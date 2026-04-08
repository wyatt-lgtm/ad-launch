export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

/**
 * Phase 9: Export/API Layer
 * GET  /api/rss/admin/export?format=json|csv&type=feeds|items
 * POST /api/rss/admin/export — webhook trigger for Clark Kent
 */
export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const format = url.searchParams.get('format') || 'json';
    const type = url.searchParams.get('type') || 'feeds';
    const status = url.searchParams.get('status') || undefined;
    const pilotState = url.searchParams.get('pilotState') || undefined;

    const where: any = {};
    if (status) where.status = status;
    if (pilotState) where.pilotState = pilotState;

    if (type === 'feeds') {
      const feeds = await prisma.rssFeed.findMany({
        where,
        include: { _count: { select: { items: true, feedGeos: true } } },
        orderBy: { updatedAt: 'desc' },
      });

      if (format === 'csv') {
        const headers = ['id', 'title', 'url', 'siteUrl', 'sourceType', 'sourceQuality', 'status', 'geoScope', 'pilotState', 'itemCount', 'geoCount'];
        const rows = feeds.map(f => [
          f.id, csvEscape(f.title || ''), csvEscape(f.url), csvEscape(f.siteUrl || ''),
          f.sourceType, f.sourceQuality || '', f.status, f.geoScope || '',
          f.pilotState || '', f._count.items, f._count.feedGeos,
        ].join(','));
        const csv = [headers.join(','), ...rows].join('\n');
        return new NextResponse(csv, {
          headers: { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="feeds.csv"' },
        });
      }

      return NextResponse.json({ feeds, total: feeds.length });
    }

    if (type === 'items') {
      const items = await prisma.rssItem.findMany({
        where: where.status ? { feed: { status: where.status } } : {},
        include: {
          feed: { select: { title: true, sourceType: true, pilotState: true } },
          itemAudits: { take: 1, orderBy: { createdAt: 'desc' } },
        },
        orderBy: { pubDate: 'desc' },
        take: 1000,
      });

      if (format === 'csv') {
        const headers = ['id', 'title', 'link', 'pubDate', 'feedTitle', 'sourceType', 'filterStatus', 'auditCategory'];
        const rows = items.map((i: any) => [
          i.id, csvEscape(i.title || ''), csvEscape(i.link || ''),
          i.pubDate?.toISOString() || '', csvEscape(i.feed?.title || ''),
          i.feed?.sourceType || '', i.filterStatus || 'pending',
          i.itemAudits?.[0]?.category || '',
        ].join(','));
        const csv = [headers.join(','), ...rows].join('\n');
        return new NextResponse(csv, {
          headers: { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="items.csv"' },
        });
      }

      return NextResponse.json({ items, total: items.length });
    }

    return NextResponse.json({ error: 'Unknown type. Use feeds or items' }, { status: 400 });
  } catch (error: any) {
    console.error('Export error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * Webhook trigger for Clark Kent agent.
 * POST body: { zip, radius?, days?, sourceTypes?, limit? }
 * Returns a content brief ready for agent consumption.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { zip, radius = 25, days = 7, sourceTypes, limit = 20 } = body;

    if (!zip) {
      return NextResponse.json({ error: 'zip is required' }, { status: 400 });
    }

    // Dynamically import the trade area engine
    const { generateContentBrief } = await import('@/lib/rss/trade-area-feed');
    const brief = await generateContentBrief(zip, radius, { days, sourceTypes, limit });

    return NextResponse.json({
      webhook: 'clark_kent_brief',
      timestamp: new Date().toISOString(),
      brief,
    });
  } catch (error: any) {
    console.error('Webhook error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

function csvEscape(s: string): string {
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}
