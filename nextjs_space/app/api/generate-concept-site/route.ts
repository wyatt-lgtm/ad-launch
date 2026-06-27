export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { createConceptWebsiteMission } from '@/lib/tombstone';
import { prisma } from '@/lib/db';
import { buildWebsiteAssetContext } from '@/lib/tombstone-asset-bridge';

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
      ownerFeedback,
    } = body;

    const warnings: string[] = [];

    // ── Try Tombstone workflow first ──────────────────────────────────────
    if (websiteUrl || businessName) {
      // Fetch business-level metadata (service area, build mode, forbidden terms)
      let serviceAreaMode = 'local';
      let isNationwide = false;
      let websiteBuildMode = 'multi_page_seo';
      let forbiddenBrandTerms: string[] = [];
      let hqCity = '';
      let hqState = '';
      if (businessId) {
        try {
          const biz = await prisma.business.findUnique({
            where: { id: businessId },
            select: { serviceAreaMode: true, isNationwide: true, websiteBuildMode: true, forbiddenBrandTerms: true, hqCity: true, hqState: true },
          });
          if (biz) {
            serviceAreaMode = biz.serviceAreaMode || 'local';
            isNationwide = biz.isNationwide || false;
            websiteBuildMode = biz.websiteBuildMode || 'multi_page_seo';
            forbiddenBrandTerms = biz.forbiddenBrandTerms || [];
            hqCity = biz.hqCity || '';
            hqState = biz.hqState || '';
          }
        } catch (e: any) {
          console.warn('[generate-concept-site] Failed to fetch business metadata (non-fatal):', e?.message);
        }
      }

      try {
        // Check for search API availability if competitor auto-discovery requested
        const hasSearchApi = !!(process.env.SERPAPI_API_KEY || process.env.DATAFORSEO_LOGIN || process.env.GOOGLE_CUSTOM_SEARCH_KEY || process.env.BING_SEARCH_API_KEY);
        if (analyzeCompetitors && !competitorUrls?.length && !hasSearchApi) {
          warnings.push('No search provider configured; automatic competitor discovery skipped. Provide competitor URLs manually for best results.');
        }

        // Fetch all locations for multi-location website generation
        let locationsPayload: { locations_count?: number; primary_location?: Record<string, any>; all_locations?: Array<Record<string, any>> } = {};
        if (businessId) {
          try {
            const locations = await prisma.businessLocation.findMany({
              where: { businessId },
              orderBy: [{ isPrimary: 'desc' }, { locationNumber: 'asc' }],
            });
            if (locations.length > 0) {
              const primary = locations.find(l => l.isPrimary) || locations[0];
              locationsPayload = {
                locations_count: locations.length,
                primary_location: {
                  location_number: primary.locationNumber,
                  location_name: primary.locationName,
                  address: primary.address1,
                  city: primary.city,
                  state: primary.state,
                  zip: primary.postalCode,
                  county: primary.county,
                  phone: primary.phone,
                  is_primary: true,
                  page_slug: primary.pageSlug,
                },
                all_locations: locations.map(l => ({
                  location_number: l.locationNumber,
                  location_name: l.locationName,
                  address: l.address1,
                  city: l.city,
                  state: l.state,
                  zip: l.postalCode,
                  county: l.county,
                  phone: l.phone,
                  is_primary: l.isPrimary,
                  page_slug: l.pageSlug,
                })),
              };
            }
          } catch (locErr: any) {
            console.warn('[generate-concept-site] Failed to fetch locations (non-fatal):', locErr?.message);
          }
        }

        // Fetch approved asset context for website generation
        let assetContext;
        if (businessId) {
          try {
            const bridge = await buildWebsiteAssetContext(businessId);
            assetContext = bridge.context;
            console.log(`[generate-concept-site] Asset context: ${bridge.context.totalRetrieved} assets, ${bridge.context.totalSkipped} skipped`);
          } catch (err: any) {
            console.warn('[generate-concept-site] Asset bridge failed (non-fatal):', err?.message);
          }
        }

        const result = await createConceptWebsiteMission({
          website_url: websiteUrl || '',
          business_name: businessName || 'the business',
          industry: industry || '',
          location: location || '',
          ...locationsPayload,
          content_profile: contentProfile || {},
          business_id: businessId || '',
          user_id: userId || '',
          google_maps_api_key: process.env.GOOGLE_MAPS_API_KEY || '',
          // Reference websites
          reference_sites: referenceSites?.slice(0, 3),
          reference_instructions: referenceInstructions,
          inspiration_only: true,
          do_not_copy_assets: true,
          // Service area & build mode
          service_area_mode: serviceAreaMode,
          is_nationwide: isNationwide,
          website_build_mode: websiteBuildMode,
          forbidden_brand_terms: forbiddenBrandTerms,
          hq_city: hqCity,
          hq_state: hqState,
          // Competitive SEO scout — always enabled for website generation
          analyze_competitors: true,
          primary_keyword: primaryKeyword,
          trade_area: tradeArea,
          competitor_urls: competitorUrls?.slice(0, 3),
          competitor_count: 3,
          // Owner feedback for revision pass
          owner_feedback: Array.isArray(ownerFeedback) ? ownerFeedback : undefined,
          // Approved asset context from Launch OS
          asset_context: assetContext,
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
        const isAbort = tombstoneErr?.name === 'AbortError' || tombstoneErr?.message?.includes('aborted');
        const msg = isAbort
          ? 'Website generation timed out — the service may be warming up. Please try again in a moment.'
          : 'Website generation service unavailable. Please try again.';
        return NextResponse.json({ error: msg }, { status: 503 });
      }
    }

    // No URL or businessName provided
    return NextResponse.json({ error: 'No website concept data provided' }, { status: 400 });
  } catch (err: any) {
    console.error('[generate-concept-site] Error:', err?.message);
    return NextResponse.json({ error: 'Generation failed' }, { status: 500 });
  }
}
