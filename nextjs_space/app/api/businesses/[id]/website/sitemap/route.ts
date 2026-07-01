/**
 * Sitemap API (Milestone 2) — business-scoped.
 *
 * GET  -> latest sitemap artifact + copy-gate status (or null when none exists).
 * POST -> generate a fresh sitemap from stored business identity + latest
 *         confirmed service discovery, persist it, and return it.
 *
 * Generation is hub-and-spoke over CONFIRMED services only. NO copy, NO images,
 * NO publish/deploy.
 */
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { resolveBusinessAccess, ensureWebsiteProject } from '@/lib/website-workflow';
import { generateSitemap, canGenerateCopy, WebsiteSitemapArtifact } from '@/lib/website-sitemap';
import { validateSitemapForApproval, mapCopyGateStatus } from '@/lib/website-sitemap-edit';
import {
  loadLatestSitemap,
  saveSitemap,
  buildSitemapGenerationInput,
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

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const { error } = await authorize(params.id);
  if (error) return error;

  const row = await loadLatestSitemap(params.id);
  if (!row) {
    return NextResponse.json({ sitemapId: null, sitemap: null, copyGate: null, issues: [] });
  }
  const artifact = row.sitemapJson as unknown as WebsiteSitemapArtifact;
  const gate = canGenerateCopy(artifact);
  return NextResponse.json({
    sitemapId: row.id,
    sitemap: artifact,
    approvalStatus: row.approvalStatus,
    issues: validateSitemapForApproval(artifact),
    copyGate: {
      status: mapCopyGateStatus(gate.code),
      allowed: gate.allowed,
      code: gate.code,
      reason: gate.reason,
    },
  });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { error } = await authorize(params.id);
  if (error) return error;

  const project = await ensureWebsiteProject(params.id);
  const input = await buildSitemapGenerationInput(params.id);
  if (!input) {
    return NextResponse.json({ error: 'Business not found' }, { status: 404 });
  }

  const artifact = generateSitemap(input);
  const saved = await saveSitemap({
    businessId: params.id,
    websiteProjectId: project.id,
    sitemap: artifact,
  });

  return NextResponse.json({
    sitemapId: saved.id,
    sitemap: artifact,
    issues: validateSitemapForApproval(artifact),
  });
}
