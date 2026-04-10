export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const page = parseInt(url.searchParams.get('page') || '1');
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 100);
    const status = url.searchParams.get('status') || undefined;
    const sourceType = url.searchParams.get('sourceType') || undefined;
    const pilotState = url.searchParams.get('pilotState') || undefined;
    const geoScope = url.searchParams.get('geoScope') || undefined;
    const industry = url.searchParams.get('industry') || undefined;
    const search = url.searchParams.get('search') || undefined;
    const sortBy = url.searchParams.get('sortBy') || 'updatedAt';
    const sortDir = (url.searchParams.get('sortDir') || 'desc') as 'asc' | 'desc';

    const where: any = {};
    if (status) where.status = status;
    if (sourceType) where.sourceType = sourceType;
    if (pilotState) where.pilotState = pilotState;
    if (geoScope) where.geoScope = geoScope;
    if (industry) where.industry = industry;
    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { url: { contains: search, mode: 'insensitive' } },
        { siteUrl: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [feeds, total] = await Promise.all([
      prisma.rssFeed.findMany({
        where,
        orderBy: { [sortBy]: sortDir },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          _count: { select: { items: true, feedGeos: true } },
        },
      }),
      prisma.rssFeed.count({ where }),
    ]);

    return NextResponse.json({
      feeds,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (error: any) {
    console.error('Feeds list error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
