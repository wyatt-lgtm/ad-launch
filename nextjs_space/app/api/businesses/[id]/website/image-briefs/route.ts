/**
 * Website Image Briefs API (Milestone 4) — business-scoped.
 *
 * GET  -> latest image-brief set for the business (or null) plus the current
 *         image-brief gate status (derived from the approved sitemap + copy).
 * POST -> generate image BRIEFS (specifications only) from the approved sitemap
 *         + existing copy artifact. Strictly gated: returns 422 with the gate
 *         reason when the sitemap is missing / not approved / has invalid H1s,
 *         or when the copy artifact is missing / ineligible. No briefs are
 *         written when the gate blocks.
 *
 * HARD BOUNDARIES: NO image generation, NO image-provider calls, NO R2 upload,
 * NO static build, NO publish, NO deploy. Briefs are DRAFT specs for review.
 */
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { resolveBusinessAccess, ensureWebsiteProject } from '@/lib/website-workflow';
import {
  loadImageBriefState,
  generateImageBriefs,
  isImageBriefLlmConfigured,
} from '@/lib/website-image-briefs-store';

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

function gatePayload(gate: { allowed: boolean; code: string; reason: string }) {
  return { allowed: gate.allowed, code: gate.code, reason: gate.reason };
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const { error } = await authorize(params.id);
  if (error) return error;

  const state = await loadImageBriefState(params.id);
  return NextResponse.json({
    sitemapId: state.sitemapId,
    copyArtifactId: state.copyArtifactId,
    copyPresent: state.copyPresent,
    briefGate: gatePayload(state.gate),
    llmConfigured: isImageBriefLlmConfigured(),
    latest: state.latest,
    history: state.history,
    // Explicit boundary flags for the client / audit.
    imageGenerationAvailable: false,
    note: 'Image generation is available in a later milestone.',
  });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { error, access } = await authorize(params.id);
  if (error) return error;

  if (!isImageBriefLlmConfigured()) {
    return NextResponse.json(
      { error: 'Image brief generation is not configured (missing LLM API key).' },
      { status: 503 },
    );
  }

  const project = await ensureWebsiteProject(params.id);
  const result = await generateImageBriefs({
    businessId: params.id,
    websiteProjectId: project.id,
    generatedByUserId: access?.user.id ?? null,
  });

  // HARD GATE — no briefs generated.
  if (!result.ok && result.gate && !result.gate.allowed) {
    return NextResponse.json(
      {
        error: 'Image briefs are blocked until an approved sitemap and website copy exist.',
        briefGate: gatePayload(result.gate),
      },
      { status: 422 },
    );
  }

  if (!result.ok) {
    return NextResponse.json(
      { error: 'Image brief generation failed to produce any briefs.' },
      { status: 502 },
    );
  }

  return NextResponse.json({
    briefSet: result.briefSet,
    issues: result.issues ?? [],
    fallbackSlugs: result.fallbackSlugs ?? [],
    // Explicit boundary flags for the client / audit.
    imageGenerationRun: result.imageGenerationRun,
    r2UploadRun: result.r2UploadRun,
    staticBuildRun: result.staticBuildRun,
    publishRun: result.publishRun,
    note: 'Image briefs are draft specifications for review. Image generation is available in a later milestone.',
  });
}
