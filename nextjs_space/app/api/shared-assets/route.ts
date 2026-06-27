export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';
import { getFileUrl } from '@/lib/s3';
import { isAdmin, logSharedAssetAudit } from '@/lib/shared-assets';

/**
 * GET /api/shared-assets
 * List shared assets. Any authenticated user can browse.
 * Query params: scope, category, search, page, pageSize
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const scope = searchParams.get('scope');
    const category = searchParams.get('category');
    const search = searchParams.get('search');
    const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
    const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get('pageSize') || '50')));
    const showAll = searchParams.get('showAll') === 'true'; // admin-only: show inactive

    const where: any = {};
    if (!showAll || !isAdmin(session)) {
      where.isActive = true;
      where.approvalStatus = 'approved';
      where.licenseStatus = 'active';
    }
    if (scope) where.scope = scope;
    if (category) where.category = category;
    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
        { tags: { hasSome: [search.toLowerCase()] } },
      ];
    }

    const [assets, total] = await Promise.all([
      prisma.sharedAsset.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { uploadedBy: { select: { email: true } } },
      }),
      prisma.sharedAsset.count({ where }),
    ]);

    // Resolve URLs
    const enriched = await Promise.all(
      assets.map(async (a) => {
        let resolvedUrl = a.publicUrl || null;
        if (!resolvedUrl && a.cloudStoragePath) {
          try { resolvedUrl = await getFileUrl(a.cloudStoragePath, a.mimeType, a.isPublic); } catch {}
        }
        return { ...a, resolvedUrl };
      }),
    );

    return NextResponse.json({ assets: enriched, total, page, pageSize });
  } catch (err) {
    console.error('[SharedAssets GET]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * POST /api/shared-assets
 * Create a shared asset. Admin only.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!isAdmin(session)) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const body = await req.json();
    const {
      scope, category, assetType, title, description, tags,
      originalFilename, mimeType, fileSizeBytes, width, height, duration,
      sha256Hash, cloudStoragePath, publicUrl,
      licenseType, licenseExpiry, licenseNotes, rightsHolder,
      attributionRequired, attributionText,
      allowWebsite, allowSocial, allowAds, allowEmail, allowPrint,
      allowVideo, allowInternal, allowAI,
      requiresApproval, maxResolution, noDerivatives, noCommercial,
      geographicRestriction, industryRestriction,
      targetIndustries, targetBusinessTypes,
    } = body;

    if (!category || !assetType || !title || !originalFilename || !mimeType || !cloudStoragePath) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Dedup check
    if (sha256Hash) {
      const existing = await prisma.sharedAsset.findFirst({ where: { sha256Hash } });
      if (existing) {
        return NextResponse.json(
          { error: 'Duplicate asset detected', existingId: existing.id },
          { status: 409 },
        );
      }
    }

    const userId = (session.user as any).id;
    // Brand/OEM defaults to requires-approval
    const effectiveRequiresApproval = scope === 'brand_oem' ? true : (requiresApproval ?? false);

    const asset = await prisma.sharedAsset.create({
      data: {
        uploadedByUserId: userId,
        scope: scope || 'global',
        category,
        assetType,
        title,
        description: description || '',
        tags: tags || [],
        originalFilename,
        mimeType,
        fileSizeBytes: fileSizeBytes || 0,
        width,
        height,
        duration,
        sha256Hash,
        cloudStoragePath,
        publicUrl,
        licenseType: licenseType || 'owned',
        licenseExpiry: licenseExpiry ? new Date(licenseExpiry) : null,
        licenseNotes,
        rightsHolder,
        attributionRequired: attributionRequired ?? false,
        attributionText,
        allowWebsite: allowWebsite ?? true,
        allowSocial: allowSocial ?? true,
        allowAds: allowAds ?? true,
        allowEmail: allowEmail ?? true,
        allowPrint: allowPrint ?? true,
        allowVideo: allowVideo ?? true,
        allowInternal: allowInternal ?? true,
        allowAI: allowAI ?? true,
        requiresApproval: effectiveRequiresApproval,
        maxResolution,
        noDerivatives: noDerivatives ?? false,
        noCommercial: noCommercial ?? false,
        geographicRestriction,
        industryRestriction: industryRestriction || [],
        targetIndustries: targetIndustries || [],
        targetBusinessTypes: targetBusinessTypes || [],
      },
    });

    await logSharedAssetAudit({
      sharedAssetId: asset.id,
      userId,
      action: 'created',
      details: { title, scope, category },
    });

    return NextResponse.json({ asset }, { status: 201 });
  } catch (err) {
    console.error('[SharedAssets POST]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
