import { NextRequest, NextResponse } from 'next/server';
import { requireRoleFromHeader } from '@/lib/requireRole';
import { ODDS_BASE, ODDS_KEY, ODDS_BOOKMAKERS, sportKey } from '@/lib/oddsapi';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const fetchCache = 'default-no-store';

// Minimal Odds API types (kept local to avoid extra imports)
type OddsOutcome = { name: string; price: number; point?: number | null };
type OddsMarket = { key: 'h2h' | 'spreads' | 'totals'; outcomes: OddsOutcome[] };
type OddsBookmaker = { key: string; markets: OddsMarket[] };
type Game = {
  id: string;
  commence_time: string;
  home_team: string;
  away_team: string;
  bookmakers: OddsBookmaker[];
};

export async function POST(req: NextRequest) {
  const { supabase } = await requireRoleFromHeader(req, 'admin');

  const sport = (req.nextUrl.searchParams.get('sport') ?? 'nfl') as 'nfl' | 'nba' | 'nhl' | 'ncaaf';
  const url =
    `${ODDS_BASE}/sports/${sportKey(sport)}/odds` +
    `?apiKey=${ODDS_KEY}&regions=us&markets=h2h,spreads,totals&oddsFormat=american` +
    `&bookmakers=${ODDS_BOOKMAKERS}`;

  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) {
    return NextResponse.json({ ok: false, error: `odds api ${res.status}` }, { status: 400 });
  }

  const games = (await res.json()) as Game[];

  let eventsUpserted = 0;
  let snapsInserted = 0;

  for (const g of games) {
    // Upsert event
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

    const bookmaker = g.bookmakers?.[0];
    if (!bookmaker) continue;

    for (const m of bookmaker.markets) {
      for (const o of m.outcomes) {
        const side =
          o.name.toLowerCase().includes('over') ? 'over' :
          o.name.toLowerCase().includes('under') ? 'under' :
          o.name.toLowerCase().includes(g.home_team.toLowerCase()) ? 'home' : 'away';

        const { error } = await supabase.from('event_odds_snapshots').insert({
          event_id: ev.id,
          bookmaker: bookmaker.key,
          market: m.key,
          side,
          american_odds: o.price,
          line: o.point ?? null,
        });
        if (!error) snapsInserted++;
      }
    }
  }

  return NextResponse.json({
    ok: true,
    events_upserted: eventsUpserted,
    snapshots_inserted: snapsInserted,
  });
}
