// src/app/api/admin/update-odds/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { requireRoleFromHeader } from '@/lib/requireRole';
import { ODDS_BASE, ODDS_KEY, sportKey } from '@/lib/oddsapi';
import type { Game } from '@/lib/odds-types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const fetchCache = 'default-no-store';

export async function POST(req: NextRequest) {
  // Require admin via Authorization: Bearer <token> (cookie fallback is in requireRole*)
  await requireRoleFromHeader(req, 'admin');

  const sport = (req.nextUrl.searchParams.get('sport') ?? 'nfl') as 'nfl' | 'nba' | 'nhl' | 'ncaaf';

  // No "bookmakers=" filter so we always have a fallback
  const url =
    `${ODDS_BASE}/sports/${sportKey(sport)}/odds` +
    `?apiKey=${ODDS_KEY}&regions=us&markets=h2h,spreads,totals&oddsFormat=american`;

  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) {
    return NextResponse.json({ ok: false, error: `odds api ${res.status}` }, { status: 400 });
  }

  const games: Game[] = await res.json();

  // Server-side Supabase client (service role for writes)
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { cookies: { get: (n) => cookieStore.get(n)?.value } }
  );

  const preferred = (process.env.PRIMARY_BOOKMAKER ?? '').toLowerCase();
  let snapsInserted = 0;

  for (const g of games) {
    // Find our event by external id
    const { data: ev } = await supabase
      .from('sports_events')
      .select('id')
      .eq('external_event_id', g.id)
      .maybeSingle();
    if (!ev) continue;

    // Prefer PRIMARY_BOOKMAKER, else first available
    const bookmaker =
      g.bookmakers.find((b) => b.key.toLowerCase() === preferred) ?? g.bookmakers[0];
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

  return NextResponse.json({ ok: true, snapshots_inserted: snapsInserted });
}
