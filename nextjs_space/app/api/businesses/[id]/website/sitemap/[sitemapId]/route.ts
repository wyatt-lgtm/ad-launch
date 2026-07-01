/**
 * Sitemap edit API (Milestone 2) — business-scoped.
 *
 * PUT -> apply a single structural edit to the sitemap draft and persist it.
 *   body: { action, ...args }
 *   Supported actions (all pure, network-free edits):
 *     rename_page            { slug, newTitle, newH1? }
 *     remove_page            { slug }
 *     reorder_pages          { orderedSlugs: string[] }
 *     add_section            { slug, sectionName }
 *     remove_section         { slug, sectionName }
 *     add_comparison_page    { title }
 *     add_location_page      { city, state?, businessCategory? }
 *     convert_section_to_page { parentSlug, sectionName }
 *     convert_service_to_page { serviceName }
 *     set_service_confirmation { serviceName, status, source?, evidence? }
 *     apply_service_discovery { services: DiscoveredService[] }
 *
 * Every structural edit resets approvalStatus to pending_user_review and records
 * a revision. NO copy, NO images, NO publish/deploy.
 */
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { resolveBusinessAccess } from '@/lib/website-workflow';
import { WebsiteSitemapArtifact } from '@/lib/website-sitemap';
import {
  renamePage,
  removePage,
  reorderPages,
  addSection,
  removeSection,
  addComparisonPage,
  addLocationPage,
  convertSectionToPage,
  convertServiceToPage,
  setServiceConfirmation,
  applyServiceDiscovery,
  validateSitemapForApproval,
} from '@/lib/website-sitemap-edit';
import {
  loadSitemapById,
  updateSitemapArtifact,
  recordRevision,
} from '@/lib/website-sitemap-store';

export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string; sitemapId: string } },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const access = await resolveBusinessAccess(session.user.email, params.id);
  if (!access) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const row = await loadSitemapById(params.id, params.sitemapId);
  if (!row) {
    return NextResponse.json({ error: 'Sitemap not found' }, { status: 404 });
  }

  const body = await req.json().catch(() => ({} as any));
  const action: string = body?.action;
  const before = row.sitemapJson as unknown as WebsiteSitemapArtifact;
  const userId = access.user.id;

  let next: WebsiteSitemapArtifact;
  const revisionPage: { title?: string; slug?: string; pageType?: string; source?: string | null } = {};

  try {
    switch (action) {
      case 'rename_page':
        next = renamePage(before, body.slug, body.newTitle, { newH1: body.newH1 });
        revisionPage.slug = body.slug;
        revisionPage.title = body.newTitle;
        break;
      case 'remove_page':
        next = removePage(before, body.slug);
        revisionPage.slug = body.slug;
        break;
      case 'reorder_pages':
        next = reorderPages(before, body.orderedSlugs || []);
        break;
      case 'add_section':
        next = addSection(before, body.slug, body.sectionName);
        revisionPage.slug = body.slug;
        break;
      case 'remove_section':
        next = removeSection(before, body.slug, body.sectionName);
        revisionPage.slug = body.slug;
        break;
      case 'add_comparison_page':
        next = addComparisonPage(before, body.title, { requestedByUserId: userId });
        revisionPage.title = body.title;
        revisionPage.pageType = 'comparison';
        revisionPage.source = 'user_requested';
        break;
      case 'add_location_page':
        next = addLocationPage(before, {
          city: body.city,
          state: body.state,
          businessCategory: body.businessCategory,
          requestedByUserId: userId,
        });
        revisionPage.title = body.city;
        revisionPage.pageType = 'location';
        revisionPage.source = 'user_requested';
        break;
      case 'convert_section_to_page':
        next = convertSectionToPage(before, body.parentSlug, body.sectionName, {
          requestedByUserId: userId,
        });
        revisionPage.title = body.sectionName;
        break;
      case 'convert_service_to_page':
        next = convertServiceToPage(before, body.serviceName);
        revisionPage.title = body.serviceName;
        revisionPage.pageType = 'service_detail';
        break;
      case 'set_service_confirmation':
        next = setServiceConfirmation(before, body.serviceName, body.status, {
          source: body.source,
          evidence: body.evidence,
        });
        revisionPage.title = body.serviceName;
        break;
      case 'apply_service_discovery':
        next = applyServiceDiscovery(before, body.services || []);
        break;
      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Edit failed' }, { status: 400 });
  }

  await updateSitemapArtifact({
    businessId: params.id,
    sitemapId: params.sitemapId,
    sitemap: next,
  });

  await recordRevision({
    businessId: params.id,
    sitemapId: params.sitemapId,
    action,
    detail: { action },
    page: revisionPage,
    requestedByUserId: userId,
  });

  return NextResponse.json({
    sitemapId: params.sitemapId,
    sitemap: next,
    issues: validateSitemapForApproval(next),
  });
}
