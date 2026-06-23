export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';

const TOMBSTONE_URL = process.env.TOMBSTONE_API_URL ?? 'https://tombstone-api-xjc4.onrender.com';
const ADMIN_KEY = () => process.env.ADMIN_API_KEY ?? '';

/**
 * Unified Marketing Intelligence proxy.
 * GET  ?action=overview&business_id=<prisma_id>&date_start=...&date_end=...
 * GET  ?action=trends&business_id=<prisma_id>&compare_mode=previous_7_days
 * POST ?action=sync&business_id=<prisma_id>
 */

async function resolveTombstoneBusinessId(prismaBusinessId: string): Promise<number | null> {
  const biz = await prisma.business.findUnique({
    where: { id: prismaBusinessId },
    select: { tombstoneBusinessId: true },
  });
  return biz?.tombstoneBusinessId ?? null;
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const sp = req.nextUrl.searchParams;
  const action = sp.get('action') ?? 'overview';
  const prismaBusinessId = sp.get('business_id');

  if (!prismaBusinessId) {
    return NextResponse.json({ error: 'business_id is required' }, { status: 400 });
  }

  const tombstoneId = await resolveTombstoneBusinessId(prismaBusinessId);
  if (!tombstoneId) {
    // Return empty-state data instead of error so UI handles gracefully
    return NextResponse.json({
      _no_tombstone_id: true,
      date_range: { start: sp.get('date_start') || '', end: sp.get('date_end') || '' },
      kpis: { impressions: 0, clicks: 0, spend: 0, conversions: 0, revenue: 0, ctr: 0, cpc: 0, conversion_rate: 0, roas: 0 },
      channels: [],
      connections: [],
      last_sync: null,
      monthly_trend: [],
      comparison: null,
    });
  }

  // Build params for Tombstone
  const params = new URLSearchParams();
  params.set('key', ADMIN_KEY());
  params.set('business_id', String(tombstoneId));

  let endpoint = '/reports/unified/overview';

  if (action === 'overview') {
    endpoint = '/reports/unified/overview';
    if (sp.get('date_start')) params.set('date_start', sp.get('date_start')!);
    if (sp.get('date_end')) params.set('date_end', sp.get('date_end')!);
  } else if (action === 'trends') {
    endpoint = '/reports/unified/trends';
    if (sp.get('date_start')) params.set('date_start', sp.get('date_start')!);
    if (sp.get('date_end')) params.set('date_end', sp.get('date_end')!);
    if (sp.get('compare_mode')) params.set('compare_mode', sp.get('compare_mode')!);
  } else {
    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  }

  try {
    const res = await fetch(`${TOMBSTONE_URL}${endpoint}?${params.toString()}`, {
      headers: { 'Accept': 'application/json' },
      next: { revalidate: 0 },
    });
    if (!res.ok) {
      const text = await res.text();
      console.error(`[marketing-proxy] Tombstone ${res.status}: ${text.slice(0, 500)}`);
      return NextResponse.json({ error: `Backend ${res.status}` }, { status: res.status });
    }
    const data = await res.json();
    return NextResponse.json(data);
  } catch (err: any) {
    console.error('[marketing-proxy] Fetch error:', err);
    return NextResponse.json({ error: err.message || 'Failed to reach backend' }, { status: 502 });
  }
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const sp = req.nextUrl.searchParams;
  const action = sp.get('action') ?? 'sync';
  const prismaBusinessId = sp.get('business_id');

  if (!prismaBusinessId) {
    return NextResponse.json({ error: 'business_id is required' }, { status: 400 });
  }

  if (action !== 'sync') {
    return NextResponse.json({ error: `Unknown POST action: ${action}` }, { status: 400 });
  }

  const tombstoneId = await resolveTombstoneBusinessId(prismaBusinessId);
  if (!tombstoneId) {
    return NextResponse.json({ error: 'Business not connected to marketing backend' }, { status: 404 });
  }

  const params = new URLSearchParams();
  params.set('key', ADMIN_KEY());
  params.set('business_id', String(tombstoneId));

  try {
    const res = await fetch(`${TOMBSTONE_URL}/reports/unified/sync?${params.toString()}`, {
      method: 'POST',
      headers: { 'Accept': 'application/json' },
    });
    if (!res.ok) {
      const text = await res.text();
      console.error(`[marketing-proxy] Sync error ${res.status}: ${text.slice(0, 500)}`);
      return NextResponse.json({ error: `Backend ${res.status}` }, { status: res.status });
    }
    const data = await res.json();
    return NextResponse.json(data);
  } catch (err: any) {
    console.error('[marketing-proxy] Sync fetch error:', err);
    return NextResponse.json({ error: err.message || 'Failed to reach backend' }, { status: 502 });
  }
}
