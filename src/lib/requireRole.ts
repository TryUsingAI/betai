import { headers } from 'next/headers';
import { createClient } from '@supabase/supabase-js';

export async function requireRole(required: 'admin'|'superadmin') {
  const h = await headers();
  const auth = h.get('authorization') || h.get('Authorization');
  const token = auth?.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) throw new Response('Unauthorized', { status: 401 });

  // Admin client
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Validate user from JWT
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) throw new Response('Unauthorized', { status: 401 });

  // Role check
  const { data: prof, error: profErr } = await supabase
    .from('profiles').select('role').eq('user_id', user.id).single();
  if (profErr) throw new Response('Profile lookup failed', { status: 500 });

  const ok = prof?.role === 'superadmin' || (required === 'admin' && prof?.role === 'admin');
  if (!ok) throw new Response('Forbidden', { status: 403 });

  return { supabase, user, role: prof.role as string };
}
