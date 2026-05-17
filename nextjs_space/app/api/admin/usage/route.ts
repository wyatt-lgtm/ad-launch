export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-guard';
import { prisma } from '@/lib/db';

export async function GET() {
  const auth = await requireAdmin();
  if (!auth.authorized) return auth.response;

  const [analysesByStatus, adsByLane, postsByStatus, businesses] = await Promise.all([
    prisma.analysis.groupBy({ by: ['status'], _count: true }),
    prisma.ad.groupBy({ by: ['lane'], _count: true }),
    prisma.socialPost.groupBy({ by: ['status'], _count: true }),
    prisma.business.findMany({
      select: {
        id: true,
        businessName: true,
        websiteUrl: true,
        _count: {
          select: { analyses: true },
        },
      },
      orderBy: { updatedAt: 'desc' },
      take: 50,
    }),
  ]);

  // Get ad + social post counts per business (through analyses)
  const bizIds = businesses.map(b => b.id);
  const analysesForBiz = await prisma.analysis.findMany({
    where: { businessId: { in: bizIds } },
    select: { id: true, businessId: true },
  });
  const analysisIds = analysesForBiz.map(a => a.id);
  const analysisToBiz = new Map(analysesForBiz.map(a => [a.id, a.businessId]));

  const adCountsByAnalysis = await prisma.ad.groupBy({
    by: ['analysisId'],
    where: { analysisId: { in: analysisIds } },
    _count: true,
  });

  const bizAdCounts = new Map<string, number>();
  for (const ac of adCountsByAnalysis) {
    const bid = analysisToBiz.get(ac.analysisId);
    if (bid) bizAdCounts.set(bid, (bizAdCounts.get(bid) || 0) + ac._count);
  }

  // Social posts per user → per business (through userId → business)
  const bizUserMap = await prisma.business.findMany({
    where: { id: { in: bizIds } },
    select: { id: true, userId: true },
  });
  const userToBiz = new Map<string, string[]>();
  for (const b of bizUserMap) {
    if (!userToBiz.has(b.userId)) userToBiz.set(b.userId, []);
    userToBiz.get(b.userId)!.push(b.id);
  }

  const postCountsByUser = await prisma.socialPost.groupBy({
    by: ['userId'],
    where: { userId: { in: Array.from(userToBiz.keys()) } },
    _count: true,
  });
  const bizPostCounts = new Map<string, number>();
  for (const pc of postCountsByUser) {
    const bids = userToBiz.get(pc.userId) || [];
    for (const bid of bids) {
      bizPostCounts.set(bid, (bizPostCounts.get(bid) || 0) + pc._count);
    }
  }

  const perBusiness = businesses.map(b => ({
    id: b.id,
    businessName: b.businessName || b.websiteUrl,
    websiteUrl: b.websiteUrl,
    analysisCount: b._count.analyses,
    adCount: bizAdCounts.get(b.id) || 0,
    socialPostCount: bizPostCounts.get(b.id) || 0,
  }));

  return NextResponse.json({
    analyses: {
      total: analysesByStatus.reduce((sum, s) => sum + s._count, 0),
      byStatus: Object.fromEntries(analysesByStatus.map(s => [s.status, s._count])),
    },
    ads: {
      total: adsByLane.reduce((sum, s) => sum + s._count, 0),
      byLane: Object.fromEntries(adsByLane.map(s => [s.lane || 'unknown', s._count])),
    },
    socialPosts: {
      total: postsByStatus.reduce((sum, s) => sum + s._count, 0),
      byStatus: Object.fromEntries(postsByStatus.map(s => [s.status, s._count])),
    },
    perBusiness,
  });
}
