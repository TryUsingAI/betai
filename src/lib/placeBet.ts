// src/lib/placeBet.ts
'use client'

import { supabaseBrowser } from '@/lib/supabase-browser'

export type PlaceBetPayload = {
  event_id: string
  market: 'moneyline' | 'spread' | 'total'
  selection: 'home' | 'away' | 'over' | 'under'
  line?: number | null
  price: number
  stake_cents: number
  snapshot_id: number
  client_key?: string | null
}

export async function placeBet(payload: PlaceBetPayload) {
  const { data: { session } } = await supabaseBrowser.auth.getSession()
  const access = session?.access_token

  const res = await fetch('/api/bets/place', {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      ...(access ? { Authorization: `Bearer ${access}` } : {}),
    },
    body: JSON.stringify(payload),
  })

  const json = await res.json().catch(() => ({}))
  return { ok: res.ok, status: res.status, json }
}
