/**
 * Website Generated Image asset API (Milestone 5) — business-scoped.
 *
 * GET -> a single generated asset (business-scoped).
 * PUT -> update editable metadata (alt text, prompt summary, rationale).
 *
 * HARD BOUNDARIES: NO static build, NO publish, NO deploy.
 */
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { resolveBusinessAccess } from '@/lib/website-workflow';
import {
  getGeneratedImageAsset,
  updateGeneratedImageAsset,
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

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string; assetId: string } },
) {
  const { error } = await authorize(params.id);
  if (error) return error;
  const asset = await getGeneratedImageAsset(params.id, params.assetId);
  if (!asset) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ asset });
}

export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string; assetId: string } },
) {
  const { error } = await authorize(params.id);
  if (error) return error;
  let body: any = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const result = await updateGeneratedImageAsset({
    businessId: params.id,
    assetId: params.assetId,
    altText: typeof body?.altText === 'string' ? body.altText : undefined,
    promptSummary: typeof body?.promptSummary === 'string' ? body.promptSummary : undefined,
    visualRationale: typeof body?.visualRationale === 'string' ? body.visualRationale : undefined,
  });
  if (!result.ok) {
    const status = result.error === 'not_found' ? 404 : 400;
    return NextResponse.json({ error: result.error }, { status });
  }
  return NextResponse.json({ asset: result.asset });
}
