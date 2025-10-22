import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'

export async function GET(req: Request) {
  const store = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get: (name) => store.get(name)?.value,
        set: (name, value, options) => { store.set(name, value, options) },
        remove: (name, options) => { store.set(name, '', { ...options, maxAge: 0 }) },
      },
    }
  )

  const url = new URL(req.url)
  const code = url.searchParams.get('code')
  if (code) {
    await supabase.auth.exchangeCodeForSession(code)
  }

  // send users back to home or your /bet page
  const redirectTo = url.searchParams.get('redirect') ?? '/bet'
  return NextResponse.redirect(new URL(redirectTo, url.origin))
}
