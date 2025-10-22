// middleware.ts
import { NextRequest, NextResponse } from 'next/server'
import { createMiddlewareClient } from '@supabase/auth-helpers-nextjs'

export async function middleware(req: NextRequest) {
  const res = NextResponse.next()
  const supabase = createMiddlewareClient({ req, res })
  await supabase.auth.getSession()
  return res
}

// run on everything except static assets
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
