/**
 * Deep Research tracking-pixel discovery: mapping + match/import logic.
 *
 * Bridger (Deep Research, in the Tombstone backend) detects pixels/tags on the
 * business website and reports them. This module is the app-side layer that
 * stores discoveries (discovery layer) and reconciles them against the
 * TrackingPixel configuration layer.
 *
 * IMPORTANT: We NEVER inject, modify, remove, or activate tracking scripts on
 * the website. Auto-created TrackingPixel records are draft / needs_verification
 * only — never auto-active. All operations are business-scoped.
 */

import { prisma } from '@/lib/db';
import { logPixelAudit } from '@/lib/tracking-pixels';

/** Maps a detected platform string (any casing/alias) to a canonical TrackingPixel platform. */
export function mapDetectedPlatform(raw: string): string {
  const v = (raw || '').toLowerCase().trim();
  if (/(^|[^a-z])ga4|measurement[_-]?id|g-[a-z0-9]+/.test(v) || v === 'ga4') return 'ga4';
  if (v.includes('tag manager') || v.includes('gtm') || /gtm-[a-z0-9]+/.test(v)) return 'google_tag_manager';
  if (v.includes('google ads') || /aw-[0-9]+/.test(v) || v.includes('adwords')) return 'google_ads';
  if (v === 'gtag' || v.includes('google tag') || v.includes('global site tag')) return 'google_tag';
  if (v.includes('facebook') || v.includes('meta') || /fbq|fbevents/.test(v)) return 'meta';
  if (v.includes('tiktok') || v.includes('ttq')) return 'tiktok';
  if (v.includes('linkedin') || v.includes('insight tag')) return 'linkedin';
  if (v.includes('bing') || v.includes('uet') || v.includes('microsoft')) return 'bing';
  if (v.includes('pinterest') || /pintrk/.test(v)) return 'pinterest';
  if (v.includes('twitter') || v === 'x' || /twq/.test(v)) return 'x';
  if (v.includes('choozle')) return 'choozle';
  return 'custom';
}

/** Which TrackingPixel id column a detected id belongs in for a given platform. */
export function idFieldForPlatform(platform: string): string {
  switch (platform) {
    case 'ga4':
      return 'ga4MeasurementId';
    case 'google_tag':
      return 'googleTagId';
    case 'google_tag_manager':
      return 'gtmContainerId';
    case 'google_ads':
      return 'googleAdsConversionId';
    case 'meta':
    case 'facebook':
      return 'metaPixelId';
    case 'tiktok':
      return 'tiktokPixelId';
    case 'linkedin':
      return 'linkedinPartnerId';
    case 'bing':
    case 'microsoft_ads':
      return 'bingUetTagId';
    case 'choozle':
      return 'choozlePixelId';
    default:
      return 'pixelId';
  }
}

const HIGH_CONFIDENCE = 0.8;

export interface DetectedPixelInput {
  platform: string; // raw or canonical
  detectedId?: string | null;
  pixelType?: string | null;
  detectedScriptUrl?: string | null;
  detectedEventNames?: string[] | null;
  placementDetected?: string | null;
  confidenceScore?: number | null;
  detectionMethod?: string | null;
  pageUrl?: string | null;
  sourceUrl?: string | null;
}

export interface ReconcileResult {
  discoveryId: string;
  status: string;
  matchedTrackingPixelId: string | null;
  createdPixel: boolean;
}

/**
 * Store a single detected pixel and reconcile it against existing TrackingPixel
 * records for the same business. Returns the resulting discovery status.
 */
export async function reconcileDiscovery(
  businessId: string,
  input: DetectedPixelInput,
  meta: { createdTaskId?: string | null; createdByAgent?: string | null; userId?: string | null } = {},
): Promise<ReconcileResult> {
  const platform = mapDetectedPlatform(input.platform);
  const detectedId = (input.detectedId || '').trim() || null;
  const confidence = input.confidenceScore ?? 0;
  const idField = idFieldForPlatform(platform);

  // Look for an existing config pixel for this business+platform with same id.
  let matchedPixel: { id: string } | null = null;
  if (detectedId) {
    matchedPixel = await prisma.trackingPixel.findFirst({
      where: {
        businessId,
        platform,
        OR: [{ pixelId: detectedId }, { [idField]: detectedId } as any],
      },
      select: { id: true },
    });
  }

  // Existing discovery for same business+platform+id (avoid dupes; update lastSeen).
  const existingDiscovery = detectedId
    ? await prisma.trackingPixelDiscovery.findFirst({
        where: { businessId, platform, detectedId },
        select: { id: true },
      })
    : null;

  let status: string;
  let matchedTrackingPixelId: string | null = matchedPixel?.id ?? null;
  let createdPixel = false;

  if (matchedPixel) {
    status = 'matched_existing_config';
    // Update verification signal on the matched pixel (found installed on site).
    await prisma.trackingPixel.update({
      where: { id: matchedPixel.id },
      data: { lastSeenAt: new Date(), installStatus: 'detected_on_site' } as any,
    });
  } else if (detectedId && confidence >= HIGH_CONFIDENCE) {
    // High-confidence, not in config — create a draft/needs_review pixel.
    // Guard against a possible-duplicate id within the same platform.
    const possibleDup = await prisma.trackingPixel.findFirst({
      where: { businessId, platform, status: { in: ['active', 'needs_verification', 'draft'] } },
      select: { id: true },
    });
    if (possibleDup && !detectedId) {
      status = 'duplicate_possible';
    } else {
      const created = await prisma.trackingPixel.create({
        data: {
          businessId,
          name: `${platform} (detected on site)`,
          platform,
          pixelType: input.pixelType || 'base_pixel',
          pixelId: detectedId,
          [idField]: detectedId,
          status: 'needs_verification',
          verificationStatus: 'pending',
          manualSetupRequired: false,
          installStatus: 'detected_on_site',
          installationTarget: 'unknown',
          setupStatus: 'needs_customer_action',
        } as any,
      });
      matchedTrackingPixelId = created.id;
      createdPixel = true;
      status = 'needs_review';
      await logPixelAudit({
        businessId,
        pixelId: created.id,
        action: 'created',
        details: { source: 'bridger_deep_research', detectedId, platform },
        userId: meta.userId ?? null,
      });
    }
  } else if (detectedId) {
    status = 'detected_unmatched';
  } else {
    status = 'needs_review';
  }

  let discoveryId: string;
  if (existingDiscovery) {
    const updated = await prisma.trackingPixelDiscovery.update({
      where: { id: existingDiscovery.id },
      data: {
        lastSeenAt: new Date(),
        status,
        matchedTrackingPixelId,
        confidenceScore: confidence,
        pageUrl: input.pageUrl ?? undefined,
        detectedScriptUrl: input.detectedScriptUrl ?? undefined,
        detectedEventNamesJson: input.detectedEventNames ?? undefined,
      } as any,
    });
    discoveryId = updated.id;
  } else {
    const created = await prisma.trackingPixelDiscovery.create({
      data: {
        businessId,
        sourceUrl: input.sourceUrl ?? null,
        pageUrl: input.pageUrl ?? null,
        platform,
        pixelType: input.pixelType || 'base_pixel',
        detectedId,
        detectedScriptUrl: input.detectedScriptUrl ?? null,
        detectedEventNamesJson: input.detectedEventNames ?? undefined,
        placementDetected: input.placementDetected ?? null,
        confidenceScore: confidence,
        detectionMethod: input.detectionMethod ?? null,
        status,
        matchedTrackingPixelId,
        createdTaskId: meta.createdTaskId ?? null,
        createdByAgent: meta.createdByAgent ?? 'jim_bridger',
      } as any,
    });
    discoveryId = created.id;
  }

  return { discoveryId, status, matchedTrackingPixelId, createdPixel };
}

/**
 * Flag configured ACTIVE pixels that were NOT found among the detected ids on
 * the scanned website (configured_but_not_found). Also creates discovery rows
 * for missing-from-config event gaps where relevant.
 */
export async function flagConfiguredButNotFound(
  businessId: string,
  detectedIds: string[],
): Promise<number> {
  const detected = new Set(detectedIds.map((d) => (d || '').trim()).filter(Boolean));
  const activePixels = await prisma.trackingPixel.findMany({
    where: { businessId, status: { in: ['active', 'needs_verification'] } },
    select: { id: true, platform: true, pixelId: true },
  });
  let flagged = 0;
  for (const p of activePixels) {
    if (p.pixelId && detected.has(p.pixelId)) continue;
    await prisma.trackingPixel.update({
      where: { id: p.id },
      data: { installStatus: 'configured_but_not_found', verificationStatus: 'unverified' } as any,
    });
    flagged++;
  }
  return flagged;
}

/**
 * Create tracking recommendations for missing landing-page / thank-you-page
 * conversion events surfaced during deep research.
 */
export async function createTrackingGapRecommendations(
  businessId: string,
  gaps: { missingThankYouEvent?: boolean; missingLandingEvent?: boolean },
  runId?: string | null,
): Promise<number> {
  let created = 0;
  if (gaps.missingThankYouEvent) {
    await prisma.searchIntelligenceRecommendation.create({
      data: {
        businessId,
        runId: runId ?? null,
        recommendationType: 'add_tracking',
        title: 'Add thank-you page conversion event',
        suggestedAction:
          'No thank_you_page_view / lead / generate_lead event was detected. Add a conversion event on thank-you pages.',
        priority: 'high',
        confidenceScore: 0.9,
      } as any,
    });
    created++;
  }
  if (gaps.missingLandingEvent) {
    await prisma.searchIntelligenceRecommendation.create({
      data: {
        businessId,
        runId: runId ?? null,
        recommendationType: 'add_tracking',
        title: 'Add landing page view event',
        suggestedAction: 'No landing_page_view event was detected. Add a landing_page_view event on landing pages.',
        priority: 'medium',
        confidenceScore: 0.85,
      } as any,
    });
    created++;
  }
  return created;
}
