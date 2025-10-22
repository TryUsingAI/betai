// src/app/api/bets/place/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'

type Body = {
  event_id: string
  market: 'moneyline' | 'spread' | 'total'
  selection: 'home' | 'away' | 'over' | 'under'
  line?: number | null
  price: number
  stake_cents: number
  snapshot_id: number
  client_key?: string | null
}

export async function POST(req: NextRequest) {
  const store = await cookies()
  const authHeader = req.headers.get('authorization') || ''

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get: (name) => store.get(name)?.value,
        set: (name, value, options) => { store.set(name, value, options) },
        remove: (name, options) => { store.set(name, '', { ...options, maxAge: 0 }) },
      },
      global: { headers: { Authorization: authHeader } },
    }
  )

  const { data: auth, error: authErr } = await supabase.auth.getUser()
  if (authErr || !auth?.user) {
    return NextResponse.json({ ok: false, error: 'unauthenticated' }, { status: 401 })
  }

  let body: Body
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid json' }, { status: 400 })
  }

  const errors: string[] = []
  if (!body?.event_id) errors.push('event_id required')
  if (!['moneyline', 'spread', 'total'].includes(String(body?.market))) errors.push('invalid market')
  if (!['home', 'away', 'over', 'under'].includes(String(body?.selection))) errors.push('invalid selection')
  if (!Number.isFinite(body?.price)) errors.push('invalid price')
  if (!Number.isInteger(body?.stake_cents) || body.stake_cents <= 0) errors.push('invalid stake_cents')
  if (!Number.isFinite(body?.snapshot_id)) errors.push('invalid snapshot_id')
  if ((body.market === 'spread' || body.market === 'total') && !Number.isFinite(body.line as number)) {
    errors.push('line required for spread/total')
  }
  if (errors.length) {
    return NextResponse.json({ ok: false, error: errors.join(', ') }, { status: 400 })
  }

  // CHANGED: align to DB function signature (7 args, returns void)
const { error } = await supabase.rpc('execute_place_bet', {
  p_user_id: auth.user.id,
  p_stake: body.stake_cents / 100,
  p_event_id: body.event_id,
  p_market: body.market,
  p_side: body.selection,
  p_line: body.line ?? null,
  p_american_odds: Math.trunc(body.price),
  p_client_key: body.client_key ?? null,   // ← add
})

  if (error) {
    const msg = error.message || 'bet placement failed'
    const code = msg.includes('INSUFFICIENT_FUNDS') ? 402 : 400
    return NextResponse.json({ ok: false, error: msg }, { status: code })
  }

  // CHANGED: function returns void, so no bet_id here
  return NextResponse.json({ ok: true })
}
