'use client'

import { useState } from 'react'
import { placeBet, type PlaceBetPayload } from '@/lib/placeBet'

export default function PlaceBetTest() {
  const [status, setStatus] = useState<string>('idle')
  const [resp, setResp] = useState<any>(null)

  const [form, setForm] = useState<PlaceBetPayload>({
    event_id: '',
    market: 'moneyline',
    selection: 'home',
    line: null,
    price: -110,
    stake_cents: 100,
    snapshot_id: 0,
    client_key: null,
  })

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setStatus('submitting')
    const r = await placeBet(form)
    setResp(r)
    setStatus(r.ok ? 'ok' : `err ${r.status}`)
  }

  return (
    <div className="p-4 border rounded">
      <h3 className="font-semibold mb-2">PlaceBetTest</h3>
      <form onSubmit={onSubmit} className="space-y-2">
        <input
          className="border p-2 w-full"
          placeholder="event_id (uuid)"
          value={form.event_id}
          onChange={e => setForm({ ...form, event_id: e.target.value })}
        />
        <div className="flex gap-2">
          <select
            className="border p-2"
            value={form.market}
            onChange={e => setForm({ ...form, market: e.target.value as any })}
          >
            <option value="moneyline">moneyline</option>
            <option value="spread">spread</option>
            <option value="total">total</option>
          </select>
          <select
            className="border p-2"
            value={form.selection}
            onChange={e => setForm({ ...form, selection: e.target.value as any })}
          >
            <option value="home">home</option>
            <option value="away">away</option>
            <option value="over">over</option>
            <option value="under">under</option>
          </select>
          <input
            className="border p-2 w-28"
            type="number"
            step="0.5"
            placeholder="line"
            value={form.line ?? ''}
            onChange={e =>
              setForm({ ...form, line: e.target.value === '' ? null : Number(e.target.value) })
            }
          />
          <input
            className="border p-2 w-24"
            type="number"
            placeholder="price"
            value={form.price}
            onChange={e => setForm({ ...form, price: Number(e.target.value) })}
          />
          <input
            className="border p-2 w-28"
            type="number"
            placeholder="stake_cents"
            value={form.stake_cents}
            onChange={e => setForm({ ...form, stake_cents: Number(e.target.value) })}
          />
          <input
            className="border p-2 w-36"
            type="number"
            placeholder="snapshot_id"
            value={form.snapshot_id}
            onChange={e => setForm({ ...form, snapshot_id: Number(e.target.value) })}
          />
        </div>
        <button type="submit" className="border px-4 py-2">Place Bet</button>
      </form>

      <div className="mt-3 text-sm">
        <div>Status: {status}</div>
        <pre className="mt-2 whitespace-pre-wrap break-words">{JSON.stringify(resp, null, 2)}</pre>
      </div>
    </div>
  )
}
