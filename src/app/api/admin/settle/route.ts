// src/app/api/admin/settle/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { requireRoleFromHeader } from '@/lib/requireRole';
import { ODDS_BASE, ODDS_KEY, sportKey } from '@/lib/oddsapi';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const fetchCache = 'default-no-store';

// ---- External scores (Odds API) ----
type ScoreEntry = { name: string; score: number | string };
type OddsScoresGame = {
  id: string;
  home_team: string;
  away_team: string;
  completed: boolean;
  scores?: ScoreEntry[];
};

// ---- Local DB shapes we read ----
type Market = 'moneyline' | 'spread' | 'total';
type Side = 'home' | 'away' | 'over' | 'under';

type JoinedEvent = {
  home_team: string | null;
  away_team: string | null;
  home_score: number | null;
  away_score: number | null;
  status: string | null;
};

type LegRow = {
  id: number;
  slip_id: string;
  market: Market;
  side: Side;
  line: number | string | null;
  event_id: string;
  sports_events: JoinedEvent;
};

export async function POST(req: NextRequest) {
  const { supabase } = await requireRoleFromHeader(req, 'admin');

  const sport = (req.nextUrl.searchParams.get('sport') ?? 'nfl') as 'nfl' | 'nba' | 'nhl' | 'ncaaf';

  // 1) Pull scores from last 3 days
  const scoresUrl = `${ODDS_BASE}/sports/${sportKey(sport)}/scores?apiKey=${ODDS_KEY}&daysFrom=3`;
  const r = await fetch(scoresUrl, { cache: 'no-store' });
  if (!r.ok) {
    return NextResponse.json({ ok: false, error: `scores api ${r.status}` }, { status: 400 });
  }
  const games: OddsScoresGame[] = await r.json();

  // 2) Update events with final scores
  const finals = games.filter((g) => g.completed && (g.scores?.length ?? 0) >= 2);
  for (const g of finals) {
    const sh = Number(g.scores?.find((s) => s.name === g.home_team)?.score ?? 0);
    const sa = Number(g.scores?.find((s) => s.name === g.away_team)?.score ?? 0);

    await supabase
      .from('sports_events')
      .update({ home_score: sh, away_score: sa, status: 'final' })
      .eq('external_event_id', g.id);
  }

  // 3) Select legs joined to final events
  const { data: legs } = await supabase
    .from('bet_legs')
    .select(
      'id, slip_id, market, side, line, event_id, sports_events!inner(home_team,away_team,home_score,away_score,status)'
    )
    .eq('sports_events.status', 'final');

  if (!legs || legs.length === 0) {
    return NextResponse.json({
      ok: true,
      updated_events: finals.length,
      settled_slips: 0,
      legs: { won: 0, lost: 0, void: 0 },
    });
  }

  const rows: LegRow[] = legs as unknown as LegRow[];

  const winLegIds: number[] = [];
  const loseLegIds: number[] = [];
  const voidLegIds: number[] = [];

  for (const l of rows) {
    const sh = Number(l.sports_events.home_score ?? 0);
    const sa = Number(l.sports_events.away_score ?? 0);
    const total = sh + sa;

    if (l.market === 'moneyline') {
      const winner: 'home' | 'away' | 'draw' = sh === sa ? 'draw' : sh > sa ? 'home' : 'away';
      if (winner === 'draw') voidLegIds.push(l.id);
      else if (l.side === winner) winLegIds.push(l.id);
      else loseLegIds.push(l.id);
    }

    if (l.market === 'spread') {
      const margin = sh - sa; // >0 home by X
      const line = Number(l.line ?? 0);
      const picked = l.side === 'home' ? margin - line : -margin - line;
      if (picked > 0) winLegIds.push(l.id);
      else if (picked < 0) loseLegIds.push(l.id);
      else voidLegIds.push(l.id);
    }

    if (l.market === 'total') {
      const line = Number(l.line ?? 0);
      const diff = total - line;
      if (diff === 0) voidLegIds.push(l.id);
      else if (l.side === 'over' ? diff > 0 : diff < 0) winLegIds.push(l.id);
      else loseLegIds.push(l.id);
    }
  }

  if (winLegIds.length) await supabase.from('bet_legs').update({ result: 'won' }).in('id', winLegIds);
  if (loseLegIds.length) await supabase.from('bet_legs').update({ result: 'lost' }).in('id', loseLegIds);
  if (voidLegIds.length) await supabase.from('bet_legs').update({ result: 'void' }).in('id', voidLegIds);

  // 4) Settle slips
  const { data: slips } = await supabase.from('bet_slips').select('id').eq('status', 'open');
  let settled = 0;

  for (const s of slips ?? []) {
    const { data: legsS } = await supabase.from('bet_legs').select('result').eq('slip_id', s.id);
    if (!legsS?.length) continue;
    const outcomes = legsS.map((x) => x.result);

    if (outcomes.every((r) => r === 'won')) {
      await supabase.from('bet_slips').update({ status: 'won', settled_at: new Date().toISOString() }).eq('id', s.id);
      settled++;
    } else if (outcomes.some((r) => r === 'lost')) {
      await supabase.from('bet_slips').update({ status: 'lost', settled_at: new Date().toISOString() }).eq('id', s.id);
      settled++;
    } else if (outcomes.every((r) => r === 'void')) {
      await supabase.from('bet_slips').update({ status: 'void', settled_at: new Date().toISOString() }).eq('id', s.id);
      settled++;
    }
  }

  return NextResponse.json({
    ok: true,
    updated_events: finals.length,
    settled_slips: settled,
    legs: { won: winLegIds.length, lost: loseLegIds.length, void: voidLegIds.length },
  });
}
