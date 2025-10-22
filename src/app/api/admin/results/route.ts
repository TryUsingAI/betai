// app/api/admin/results/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function POST(req: NextRequest) {
  const body = await req.json();
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  const { data, error } = await supabase
    .from('sports_event_results')
    .upsert({
      event_id: body.event_id,
      home_score: body.home_score,
      away_score: body.away_score,
      status: body.status ?? 'final',
      source: body.source ?? 'manual',
      raw: body.raw ?? null
    }, { onConflict: 'event_id' })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true, result: data });
}
