// src/app/admin/page.tsx
'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase-browser';

type Sport = 'nfl' | 'nba' | 'nhl' | 'ncaaf' | 'all';
const SPORTS: Exclude<Sport, 'all'>[] = ['nfl', 'nba', 'nhl', 'ncaaf'];

// Routes that REQUIRE ?sport=
const SPORTED = new Set<string>([
  '/api/admin/ingest',
  '/api/admin/update-odds',
  '/api/admin/poll-results',
]);

export default function AdminPage() {
  const [sport, setSport] = useState<Sport>('nfl');
  const [token, setToken] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [log, setLog] = useState<string>('');

  useEffect(() => {
    let active = true;
    async function load() {
      const { data } = await supabase.auth.getSession();
      if (!active) return;
      setToken(data.session?.access_token ?? null);
    }
    load();
    const { data: sub } = supabase.auth.onAuthStateChange(load);
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const authed = !!token;
  const hdrs = token ? { Authorization: `Bearer ${token}` } : undefined;
  const append = (s: string) => setLog((p) => `${s}\n${p}`);

  async function callRoute(path: string, s?: string) {
    const needsSport = SPORTED.has(path);
    const url = needsSport && s ? `${path}?sport=${encodeURIComponent(s)}` : path;
    const res = await fetch(url, { method: 'POST', headers: hdrs });
    const txt = await res.text();
    return { ok: res.ok, text: txt };
  }

  async function runAction(path: string) {
    setIsRunning(true);
    setLog('');
    try {
      if (sport === 'all') {
        for (const s of SPORTS) {
          append(`▶ ${path} :: ${s.toUpperCase()}`);
          const r = await callRoute(path, s);
          append(r.text.trim() || '(no body)');
          if (!r.ok) append(`ERROR on ${s}`);
        }
      } else {
        append(`▶ ${path} :: ${sport.toUpperCase()}`);
        const r = await callRoute(path, sport);
        append(r.text.trim() || '(no body)');
        if (!r.ok) append('ERROR');
      }
    } catch (e: any) {
      append(`EXCEPTION: ${e?.message || String(e)}`);
    } finally {
      setIsRunning(false);
    }
  }

  async function pollFinals() {
    setIsRunning(true);
    setLog('');
    try {
      // 1) poll finals for one or all sports
      if (sport === 'all') {
        for (const s of SPORTS) {
          append(`▶ /api/admin/poll-results :: ${s.toUpperCase()}`);
          const r = await callRoute('/api/admin/poll-results', s);
          append(r.text.trim() || '(no body)');
          if (!r.ok) append(`ERROR on ${s}`);
        }
      } else {
        append(`▶ /api/admin/poll-results :: ${sport.toUpperCase()}`);
        const r = await callRoute('/api/admin/poll-results', sport);
        append(r.text.trim() || '(no body)');
        if (!r.ok) append('ERROR');
      }

      // 2) auto-settle once after polling
      append('▶ /api/admin/settle (auto)');
      const settled = await callRoute('/api/admin/settle');
      append(settled.text.trim() || '(no body)');
      if (!settled.ok) append('ERROR');
    } catch (e: any) {
      append(`EXCEPTION: ${e?.message || String(e)}`);
    } finally {
      setIsRunning(false);
    }
  }

  async function ingest() {
    await runAction('/api/admin/ingest');
  }

  async function updateOdds() {
    await runAction('/api/admin/update-odds');
  }

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-semibold">Admin</h1>

      <div className="flex items-center gap-3">
        <label>Sport</label>
        <select
          className="border px-2 py-1 rounded"
          value={sport}
          onChange={(e) => setSport(e.target.value as Sport)}
          disabled={isRunning}
        >
          <option value="all">All Sports</option>
          <option value="nfl">NFL</option>
          <option value="nba">NBA</option>
          <option value="nhl">NHL</option>
          <option value="ncaaf">NCAAF</option>
        </select>
      </div>

      {!authed && <p className="text-sm text-red-600">You are not authenticated.</p>}

      <div className="flex gap-3 flex-wrap">
        <button
          className="border px-3 py-2 rounded disabled:opacity-50"
          disabled={!authed || isRunning}
          onClick={ingest}
        >
          Ingest
        </button>

        <button
          className="border px-3 py-2 rounded disabled:opacity-50"
          disabled={!authed || isRunning}
          onClick={updateOdds}
        >
          Update Odds
        </button>

        {/* Settle button removed; settle runs automatically after Poll Finals */}

        <button
          className="border px-3 py-2 rounded disabled:opacity-50 bg-black text-white"
          disabled={!authed || isRunning}
          onClick={pollFinals}
        >
          Poll Finals
        </button>
      </div>

      <pre className="bg-black text-white p-3 rounded text-sm overflow-auto min-h-24">
        {log || (authed ? '—' : 'No token; log in.')}
      </pre>
    </div>
  );
}
