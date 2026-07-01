/**
 * Website Image Briefs — approve a brief set (Milestone 4), business-scoped.
 *
 * POST -> mark a brief set as approved. This is a REVIEW action only; it does
 *         NOT render images, upload assets, build, or deploy.
 *
 * HARD BOUNDARIES: NO image generation, NO R2 upload, NO static build, NO
 * publish, NO deploy.
 */
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { resolveBusinessAccess } from '@/lib/website-workflow';
import { approveImageBriefSet } from '@/lib/website-image-briefs-store';

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

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string; briefSetId: string } },
) {
  const { error } = await authorize(params.id);
  if (error) return error;

  const result = await approveImageBriefSet({
    businessId: params.id,
    briefSetId: params.briefSetId,
  });
  if (!result.ok) {
    const code = result.error === 'not_found' ? 404 : 422;
    return NextResponse.json({ error: result.error }, { status: code });
  }

  return NextResponse.json({
    briefSet: result.briefSet,
    // Explicit boundary flags for the client / audit.
    imageGenerationRun: false,
    r2UploadRun: false,
    staticBuildRun: false,
    publishRun: false,
    note: 'Image briefs approved. Image generation is available in a later milestone.',
  });
}
