// @ts-nocheck
export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export async function GET() {
  try {
    const [totalFeeds, activeFeeds, staleFeeds, brokenFeeds, blockedFeeds] = await Promise.all([
      prisma.rssFeed.count(),
      prisma.rssFeed.count({ where: { status: 'active' } }),
      prisma.rssFeed.count({ where: { status: 'stale' } }),
      prisma.rssFeed.count({ where: { status: 'broken' } }),
      prisma.rssFeed.count({ where: { status: 'blocked' } }),
    ]);

    const [totalItems, approvedItems, blockedItems, manualReviewItems] = await Promise.all([
      prisma.rssItem.count(),
      prisma.rssItem.count({ where: { filterStatus: 'approved' } }),
      prisma.rssItem.count({ where: { filterStatus: 'blocked' } }),
      prisma.rssItem.count({ where: { filterStatus: 'manual_review' } }),
    ]);

    const feedsByType = await prisma.rssFeed.groupBy({
      by: ['sourceType'],
      _count: true,
      orderBy: { _count: { sourceType: 'desc' } },
    });

    const feedsByState = await prisma.rssFeed.groupBy({
      by: ['pilotState'],
      _count: true,
      where: { pilotState: { not: null } },
      orderBy: { _count: { pilotState: 'desc' } },
    });

    const feedsByStatus = await prisma.rssFeed.groupBy({
      by: ['status'],
      _count: true,
      orderBy: { _count: { status: 'desc' } },
    });

    const feedsByScope = await prisma.rssFeed.groupBy({
      by: ['geoScope'],
      _count: true,
      orderBy: { _count: { geoScope: 'desc' } },
    });

    const totalGeoMappings = await prisma.feedGeo.count();
    const totalPolicies = await prisma.contentPolicy.count();

    return NextResponse.json({
      overview: {
        totalFeeds,
        activeFeeds,
        staleFeeds,
        brokenFeeds,
        blockedFeeds,
        totalItems,
        approvedItems,
        blockedItems,
        manualReviewItems,
        totalGeoMappings,
        totalPolicies,
      },
      feedsByType: feedsByType.map(r => ({ type: r.sourceType, count: r._count })),
      feedsByState: feedsByState.map(r => ({ state: r.pilotState, count: r._count })),
      feedsByStatus: feedsByStatus.map(r => ({ status: r.status, count: r._count })),
      feedsByScope: feedsByScope.map(r => ({ scope: r.geoScope, count: r._count })),
    });
  } catch (error: any) {
    console.error('Stats error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
