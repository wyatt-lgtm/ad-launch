export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-guard';
import { prisma } from '@/lib/db';

export async function GET(req: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.authorized) return auth.response;

  const url = new URL(req.url);
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1'));
  const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') || '50')));
  const search = url.searchParams.get('search')?.trim() || '';
  const skip = (page - 1) * limit;

  const where = search
    ? {
        OR: [
          { businessName: { contains: search, mode: 'insensitive' as const } },
          { websiteUrl: { contains: search, mode: 'insensitive' as const } },
          { user: { email: { contains: search, mode: 'insensitive' as const } } },
        ],
      }
    : {};

  const [businesses, total] = await Promise.all([
    prisma.business.findMany({
      where,
      select: {
        id: true,
        websiteUrl: true,
        businessName: true,
        businessCity: true,
        businessState: true,
        businessZip: true,
        createdAt: true,
        updatedAt: true,
        user: {
          select: { id: true, email: true },
        },
        _count: {
          select: {
            analyses: true,
            socialPosts: true,
          },
        },
        analyses: {
          select: {
            id: true,
            status: true,
            createdAt: true,
            _count: { select: { ads: true } },
          },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.business.count({ where }),
  ]);

  // Flatten for frontend
  const items = businesses.map((b: any) => {
    const latestAnalysis = b.analyses?.[0] || null;
    return {
      id: b.id,
      websiteUrl: b.websiteUrl,
      businessName: b.businessName,
      businessCity: b.businessCity,
      businessState: b.businessState,
      businessZip: b.businessZip,
      ownerEmail: b.user?.email || null,
      ownerId: b.user?.id || null,
      analysisCount: b._count?.analyses || 0,
      socialPostCount: b._count?.socialPosts || 0,
      adCount: latestAnalysis?._count?.ads || 0,
      latestAnalysisId: latestAnalysis?.id || null,
      latestAnalysisStatus: latestAnalysis?.status || null,
      createdAt: b.createdAt,
      updatedAt: b.updatedAt,
    };
  });

  return NextResponse.json({
    businesses: items,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
}
