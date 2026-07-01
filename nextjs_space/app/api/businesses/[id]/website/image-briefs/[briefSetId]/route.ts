/**
 * Website Image Briefs — single brief-set API (Milestone 4), business-scoped.
 *
 * GET -> a single image-brief set.
 * PUT -> apply low-risk edits (descriptive fields) and/or a status transition
 *        (e.g. request revision). Safety fields are re-validated. Never renders.
 *
 * HARD BOUNDARIES: NO image generation, NO R2 upload, NO static build, NO
 * publish, NO deploy.
 */
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { resolveBusinessAccess } from '@/lib/website-workflow';
import {
  getImageBriefSet,
  updateImageBriefSet,
} from '@/lib/website-image-briefs-store';
import type { ImageBriefStatus } from '@/lib/website-image-briefs';

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

const EDIT_STATUSES = new Set<ImageBriefStatus>([
  'draft',
  'ready_for_review',
  'revision_requested',
]);

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string; briefSetId: string } },
) {
  const { error } = await authorize(params.id);
  if (error) return error;

  const briefSet = await getImageBriefSet(params.id, params.briefSetId);
  if (!briefSet) {
    return NextResponse.json({ error: 'Image brief set not found.' }, { status: 404 });
  }
  return NextResponse.json({ briefSet });
}

export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string; briefSetId: string } },
) {
  const { error } = await authorize(params.id);
  if (error) return error;

  const body = await req.json().catch(() => null);
  const artifact = body && typeof body === 'object' ? body.artifact : undefined;
  let status: ImageBriefStatus | undefined;
  if (body && typeof body.status === 'string' && EDIT_STATUSES.has(body.status)) {
    status = body.status;
  }

  const result = await updateImageBriefSet({
    businessId: params.id,
    briefSetId: params.briefSetId,
    artifact,
    status,
  });
  if (!result.ok) {
    const code = result.error === 'not_found' ? 404 : 422;
    return NextResponse.json({ error: result.error }, { status: code });
  }

  return NextResponse.json({
    briefSet: result.briefSet,
    issues: result.issues ?? [],
    imageGenerationRun: false,
    staticBuildRun: false,
    publishRun: false,
  });
}
