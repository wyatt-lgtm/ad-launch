/**
 * Content Profile Enrichment Engine
 *
 * Generates business-agnostic content pillars, evergreen topics, audience segments,
 * and seasonal topic maps using LLM inference on business profile data.
 */

import { prisma } from '@/lib/db';

const LLM_URL = 'https://apps.abacus.ai/v1/chat/completions';

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

  const now = new Date();
  const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const currentMonth = monthNames[now.getMonth()];
  const currentYear = now.getFullYear();

  const prompt = `You are a content strategist for small businesses. Analyze this business and generate a comprehensive content profile.

Business: ${name}
Website: ${business.websiteUrl}
Location: ${location || 'Unknown'}
Current month: ${currentMonth} ${currentYear}

Return a JSON object with EXACTLY these keys (no markdown, no explanation, just the JSON):

{
  "industry": "<the business industry/category, e.g. 'auto repair', 'HVAC', 'dental', 'internet service provider', 'restaurant', etc.>",
  "contentPillars": ["<5-8 core content themes this business should post about regularly>"],
  "allowedAdjacentTopics": ["<8-12 lifestyle/adjacent topics relevant to this business's customers, e.g. an auto repair shop's customers also care about road trips, fuel savings, car insurance tips>"],
  "seasonalTopicMap": {
    "January": ["<2-3 seasonal topics for this month relevant to this business>"],
    "February": ["..."],
    "March": ["..."],
    "April": ["..."],
    "May": ["..."],
    "June": ["..."],
    "July": ["..."],
    "August": ["..."],
    "September": ["..."],
    "October": ["..."],
    "November": ["..."],
    "December": ["..."]
  },
  "faqTopics": ["<8-12 common questions customers ask this type of business>"],
  "audienceSegments": ["<3-5 distinct customer segments this business serves>"],
  "brandVoiceSummary": "<2-3 sentence summary of ideal brand voice for this business type>",
  "restrictedTopics": ["<topics this business should NEVER post about: specific medical/legal/financial advice, partisan politics, competitor bashing, anything brand-damaging>"],
  "evergreenTopics": [
    {
      "topic": "<specific post topic>",
      "category": "<one of: Seasonal Tip, Maintenance Reminder, Customer FAQ, How-To / Checklist, Safety / Preparedness, Problem / Solution, Local Lifestyle, Myth-Busting, Offer Tie-In>",
      "audience": "<target audience segment>",
      "why_it_fits": "<1 sentence: why this topic works for this business>",
      "suggested_business_tie_in": "<1 sentence: how the business can connect to this topic without being salesy>"
    }
  ]
}

Generate 15-20 evergreen topics spanning all categories. Make them specific and actionable, not generic.
For adjacent topics, think about what THIS business's customers care about in their daily lives.
For restricted topics, include any area where the business could face liability or backlash.

IMPORTANT: Return ONLY the JSON object, no markdown fences, no explanation.`;

  try {
    const res = await fetch(LLM_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.ABACUSAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-4.1-mini',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.7,
        max_tokens: 4000,
      }),
    });

    if (!res.ok) {
      console.error(`[content-profile] LLM request failed: ${res.status}`);
      return null;
    }

    const data = await res.json();
    const text = data.choices?.[0]?.message?.content?.trim() || '';

    // Parse JSON from response (strip markdown fences if present)
    const cleaned = text.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
    const parsed = JSON.parse(cleaned) as ContentProfileData;

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

  // Add seasonal topics for current month
  const seasonalTopics = (profile.seasonalTopicMap?.[currentMonth] || []).map((t: string) => ({
    topic: t,
    category: 'Seasonal Tip' as string,
    audience: 'All customers',
    why_it_fits: `Timely for ${currentMonth}`,
    suggested_business_tie_in: `Connect this seasonal topic to your ${profile.industry} services`,
  }));

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
