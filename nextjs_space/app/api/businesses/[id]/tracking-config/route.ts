export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { resolveBusinessAccess } from '@/lib/tracking-auth';
import { getTrackingConfigForPage } from '@/lib/tracking-pixels';

/**
 * GET /api/businesses/[id]/tracking-config?pageType=landing_page&path=/example
 * Returns ONLY active tracking config (pixels, events, routes) for the
 * business that matches the requested page type and path. Authenticated and
 * business-scoped — never returns another business's data.
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const r = await resolveBusinessAccess(req, params.id);
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: r.status });

  const pageType = req.nextUrl.searchParams.get('pageType') || 'website_page';
  const path = req.nextUrl.searchParams.get('path');

  const config = await getTrackingConfigForPage(r.business.id, { pageType, path });
  return NextResponse.json(config);
}
