export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { resolveBusinessAccess } from '@/lib/tracking-auth';
import { getAllProviderHealth } from '@/lib/search-intelligence-provider';
import { getDataForSeoStatus } from '@/lib/provider-usage';

/**
 * GET /api/businesses/[id]/search-intelligence/provider-health
 * Returns the DataForSEO status (disabled / missing credentials / sandbox /
 * live) plus last successful + last error timestamps for this business, and a
 * health summary for all registered providers. No credentials are ever
 * returned — only a credentialsRef label.
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const r = await resolveBusinessAccess(req, params.id);
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: r.status });
  const businessId = r.business.id;

  const [dataforseo, providers] = await Promise.all([
    getDataForSeoStatus(businessId),
    getAllProviderHealth(),
  ]);

  return NextResponse.json({ dataforseo, providers });
}
