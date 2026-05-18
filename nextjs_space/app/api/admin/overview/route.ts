// @ts-nocheck
export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-guard';
import { prisma } from '@/lib/db';

export async function GET() {
  const auth = await requireAdmin();
  if (!auth.authorized) return auth.response;

  const [totalUsers, confirmedUsers, totalBusinesses, totalAnalyses, totalAds, totalSocialPosts, totalPasswordResets] =
    await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { confirmed: true } }),
      prisma.business.count(),
      prisma.analysis.count(),
      prisma.ad.count(),
      prisma.socialPost.count(),
      prisma.passwordResetToken.count(),
    ]);

  // Recent signups (last 7 days)
  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);
  const recentSignups = await prisma.user.count({ where: { createdAt: { gte: weekAgo } } });

  // Analysis status breakdown
  const analysesByStatus = await prisma.analysis.groupBy({
    by: ['status'],
    _count: true,
  });

  // Social post status breakdown
  const postsByStatus = await prisma.socialPost.groupBy({
    by: ['status'],
    _count: true,
  });

  return NextResponse.json({
    users: {
      total: totalUsers,
      confirmed: confirmedUsers,
      unconfirmed: totalUsers - confirmedUsers,
      recentSignups,
    },
    businesses: totalBusinesses,
    analyses: {
      total: totalAnalyses,
      byStatus: Object.fromEntries(analysesByStatus.map(s => [s.status, s._count])),
    },
    ads: totalAds,
    socialPosts: {
      total: totalSocialPosts,
      byStatus: Object.fromEntries(postsByStatus.map(s => [s.status, s._count])),
    },
    passwordResets: totalPasswordResets,
  });
}
