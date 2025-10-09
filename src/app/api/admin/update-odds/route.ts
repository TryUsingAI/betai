// src/app/api/admin/update-odds/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { requireRoleFromHeader } from '@/lib/requireRole';
import { ODDS_BASE, ODDS_KEY, sportKey } from '@/lib/oddsapi';
import type { Game } from '@/lib/odds-types';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const fetchCache = 'default-no-store';

type MarketKey = 'h2h' | 'spreads' | 'totals';
type SnapshotSide = 'home' | 'away' | 'over' | 'under';

type SnapshotRow = {
  event_id: string;
  bookmaker: string;
  market: MarketKey;
  side: SnapshotSide;
  american_odds: number;
  line: number | null;
};

const BOOK_PRIORITY = ['betmgm', 'draftkings', 'fanduel', 'caesars', 'pointsbet', 'betus', 'wynnbet'];

function pickBookmaker(
  g: Game
): (Game['bookmakers'][number]) | null {
  for (const key of BOOK_PRIORITY) {
    const b = g.bookmakers.find(
      (b) => b.key === key && (b.markets?.length ?? 0) > 0
    );
    if (b) return b;
  }
  return g.bookmakers.find((b) => (b.markets?.length ?? 0) > 0) ?? null;
}

function outcomeSide(
  marketKey: string,
  oName: string,
  homeTeam: string
): SnapshotSide {
  const name = oName.toLowerCase();
  if (marketKey === 'totals') {
    return name.includes('over') ? 'over' : 'under';
  }
  return name.includes(homeTeam.toLowerCase()) ? 'home' : 'away';
}

export async function POST(req: NextRequest) {
  await requireRoleFromHeader(req, 'admin');

  const sport = (req.nextUrl.searchParams.get('sport') ?? 'nfl') as 'nfl' | 'nba' | 'nhl' | 'ncaaf';
  const url =
    `${ODDS_BASE}/sports/${sportKey(sport)}/odds` +
    `?apiKey=${ODDS_KEY}&regions=us&markets=h2h,spreads,totals&oddsFormat=american`;

  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) {
    return NextResponse.json({ ok: false, error: `odds api ${res.status}` }, { status: 400 });
  }

  const games: Game[] = await res.json();

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  let snapsInserted = 0;

  for (const g of games) {
    const { data: ev } = await supabase
      .from('sports_events')
      .select('id')
      .eq('external_event_id', g.id)
      .maybeSingle();
    if (!ev) continue;

    const bookmaker = pickBookmaker(g);
    if (!bookmaker) continue;

    const rows: SnapshotRow[] = [];

    for (const m of bookmaker.markets ?? []) {
      if (!m?.outcomes?.length) continue;
      const marketKey = (m.key as MarketKey);

      for (const o of m.outcomes) {
        rows.push({
          event_id: ev.id,
          bookmaker: bookmaker.key,
          market: marketKey,
          side: outcomeSide(marketKey, o.name, g.home_team),
          american_odds: Number(o.price),
          line: typeof o.point === 'number' ? o.point : (o.point == null ? null : Number(o.point)),
        });
      }
    }

    if (rows.length) {
      const { error } = await supabase.from('event_odds_snapshots').insert(rows);
      if (!error) snapsInserted += rows.length;
    }
  }

  return NextResponse.json({ ok: true, snapshots_inserted: snapsInserted });
}
