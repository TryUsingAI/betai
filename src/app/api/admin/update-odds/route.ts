// src/app/api/admin/update-odds/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { requireRoleFromHeader } from '@/lib/requireRole';
import { ODDS_BASE, ODDS_KEY, ODDS_BOOKMAKERS, sportKey } from '@/lib/oddsapi';
import type { Game } from '@/lib/odds-types';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const fetchCache = 'default-no-store';

export async function POST(req: NextRequest) {
  // Authenticate via Authorization: Bearer <token>
  await requireRoleFromHeader(req, 'admin');

  const sport = (req.nextUrl.searchParams.get('sport') ?? 'nfl') as 'nfl' | 'nba' | 'nhl' | 'ncaaf';
  const url =
    `${ODDS_BASE}/sports/${sportKey(sport)}/odds` +
    `?apiKey=${ODDS_KEY}&regions=us&markets=h2h,spreads,totals&oddsFormat=american` +
    `&bookmakers=${ODDS_BOOKMAKERS}`;

  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) {
    return NextResponse.json({ ok: false, error: `odds api ${res.status}` }, { status: 400 });
  }

  const games: Game[] = await res.json();

  // Use service role for server-side writes
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  let snapsInserted = 0;

  for (const g of games) {
    // find our event by external id
    const { data: ev } = await supabase
      .from('sports_events')
      .select('id')
      .eq('external_event_id', g.id)
      .maybeSingle();
    if (!ev) continue;

    const bookmaker = g.bookmakers[0];
    if (!bookmaker) continue;

    for (const m of bookmaker.markets) {
      for (const o of m.outcomes) {
        const { error } = await supabase.from('event_odds_snapshots').insert({
          event_id: ev.id,
          bookmaker: bookmaker.key,
          market: m.key,
          side: o.name.toLowerCase().includes('over')
            ? 'over'
            : o.name.toLowerCase().includes('under')
            ? 'under'
            : o.name.toLowerCase().includes(g.home_team.toLowerCase())
            ? 'home'
            : 'away',
          american_odds: o.price,
          line: o.point ?? null,
        });
        if (!error) snapsInserted++;
      }
    }
  }

  return NextResponse.json({ ok: true, snapshots_inserted: snapsInserted });
}
