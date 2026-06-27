// @ts-nocheck
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';

/**
 * GET /api/businesses/[id]/community-engagement/settings
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const userId = (session.user as any).id;
    const businessId = params.id;

    const business = await prisma.business.findFirst({ where: { id: businessId, userId }, select: { id: true } });
    if (!business) return NextResponse.json({ error: 'Business not found' }, { status: 404 });

    const settings = await prisma.communityEngagementSettings.findUnique({ where: { businessId } });

    // Get communities
    const sources = await prisma.communitySource.findMany({
      where: { businessId },
      orderBy: { createdAt: 'desc' },
    });

    const targetCommunities = sources.filter(s => !s.excluded);
    const excludedCommunities = sources.filter(s => s.excluded);

    return NextResponse.json({
      settings: settings || {
        enabled: false,
        minOpportunityScore: 75,
        minContentMatchScore: 20,
        minRuleCompatibility: 10,
        requireVideo: false,
        requireExplainerStory: false,
        humanApprovalRequired: true,
        disclosureReminder: true,
        maxOppsPerDay: 3,
        maxOppsPerCommunityWeek: 1,
        urlCooldownDays: 14,
        expertiseTopics: [],
        contentSourceUrls: [],
      },
      targetCommunities,
      excludedCommunities,
    });
  } catch (err: any) {
    console.error('[community-engagement/settings] GET error:', err);
    return NextResponse.json({ error: 'Failed to load settings' }, { status: 500 });
  }
}

/**
 * PUT /api/businesses/[id]/community-engagement/settings
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const userId = (session.user as any).id;
    const businessId = params.id;

    const business = await prisma.business.findFirst({ where: { id: businessId, userId }, select: { id: true } });
    if (!business) return NextResponse.json({ error: 'Business not found' }, { status: 404 });

    const body = await req.json();
    const {
      enabled, minOpportunityScore, minContentMatchScore, minRuleCompatibility,
      requireVideo, requireExplainerStory, disclosureReminder,
      maxOppsPerDay, maxOppsPerCommunityWeek, urlCooldownDays,
      expertiseTopics, contentSourceUrls,
      // Community management
      addCommunity, removeCommunityId, toggleCommunityId,
    } = body;

    // Upsert settings
    const settingsData: any = {};
    if (enabled !== undefined) settingsData.enabled = enabled;
    if (minOpportunityScore !== undefined) settingsData.minOpportunityScore = Math.max(0, Math.min(100, minOpportunityScore));
    if (minContentMatchScore !== undefined) settingsData.minContentMatchScore = Math.max(0, Math.min(25, minContentMatchScore));
    if (minRuleCompatibility !== undefined) settingsData.minRuleCompatibility = Math.max(0, Math.min(15, minRuleCompatibility));
    if (requireVideo !== undefined) settingsData.requireVideo = requireVideo;
    if (requireExplainerStory !== undefined) settingsData.requireExplainerStory = requireExplainerStory;
    if (disclosureReminder !== undefined) settingsData.disclosureReminder = disclosureReminder;
    if (maxOppsPerDay !== undefined) settingsData.maxOppsPerDay = Math.max(1, Math.min(10, maxOppsPerDay));
    if (maxOppsPerCommunityWeek !== undefined) settingsData.maxOppsPerCommunityWeek = Math.max(1, Math.min(5, maxOppsPerCommunityWeek));
    if (urlCooldownDays !== undefined) settingsData.urlCooldownDays = Math.max(1, Math.min(90, urlCooldownDays));
    if (expertiseTopics !== undefined) settingsData.expertiseTopics = expertiseTopics;
    if (contentSourceUrls !== undefined) settingsData.contentSourceUrls = contentSourceUrls;
    // humanApprovalRequired is always true — cannot be disabled
    settingsData.humanApprovalRequired = true;

    if (Object.keys(settingsData).length > 0) {
      await prisma.communityEngagementSettings.upsert({
        where: { businessId },
        create: { businessId, ...settingsData },
        update: settingsData,
      });
    }

    // Add community
    if (addCommunity) {
      const { platform, communityName, communityUrl, excluded, notes } = addCommunity;
      if (platform && communityName) {
        await prisma.communitySource.upsert({
          where: { businessId_platform_communityName: { businessId, platform, communityName } },
          create: { businessId, platform, communityName, communityUrl: communityUrl || null, excluded: excluded || false, notes: notes || null },
          update: { communityUrl: communityUrl || undefined, excluded: excluded || false, notes: notes || undefined, enabled: true },
        });
      }
    }

    // Remove community
    if (removeCommunityId) {
      await prisma.communitySource.deleteMany({ where: { id: removeCommunityId, businessId } });
    }

    // Toggle community enabled/disabled
    if (toggleCommunityId) {
      const source = await prisma.communitySource.findFirst({ where: { id: toggleCommunityId, businessId } });
      if (source) {
        await prisma.communitySource.update({ where: { id: toggleCommunityId }, data: { enabled: !source.enabled } });
      }
    }

    // Return updated state
    const updated = await prisma.communityEngagementSettings.findUnique({ where: { businessId } });
    const sources = await prisma.communitySource.findMany({ where: { businessId }, orderBy: { createdAt: 'desc' } });

    console.log(`[community-engagement/settings] Updated for business ${businessId}: enabled=${updated?.enabled}`);

    return NextResponse.json({
      settings: updated,
      targetCommunities: sources.filter(s => !s.excluded),
      excludedCommunities: sources.filter(s => s.excluded),
    });
  } catch (err: any) {
    console.error('[community-engagement/settings] PUT error:', err);
    return NextResponse.json({ error: 'Failed to update settings' }, { status: 500 });
  }
}
