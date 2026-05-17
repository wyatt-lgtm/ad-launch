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

  const where = search ? { email: { contains: search, mode: 'insensitive' as const } } : {};

  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      select: {
        id: true,
        email: true,
        confirmed: true,
        role: true,
        freeAdsUsed: true,
        paidAdsCount: true,
        createdAt: true,
        updatedAt: true,
        _count: {
          select: {
            businesses: true,
            analyses: true,
            socialPosts: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.user.count({ where }),
  ]);

  // Get ad counts per user (through analyses)
  const userIds = users.map(u => u.id);
  const adCounts = await prisma.ad.groupBy({
    by: ['analysisId'],
    where: {
      analysis: { userId: { in: userIds } },
    },
    _count: true,
  });

  // Map analysisId → userId for ad count aggregation
  const analysisUserMap = await prisma.analysis.findMany({
    where: { userId: { in: userIds } },
    select: { id: true, userId: true },
  });
  const analysisToUser = new Map(analysisUserMap.map(a => [a.id, a.userId]));
  const userAdCounts = new Map<string, number>();
  for (const ac of adCounts) {
    const uid = analysisToUser.get(ac.analysisId);
    if (uid) userAdCounts.set(uid, (userAdCounts.get(uid) || 0) + ac._count);
  }

  const accounts = users.map(u => ({
    id: u.id,
    email: u.email,
    confirmed: u.confirmed,
    role: u.role,
    freeAdsUsed: u.freeAdsUsed,
    paidAdsCount: u.paidAdsCount,
    createdAt: u.createdAt.toISOString(),
    updatedAt: u.updatedAt.toISOString(),
    businessCount: u._count.businesses,
    analysisCount: u._count.analyses,
    adCount: userAdCounts.get(u.id) || 0,
    socialPostCount: u._count.socialPosts,
  }));

  return NextResponse.json({
    accounts,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
}
