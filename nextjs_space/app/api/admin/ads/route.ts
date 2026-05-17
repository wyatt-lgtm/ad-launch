export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-guard';
import { prisma } from '@/lib/db';

export async function GET(req: NextRequest) {
  const guard = await requireAdmin();
  if (!guard.authorized) return guard.response;

  const { searchParams } = new URL(req.url);
  const mode = searchParams.get('mode') || 'daily'; // 'daily' | 'day-detail'
  const day = searchParams.get('day'); // YYYY-MM-DD for day-detail

  try {
    if (mode === 'daily') {
      // Return ad counts grouped by day (last 90 days)
      const since = new Date();
      since.setDate(since.getDate() - 90);

      const ads = await prisma.ad.findMany({
        where: { createdAt: { gte: since } },
        select: {
          id: true,
          createdAt: true,
          lane: true,
        },
        orderBy: { createdAt: 'desc' },
      });

      // Group by day
      const dayMap: Record<string, { date: string; count: number; lanes: Record<string, number> }> = {};
      for (const ad of ads) {
        const dateStr = ad.createdAt.toISOString().slice(0, 10);
        if (!dayMap[dateStr]) {
          dayMap[dateStr] = { date: dateStr, count: 0, lanes: {} };
        }
        dayMap[dateStr].count++;
        const lane = ad.lane || 'unknown';
        dayMap[dateStr].lanes[lane] = (dayMap[dateStr].lanes[lane] || 0) + 1;
      }

      const days = Object.values(dayMap).sort((a, b) => b.date.localeCompare(a.date));
      return NextResponse.json({ days, total: ads.length });
    }

    if (mode === 'day-detail' && day) {
      // Return ads for a specific day, grouped by account
      const start = new Date(day + 'T00:00:00.000Z');
      const end = new Date(day + 'T23:59:59.999Z');

      const ads = await prisma.ad.findMany({
        where: {
          createdAt: { gte: start, lte: end },
        },
        select: {
          id: true,
          imageUrl: true,
          watermarkedUrl: true,
          headline: true,
          caption: true,
          lane: true,
          createdAt: true,
          analysis: {
            select: {
              id: true,
              websiteUrl: true,
              businessName: true,
              user: {
                select: {
                  id: true,
                  email: true,
                },
              },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      });

      // Group by user
      const accountMap: Record<string, {
        userId: string;
        email: string;
        ads: typeof ads;
      }> = {};

      for (const ad of ads) {
        const userId = ad.analysis?.user?.id || 'unknown';
        const email = ad.analysis?.user?.email || 'Unknown';
        if (!accountMap[userId]) {
          accountMap[userId] = { userId, email, ads: [] };
        }
        accountMap[userId].ads.push(ad);
      }

      const accounts = Object.values(accountMap).map(a => ({
        userId: a.userId,
        email: a.email,
        adCount: a.ads.length,
        ads: a.ads.map((ad: any) => ({
          id: ad.id,
          imageUrl: ad.watermarkedUrl || ad.imageUrl || null,
          headline: ad.headline || null,
          caption: ad.caption ? ad.caption.slice(0, 200) : null,
          lane: ad.lane || null,
          websiteUrl: ad.analysis?.websiteUrl || null,
          businessName: ad.analysis?.businessName || null,
          createdAt: ad.createdAt,
        })),
      }));

      accounts.sort((a, b) => b.adCount - a.adCount);

      return NextResponse.json({ day, accounts, total: ads.length });
    }

    return NextResponse.json({ error: 'Invalid mode' }, { status: 400 });
  } catch (err: any) {
    console.error('[admin/ads] Error:', err);
    return NextResponse.json({ error: 'Failed to fetch ads data' }, { status: 500 });
  }
}
