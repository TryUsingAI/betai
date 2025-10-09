import { NextRequest } from 'next/server';
import { requireRole } from '@/lib/requireRole';
import { ODDS_BASE, ODDS_KEY, ODDS_BOOKMAKERS, sportKey } from '@/lib/oddsapi';

export async function POST(req: NextRequest) {
  const { supabase } = await requireRole('admin');
  const sport = new URL(req.url).searchParams.get('sport') || 'nfl';

  // Odds + events snapshot
  const url = `${ODDS_BASE}/sports/${sportKey(sport)}/odds?apiKey=${ODDS_KEY}&regions=us&markets=h2h,spreads,totals&oddsFormat=american`+
  `&bookmakers=${ODDS_BOOKMAKERS}`;
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) return Response.json({ ok:false, error:`odds api ${res.status}` }, { status: 400 });
  const games: any[] = await res.json();

  let evIns = 0, snapIns = 0;
  for (const g of games) {
    const extId = g.id as string;
    const home = g.home_team as string;
    const away = g.away_team as string;
    const starts = g.commence_time as string;

    // upsert event
    const { data: ev } = await supabase.from('sports_events').upsert({
      external_event_id: extId,
      sport, league: sport.toUpperCase(),
      starts_at: starts, home_team: home, away_team: away,
      status: 'scheduled'
    }, { onConflict: 'external_event_id' }).select('id').single();
    if (!ev?.id) continue;
    evIns++;

    // insert snapshots for each bookmaker/market
    for (const bk of g.bookmakers ?? []) {
      const bookmaker = bk.key as string;
      for (const mk of bk.markets ?? []) {
        const market = mk.key as 'h2h'|'spreads'|'totals';
        if (market === 'h2h') {
          for (const o of mk.outcomes ?? []) {
            const side = o.name === home ? 'home' : o.name === away ? 'away' : 'draw';
            await supabase.from('event_odds_snapshots').insert({
              event_id: ev.id, bookmaker, market: 'moneyline', side,
              american_odds: Number(o.price)
            });
            snapIns++;
          }
        } else if (market === 'spreads') {
          for (const o of mk.outcomes ?? []) {
            const side = o.name === home ? 'home' : 'away';
            await supabase.from('event_odds_snapshots').insert({
              event_id: ev.id, bookmaker, market: 'spread', side,
              line: Number(o.point), american_odds: Number(o.price)
            });
            snapIns++;
          }
        } else if (market === 'totals') {
          for (const o of mk.outcomes ?? []) {
            const side = (o.name || '').toLowerCase() === 'over' ? 'over' : 'under';
            await supabase.from('event_odds_snapshots').insert({
              event_id: ev.id, bookmaker, market: 'total', side,
              line: Number(o.point), american_odds: Number(o.price)
            });
            snapIns++;
          }
        }
      }
    }
  }

  return Response.json({ ok:true, events_upserted: evIns, snapshots_inserted: snapIns });
}
