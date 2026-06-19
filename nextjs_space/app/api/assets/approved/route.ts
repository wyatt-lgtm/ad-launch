export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getFileUrl } from '@/lib/s3';

/**
 * GET /api/assets/approved?tombstoneBusinessId=xxx
 * GET /api/assets/approved?tombstoneBusinessUuid=yyy
 * GET /api/assets/approved?businessId=zzz
 *
 * Tombstone-facing endpoint: retrieve approved assets for creative workflows.
 * This endpoint is authenticated via the ADMIN_API_KEY header or session.
 * Only returns assets with approvalStatus='approved'.
 *
 * Optional query params:
 * - category: filter by category
 * - assetType: filter by asset type
 * - adObjective: trust, product, local, brand — returns prioritized assets for the objective
 */
export async function GET(req: NextRequest) {
  try {
    // Auth: check ADMIN_API_KEY header or session
    const apiKey = req.headers.get('x-api-key');
    const validApiKey = process.env.ADMIN_API_KEY;

    if (!apiKey || apiKey !== validApiKey) {
      // Fall back to session auth
      const { getServerSession } = await import('next-auth');
      const { authOptions } = await import('@/lib/auth-options');
      const session = await getServerSession(authOptions);
      if (!session?.user?.email) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
    }

    const { searchParams } = new URL(req.url);
    const tombstoneBusinessId = searchParams.get('tombstoneBusinessId');
    const tombstoneBusinessUuid = searchParams.get('tombstoneBusinessUuid');
    const businessId = searchParams.get('businessId');
    const category = searchParams.get('category');
    const assetType = searchParams.get('assetType');
    const adObjective = searchParams.get('adObjective');

    if (!tombstoneBusinessId && !tombstoneBusinessUuid && !businessId) {
      return NextResponse.json(
        { error: 'One of tombstoneBusinessId, tombstoneBusinessUuid, or businessId is required.' },
        { status: 400 }
      );
    }

    // Build the where clause
    const where: any = {
      approvalStatus: 'approved',
      archivedAt: null,
    };

    if (businessId) {
      where.businessId = businessId;
    } else if (tombstoneBusinessId) {
      where.tombstoneBusinessId = parseInt(tombstoneBusinessId, 10);
    } else if (tombstoneBusinessUuid) {
      where.tombstoneBusinessUuid = tombstoneBusinessUuid;
    }

    // Additional filters
    if (category) where.category = category;
    if (assetType) where.assetType = assetType;

    // Objective-based prioritization
    let orderBy: any[] = [{ priorityScore: 'desc' }, { createdAt: 'desc' }];

    // Filter by objective-relevant categories if specified
    if (adObjective) {
      const objectiveCategories = getObjectiveCategories(adObjective);
      if (objectiveCategories.length > 0 && !category) {
        where.category = { in: objectiveCategories };
      }
    }

    const assets = await prisma.businessAsset.findMany({
      where,
      orderBy,
      select: {
        id: true,
        assetType: true,
        category: true,
        title: true,
        description: true,
        tags: true,
        mimeType: true,
        cloudStoragePath: true,
        publicUrl: true,
        thumbnailUrl: true,
        isPublic: true,
        usageRights: true,
        allowedChannels: true,
        disallowedChannels: true,
        priorityScore: true,
        textContent: true,
        approvedForAds: true,
        exampleType: true,
        tombstoneBusinessId: true,
        tombstoneBusinessUuid: true,
        width: true,
        height: true,
      },
    });

    // Resolve URLs
    const resolved = await Promise.all(
      assets.map(async (a) => {
        let resolvedUrl = a.publicUrl;
        if (a.cloudStoragePath && !a.publicUrl) {
          try {
            resolvedUrl = await getFileUrl(a.cloudStoragePath, a.mimeType, a.isPublic);
          } catch { /* skip */ }
        }
        return { ...a, resolvedUrl };
      })
    );

    // Always include brand assets (logo, palette, guidelines) regardless of objective
    let brandAssets: typeof resolved = [];
    if (adObjective && !category) {
      const brandWhere = {
        ...where,
        category: 'brand',
      };
      delete brandWhere.category; // remove the objective filter for brand query
      const brands = await prisma.businessAsset.findMany({
        where: {
          approvalStatus: 'approved',
          archivedAt: null,
          category: 'brand',
          ...(businessId ? { businessId } : {}),
          ...(tombstoneBusinessId ? { tombstoneBusinessId: parseInt(tombstoneBusinessId, 10) } : {}),
          ...(tombstoneBusinessUuid ? { tombstoneBusinessUuid } : {}),
        },
        orderBy,
        select: {
          id: true, assetType: true, category: true, title: true, description: true,
          tags: true, mimeType: true, cloudStoragePath: true, publicUrl: true,
          thumbnailUrl: true, isPublic: true, usageRights: true, allowedChannels: true,
          disallowedChannels: true, priorityScore: true, textContent: true,
          approvedForAds: true, exampleType: true, tombstoneBusinessId: true,
          tombstoneBusinessUuid: true, width: true, height: true,
        },
      });
      // Deduplicate
      const existingIds = new Set(resolved.map(r => r.id));
      for (const b of brands) {
        if (!existingIds.has(b.id)) {
          let resolvedUrl = b.publicUrl;
          if (b.cloudStoragePath && !b.publicUrl) {
            try { resolvedUrl = await getFileUrl(b.cloudStoragePath, b.mimeType, b.isPublic); } catch {}
          }
          brandAssets.push({ ...b, resolvedUrl });
        }
      }
    }

    return NextResponse.json({
      assets: [...resolved, ...brandAssets],
      count: resolved.length + brandAssets.length,
    });
  } catch (err: any) {
    console.error('[assets/approved] Error:', err);
    return NextResponse.json({ error: 'Failed to fetch approved assets.' }, { status: 500 });
  }
}

/**
 * Map ad objectives to prioritized asset categories.
 */
function getObjectiveCategories(objective: string): string[] {
  switch (objective) {
    case 'trust':
      return ['people_trust', 'proof_social_proof', 'location_service_area', 'compliance'];
    case 'product':
      return ['products_services', 'proof_social_proof', 'compliance'];
    case 'local':
      return ['location_service_area', 'proof_social_proof', 'people_trust'];
    case 'brand':
      return ['brand', 'creative_examples'];
    default:
      return [];
  }
}
