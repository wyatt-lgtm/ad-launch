// @ts-nocheck
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';

// Industry metadata for the UI
const INDUSTRIES = [
  { key: 'technology', label: 'Technology', description: 'Tech news, gadgets, software, AI & innovation', icon: '💻' },
  { key: 'small_business', label: 'Small Business', description: 'Entrepreneurship, marketing tips, growth strategies', icon: '🏪' },
  { key: 'automotive', label: 'Automotive', description: 'Cars, trucks, reviews, maintenance & industry news', icon: '🚗' },
  { key: 'sports', label: 'Sports', description: 'NFL, NBA, MLB, NHL, college sports, golf, MMA & more', icon: '🏈' },
  { key: 'rural_agriculture', label: 'Rural & Agriculture', description: 'Farming, ranching, rural lifestyle & agribusiness', icon: '🌾' },
  { key: 'rodeo_western', label: 'Rodeo & Western', description: 'Rodeo events, western lifestyle, cowboy culture', icon: '🤠' },
  { key: 'home_services', label: 'Home Services', description: 'Home improvement, DIY, remodeling & maintenance', icon: '🔧' },
  { key: 'cybersecurity', label: 'Cybersecurity', description: 'Security news, threats, privacy & best practices', icon: '🔒' },
  { key: 'retail_consumer', label: 'Retail & Consumer', description: 'Retail trends, e-commerce, consumer behavior', icon: '🛍️' },
  { key: 'weather', label: 'Weather', description: 'Weather alerts, forecasts, severe weather tracking', icon: '⛈️' },
];

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const userId = (session.user as any).id;

    const prefs = await prisma.userFeedPreference.findMany({
      where: { userId },
    });

    // Get feed counts per industry
    const feedCounts = await prisma.rssFeed.groupBy({
      by: ['industry'],
      where: { geoScope: 'national', status: 'active', industry: { not: null } },
      _count: { id: true },
    });

    const countMap: Record<string, number> = {};
    feedCounts.forEach((fc) => {
      if (fc.industry) countMap[fc.industry] = fc._count.id;
    });

    const enabledSet = new Set(prefs.filter((p) => p.enabled).map((p) => p.industry));

    const industries = INDUSTRIES.map((ind) => ({
      ...ind,
      feedCount: countMap[ind.key] ?? 0,
      enabled: enabledSet.has(ind.key),
    }));

    return NextResponse.json({ industries });
  } catch (err: any) {
    console.error('Feed preferences GET error:', err);
    return NextResponse.json({ error: 'Failed to load preferences' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const userId = (session.user as any).id;
    const body = await request.json();
    const { industries } = body ?? {};

    if (!Array.isArray(industries)) {
      return NextResponse.json({ error: 'industries array required' }, { status: 400 });
    }

    // Validate keys
    const validKeys = new Set(INDUSTRIES.map((i) => i.key));
    const selected = industries.filter((k: string) => validKeys.has(k));

    // Upsert selected as enabled, delete unselected
    await prisma.$transaction(async (tx) => {
      // Disable all first
      await tx.userFeedPreference.updateMany({
        where: { userId },
        data: { enabled: false },
      });

      // Upsert selected
      for (const industry of selected) {
        await tx.userFeedPreference.upsert({
          where: { userId_industry: { userId, industry } },
          create: { userId, industry, enabled: true },
          update: { enabled: true },
        });
      }
    });

    return NextResponse.json({ success: true, selected });
  } catch (err: any) {
    console.error('Feed preferences POST error:', err);
    return NextResponse.json({ error: 'Failed to save preferences' }, { status: 500 });
  }
}
