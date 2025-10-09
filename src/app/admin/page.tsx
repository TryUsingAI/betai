'use client';
import { useState } from 'react';
import { supabase } from '@/lib/supabase-browser';

export default function Admin() {
  const [sport, setSport] = useState<'nfl'|'nba'|'nhl'|'ncaaf'>('nfl');
  const [log, setLog] = useState('');

  async function run(path: string) {
    setLog('Running...');
    const { data: { session } } = await supabase.auth.getSession();
    const r = await fetch(`${path}?sport=${sport}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${session?.access_token ?? ''}` },
    });
    const j = await r.json().catch(() => ({}));
    setLog(JSON.stringify(j, null, 2));
  }

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-semibold">Admin</h1>
      <div className="flex items-center gap-3">
        <label>Sport</label>
        <select className="border px-2 py-1 rounded" value={sport} onChange={e=>setSport(e.target.value as any)}>
          <option value="nfl">NFL</option><option value="nba">NBA</option>
          <option value="nhl">NHL</option><option value="ncaaf">NCAAF</option>
        </select>
      </div>
      <div className="flex gap-3">
        <button className="border px-3 py-2 rounded" onClick={()=>run('/api/admin/ingest')}>Ingest</button>
        <button className="border px-3 py-2 rounded" onClick={()=>run('/api/admin/update-odds')}>Update Odds</button>
        <button className="border px-3 py-2 rounded" onClick={()=>run('/api/admin/settle')}>Settle</button>
      </div>
      <pre className="bg-black text-white p-3 rounded text-sm overflow-auto">{log}</pre>
    </div>
  );
}
