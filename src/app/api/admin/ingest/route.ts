// src/app/api/admin/ingest/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { requireRoleFromHeader } from '@/lib/requireRole';
import { ODDS_BASE, ODDS_KEY, sportKey } from '@/lib/oddsapi';
import type { Game } from '@/lib/odds-types';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const fetchCache = 'default-no-store';

const BOOK_PRIORITY = ['betmgm','draftkings','fanduel','caesars','pointsbet','betus','wynnbet'];

function pickBookmaker(g: Game) {
  // Try priority order first; fall back to first with markets
  for (const key of BOOK_PRIORITY) {
    const b = g.bookmakers.find(b => b.key === key && (b.markets?.length ?? 0) > 0);
    if (b) return b;
  }
  return g.bookmakers.find(b => (b.markets?.length ?? 0) > 0) ?? null;
}

function outcomeSide(marketKey: string, oName: string, homeTeam: string): 'home'|'away'|'over'|'under' {
  const name = oName.toLowerCase();
  if (marketKey === 'totals') {
    return name.includes('over') ? 'over' : 'under';
  }
  return name.includes(homeTeam.toLowerCase()) ? 'home' : 'away';
}

export async function POST(req: NextRequest) {
  await requireRoleFromHeader(req, 'admin');

  const sport = (req.nextUrl.searchParams.get('sport') ?? 'nfl') as 'nfl'|'nba'|'nhl'|'ncaaf';

  // Pull odds for ALL books; we’ll choose usable one per game
  const url =
    `${ODDS_BASE}/sports/${sportKey(sport)}/odds` +
    `?apiKey=${ODDS_KEY}&regions=us&markets=h2h,spreads,totals&oddsFormat=american`;

  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) {
    return NextResponse.json({ ok:false, error:`odds api ${res.status}` }, { status: 400 });
  }

  const games: Game[] = await res.json();

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  let eventsUpserted = 0;
  let snapsInserted = 0;

  for (const g of games) {
    // Upsert the event
    const { data: ev } = await supabase
      .from('sports_events')
      .upsert(
        {
          sport,
          league: sport.toUpperCase(),
          external_event_id: g.id,
          starts_at: g.commence_time,
          home_team: g.home_team,
          away_team: g.away_team,
        },
        { onConflict: 'external_event_id' }
      )
      .select('id')
      .single();

    if (!ev?.id) continue;
    eventsUpserted++;

    // Choose a bookmaker that actually has markets/outcomes
    const bookmaker = pickBookmaker(g);
    if (!bookmaker) continue;

    const rows: any[] = [];
    for (const m of bookmaker.markets ?? []) {
      if (!m?.outcomes?.length) continue;

      for (const o of m.outcomes) {
        rows.push({
          event_id: ev.id,
          bookmaker: bookmaker.key,
          market: m.key, // 'h2h' | 'spreads' | 'totals'
          side: outcomeSide(m.key, o.name, g.home_team),
          american_odds: Number(o.price),
          line: o.point ?? null,
        });
      }
    }

    if (rows.length) {
      const { error, count } = await supabase
        .from('event_odds_snapshots')
        .insert(rows)
        .select('*', { count: 'exact', head: true });
      if (!error) snapsInserted += rows.length;
    }
  }

  return NextResponse.json({ ok: true, events_upserted: eventsUpserted, snapshots_inserted: snapsInserted });
}
