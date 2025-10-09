// src/app/admin/page.tsx
'use client';

import { useEffect, useState, ChangeEvent } from 'react';
import { supabase } from '@/lib/supabase-browser';

type Sport = 'nfl' | 'nba' | 'nhl' | 'ncaaf';
type AdminPath = '/api/admin/ingest' | '/api/admin/update-odds' | '/api/admin/settle';

export default function AdminPage() {
  const [sport, setSport] = useState<Sport>('nfl');
  const [log, setLog] = useState<string>('');
  const [token, setToken] = useState<string | null>(null);

  // Get an access token we can send as a Bearer header
  useEffect(() => {
    let active = true;

    async function load() {
      const { data } = await supabase.auth.getSession();
      if (!active) return;
      setToken(data.session?.access_token ?? null);
    }

    // initial + react to auth changes
    load();
    const { data: sub } = supabase.auth.onAuthStateChange(async () => {
      await load();
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  async function run(path: AdminPath) {
    setLog('Running...');
    try {
      const res = await fetch(`${path}?sport=${sport}`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      const text = await res.text();
      setLog(text);
    } catch (err: unknown) {
      setLog(`Request failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  function onSport(e: ChangeEvent<HTMLSelectElement>) {
    setSport(e.target.value as Sport);
  }

  const authed = !!token;

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-semibold">Admin</h1>

      <div className="flex items-center gap-3">
        <label>Sport</label>
        <select className="border px-2 py-1 rounded" value={sport} onChange={onSport}>
          <option value="nfl">NFL</option>
          <option value="nba">NBA</option>
          <option value="nhl">NHL</option>
          <option value="ncaaf">NCAAF</option>
        </select>
      </div>

      {!authed && (
        <p className="text-sm text-red-600">
          You are not authenticated. Log in to run admin actions.
        </p>
      )}

      <div className="flex gap-3">
        <button
          className="border px-3 py-2 rounded disabled:opacity-50"
          disabled={!authed}
          onClick={() => run('/api/admin/ingest')}
        >
          Ingest
        </button>
        <button
          className="border px-3 py-2 rounded disabled:opacity-50"
          disabled={!authed}
          onClick={() => run('/api/admin/update-odds')}
        >
          Update Odds
        </button>
        <button
          className="border px-3 py-2 rounded disabled:opacity-50"
          disabled={!authed}
          onClick={() => run('/api/admin/settle')}
        >
          Settle
        </button>
      </div>

      <pre className="bg-black text-white p-3 rounded text-sm overflow-auto min-h-24">
        {log || (authed ? '—' : 'No token; log in to continue.')}
      </pre>
    </div>
  );
}
