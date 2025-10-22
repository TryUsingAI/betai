// src/app/api/admin/poll-results/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const ODDS_API_KEY = process.env.ODDS_API_KEY; // your env name
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Map UI sport -> TheOddsAPI sport key
const SPORT_MAP: Record<string, string> = {
  nfl: 'americanfootball_nfl',
  nba: 'basketball_nba',
  nhl: 'icehockey_nhl',
  ncaaf: 'americanfootball_ncaaf',
};

// Safe number parse
function toInt(x: unknown): number | null {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

// Extract home/away scores across payload shapes
function extractScores(g: any): { home: number | null; away: number | null } {
  // v4 common: { completed, home_team, away_team, scores: [{name,score}] }
  if (Array.isArray(g?.scores) && g?.home_team && g?.away_team) {
    const hs = g.scores.find((s: any) => s?.name === g.home_team)?.score;
    const as = g.scores.find((s: any) => s?.name === g.away_team)?.score;
    return { home: toInt(hs), away: toInt(as) };
  }
  // Some providers flatten as scores.home_score/away_score
  const hs = g?.scores?.home_score ?? g?.home_score;
  const as = g?.scores?.away_score ?? g?.away_score;
  return { home: toInt(hs), away: toInt(as) };
}

export async function POST(req: NextRequest) {
  try {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return NextResponse.json({ error: 'Supabase env missing' }, { status: 500 });
    }
    if (!ODDS_API_KEY) {
      return NextResponse.json({ error: 'ODDS_API_KEY missing' }, { status: 500 });
    }

    const url = new URL(req.url);
    const uiSport = url.searchParams.get('sport') || 'nba';
    const sportKey = SPORT_MAP[uiSport];
    const daysFrom = url.searchParams.get('daysFrom') || '2';
    if (!sportKey) {
      return NextResponse.json({ error: `unsupported sport '${uiSport}'` }, { status: 400 });
    }

    // Fetch recent scores
    const scoresRes = await fetch(
      `https://api.the-odds-api.com/v4/sports/${sportKey}/scores/?daysFrom=${daysFrom}&apiKey=${ODDS_API_KEY}`,
      { cache: 'no-store' }
    );
    if (!scoresRes.ok) {
      const txt = await scoresRes.text();
      return NextResponse.json(
        { error: `scores fetch failed: ${scoresRes.status} ${txt}` },
        { status: 502 }
      );
    }
    const games: any[] = await scoresRes.json();

    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    let finalsSeen = 0;
    let resultsUpserted = 0;

    for (const g of games) {
      const completed = Boolean(g?.completed ?? g?.final ?? false);
      if (!completed) continue;

      const { home, away } = extractScores(g);
      if (home === null || away === null) continue;
      finalsSeen++;

      // Match our event by external_event_id saved at ingest time
      const { data: ev, error: evErr } = await sb
        .from('sports_events')
        .select('id')
        .eq('external_event_id', g.id)
        .maybeSingle();

      if (evErr || !ev?.id) continue;

      const { error: upErr } = await sb
        .from('sports_event_results')
        .upsert(
          {
            event_id: ev.id,
            home_score: home,
            away_score: away,
            status: 'final',
            source: 'theoddsapi',
            raw: g,
          },
          { onConflict: 'event_id' }
        );

      if (!upErr) resultsUpserted++;
    }

    // DB trigger grades legs and settles slips on upsert
    return NextResponse.json({
      ok: true,
      sport: uiSport,
      finals_seen: finalsSeen,
      results_upserted: resultsUpserted,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'unknown error' }, { status: 500 });
  }
}
