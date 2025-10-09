import { NextRequest } from 'next/server';
import { requireRole } from '@/lib/requireRole';
import { ODDS_BASE, ODDS_KEY, ODDS_BOOKMAKERS, sportKey } from '@/lib/oddsapi';

export async function POST(req: NextRequest) {
  const { supabase } = await requireRole('admin');
  const sport = new URL(req.url).searchParams.get('sport') || 'nfl';

  // events in ±24h
  const now = Date.now();
  const from = new Date(now - 24*3600*1000).toISOString();
  const to   = new Date(now + 24*3600*1000).toISOString();
  const { data: events } = await supabase
    .from('sports_events')
    .select('id, external_event_id, home_team, away_team')
    .gte('starts_at', from).lte('starts_at', to);

  if (!events?.length) return Response.json({ ok:true, snapshots: 0 });

  const url = `${ODDS_BASE}/sports/${sportKey(sport)}/odds?apiKey=${ODDS_KEY}&regions=us&markets=h2h,spreads,totals&oddsFormat=american`+
  `&bookmakers=${ODDS_BOOKMAKERS}`;
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) return Response.json({ ok:false, error:`odds api ${res.status}` }, { status: 400 });
  const games: any[] = await res.json();

  const byId = new Map(games.map(g => [g.id, g]));
  let snaps = 0;

  for (const ev of events) {
    const g = byId.get(ev.external_event_id);
    if (!g) continue;
    for (const bk of g.bookmakers ?? []) {
      const bookmaker = bk.key as string;
      for (const mk of bk.markets ?? []) {
        if (mk.key === 'h2h') {
          for (const o of mk.outcomes ?? []) {
            const side = o.name === ev.home_team ? 'home' : o.name === ev.away_team ? 'away' : 'draw';
            await supabase.from('event_odds_snapshots').insert({
              event_id: ev.id, bookmaker, market: 'moneyline', side,
              american_odds: Number(o.price)
            });
            snaps++;
          }
        }
        if (mk.key === 'spreads') {
          for (const o of mk.outcomes ?? []) {
            const side = o.name === ev.home_team ? 'home' : 'away';
            await supabase.from('event_odds_snapshots').insert({
              event_id: ev.id, bookmaker, market: 'spread', side,
              line: Number(o.point), american_odds: Number(o.price)
            });
            snaps++;
          }
        }
        if (mk.key === 'totals') {
          for (const o of mk.outcomes ?? []) {
            const side = (o.name || '').toLowerCase() === 'over' ? 'over' : 'under';
            await supabase.from('event_odds_snapshots').insert({
              event_id: ev.id, bookmaker, market: 'total', side,
              line: Number(o.point), american_odds: Number(o.price)
            });
            snaps++;
          }
        }
      }
    }
  }

  return Response.json({ ok:true, snapshots: snaps });
}
