export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { verifyAssetAccess } from '@/lib/asset-access';
import { prisma } from '@/lib/db';
import {
  generateAssetContextForBusinessAsset,
} from '@/lib/asset-context';

/**
 * GET /api/assets/[id]/context
 * Returns existing context for a business asset, or null.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const assetId = params.id;
    const asset = await prisma.businessAsset.findUnique({
      where: { id: assetId },
      select: { businessId: true },
    });
    if (!asset) {
      return NextResponse.json({ error: 'Asset not found.' }, { status: 404 });
    }
    const access = await verifyAssetAccess(asset.businessId);
    if (!access.authorized) {
      return NextResponse.json({ error: access.error }, { status: access.statusCode ?? 403 });
    }

    const ctx = await prisma.assetContext.findUnique({
      where: { businessAssetId: assetId },
    });

    return NextResponse.json({ context: ctx || null });
  } catch (err: any) {
    console.error('[assets/context GET]', err);
    return NextResponse.json({ error: 'Failed to get context.' }, { status: 500 });
  }
}

/**
 * POST /api/assets/[id]/context
 * Generate (or regenerate) AI context for a business asset.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const assetId = params.id;
    const asset = await prisma.businessAsset.findUnique({
      where: { id: assetId },
      select: { businessId: true },
    });
    if (!asset) {
      return NextResponse.json({ error: 'Asset not found.' }, { status: 404 });
    }
    const access = await verifyAssetAccess(asset.businessId);
    if (!access.authorized) {
      return NextResponse.json({ error: access.error }, { status: access.statusCode ?? 403 });
    }

    const result = await generateAssetContextForBusinessAsset(assetId);

    const ctx = await prisma.assetContext.findUnique({
      where: { businessAssetId: assetId },
    });

    return NextResponse.json({
      context: ctx,
      generated: result !== null,
    });
  } catch (err: any) {
    console.error('[assets/context POST]', err);
    return NextResponse.json({ error: 'Failed to generate context.' }, { status: 500 });
  }
}

/**
 * PATCH /api/assets/[id]/context
 * Human edits and approval status changes.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const assetId = params.id;
    const body = await req.json();

    const asset = await prisma.businessAsset.findUnique({
      where: { id: assetId },
      select: { businessId: true },
    });
    if (!asset) {
      return NextResponse.json({ error: 'Asset not found.' }, { status: 404 });
    }
    const access = await verifyAssetAccess(asset.businessId);
    if (!access.authorized) {
      return NextResponse.json({ error: access.error }, { status: access.statusCode ?? 403 });
    }

    const session = await getServerSession(authOptions);

    // Check context exists
    const existing = await prisma.assetContext.findUnique({
      where: { businessAssetId: assetId },
    });
    if (!existing) {
      return NextResponse.json({ error: 'No context to update. Generate context first.' }, { status: 404 });
    }

    // Allowed editable fields
    const updateData: any = {};
    const editableFields = [
      'humanDescription', 'agentDescription', 'suggestedUses', 'restrictedUses',
      'visibleElements', 'dominantColors', 'mood', 'style',
      'documentSummary', 'keyPoints', 'restrictedClaims', 'requiredDisclosures',
      'transcriptSummary', 'qualityNotes', 'contextStatus',
    ];

    for (const field of editableFields) {
      if (body[field] !== undefined) {
        updateData[field] = body[field];
      }
    }

    // If human is editing, mark as human-reviewed
    if (Object.keys(updateData).length > 0) {
      updateData.humanReviewedContext = true;
      updateData.reviewedByUserId = (session?.user as any)?.id || null;
      updateData.reviewedAt = new Date();
    }

    const updated = await prisma.assetContext.update({
      where: { businessAssetId: assetId },
      data: updateData,
    });

    return NextResponse.json({ context: updated });
  } catch (err: any) {
    console.error('[assets/context PATCH]', err);
    return NextResponse.json({ error: 'Failed to update context.' }, { status: 500 });
  }
}
