// src/app/bet/page.tsx
'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { placeBet, type PlaceBetPayload } from '@/lib/placeBet'

type Sport = 'nfl' | 'nba' | 'nhl' | 'ncaaf'

type Row = {
  event_id: string
  sport: Sport
  starts_at: string
  home_team: string
  away_team: string
  snapshot_id: number
  market: 'moneyline' | 'spread' | 'total'
  side: 'home' | 'away' | 'over' | 'under'
  line: number | null
  american_odds: number
}

type Pick = {
  event_id: string
  snapshot_id: number
  market: Row['market']
  selection: Row['side']
  line: number | null
  price: number
  label: string
}

type PlaceBetResponse = { ok: boolean; bet_id?: string; error?: string }
type PlaceBetCallResult = { ok: boolean; status: number; json: PlaceBetResponse | undefined }
type OutEntry = {
  ok: boolean
  status: number
  pick: string
  bet_id?: string
  error?: string
}

const SPORTS: Sport[] = ['nfl', 'nba', 'nhl', 'ncaaf']
const dec = (a: number) => (a > 0 ? 1 + a / 100 : 1 + 100 / Math.abs(a))

export default function BetPage() {
  const [sport, setSport] = useState<Sport>('nhl')
  const [rows, setRows] = useState<Row[]>([])
  const [picks, setPicks] = useState<Pick[]>([])
  const [stakeCents, setStakeCents] = useState<number>(500)
  const [log, setLog] = useState<string>('—')
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setRows([])
    try {
      const start = new Date().toISOString()
      const r = await fetch(`/api/events?sport=${sport}&start=${encodeURIComponent(start)}`)
      const j: { ok: boolean; events?: Row[] } = await r.json()
      setRows(j.events ?? [])
      setLog('—')
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setLog(`load error: ${msg}`)
    } finally {
      setLoading(false)
    }
  }, [sport])

  useEffect(() => {
    void load()
  }, [load])

  function addPick(r: Row) {
    const key = `${r.event_id}:${r.market}:${r.side}`
    if (picks.some(p => `${p.event_id}:${p.market}:${p.selection}` === key)) return
    const team = r.market !== 'total' ? (r.side === 'home' ? r.home_team : r.away_team) : ''
    const label =
      r.market === 'moneyline'
        ? `${team} ML (${r.american_odds})`
        : r.market === 'spread'
        ? `${team} ${r.line! >= 0 ? '+' : ''}${r.line} (${r.american_odds})`
        : `${r.side.toUpperCase()} ${r.line} (${r.american_odds})`
    setPicks(p => [
      ...p,
      {
        event_id: r.event_id,
        snapshot_id: r.snapshot_id,
        market: r.market,
        selection: r.side,
        line: r.line,
        price: r.american_odds,
        label,
      },
    ])
  }

  function removePick(i: number) {
    setPicks(p => p.filter((_, k) => k !== i))
  }

  const potentialSingles = useMemo(
    () => picks.reduce((acc, p) => acc + Math.round(stakeCents * dec(p.price)), 0),
    [picks, stakeCents]
  )

  async function placeSingles() {
    if (picks.length === 0 || stakeCents <= 0) return
    setLog('Placing…')
    const out: OutEntry[] = []

    for (const p of picks) {
      const body: PlaceBetPayload = {
        event_id: p.event_id,
        market: p.market,
        selection: p.selection,
        line: p.line,
        price: p.price,
        stake_cents: stakeCents,
        snapshot_id: p.snapshot_id,
        client_key: crypto.randomUUID(),
      }

      const r: PlaceBetCallResult = await placeBet(body)

      // avoid duplicate 'ok' by stripping it from the response before spreading
      const j = (r.json ?? {}) as Record<string, unknown>
      const { ok: _omit, ...rest } = j

      out.push({
        ok: r.ok,
        status: r.status,
        pick: p.label,
        bet_id: rest.bet_id as string | undefined,
        error: rest.error as string | undefined,
      })

      if (!r.ok) break
    }

    setLog(JSON.stringify(out, null, 2))
    if (out.length && out.every(x => x.ok)) setPicks([])
  }

  return (
    <div className="p-6 space-y-5">
      <h1 className="text-xl font-semibold">Place Bets</h1>

      <div className="flex flex-wrap items-center gap-3">
        <label>Sport</label>
        <select
          className="border rounded px-2 py-1"
          value={sport}
          onChange={e => setSport(e.target.value as Sport)}
          disabled={loading}
        >
          {SPORTS.map(s => (
            <option key={s} value={s}>
              {s.toUpperCase()}
            </option>
          ))}
        </select>

        <button className="border px-3 py-1 rounded" onClick={load} disabled={loading}>
          Refresh
        </button>

        <label className="ml-4">Stake ($)</label>
        <input
          className="border rounded px-2 py-1 w-24"
          type="number"
          min={1}
          step={0.01}
          value={(stakeCents / 100).toFixed(2)}
          onChange={e =>
            setStakeCents(Math.max(0, Math.round(parseFloat(e.target.value || '0') * 100)))
          }
        />

        <div className="text-sm">
          Potential if all singles win:{' '}
          <span className="font-semibold">${(potentialSingles / 100).toFixed(2)}</span>
        </div>

        <button
          className="ml-auto px-3 py-2 rounded bg-blue-600 text-white disabled:opacity-50"
          disabled={picks.length === 0 || stakeCents <= 0}
          onClick={placeSingles}
        >
          Place {picks.length > 1 ? `Singles (${picks.length})` : 'Bet'}
        </button>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <div>
          <h2 className="font-semibold mb-2">Upcoming</h2>
          {loading && <div className="text-sm opacity-70">Loading…</div>}
          <div className="space-y-2">
            {rows.map(r => (
              <div
                key={`${r.event_id}:${r.snapshot_id}:${r.market}:${r.side}`}
                className="border rounded p-2 flex items-center justify-between"
              >
                <div className="text-sm">
                  <div className="font-medium">
                    {r.away_team} @ {r.home_team}
                  </div>
                  <div className="text-xs opacity-70">
                    {new Date(r.starts_at).toLocaleString()}
                  </div>
                  <div className="text-xs">
                    {r.market} • {r.side} {r.line ?? ''} • {r.american_odds}
                  </div>
                </div>
                <button className="px-2 py-1 text-sm border rounded" onClick={() => addPick(r)}>
                  Add
                </button>
              </div>
            ))}
            {rows.length === 0 && !loading && (
              <div className="text-sm opacity-70">No events.</div>
            )}
          </div>
        </div>

        <div>
          <h2 className="font-semibold mb-2">Bet Slip ({picks.length})</h2>
          <div className="space-y-2">
            {picks.map((p, i) => (
              <div key={i} className="border rounded p-2 flex items-center justify-between">
                <div className="text-sm">{p.label}</div>
                <button className="text-xs border rounded px-2 py-1" onClick={() => removePick(i)}>
                  Remove
                </button>
              </div>
            ))}
            {picks.length === 0 && <div className="text-sm opacity-70">No selections.</div>}
          </div>
        </div>
      </div>

      <pre className="bg-black text-green-300 p-3 rounded text-sm min-h-16 overflow-auto">
        {log}
      </pre>
    </div>
  )
}
