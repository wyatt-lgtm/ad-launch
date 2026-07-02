/**
 * Backlink Inventory — own-site scan (Milestone 10). business-scoped.
 *
 * POST -> crawl the customer's OWN live site (sitemap/robots/homepage links),
 *         build an inventory snapshot, persist it, and return it. NEVER scrapes
 *         Google or third-party SERPs. NEVER deploys/publishes/mutates DNS.
 *
 * When no external backlink provider is configured the inventory status is
 * `incomplete_provider_missing` with an explicit warning — it is never a silent
 * "complete".
 */
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { authorizeBusiness, rejectDeployIntent } from '@/lib/site-backlinks/api-guard';
import { ensureWebsiteProject } from '@/lib/website-workflow';
import { crawlExistingSite } from '@/lib/site-backlinks/crawl';
import { buildInventory } from '@/lib/site-backlinks/inventory';
import { saveInventory } from '@/lib/site-backlinks/store';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await authorizeBusiness(params.id);
  if ('error' in guard) return guard.error;

  const body = await req.json().catch(() => ({} as any));
  const deployReject = rejectDeployIntent(body);
  if (deployReject) return deployReject;

  const business = await prisma.business.findFirst({
    where: { id: params.id },
    select: { id: true, websiteUrl: true },
  });
  if (!business) {
    return NextResponse.json({ error: 'Business not found' }, { status: 404 });
  }

  const liveUrl = (body?.liveUrl as string) || business.websiteUrl || '';
  const project = await ensureWebsiteProject(params.id);
  const crawl = await crawlExistingSite(liveUrl);

  const inventory = buildInventory({
    liveDomain: crawl.liveDomain,
    crawledAt: crawl.crawledAt,
    sources: [{ source: 'site_crawl', urls: crawl.urls }],
    providerAvailable: false,
    reachable: crawl.reachable,
    extraWarnings: crawl.warnings,
  });

  const saved = await saveInventory({
    businessId: params.id,
    websiteProjectId: project.id,
    inventory,
  });

  return NextResponse.json({
    inventoryId: saved.id,
    status: inventory.status,
    liveDomain: inventory.liveDomain,
    totalBacklinkUrls: inventory.totalBacklinkUrls,
    highValueUrlCount: inventory.highValueUrlCount,
    providerMissing: inventory.providerMissing,
    warnings: inventory.warnings,
    urls: inventory.urls,
  });
}
