/**
 * Business Profile: saved analysis reuse for social post workflows.
 *
 * Saves Jim Bridger's recon output to the Business record so future
 * social-post workflows can skip full website re-scraping.
 *
 * Searchable log prefixes:
 *   SOCIAL_BUSINESS_CONTEXT_LOADED
 *   SOCIAL_BUSINESS_CONTEXT_MISSING_ANALYSIS
 *   SOCIAL_BUSINESS_CONTEXT_REFRESH_STARTED
 *   SOCIAL_BUSINESS_CONTEXT_REUSED
 */

import { prisma } from '@/lib/db';

export interface SavedBusinessProfile {
  businessName: string;
  websiteUrl: string;
  services?: string;
  brandVoice?: string;
  brandColors?: Record<string, string>;
  targetCustomers?: string;
  location?: string;
  approvedClaims?: string[];
  restrictedClaims?: string[];
  ctaRules?: string;
  analysisSummary?: string;
  rawRecon?: Record<string, any>;
  savedAt: string;
}

const STALE_DAYS = 30;

/**
 * Save Jim Bridger's recon output as the business's saved analysis.
 * Called after a workflow completes successfully.
 */
export async function saveBusinessProfile(
  businessId: string,
  recon: Record<string, any>,
): Promise<void> {
  try {
    const profile: SavedBusinessProfile = {
      businessName: recon.business_name || recon.businessName || '',
      websiteUrl: recon.website_url || recon.websiteUrl || recon.target_url || '',
      services: recon.services_offered || recon.services || recon.products_services || '',
      brandVoice: recon.brand_voice || recon.brand_personality || recon.tone || '',
      brandColors: recon.brand_colors || recon.color_palette || {},
      targetCustomers: recon.target_audience || recon.target_customers || recon.ideal_customer || '',
      location: recon.location || recon.service_area || recon.address || '',
      approvedClaims: recon.approved_claims || [],
      restrictedClaims: recon.restricted_claims || [],
      ctaRules: recon.cta_rules || recon.default_cta || '',
      analysisSummary: recon.summary || recon.business_summary || recon.overview || '',
      rawRecon: recon,
      savedAt: new Date().toISOString(),
    };

    await prisma.business.update({
      where: { id: businessId },
      data: {
        savedAnalysis: profile as any,
        analysisRefreshedAt: new Date(),
      },
    });

    console.log(
      `SOCIAL_BUSINESS_CONTEXT_LOADED business_id=${businessId} ` +
      `has_saved_analysis=true analysis_age_days=0`,
    );
  } catch (err: any) {
    console.error(`[business-profile] Failed to save profile for ${businessId}: ${err.message}`);
  }
}

/**
 * Load saved business profile for injection into Tombstone commands.
 * Returns null if no profile exists or it's too stale.
 */
export async function loadBusinessProfile(
  businessId: string,
): Promise<{ profile: SavedBusinessProfile; ageDays: number } | null> {
  try {
    const biz = await prisma.business.findUnique({
      where: { id: businessId },
      select: {
        savedAnalysis: true,
        analysisRefreshedAt: true,
        businessName: true,
        websiteUrl: true,
      },
    });

    if (!biz || !biz.savedAnalysis) {
      console.log(
        `SOCIAL_BUSINESS_CONTEXT_MISSING_ANALYSIS business_id=${businessId} ` +
        `has_saved_analysis=false`,
      );
      return null;
    }

    const profile = biz.savedAnalysis as unknown as SavedBusinessProfile;
    const ageDays = biz.analysisRefreshedAt
      ? Math.floor((Date.now() - biz.analysisRefreshedAt.getTime()) / (1000 * 60 * 60 * 24))
      : 999;

    console.log(
      `SOCIAL_BUSINESS_CONTEXT_REUSED business_id=${businessId} ` +
      `has_saved_analysis=true analysis_age_days=${ageDays}`,
    );

    return { profile, ageDays };
  } catch (err: any) {
    console.error(`[business-profile] Failed to load profile for ${businessId}: ${err.message}`);
    return null;
  }
}

/**
 * Check if saved analysis is stale (older than STALE_DAYS).
 */
export function isStale(ageDays: number): boolean {
  return ageDays > STALE_DAYS;
}

/**
 * Format the saved business profile as a text block for Tombstone command injection.
 * Jim Bridger detects this block and skips full website scraping.
 */
export function formatProfileForCommand(profile: SavedBusinessProfile): string {
  const lines: string[] = [
    '--- SAVED BUSINESS PROFILE ---',
    `Business Name: ${profile.businessName}`,
    `Website URL: ${profile.websiteUrl}`,
  ];

  if (profile.services) lines.push(`Services/Products: ${profile.services}`);
  if (profile.brandVoice) lines.push(`Brand Voice: ${profile.brandVoice}`);
  if (profile.targetCustomers) lines.push(`Target Customers: ${profile.targetCustomers}`);
  if (profile.location) lines.push(`Location: ${profile.location}`);
  if (profile.ctaRules) lines.push(`CTA Rules: ${profile.ctaRules}`);
  if (profile.analysisSummary) {
    lines.push(`Business Summary: ${profile.analysisSummary.slice(0, 1000)}`);
  }
  if (profile.approvedClaims && profile.approvedClaims.length > 0) {
    lines.push(`Approved Claims: ${profile.approvedClaims.join('; ')}`);
  }
  if (profile.restrictedClaims && profile.restrictedClaims.length > 0) {
    lines.push(`Restricted Claims: ${profile.restrictedClaims.join('; ')}`);
  }
  if (profile.brandColors && Object.keys(profile.brandColors).length > 0) {
    const colorStr = Object.entries(profile.brandColors)
      .map(([k, v]) => `${k}: ${v}`)
      .join(', ');
    lines.push(`Brand Colors: ${colorStr}`);
  }

  lines.push('--- END SAVED BUSINESS PROFILE ---');
  return lines.join('\n');
}
