import { NextRequest } from 'next/server';
import { requireRole } from '@/lib/requireRole';
import { ODDS_BASE, ODDS_KEY, sportKey } from '@/lib/oddsapi';

export async function POST(req: NextRequest) {
  const { supabase } = await requireRole('admin');
  const sport = new URL(req.url).searchParams.get('sport') || 'nfl';

  // Pull scores from last 3 days
  const scoresUrl = `${ODDS_BASE}/sports/${sportKey(sport)}/scores?apiKey=${ODDS_KEY}&daysFrom=3`;
  const r = await fetch(scoresUrl, { cache: 'no-store' });
  if (!r.ok) return Response.json({ ok:false, error:`scores api ${r.status}` }, { status: 400 });
  const games: any[] = await r.json();

  // Update events with final scores
  const finals = games.filter(g => g.completed && g.scores?.length >= 2);
  for (const g of finals) {
    const home = g.home_team as string;
    const away = g.away_team as string;
    const sh = Number(g.scores.find((s:any)=>s.name===home)?.score ?? 0);
    const sa = Number(g.scores.find((s:any)=>s.name===away)?.score ?? 0);
    await supabase
      .from('sports_events')
      .update({ home_score: sh, away_score: sa, status: 'final' })
      .eq('external_event_id', g.id);
  }

  // Basic settlement: only moneyline and spreads and totals
  // 1) fetch open slips + legs joined to events that are final
  const { data: legs } = await supabase
    .from('bet_legs')
    .select('id, slip_id, market, side, line, event_id, sports_events!inner(home_team,away_team,home_score,away_score,status)')
    .eq('sports_events.status', 'final');

  if (!legs?.length) return Response.json({ ok:true, settled_slips: 0 });

  const winLegIds:number[] = [], loseLegIds:number[] = [], voidLegIds:number[] = [];

  for (const l of legs as any[]) {
    const sh = Number(l.sports_events.home_score ?? 0);
    const sa = Number(l.sports_events.away_score ?? 0);
    const total = sh + sa;

    if (l.market === 'moneyline') {
      const winner = sh === sa ? 'draw' : sh > sa ? 'home' : 'away';
      if (winner === 'draw') voidLegIds.push(l.id);
      else if (l.side === winner) winLegIds.push(l.id); else loseLegIds.push(l.id);
    }

    if (l.market === 'spread') {
      const margin = sh - sa; // >0 means home by X
      const picked = l.side === 'home' ? margin - Number(l.line) : (-margin) - Number(l.line);
      if (picked > 0) winLegIds.push(l.id);
      else if (picked < 0) loseLegIds.push(l.id);
      else voidLegIds.push(l.id);
    }

    if (l.market === 'total') {
      const diff = total - Number(l.line);
      if (diff === 0) voidLegIds.push(l.id);
      else if (l.side === 'over' ? diff > 0 : diff < 0) winLegIds.push(l.id);
      else loseLegIds.push(l.id);
    }
  }

  if (winLegIds.length)  await supabase.from('bet_legs').update({ result: 'won'  }).in('id', winLegIds);
  if (loseLegIds.length) await supabase.from('bet_legs').update({ result: 'lost' }).in('id', loseLegIds);
  if (voidLegIds.length) await supabase.from('bet_legs').update({ result: 'void' }).in('id', voidLegIds);

  // Settle slips: won if all legs won; lost if any lost; void if all void
  const { data: slips } = await supabase.from('bet_slips').select('id').eq('status','open');
  let settled = 0;
  for (const s of slips ?? []) {
    const { data: legsS } = await supabase.from('bet_legs').select('result').eq('slip_id', s.id);
    if (!legsS?.length) continue;
    const res = legsS.map(x=>x.result);
    if (res.every(r=>r==='won')) {
      await supabase.from('bet_slips').update({ status:'won', settled_at: new Date().toISOString() }).eq('id', s.id);
      settled++;
    } else if (res.some(r=>r==='lost')) {
      await supabase.from('bet_slips').update({ status:'lost', settled_at: new Date().toISOString() }).eq('id', s.id);
      settled++;
    } else if (res.every(r=>r==='void')) {
      await supabase.from('bet_slips').update({ status:'void', settled_at: new Date().toISOString() }).eq('id', s.id);
      settled++;
    }
  }

  return Response.json({ ok:true, updated_events: finals.length, settled_slips: settled,
    legs: { won: winLegIds.length, lost: loseLegIds.length, void: voidLegIds.length } });
}
