/**
 * Sitemap revisions API (Milestone 2) — business-scoped.
 *
 * GET  -> list revision history for the sitemap (audit trail).
 * POST -> add a user-requested page (body: { title }).
 *          The page is always marked source: 'user_requested', is added ONLY to
 *          this business's sitemap, resets approvalStatus to pending_user_review,
 *          and writes an audit revision.
 *
 * NO copy, NO images, NO publish/deploy.
 */
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { resolveBusinessAccess } from '@/lib/website-workflow';
import { addUserRequestedPage, WebsiteSitemapArtifact } from '@/lib/website-sitemap';
import { validateSitemapForApproval } from '@/lib/website-sitemap-edit';
import {
  loadSitemapById,
  updateSitemapArtifact,
  saveSitemapRevision,
  listSitemapRevisions,
} from '@/lib/website-sitemap-store';

async function authorize(businessId: string) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }
  const access = await resolveBusinessAccess(session.user.email, businessId);
  if (!access) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  }
  return { access };
}

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string; sitemapId: string } },
) {
  const { error } = await authorize(params.id);
  if (error) return error;

  const row = await loadSitemapById(params.id, params.sitemapId);
  if (!row) {
    return NextResponse.json({ error: 'Sitemap not found' }, { status: 404 });
  }

  const revisions = await listSitemapRevisions(params.id, params.sitemapId);
  return NextResponse.json({ revisions });
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string; sitemapId: string } },
) {
  const { access, error } = await authorize(params.id);
  if (error) return error;

  const row = await loadSitemapById(params.id, params.sitemapId);
  if (!row) {
    return NextResponse.json({ error: 'Sitemap not found' }, { status: 404 });
  }

  const body = await req.json().catch(() => ({} as any));
  const title = (body?.title || '').trim();
  if (!title) {
    return NextResponse.json({ error: 'A page title is required.' }, { status: 400 });
  }

  const before = row.sitemapJson as unknown as WebsiteSitemapArtifact;
  const { sitemap: next, revision } = addUserRequestedPage(before, {
    title,
    requestedByUserId: access.user.id,
  });

  await updateSitemapArtifact({
    businessId: params.id,
    sitemapId: params.sitemapId,
    sitemap: next,
  });

  await saveSitemapRevision({
    businessId: params.id,
    sitemapId: params.sitemapId,
    revision,
  });

  return NextResponse.json({
    sitemapId: params.sitemapId,
    sitemap: next,
    revision,
    issues: validateSitemapForApproval(next),
  });
}
