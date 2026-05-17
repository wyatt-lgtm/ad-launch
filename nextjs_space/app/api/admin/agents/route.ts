export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-guard';

const TOMBSTONE_URL = process.env.TOMBSTONE_API_URL ?? 'https://tombstone-api-xjc4.onrender.com';

export async function GET() {
  const auth = await requireAdmin();
  if (!auth.authorized) return auth.response;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    const res = await fetch(`${TOMBSTONE_URL}/agents/status`, {
      cache: 'no-store',
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) {
      return NextResponse.json({ error: 'Tombstone API error', status: res.status }, { status: 502 });
    }

    const agents = await res.json();
    return NextResponse.json({ agents, fetchedAt: new Date().toISOString() });
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      return NextResponse.json({ error: 'Tombstone API timeout', agents: [] }, { status: 504 });
    }
    console.error('[admin/agents] Tombstone proxy error:', err?.message);
    return NextResponse.json({ error: 'Failed to reach Tombstone API', agents: [] }, { status: 502 });
  }
}
