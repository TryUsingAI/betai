// src/app/dashboard/page.tsx
export const revalidate = 0;
export const fetchCache = 'force-no-store';

import { unstable_noStore as noStore } from 'next/cache';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createServerClient, type CookieOptions } from '@supabase/ssr';

function fmtCents(c: number | null | undefined) {
  const n = typeof c === 'number' ? c : 0;
  return `$${(n / 100).toFixed(2)}`;
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

  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr || !auth?.user) redirect('/');

  // 1) counts (unfiltered and filtered) to see what RLS returns
  const allCountQ = supabase.from('bet_slips').select('id', { count: 'exact', head: true });
  const myCountQ  = supabase.from('bet_slips').select('id', { count: 'exact', head: true }).eq('user_id', auth.user.id);

  const [{ count: allCount, error: allErr }, { count: myCount, error: myErr }] = await Promise.all([allCountQ, myCountQ]);

  // 2) fetch minimal rows first, no nested join, to rule out relation issues
  const { data: slipsRaw, error: slipsErr } = await supabase
    .from('bet_slips')
    .select('id, created_at, status, stake_cents, potential_payout_cents, user_id')
    .eq('user_id', auth.user.id)
    .order('created_at', { ascending: false })
    .limit(50);

  // 3) fetch legs separately for shown slips (avoid nested select masking rows)
  let legsBySlip: Record<string, any[]> = {};
  if (slipsRaw && slipsRaw.length > 0) {
    const ids = slipsRaw.map(s => s.id);
    const { data: legs, error: legsErr } = await supabase
      .from('bet_legs')
      .select('id, slip_id, event_id, market, side, line, american_odds, selection, price')
      .in('slip_id', ids);

    if (!legsErr && legs) {
      legsBySlip = legs.reduce((acc: any, l: any) => {
        (acc[l.slip_id] ||= []).push(l);
        return acc;
      }, {});
    }
  }

  // wallet (optional)
  const { data: wallet } = await supabase.from('wallets').select('balance_cents').single();

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-semibold">Your Dashboard</h1>

      {/* TEMP DEBUG: show auth + query diagnostics */}
      <div className="text-xs space-y-1 p-3 border rounded bg-black/5">
        <div>uid: {auth.user.id}</div>
        <div>allCount(bet_slips): {allCount ?? 'null'} {allErr ? `ERR:${allErr.message}` : ''}</div>
        <div>myCount(bet_slips where user_id=uid): {myCount ?? 'null'} {myErr ? `ERR:${myErr.message}` : ''}</div>
        <div>slipsRaw len: {slipsRaw?.length ?? 0} {slipsErr ? `ERR:${slipsErr.message}` : ''}</div>
      </div>

      <section className="grid gap-4 md:grid-cols-3">
        <div className="border rounded p-4">
          <div className="text-sm opacity-70">Wallet Balance</div>
          <div className="text-2xl font-bold">{fmtCents(wallet?.balance_cents)}</div>
        </div>
        <div className="border rounded p-4">
          <div className="text-sm opacity-70">Open Bets</div>
          <div className="text-2xl font-bold">
            {/* derive quickly from slipsRaw */}
            {(slipsRaw ?? []).filter(s => s.status === 'open').length}
          </div>
        </div>
        <div className="border rounded p-4">
          <div className="text-sm opacity-70">Total Bets (listed)</div>
          <div className="text-2xl font-bold">{slipsRaw?.length ?? 0}</div>
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-3">Recent Bets</h2>
        <div className="border rounded divide-y">
          {(slipsRaw ?? []).map((b: any) => (
            <div key={b.id} className="p-4">
              <div className="flex items-center justify-between">
                <div className="font-mono text-sm">{b.id}</div>
                <div className="text-sm opacity-70">{new Date(b.created_at).toLocaleString()}</div>
              </div>
              <div className="mt-2 flex flex-wrap gap-4 text-sm">
                <div>Status: <span className="font-medium">{b.status}</span></div>
                <div>Stake: <span className="font-medium">{fmtCents(b.stake_cents)}</span></div>
                <div>Potential: <span className="font-medium">{fmtCents(b.potential_payout_cents)}</span></div>
              </div>
              <div className="mt-3">
                <div className="text-xs opacity-70 mb-1">Legs</div>
                <div className="grid gap-2">
                  {(legsBySlip[b.id] ?? []).map((l: any) => (
                    <div key={l.id} className="border rounded p-2 text-sm flex justify-between">
                      <div>
                        <div className="font-medium">
                          {l.market} • {(l.selection ?? l.side) ?? ''} {l.line !== null ? String(l.line) : ''}
                        </div>
                        <div className="opacity-70">Odds: {l.american_odds}</div>
                      </div>
                      <div className="opacity-70">Event: {l.event_id}</div>
                    </div>
                  ))}
                  {(legsBySlip[b.id] ?? []).length === 0 && (
                    <div className="text-xs opacity-60">No legs found.</div>
                  )}
                </div>
              </div>
              <div className="mt-2 text-xs opacity-60">user_id on row: {b.user_id}</div>
            </div>
          ))}

          {(slipsRaw ?? []).length === 0 && (
            <div className="p-6 text-sm opacity-70">No bets yet.</div>
          )}
        </div>
      </section>
    </div>
  );
}
