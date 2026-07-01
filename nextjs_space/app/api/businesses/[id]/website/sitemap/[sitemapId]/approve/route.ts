/**
 * Sitemap approval API (Milestone 2) — business-scoped.
 *
 * POST -> validate the sitemap and, when it passes, mark it approved.
 *   - When validation fails, returns 422 with the blocking issues and does NOT
 *     approve.
 *   - On success: approvalStatus = approved, approvedAt + approvedBy recorded,
 *     an `approve` revision is written, and the revision history is preserved.
 *
 * Approval does NOT continue to copy generation. Copy generation is not
 * implemented in this milestone. NO images, NO publish/deploy.
 */
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { resolveBusinessAccess } from '@/lib/website-workflow';
import { approveSitemap, WebsiteSitemapArtifact } from '@/lib/website-sitemap';
import { validateSitemapForApproval, canApproveSitemap } from '@/lib/website-sitemap-edit';
import {
  loadSitemapById,
  updateSitemapArtifact,
  recordRevision,
} from '@/lib/website-sitemap-store';

export async function POST(
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

  const before = row.sitemapJson as unknown as WebsiteSitemapArtifact;
  const issues = validateSitemapForApproval(before);
  if (!canApproveSitemap(before)) {
    return NextResponse.json(
      { error: 'Sitemap cannot be approved until all issues are resolved.', issues },
      { status: 422 },
    );
  }

  const approved = approveSitemap(before, access.user.id);
  await updateSitemapArtifact({
    businessId: params.id,
    sitemapId: params.sitemapId,
    sitemap: approved,
  });

  await recordRevision({
    businessId: params.id,
    sitemapId: params.sitemapId,
    action: 'approve',
    detail: { approvedAt: approved.approvedAt },
    requestedByUserId: access.user.id,
  });

  return NextResponse.json({
    sitemapId: params.sitemapId,
    sitemap: approved,
    approvalStatus: approved.approvalStatus,
    approvedAt: approved.approvedAt,
    approvedBy: approved.approvedBy,
    // Approval does not continue to copy generation in this milestone.
    copyGenerationAvailable: false,
  });
}
