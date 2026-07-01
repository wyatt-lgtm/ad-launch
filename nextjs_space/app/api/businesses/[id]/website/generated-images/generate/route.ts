/**
 * Website Generated Images — dedicated generate endpoint (Milestone 5C).
 *
 * POST /api/businesses/{businessId}/website/generated-images/generate
 *   body: { imageBriefSetId, imageBriefIds: [...], maxImages: 1, dryRun: false }
 *
 * Human-in-the-loop, cost-controlled live render trigger. This route:
 *   - REQUIRES an authenticated user with access to the business.
 *   - Is strictly business-scoped (no cross-business leakage).
 *   - Uses the server-side WEBSITE_RENDER_SERVICE_TOKEN via the render-provider
 *     seam. The token is NEVER read from the client, returned, or logged.
 *   - NEVER accepts an arbitrary Tombstone URL from the client; it always calls
 *     the server-configured backend.
 *   - Bounds the number of images with maxImages (default 1, hard-capped).
 *   - Supports dryRun: validates the contract + returns the expected durable R2
 *     key WITHOUT generating an image, uploading to R2, or persisting a row.
 *
 * HARD BOUNDARIES: NO static build, NO mobile QA render, NO publish, NO deploy.
 */
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { resolveBusinessAccess, ensureWebsiteProject } from '@/lib/website-workflow';
import {
  generateWebsiteImages,
  isImageRenderProviderConfigured,
} from '@/lib/website-image-generation-store';

/** Hard safety cap so a client can never request an unbounded batch. */
const MAX_IMAGES_CAP = 10;
const DEFAULT_MAX_IMAGES = 1;

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

/** Clamp maxImages into [1, MAX_IMAGES_CAP], defaulting to 1. */
function boundMaxImages(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_MAX_IMAGES;
  return Math.min(Math.floor(n), MAX_IMAGES_CAP);
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

  const imageBriefSetId = typeof body?.imageBriefSetId === 'string' ? body.imageBriefSetId : null;
  const imageBriefIds = Array.isArray(body?.imageBriefIds) ? body.imageBriefIds.map(String) : null;
  const maxImages = boundMaxImages(body?.maxImages);
  const dryRun = body?.dryRun === true;

  const project = await ensureWebsiteProject(params.id);
  const result = await generateWebsiteImages({
    businessId: params.id,
    websiteProjectId: project.id,
    briefSetId: imageBriefSetId,
    requestedBriefIds: imageBriefIds,
    generatedByUserId: access?.user.id ?? null,
    limit: maxImages,
    dryRun,
  });

  // HARD GATE — no assets generated, no partial work.
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

  // Dry-run: validated preview only. No asset rows were persisted.
  if (result.dryRun) {
    return NextResponse.json({
      dryRun: true,
      maxImages,
      validated: result.validated ?? [],
      assets: [],
      staticBuildRun: result.staticBuildRun,
      mobileQaRun: result.mobileQaRun,
      publishRun: result.publishRun,
      deployRun: result.deployRun,
      note: 'Dry-run validated the render contract and expected durable key. No image was generated, no asset was stored. Static build and mobile QA are available in a later milestone.',
    });
  }

  return NextResponse.json({
    dryRun: false,
    maxImages,
    assets: result.assets ?? [],
    failedBriefIds: result.failedBriefIds ?? [],
    staticBuildRun: result.staticBuildRun,
    mobileQaRun: result.mobileQaRun,
    publishRun: result.publishRun,
    deployRun: result.deployRun,
    note: 'Generated assets link back to their source brief, page, and section. Static build and mobile QA are available in a later milestone.',
  });
}
