/**
 * Redirect Plan — generate mappings (Milestone 10). business-scoped.
 *
 * POST -> map the latest backlink inventory against the latest (or given)
 *         sitemap, persist the preservation mappings, and return the recomputed
 *         redirect plan. NEVER deploys redirects. NEVER mutates live DNS.
 *
 * Body: { sitemapId?: string, newSiteBaseUrl?: string }
 */
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { authorizeBusiness, rejectDeployIntent } from '@/lib/site-backlinks/api-guard';
import { ensureWebsiteProject } from '@/lib/website-workflow';
import { generateAndSaveMappings, loadRedirectPlan } from '@/lib/site-backlinks/store';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await authorizeBusiness(params.id);
  if ('error' in guard) return guard.error;

  const body = await req.json().catch(() => ({} as any));
  const deployReject = rejectDeployIntent(body);
  if (deployReject) return deployReject;

  const project = await ensureWebsiteProject(params.id);
  const result = await generateAndSaveMappings({
    businessId: params.id,
    websiteProjectId: project.id,
    sitemapId: (body?.sitemapId as string) || null,
    newSiteBaseUrl: (body?.newSiteBaseUrl as string) || null,
  });

  if (!result.mappings.length) {
    return NextResponse.json(
      {
        error:
          'Could not generate mappings. Ensure a backlink inventory and a sitemap both exist for this business.',
        sitemapId: result.sitemapId,
        inventoryId: result.inventoryId,
      },
      { status: 409 },
    );
  }

  const plan = await loadRedirectPlan(params.id, project.id, result.sitemapId);
  return NextResponse.json({
    sitemapId: result.sitemapId,
    inventoryId: result.inventoryId,
    mappingCount: result.mappings.length,
    plan: plan || null,
  });
}
