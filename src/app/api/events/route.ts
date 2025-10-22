import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const sport = (url.searchParams.get('sport') ?? 'nhl') as string
  const startIso = url.searchParams.get('start') ?? new Date().toISOString()

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: {
        headers: {
          Authorization: req.headers.get('authorization') ?? '',
        },
      },
    }
  )

  const { data, error } = await supabase.rpc('events_with_latest_odds_v2', {
    p_sport: sport,
    p_start_iso: startIso,
  })

  if (error) {
    console.error('RPC error:', error.message)
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }

  return NextResponse.json({
    ok: true,
    sport,
    events: data ?? [],
  })
}
