// @ts-nocheck
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const feed = await prisma.rssFeed.findUnique({
      where: { id: params.id },
      include: {
        items: { take: 20, orderBy: { pubDate: 'desc' } },
        feedGeos: { take: 10, include: { zip: true } },
        feedAudits: { take: 10, orderBy: { createdAt: 'desc' } },
        _count: { select: { items: true, feedGeos: true } },
      },
    });
    if (!feed) return NextResponse.json({ error: 'Feed not found' }, { status: 404 });
    return NextResponse.json(feed);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = await req.json();
    const allowed = ['status', 'sourceType', 'sourceQuality', 'geoScope', 'title', 'notes', 'pilotState'];
    const data: any = {};
    for (const key of allowed) {
      if (body[key] !== undefined) data[key] = body[key];
    }

    const feed = await prisma.rssFeed.update({
      where: { id: params.id },
      data,
    });

    // Log the edit
    await prisma.feedAudit.create({
      data: {
        feedId: params.id,
        action: 'manual_override',
        newValue: JSON.stringify(data),
        reason: 'Admin dashboard edit',
        performedBy: 'admin',
      },
    });

    return NextResponse.json(feed);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    // Delete related records first
    await prisma.feedGeo.deleteMany({ where: { feedId: params.id } });
    const items = await prisma.rssItem.findMany({ where: { feedId: params.id }, select: { id: true } });
    if (items.length) {
      await prisma.itemAudit.deleteMany({ where: { itemId: { in: items.map(i => i.id) } } });
    }
    await prisma.rssItem.deleteMany({ where: { feedId: params.id } });
    await prisma.feedAudit.deleteMany({ where: { feedId: params.id } });
    await prisma.rssFeed.delete({ where: { id: params.id } });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
