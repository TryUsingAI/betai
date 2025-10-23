// src/app/dashboard/page.tsx
export const revalidate = 0;
export const fetchCache = 'force-no-store';

import { unstable_noStore as noStore } from 'next/cache';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createServerClient, type CookieOptions } from '@supabase/ssr';

function fmtMoney(v: unknown, assumeDollars = true) {
  if (typeof v === 'number') {
    // if value looks like cents (>= 1000), treat as cents
    if (!assumeDollars && v >= 1000) return `$${(v / 100).toFixed(2)}`;
    return `$${v.toFixed(2)}`;
  }
  return '$0.00';
}

export default async function DashboardPage() {
  noStore();

  const store = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get: (name: string) => store.get(name)?.value,
        set: (_n: string, _v: string, _o: CookieOptions) => {},
        remove: (_n: string, _o: CookieOptions) => {},
      },
    }
  );

  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user) redirect('/');

  // Wallet (prod uses cents)
  const { data: wallet } = await supabase
    .from('wallets')
    .select('balance_cents')
    .single();

  // Counts from bet_slips (these columns exist)
  const { count: openSlips } = await supabase
    .from('bet_slips')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', auth.user.id)
    .eq('status', 'open');

  const { count: totalSlips } = await supabase
    .from('bet_slips')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', auth.user.id);

  // List from the stable view `bets`; select * to avoid column mismatches
  const { data: bets } = await supabase
    .from('bets')
    .select(`
      *,
      bet_legs (
        id, event_id, market, side, line, american_odds, selection, price
      )
    `)
    .eq('user_id', auth.user.id)
    .order('created_at', { ascending: false })
    .limit(50);

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-semibold">Your Dashboard</h1>

      <section className="grid gap-4 md:grid-cols-3">
        <div className="border rounded p-4">
          <div className="text-sm opacity-70">Wallet Balance</div>
          <div className="text-2xl font-bold">
            {wallet?.balance_cents != null ? `$${(wallet.balance_cents / 100).toFixed(2)}` : '$0.00'}
          </div>
        </div>
        <div className="border rounded p-4">
          <div className="text-sm opacity-70">Open Bets</div>
          <div className="text-2xl font-bold">{openSlips ?? 0}</div>
        </div>
        <div className="border rounded p-4">
          <div className="text-sm opacity-70">Total Bets (last 50)</div>
          <div className="text-2xl font-bold">{Math.min(totalSlips ?? 0, 50)}</div>
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-3">Recent Bets</h2>
        <div className="border rounded divide-y">
          {(bets ?? []).map((b: any) => {
            // Support either dollars or cents fields in prod vs dev
            const stake =
              typeof b.stake_cents === 'number'
                ? `$${(b.stake_cents / 100).toFixed(2)}`
                : fmtMoney(b.stake, true);

            const potential =
              typeof b.potential_payout_cents === 'number'
                ? `$${(b.potential_payout_cents / 100).toFixed(2)}`
                : fmtMoney(b.potential ?? b.potential_payout, true);

            return (
              <div key={b.id} className="p-4">
                <div className="flex items-center justify-between">
                  <div className="font-mono text-sm">{b.id}</div>
                  <div className="text-sm opacity-70">
                    {new Date(b.created_at).toLocaleString()}
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap gap-4 text-sm">
                  <div>Status: <span className="font-medium">{b.status}</span></div>
                  <div>Stake: <span className="font-medium">{stake}</span></div>
                  <div>Potential: <span className="font-medium">{potential}</span></div>
                </div>
                <div className="mt-3">
                  <div className="text-xs opacity-70 mb-1">Legs</div>
                  <div className="grid gap-2">
                    {(b.bet_legs ?? []).map((l: any) => (
                      <div key={l.id} className="border rounded p-2 text-sm flex justify-between">
                        <div>
                          <div className="font-medium">
                            {l.market} • {(l.selection ?? l.side) ?? ''}{' '}
                            {l.line !== null && l.line !== undefined ? String(l.line) : ''}
                          </div>
                          <div className="opacity-70">Odds: {l.american_odds}</div>
                        </div>
                        <div className="opacity-70">Event: {l.event_id}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            );
          })}
          {(bets ?? []).length === 0 && (
            <div className="p-6 text-sm opacity-70">No bets yet.</div>
          )}
        </div>
      </section>
    </div>
  );
}
