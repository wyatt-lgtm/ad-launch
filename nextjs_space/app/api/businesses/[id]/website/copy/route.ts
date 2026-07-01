/**
 * Website Copy API (Milestone 3) — business-scoped.
 *
 * GET  -> latest generated copy artifact for the business (or null) plus the
 *         current copy-gate status derived from the latest sitemap.
 * POST -> generate page-by-page copy from the APPROVED sitemap. Strictly gated:
 *         returns 422 with the gate reason (and H1 issues) when the sitemap is
 *         missing / not approved / has invalid H1s. No copy is written when the
 *         gate blocks.
 *
 * HARD BOUNDARIES: NO image generation, NO image briefs, NO static build, NO
 * publish, NO deploy. Generated copy is DRAFT for user review only.
 */
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { resolveBusinessAccess, ensureWebsiteProject } from '@/lib/website-workflow';
import { canGenerateCopy, type WebsiteSitemapArtifact } from '@/lib/website-sitemap';
import { mapCopyGateStatus } from '@/lib/website-sitemap-edit';
import { loadLatestSitemap } from '@/lib/website-sitemap-store';
import {
  loadWebsiteCopy,
  generateWebsiteCopy,
  isCopyLlmConfigured,
} from '@/lib/website-copy-store';

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

function gatePayload(gate: ReturnType<typeof canGenerateCopy>) {
  return {
    status: mapCopyGateStatus(gate.code),
    allowed: gate.allowed,
    code: gate.code,
    reason: gate.reason,
    h1Issues: gate.h1Issues ?? [],
  };
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const { error } = await authorize(params.id);
  if (error) return error;

  const sitemapRow = await loadLatestSitemap(params.id);
  const sitemap = (sitemapRow?.sitemapJson as unknown as WebsiteSitemapArtifact) || null;
  const gate = canGenerateCopy(sitemap);

  const copy = await loadWebsiteCopy(params.id, sitemapRow?.id ?? null);

  return NextResponse.json({
    sitemapId: sitemapRow?.id ?? null,
    copyGate: gatePayload(gate),
    llmConfigured: isCopyLlmConfigured(),
    copy: copy.pages.length
      ? {
          sitemapId: copy.sitemapId,
          generatedAt: copy.generatedAt,
          pageCount: copy.pages.length,
          pages: copy.pages,
          stage: 'draft' as const,
        }
      : null,
  });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { error, access } = await authorize(params.id);
  if (error) return error;

  if (!isCopyLlmConfigured()) {
    return NextResponse.json(
      { error: 'Copy generation is not configured (missing LLM API key).' },
      { status: 503 },
    );
  }

  // Optional per-page regeneration payload.
  let slugs: string[] | undefined;
  try {
    const body = await req.json().catch(() => null);
    if (body && Array.isArray(body.slugs)) {
      slugs = body.slugs.filter((s: unknown) => typeof s === 'string');
    }
  } catch {
    // no body — full generation
  }

  const project = await ensureWebsiteProject(params.id);

  const result = await generateWebsiteCopy({
    businessId: params.id,
    websiteProjectId: project.id,
    generatedByUserId: access?.user.id ?? null,
    slugs,
  });

  // HARD GATE — no copy generated.
  if (!result.ok && result.gate && !result.gate.allowed) {
    return NextResponse.json(
      {
        error: 'Copy generation is blocked until the sitemap is approved.',
        copyGate: gatePayload(result.gate),
      },
      { status: 422 },
    );
  }

  if (!result.ok) {
    return NextResponse.json(
      {
        error: 'Copy generation failed to produce any pages.',
        failedSlugs: result.failedSlugs ?? [],
      },
      { status: 502 },
    );
  }

  return NextResponse.json({
    sitemapId: result.sitemapId,
    stage: 'draft' as const,
    copy: result.artifact,
    pageIssues: result.pageIssues ?? [],
    uniquenessIssues: result.uniquenessIssues ?? [],
    failedSlugs: result.failedSlugs ?? [],
    // Explicit boundary flags for the client / audit.
    imageGenerationRun: false,
    staticBuildRun: false,
    publishRun: false,
    note: 'Copy is a draft for review. Image briefs and build are available in a later milestone.',
  });
}
