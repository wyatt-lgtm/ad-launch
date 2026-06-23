export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-guard';

const TOMBSTONE_URL = process.env.TOMBSTONE_API_URL ?? 'https://tombstone-api-xjc4.onrender.com';
const ADMIN_KEY = () => process.env.ADMIN_API_KEY ?? '';

export async function GET(req: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.authorized) return auth.response;

  const sp = req.nextUrl.searchParams;
  // Forward all filter params
  const params = new URLSearchParams();
  params.set('key', ADMIN_KEY());
  for (const k of ['business_id', 'start_date', 'end_date', 'worker_name', 'agent_name', 'model', 'request_type', 'status']) {
    const v = sp.get(k);
    if (v) params.set(k, v);
  }

  try {
    const res = await fetch(`${TOMBSTONE_URL}/reports/openai-usage/summary?${params.toString()}`, {
      headers: { 'Accept': 'application/json' },
      next: { revalidate: 0 },
    });
    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json({ error: `Tombstone ${res.status}: ${text.slice(0, 300)}` }, { status: res.status });
    }
    const data = await res.json();
    return NextResponse.json(data);
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Failed to reach Tombstone API' }, { status: 502 });
  }
}
