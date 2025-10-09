import { NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { event_id, market, side, line, american_odds, stake } = body;

  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { cookies: { get: (k)=>cookieStore.get(k)?.value } }
  );
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response('Unauthorized', { status: 401 });

  const { error: seedErr } = await supabase.rpc('seed_wallet_if_needed', { p_user_id: user.id });
  if (seedErr) return new Response(seedErr.message, { status: 400 });

  const { error: txErr } = await supabase.rpc('execute_place_bet', {
    p_user_id: user.id,
    p_stake: stake,
    p_event_id: event_id,
    p_market: market,
    p_side: side,
    p_line: line,
    p_american_odds: american_odds
  });
  if (txErr) return new Response(txErr.message, { status: 400 });

  return Response.json({ ok: true });
}
