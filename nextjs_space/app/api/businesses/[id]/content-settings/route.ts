export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';

const VALID_MODES = ['local_only', 'local_plus_interests', 'interests_only'] as const;
type ContentSourceMode = (typeof VALID_MODES)[number];

// Industry metadata (same as feed-preferences route)
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

/**
 * GET /api/businesses/[id]/content-settings
 * Returns the business's content source mode and selected interest categories.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const userId = (session.user as any).id;
    const businessId = params.id;

    const business = await prisma.business.findFirst({
      where: { id: businessId, userId },
      select: { id: true, contentSourceMode: true },
    });
    if (!business) {
      return NextResponse.json({ error: 'Business not found' }, { status: 404 });
    }

    // Get business-level feed preferences
    const prefs = await prisma.businessFeedPreference.findMany({
      where: { businessId },
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

    return NextResponse.json({
      businessId: business.id,
      contentSourceMode: business.contentSourceMode,
      selectedInterestCategories: Array.from(enabledSet),
      industries,
    });
  } catch (err: any) {
    console.error('[content-settings] GET error:', err);
    return NextResponse.json({ error: 'Failed to load content settings' }, { status: 500 });
  }
}

/**
 * PATCH /api/businesses/[id]/content-settings
 * Updates contentSourceMode and/or selectedInterestCategories.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const userId = (session.user as any).id;
    const businessId = params.id;

    const business = await prisma.business.findFirst({
      where: { id: businessId, userId },
      select: { id: true },
    });
    if (!business) {
      return NextResponse.json({ error: 'Business not found' }, { status: 404 });
    }

    const body = await req.json();
    const { contentSourceMode, selectedInterestCategories } = body;

    // Update content source mode if provided
    if (contentSourceMode !== undefined) {
      if (!VALID_MODES.includes(contentSourceMode)) {
        return NextResponse.json(
          { error: `Invalid contentSourceMode. Must be one of: ${VALID_MODES.join(', ')}` },
          { status: 400 }
        );
      }
      await prisma.business.update({
        where: { id: businessId },
        data: { contentSourceMode },
      });
    }

    // Update interest categories if provided
    if (Array.isArray(selectedInterestCategories)) {
      const validKeys = new Set(INDUSTRIES.map((i) => i.key));
      const selected = selectedInterestCategories.filter((k: string) => validKeys.has(k));

      await prisma.$transaction(async (tx) => {
        // Disable all first
        await tx.businessFeedPreference.updateMany({
          where: { businessId },
          data: { enabled: false },
        });
        // Upsert selected
        for (const industry of selected) {
          await tx.businessFeedPreference.upsert({
            where: { businessId_industry: { businessId, industry } },
            create: { businessId, industry, enabled: true },
            update: { enabled: true },
          });
        }
      });
    }

    // Re-fetch and return updated state
    const updated = await prisma.business.findUnique({
      where: { id: businessId },
      select: { contentSourceMode: true },
    });
    const prefs = await prisma.businessFeedPreference.findMany({
      where: { businessId, enabled: true },
      select: { industry: true },
    });

    console.log(`[content-settings] Updated business ${businessId}: mode=${updated?.contentSourceMode}, categories=${prefs.map(p => p.industry).join(',')}`);

    return NextResponse.json({
      businessId,
      contentSourceMode: updated?.contentSourceMode,
      selectedInterestCategories: prefs.map((p) => p.industry),
    });
  } catch (err: any) {
    console.error('[content-settings] PATCH error:', err);
    return NextResponse.json({ error: 'Failed to update content settings' }, { status: 500 });
  }
}
