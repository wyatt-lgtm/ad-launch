export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { createConceptWebsiteMission } from '@/lib/tombstone';

/**
 * POST /api/generate-concept-site
 *
 * Tries Tombstone 5-step concept-website workflow first.
 * If Tombstone is unavailable, falls back to direct LLM generation.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const {
      websiteUrl,
      businessName,
      industry,
      location,
      contentProfile,
      businessId,
      userId,
      sections,
      colorPalette,
      // New: reference websites + SEO scout
      referenceSites,
      referenceInstructions,
      analyzeCompetitors,
      primaryKeyword,
      tradeArea,
      competitorUrls,
    } = body;

    const warnings: string[] = [];

    // ── Try Tombstone workflow first ──────────────────────────────────────
    if (websiteUrl || businessName) {
      try {
        // Check for search API availability if competitor auto-discovery requested
        const hasSearchApi = !!(process.env.SERPAPI_API_KEY || process.env.DATAFORSEO_LOGIN || process.env.GOOGLE_CUSTOM_SEARCH_KEY || process.env.BING_SEARCH_API_KEY);
        if (analyzeCompetitors && !competitorUrls?.length && !hasSearchApi) {
          warnings.push('No search provider configured; automatic competitor discovery skipped. Provide competitor URLs manually for best results.');
        }

        const result = await createConceptWebsiteMission({
          website_url: websiteUrl || '',
          business_name: businessName || 'the business',
          industry: industry || '',
          location: location || '',
          content_profile: contentProfile || {},
          business_id: businessId || '',
          user_id: userId || '',
          google_maps_api_key: process.env.GOOGLE_MAPS_API_KEY || '',
          // Reference websites
          reference_sites: referenceSites?.slice(0, 3),
          reference_instructions: referenceInstructions,
          inspiration_only: true,
          do_not_copy_assets: true,
          // Competitive SEO scout
          analyze_competitors: !!analyzeCompetitors,
          primary_keyword: primaryKeyword,
          trade_area: tradeArea,
          competitor_urls: competitorUrls?.slice(0, 3),
          competitor_count: 3,
        });

        if (result.success && result.workflowId) {
          return NextResponse.json({
            mode: 'workflow',
            workflowId: result.workflowId,
            taskIds: result.taskIds,
            missionName: result.missionName,
            stepCount: result.stepCount,
            finalTaskId: result.taskIds?.[result.taskIds.length - 1] ?? null,
            warnings,
          });
        }
        // Tombstone returned a non-success result
        console.error('[generate-concept-site] Tombstone workflow failed:', result.error);
        return NextResponse.json({ error: result.error || 'Website generation failed' }, { status: 500 });
      } catch (tombstoneErr: any) {
        console.error('[generate-concept-site] Tombstone unavailable:', tombstoneErr?.message);
        return NextResponse.json({ error: 'Website generation service unavailable. Please try again.' }, { status: 503 });
      }
    }

    // No URL or businessName provided
    return NextResponse.json({ error: 'No website concept data provided' }, { status: 400 });
  } catch (err: any) {
    console.error('[generate-concept-site] Error:', err?.message);
    return NextResponse.json({ error: 'Generation failed' }, { status: 500 });
  }
}
