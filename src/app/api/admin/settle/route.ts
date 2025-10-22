// src/app/api/admin/settle/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'

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

  // call the function we actually deployed
  const { data, error } = await supabase.rpc('admin_settle_bets')

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }

  return NextResponse.json({
    ok: true,
    settled: data?.settled ?? null,
  })
}
