export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const page = parseInt(url.searchParams.get('page') || '1');
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 100);
    const filterStatus = url.searchParams.get('filterStatus') || undefined;
    const feedId = url.searchParams.get('feedId') || undefined;
    const search = url.searchParams.get('search') || undefined;

    const where: any = {};
    if (feedId) where.feedId = feedId;
    if (filterStatus) where.filterStatus = filterStatus;
    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [items, total] = await Promise.all([
      prisma.rssItem.findMany({
        where,
        orderBy: { pubDate: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          feed: { select: { title: true, sourceType: true } },
          itemAudits: { take: 1, orderBy: { createdAt: 'desc' } },
        },
      }),
      prisma.rssItem.count({ where }),
    ]);

    return NextResponse.json({
      items,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const { itemId, filterStatus, reason } = body;
    if (!itemId || !filterStatus) {
      return NextResponse.json({ error: 'itemId and filterStatus required' }, { status: 400 });
    }

    // Update the item's filterStatus directly
    await prisma.rssItem.update({
      where: { id: itemId },
      data: { filterStatus, filterReason: reason || 'admin_override' },
    });

    // Also create an audit trail
    await prisma.itemAudit.create({
      data: {
        itemId,
        action: filterStatus === 'approved' ? 'manual_approved' : 'manual_blocked',
        reason: reason || 'admin_override',
        performedBy: 'admin',
      },
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
