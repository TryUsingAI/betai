'use client';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase-browser';

type Profile = { user_id: string; username: string | null; role: string | null };

export default function Home() {
  const [sessionUserId, setSessionUserId] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [magicEmail, setMagicEmail] = useState('');
  const [username, setUsername] = useState('');
  const [status, setStatus] = useState('idle');

  async function loadProfile(uid: string) {
    const { data } = await supabase
      .from('profiles')
      .select('user_id, username, role')
      .eq('user_id', uid)
      .maybeSingle();
    if (data) setProfile(data as Profile);
  }

  // Create profile + wallet only if missing. Never overwrite username.
  async function ensureProfileAndSeed(uid: string) {
    const { data: prof } = await supabase
      .from('profiles')
      .select('user_id')
      .eq('user_id', uid)
      .maybeSingle();
    if (!prof) {
      await supabase.from('profiles').insert({ user_id: uid });
    }
    await supabase.rpc('seed_wallet_if_needed', { _user: uid });
    await loadProfile(uid);
  }

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data }) => {
      const uid = data.user?.id ?? null;
      setSessionUserId(uid);
      if (uid) await ensureProfileAndSeed(uid);
      else setProfile(null);
    });
    const { data: sub } = supabase.auth.onAuthStateChange(async (_e, sess) => {
      const uid = sess?.user?.id ?? null;
      setSessionUserId(uid);
      if (uid) await ensureProfileAndSeed(uid);
      else setProfile(null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  async function handleEmailPassword() {
    setStatus('working');
    const { data: si, error: siErr } = await supabase.auth.signInWithPassword({ email, password: pw });
    if (!siErr && si?.user) { setStatus('ok'); return; }
    const { error: suErr } = await supabase.auth.signUp({ email, password: pw });
    setStatus(suErr ? 'error: ' + suErr.message : 'check your email to confirm');
  }

  async function handleMagicLink() {
    setStatus('working');
    const { error } = await supabase.auth.signInWithOtp({
      email: magicEmail,
      options: { emailRedirectTo: window.location.origin }
    });
    setStatus(error ? 'error: ' + error.message : 'sent');
  }

  async function handleGoogle() {
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin }
    });
  }

  async function saveUsername() {
    if (!sessionUserId || !username.trim()) return;
    setStatus('working');
    const { error } = await supabase
      .from('profiles')
      .update({ username: username.trim() })
      .eq('user_id', sessionUserId);
    setStatus(error ? 'error: ' + error.message : 'ok');
    if (!error) await loadProfile(sessionUserId);
  }

  async function logout() {
    await supabase.auth.signOut();
    setSessionUserId(null);
    setProfile(null);
    window.location.assign('/'); // hard reset
  }

  return (
    <main style={{ maxWidth: 560, margin: '48px auto', fontFamily: 'system-ui, sans-serif' }}>
      <h1>betai — auth smoke test</h1>

      {!sessionUserId && (
        <>
          <section style={{ marginTop: 24, padding: 16, border: '1px solid #444' }}>
            <h2>Email + Password</h2>
            <input placeholder="email" value={email} onChange={e => setEmail(e.target.value)} />
            <input placeholder="password" type="password" value={pw} onChange={e => setPw(e.target.value)} />
            <button onClick={handleEmailPassword}>Sign up / Sign in</button>
          </section>

          <section style={{ marginTop: 16, padding: 16, border: '1px solid #444' }}>
            <h2>Magic Link</h2>
            <input placeholder="email for magic link" value={magicEmail} onChange={e => setMagicEmail(e.target.value)} />
            <button onClick={handleMagicLink}>Send link</button>
          </section>

          <section style={{ marginTop: 16, padding: 16, border: '1px solid #444' }}>
            <h2>Google</h2>
            <button onClick={handleGoogle}>Continue with Google</button>
          </section>
        </>
      )}

      {!!sessionUserId && (
        <section style={{ marginTop: 24, padding: 16, border: '1px solid #444' }}>
          <p><strong>User:</strong> {sessionUserId}</p>
          <p><strong>Role:</strong> {profile?.role ?? '—'}</p>
          <p><strong>Username:</strong> {profile?.username ?? '(not set)'}</p>

          {!profile?.username && (
            <div style={{ marginTop: 12 }}>
              <input placeholder="choose a username" value={username} onChange={e => setUsername(e.target.value)} />
              <button onClick={saveUsername}>Save username</button>
            </div>
          )}

          <div style={{ marginTop: 12 }}>
            <button onClick={logout}>Log out</button>
          </div>
        </section>
      )}

      <p style={{ marginTop: 16, color: '#888' }}>status: {status}</p>

      <style jsx global>{`
        input { display:block; margin:8px 0; padding:8px; width:100%; }
        button { padding:8px 12px; }
        h1,h2 { margin: 0 0 8px 0; }
      `}</style>
    </main>
  );
}
