/**
 * Social Landing Page Utilities
 * 
 * UTM tracking, duplicate link detection, and CTA appending for social posts.
 */

export interface LandingPageConfig {
  url: string;
  ctaText: string;
  enabled: boolean;
}

export interface UtmParams {
  platform: string;
  campaign?: string;
  contentId?: string;
}

/**
 * Append UTM parameters to a URL without breaking existing query strings.
 */
export function appendUtmParams(baseUrl: string, utm: UtmParams): string {
  try {
    const url = new URL(baseUrl);
    url.searchParams.set('utm_source', utm.platform);
    url.searchParams.set('utm_medium', 'organic_social');
    if (utm.campaign) {
      url.searchParams.set('utm_campaign', utm.campaign);
    }
    if (utm.contentId) {
      url.searchParams.set('utm_content', utm.contentId);
    }
    return url.toString();
  } catch {
    // Fallback: simple string concatenation
    const sep = baseUrl.includes('?') ? '&' : '?';
    const params = [
      `utm_source=${encodeURIComponent(utm.platform)}`,
      'utm_medium=organic_social',
      utm.campaign ? `utm_campaign=${encodeURIComponent(utm.campaign)}` : '',
      utm.contentId ? `utm_content=${encodeURIComponent(utm.contentId)}` : '',
    ].filter(Boolean).join('&');
    return `${baseUrl}${sep}${params}`;
  }
}

/**
 * Check whether the landing page URL (or its base domain) is already present
 * in the post body to avoid duplication.
 */
export function isUrlAlreadyInBody(body: string, landingUrl: string): boolean {
  if (!body || !landingUrl) return false;
  const lower = body.toLowerCase();
  // Check exact URL
  if (lower.includes(landingUrl.toLowerCase())) return true;
  // Check URL without protocol
  try {
    const parsed = new URL(landingUrl);
    const noProto = parsed.host + parsed.pathname + parsed.search;
    if (lower.includes(noProto.toLowerCase())) return true;
  } catch {}
  return false;
}

/**
 * Build the CTA + landing page block to append to a post caption.
 * Returns empty string if the URL is already present or config is disabled.
 */
export function buildLandingPageBlock(
  caption: string,
  config: LandingPageConfig,
  utm?: UtmParams
): string {
  if (!config.enabled || !config.url) return '';
  if (isUrlAlreadyInBody(caption, config.url)) return '';

  const finalUrl = utm ? appendUtmParams(config.url, utm) : config.url;
  const ctaLine = config.ctaText || 'Learn more here:';

  return `\n\n${ctaLine}\n${finalUrl}`;
}
