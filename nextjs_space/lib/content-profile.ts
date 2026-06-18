/**
 * Content Profile Enrichment Engine
 *
 * Generates business-agnostic content pillars, evergreen topics, audience segments,
 * and seasonal topic maps using LLM inference on business profile data.
 */

import { prisma } from '@/lib/db';

const TOMBSTONE_URL = process.env.TOMBSTONE_API_URL ?? 'https://tombstone-api-xjc4.onrender.com';

export interface ContentProfileData {
  contentPillars: string[];
  allowedAdjacentTopics: string[];
  seasonalTopicMap: Record<string, string[]>;
  faqTopics: string[];
  audienceSegments: string[];
  brandVoiceSummary: string;
  restrictedTopics: string[];
  evergreenTopics: Array<{
    topic: string;
    category: string;
    audience: string;
    why_it_fits: string;
    suggested_business_tie_in: string;
  }>;
  industry: string;
}

export const TOPIC_CATEGORIES = [
  'Seasonal Tip',
  'Maintenance Reminder',
  'Customer FAQ',
  'How-To / Checklist',
  'Safety / Preparedness',
  'Problem / Solution',
  'Local Lifestyle',
  'Myth-Busting',
  'Offer Tie-In',
] as const;

export type TopicCategory = (typeof TOPIC_CATEGORIES)[number];

const AUDIENCE_OPTIONS = [
  'All customers',
  'New customers',
  'Returning customers',
  'Budget-conscious',
  'Premium/high-value',
  'Seasonal/occasional',
  'Local community',
  'Families',
  'Business owners',
] as const;

export { AUDIENCE_OPTIONS };

const TONE_OPTIONS = [
  'Friendly & conversational',
  'Professional & authoritative',
  'Warm & empathetic',
  'Energetic & motivating',
  'Educational & helpful',
  'Casual & relatable',
] as const;

export { TONE_OPTIONS };

/**
 * Generate a full content profile for a business using LLM.
 */
export async function enrichContentProfile(
  businessId: string,
): Promise<ContentProfileData | null> {
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: {
      businessName: true,
      websiteUrl: true,
      businessCity: true,
      businessState: true,
      businessZip: true,
    },
  });

  if (!business) return null;

  const name = business.businessName || new URL(business.websiteUrl.startsWith('http') ? business.websiteUrl : `https://${business.websiteUrl}`).hostname;
  const location = [business.businessCity, business.businessState].filter(Boolean).join(', ');


  try {
    const res = await fetch(`${TOMBSTONE_URL}/content-profile/enrich`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        businessName: name,
        websiteUrl: business.websiteUrl,
        location: location || 'Unknown',
      }),
    });

    if (!res.ok) {
      console.error(`[content-profile] Tombstone request failed: ${res.status}`);
      return null;
    }

    const parsed = (await res.json()) as ContentProfileData;

    // Save to database
    await prisma.businessContentProfile.upsert({
      where: { businessId },
      create: {
        businessId,
        contentPillars: parsed.contentPillars || [],
        allowedAdjacentTopics: parsed.allowedAdjacentTopics || [],
        seasonalTopicMap: parsed.seasonalTopicMap || {},
        faqTopics: parsed.faqTopics || [],
        audienceSegments: parsed.audienceSegments || [],
        brandVoiceSummary: parsed.brandVoiceSummary || '',
        restrictedTopics: parsed.restrictedTopics || [],
        evergreenTopics: parsed.evergreenTopics || [],
        industry: parsed.industry || '',
        lastEnrichedAt: new Date(),
      },
      update: {
        contentPillars: parsed.contentPillars || [],
        allowedAdjacentTopics: parsed.allowedAdjacentTopics || [],
        seasonalTopicMap: parsed.seasonalTopicMap || {},
        faqTopics: parsed.faqTopics || [],
        audienceSegments: parsed.audienceSegments || [],
        brandVoiceSummary: parsed.brandVoiceSummary || '',
        restrictedTopics: parsed.restrictedTopics || [],
        evergreenTopics: parsed.evergreenTopics || [],
        industry: parsed.industry || '',
        lastEnrichedAt: new Date(),
      },
    });

    console.log(`[content-profile] Enriched profile for business ${businessId}: ${parsed.contentPillars?.length || 0} pillars, ${parsed.evergreenTopics?.length || 0} topics`);
    return parsed;
  } catch (err: any) {
    console.error(`[content-profile] Error enriching profile: ${err.message}`);
    return null;
  }
}

/**
 * Get the content profile for a business, enriching if needed.
 */
export async function getOrEnrichContentProfile(
  businessId: string,
  forceRefresh = false,
): Promise<ContentProfileData | null> {
  if (!forceRefresh) {
    const existing = await prisma.businessContentProfile.findUnique({
      where: { businessId },
    });
    if (existing && existing.lastEnrichedAt) {
      return {
        contentPillars: existing.contentPillars as string[],
        allowedAdjacentTopics: existing.allowedAdjacentTopics as string[],
        seasonalTopicMap: existing.seasonalTopicMap as Record<string, string[]>,
        faqTopics: existing.faqTopics as string[],
        audienceSegments: existing.audienceSegments as string[],
        brandVoiceSummary: existing.brandVoiceSummary,
        restrictedTopics: existing.restrictedTopics as string[],
        evergreenTopics: existing.evergreenTopics as any[],
        industry: existing.industry,
      };
    }
  }
  return enrichContentProfile(businessId);
}

/**
 * Generate weekly tip suggestions for a business using content profile + current context.
 */
export async function getWeeklyTipSuggestions(
  businessId: string,
  category?: string,
): Promise<Array<{
  topic: string;
  category: string;
  audience: string;
  why_it_fits: string;
  suggested_business_tie_in: string;
}>> {
  const profile = await getOrEnrichContentProfile(businessId);
  if (!profile) return [];

  const now = new Date();
  const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const currentMonth = monthNames[now.getMonth()];

  // Filter stored evergreen topics by category if specified
  let topics = profile.evergreenTopics || [];
  if (category && category !== 'all') {
    topics = topics.filter(t => t.category === category);
  }

  // Add seasonal topics for current month (only when no category filter or 'Seasonal Tip' selected)
  let seasonalTopics: typeof topics = [];
  if (!category || category === 'all' || category === 'Seasonal Tip') {
    seasonalTopics = (profile.seasonalTopicMap?.[currentMonth] || []).map((t: string) => ({
      topic: t,
      category: 'Seasonal Tip' as string,
      audience: 'All customers',
      why_it_fits: `Timely for ${currentMonth}`,
      suggested_business_tie_in: `Connect this seasonal topic to your ${profile.industry} services`,
    }));
  }

  // Combine and deduplicate
  const allTopics = [...seasonalTopics, ...topics];
  const seen = new Set<string>();
  const deduped = allTopics.filter(t => {
    const key = t.topic.toLowerCase().trim();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return deduped.slice(0, 20);
}