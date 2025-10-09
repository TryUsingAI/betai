// src/lib/requireRole.ts
import type { NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { createClient, type User } from '@supabase/supabase-js';

type Role = 'user' | 'admin' | 'superadmin';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SUPABASE_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// single place to decide if the role is allowed
function isAllowed(required: 'admin' | 'superadmin', role: Role | null | undefined) {
  if (!role) return false;
  if (required === 'superadmin') return role === 'superadmin';
  // required admin ⇒ admin OR superadmin
  return role === 'admin' || role === 'superadmin';
}

/**
 * Preferred path on Next 15: validate a Bearer token from the request header,
 * then return a *service-role* client for DB work.
 *
 * Usage in route handlers:
 *   const { supabase } = await requireRoleFromHeader(req, 'admin');
 */
export async function requireRoleFromHeader(req: NextRequest, required: 'admin' | 'superadmin') {
  const auth = req.headers.get('authorization') || req.headers.get('Authorization');
  const token = auth?.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) throw new Response('Unauthorized', { status: 401 });

  // Use a service client to verify the token and to perform DB writes/reads
  const service = createClient(SUPABASE_URL, SUPABASE_SERVICE);

  const { data: { user }, error: userErr } = await service.auth.getUser(token);
  if (userErr || !user) throw new Response('Unauthorized', { status: 401 });

  const { data: prof, error: profErr } = await service
    .from('profiles')
    .select('role')
    .eq('user_id', user.id)
    .maybeSingle();

  if (profErr) throw new Response('Profile lookup failed', { status: 500 });
  const role = (prof?.role ?? 'user') as Role;

  if (!isAllowed(required, role)) throw new Response('Forbidden', { status: 403 });

  // Return a service client for the actual work
  return { supabase: service, user: user as User, role };
}

/**
 * Cookie fallback (SSR). Works when the auth cookie is present and you
 * don’t want to pass a header. Returns a *service-role* client after
 * verifying the user from cookies.
 */
export async function requireRole(required: 'admin' | 'superadmin') {
  const cookieStore = await cookies();

  // SSR client bound to cookies just to read the current user
  const ssr = createServerClient(SUPABASE_URL, SUPABASE_ANON, {
    cookies: {
      get: (name: string) => cookieStore.get(name)?.value,
      set: (name: string, value: string, options: CookieOptions) => {
        cookieStore.set({ name, value, ...options });
      },
      remove: (name: string, options: CookieOptions) => {
        cookieStore.set({ name, value: '', ...options, maxAge: 0 });
      },
    },
  });

  const { data: { user }, error: userErr } = await ssr.auth.getUser();
  if (userErr || !user) throw new Response('Unauthorized', { status: 401 });

  // Use service client for DB access (immune to RLS)
  const service = createClient(SUPABASE_URL, SUPABASE_SERVICE);

  const { data: prof, error: profErr } = await service
    .from('profiles')
    .select('role')
    .eq('user_id', user.id)
    .maybeSingle();

  if (profErr) throw new Response('Profile lookup failed', { status: 500 });
  const role = (prof?.role ?? 'user') as Role;

  if (!isAllowed(required, role)) throw new Response('Forbidden', { status: 403 });

  return { supabase: service, user: user as User, role };
}
