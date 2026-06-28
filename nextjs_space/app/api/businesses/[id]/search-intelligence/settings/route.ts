export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { resolveBusinessAccess } from '@/lib/tracking-auth';
import { ensureSearchIntelSettings } from '@/lib/search-intelligence';

const SETTINGS_FIELDS = [
  'enabled', 'defaultProvider', 'weeklyRunDay', 'weeklyRunTime', 'timezone',
  'maxKeywordsPerRun', 'maxLocationsPerRun', 'device', 'includePaidAds',
  'includeOrganic', 'includeLocalPack', 'includeCompetitors', 'includeAhrefs',
  'includeGoogleAds', 'includeSearchConsole',
] as const;

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const r = await resolveBusinessAccess(req, params.id);
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: r.status });
  const settings = await ensureSearchIntelSettings(r.business.id);
  const providerAccounts = await prisma.searchIntelligenceProviderAccount.findMany({
    where: { businessId: r.business.id },
    orderBy: { createdAt: 'asc' },
  });
  return NextResponse.json({ settings, providerAccounts });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const r = await resolveBusinessAccess(req, params.id);
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: r.status });
  await ensureSearchIntelSettings(r.business.id);
  const body = await req.json().catch(() => ({}));
  const data: Record<string, any> = {};
  for (const f of SETTINGS_FIELDS) if (body[f] !== undefined) data[f] = body[f];
  const settings = await prisma.searchIntelligenceSettings.update({
    where: { businessId: r.business.id },
    data: data as any,
  });
  return NextResponse.json({ ok: true, settings });
}
