/**
 * Website Generated Images API (Milestone 5) — business-scoped.
 *
 * GET  -> gate status + list of generated image assets for the business.
 * POST -> generate website images from the APPROVED image brief set. Strictly
 *         gated: returns 422 with the gate reason when the approved sitemap /
 *         copy / approved brief set requirements are not met. No assets are
 *         written when the gate blocks.
 *
 * HARD BOUNDARIES: NO static build, NO mobile QA render, NO publish, NO deploy.
 * The actual render + durable R2 upload + hero QA are delegated to the
 * Tombstone backend through the render-provider seam.
 */
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { resolveBusinessAccess, ensureWebsiteProject } from '@/lib/website-workflow';
import {
  loadGeneratedImageState,
  generateWebsiteImages,
  isImageRenderProviderConfigured,
} from '@/lib/website-image-generation-store';

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

function gatePayload(gate: { allowed: boolean; code: string; reason: string; blockingBriefIds?: string[] }) {
  return { allowed: gate.allowed, code: gate.code, reason: gate.reason, blockingBriefIds: gate.blockingBriefIds ?? [] };
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const { error } = await authorize(params.id);
  if (error) return error;

  const state = await loadGeneratedImageState(params.id);
  return NextResponse.json({
    sitemapId: state.sitemapId,
    copyArtifactId: state.copyArtifactId,
    briefSetId: state.briefSetId,
    briefSetStatus: state.briefSetStatus,
    imageGate: gatePayload(state.gate),
    providerConfigured: state.providerConfigured,
    assets: state.assets,
    // Explicit boundary flags for the client / audit.
    staticBuildAvailable: false,
    mobileQaAvailable: false,
    note: 'Static build and mobile QA are available in a later milestone.',
  });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { error, access } = await authorize(params.id);
  if (error) return error;

  if (!isImageRenderProviderConfigured()) {
    return NextResponse.json(
      { error: 'Image generation is not configured (render provider unavailable).' },
      { status: 503 },
    );
  }

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const project = await ensureWebsiteProject(params.id);
  const result = await generateWebsiteImages({
    businessId: params.id,
    websiteProjectId: project.id,
    briefSetId: typeof body?.briefSetId === 'string' ? body.briefSetId : null,
    requestedBriefIds: Array.isArray(body?.briefIds) ? body.briefIds.map(String) : null,
    generatedByUserId: access?.user.id ?? null,
    limit: Number.isFinite(body?.limit) ? Number(body.limit) : undefined,
  });

  // HARD GATE — no assets generated.
  if (!result.ok && result.gate && !result.gate.allowed) {
    return NextResponse.json(
      {
        error: 'Image generation is blocked until the image briefs are approved.',
        imageGate: gatePayload(result.gate),
      },
      { status: 422 },
    );
  }

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error || 'Image generation failed to produce any assets.' },
      { status: 502 },
    );
  }

  return NextResponse.json({
    assets: result.assets ?? [],
    failedBriefIds: result.failedBriefIds ?? [],
    // Explicit boundary flags for the client / audit.
    staticBuildRun: result.staticBuildRun,
    mobileQaRun: result.mobileQaRun,
    publishRun: result.publishRun,
    deployRun: result.deployRun,
    note: 'Generated assets link back to their source brief, page, and section. Static build and mobile QA are available in a later milestone.',
  });
}
