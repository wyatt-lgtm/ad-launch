/**
 * Tracking Pixels & Funnel Event Tracking — shared constants, validation,
 * sanitization, defaults/templates and config retrieval helpers.
 *
 * Business-scoped tracking config for websites, landing pages, thank-you
 * pages, ads, social and retargeting pixels. Postgres only. Custom scripts
 * are STORED, never executed in the admin UI.
 */
import { prisma } from '@/lib/db';

// ── Allowed enum-like values ──────────────────────────────────────────
export const PLATFORMS = [
  'meta', 'facebook', 'google_ads', 'ga4', 'google_tag', 'google_tag_manager',
  'tiktok', 'linkedin', 'bing', 'microsoft_ads', 'pinterest', 'x', 'twitter',
  'choozle', 'custom',
] as const;

export const PIXEL_TYPES = [
  'base_pixel', 'remarketing_pixel', 'conversion_pixel', 'analytics_tag',
  'tag_manager', 'custom_script', 'custom_html', 'event_snippet',
] as const;

export const TRACKING_METHODS = ['browser', 'server', 'hybrid'] as const;

export const PLACEMENTS = ['head', 'body_start', 'body_end', 'event_only'] as const;

export const SCOPES = [
  'all_pages', 'selected_pages', 'landing_pages', 'social_landing_pages',
  'blog_pages', 'service_pages', 'thank_you_pages',
  'checkout_or_conversion_pages', 'custom_rules',
] as const;

export const PIXEL_STATUSES = [
  'active', 'inactive', 'draft', 'error', 'needs_verification', 'archived',
] as const;

export const CONSENT_CATEGORIES = [
  'essential', 'analytics', 'advertising', 'remarketing', 'conversion_tracking',
] as const;

export const EVENT_TYPES = [
  'page_view', 'lead', 'conversion', 'click', 'form', 'phone', 'email',
  'purchase', 'custom',
] as const;

export const TRIGGER_TYPES = [
  'page_load', 'url_match', 'form_submit', 'button_click', 'phone_link_click',
  'email_link_click', 'thank_you_page_load', 'custom_js', 'server_event',
  'webhook_event',
] as const;

export const DEFAULT_EVENT_NAMES = [
  'page_view', 'landing_page_view', 'thank_you_page_view', 'form_submit',
  'generate_lead', 'lead', 'phone_click', 'email_click', 'outbound_click',
  'appointment_click', 'quote_request', 'social_landing_page_visit',
  'generated_website_page_view', 'website_cta_click', 'purchase',
  'subscription_started', 'subscription_renewed',
] as const;

export const AUDIENCE_TYPES = [
  'website_visitors', 'landing_page_visitors', 'thank_you_page_visitors',
  'converted_leads', 'non_converting_visitors', 'high_intent_visitors',
  'bottom_funnel', 'exclusion', 'lookalike_seed', 'custom',
] as const;

export const FUNNEL_STAGES = [
  'top_of_funnel', 'mid_funnel', 'bottom_funnel', 'converted', 'customer',
  'reactivation',
] as const;

export const PAGE_TYPES = [
  'website_page', 'landing_page', 'social_landing_page', 'thank_you_page',
  'service_page', 'blog_page', 'city_page', 'county_page', 'checkout_page',
  'custom',
] as const;

export const AUDIT_ACTIONS = [
  'created', 'updated', 'disabled', 'enabled', 'archived', 'verified',
  'failed_verification', 'injected_on_page', 'event_fired', 'test_event_sent',
  'error_detected',
] as const;

export const VERIFICATION_STATUSES = ['unverified', 'pending', 'verified', 'failed'] as const;

// ── Validation helpers ────────────────────────────────────────────────
export function isOneOf(value: any, list: readonly string[]): boolean {
  return typeof value === 'string' && list.includes(value);
}

export function validatePixelInput(body: any): { valid: boolean; error?: string } {
  if (!body || typeof body !== 'object') return { valid: false, error: 'Invalid body' };
  if (!body.name || typeof body.name !== 'string' || !body.name.trim()) {
    return { valid: false, error: 'Pixel name is required' };
  }
  if (!isOneOf(body.platform, PLATFORMS)) return { valid: false, error: 'Invalid platform' };
  if (body.pixelType != null && !isOneOf(body.pixelType, PIXEL_TYPES)) return { valid: false, error: 'Invalid pixel type' };
  if (body.trackingMethod != null && !isOneOf(body.trackingMethod, TRACKING_METHODS)) return { valid: false, error: 'Invalid tracking method' };
  if (body.placement != null && !isOneOf(body.placement, PLACEMENTS)) return { valid: false, error: 'Invalid placement' };
  if (body.scope != null && !isOneOf(body.scope, SCOPES)) return { valid: false, error: 'Invalid scope' };
  if (body.status != null && !isOneOf(body.status, PIXEL_STATUSES)) return { valid: false, error: 'Invalid status' };
  if (body.consentCategory != null && !isOneOf(body.consentCategory, CONSENT_CATEGORIES)) return { valid: false, error: 'Invalid consent category' };
  return { valid: true };
}

export function validateEventInput(body: any): { valid: boolean; error?: string } {
  if (!body || typeof body !== 'object') return { valid: false, error: 'Invalid body' };
  if (!body.eventName || typeof body.eventName !== 'string' || !body.eventName.trim()) {
    return { valid: false, error: 'Event name is required' };
  }
  if (body.eventType != null && !isOneOf(body.eventType, EVENT_TYPES)) return { valid: false, error: 'Invalid event type' };
  if (body.triggerType != null && !isOneOf(body.triggerType, TRIGGER_TYPES)) return { valid: false, error: 'Invalid trigger type' };
  if (body.consentCategory != null && !isOneOf(body.consentCategory, CONSENT_CATEGORIES)) return { valid: false, error: 'Invalid consent category' };
  return { valid: true };
}

export function validateAudienceInput(body: any): { valid: boolean; error?: string } {
  if (!body || typeof body !== 'object') return { valid: false, error: 'Invalid body' };
  if (!body.audienceName || typeof body.audienceName !== 'string' || !body.audienceName.trim()) {
    return { valid: false, error: 'Audience name is required' };
  }
  if (body.audienceType != null && !isOneOf(body.audienceType, AUDIENCE_TYPES)) return { valid: false, error: 'Invalid audience type' };
  if (body.funnelStage != null && body.funnelStage !== '' && !isOneOf(body.funnelStage, FUNNEL_STAGES)) return { valid: false, error: 'Invalid funnel stage' };
  return { valid: true };
}

/**
 * Sanitize a stored custom snippet for SAFE display in the admin UI.
 * Custom scripts are stored verbatim in the DB, but must NEVER execute in
 * the admin UI. This escapes HTML so the snippet renders as inert text.
 */
export function sanitizeSnippetForDisplay(snippet: string | null | undefined): string {
  if (!snippet) return '';
  return String(snippet)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Append a tracking pixel audit event. Best-effort; never throws.
 */
export async function logPixelAudit(opts: {
  businessId: string;
  pixelId?: string | null;
  eventId?: string | null;
  action: string;
  details?: any;
  userId?: string | null;
}): Promise<void> {
  try {
    await prisma.trackingPixelAuditEvent.create({
      data: {
        businessId: opts.businessId,
        pixelId: opts.pixelId ?? null,
        eventId: opts.eventId ?? null,
        action: opts.action,
        detailsJson: opts.details ?? undefined,
        createdByUserId: opts.userId ?? null,
      },
    });
  } catch (err) {
    console.warn('[tracking-pixels] failed to write audit event', err);
  }
}

// ── Page-type → scope matching ────────────────────────────────────────
const PAGE_TYPE_TO_SCOPES: Record<string, string[]> = {
  website_page: ['all_pages', 'selected_pages'],
  landing_page: ['all_pages', 'landing_pages'],
  social_landing_page: ['all_pages', 'social_landing_pages'],
  thank_you_page: ['all_pages', 'thank_you_pages', 'checkout_or_conversion_pages'],
  service_page: ['all_pages', 'service_pages'],
  blog_page: ['all_pages', 'blog_pages'],
  city_page: ['all_pages', 'service_pages'],
  county_page: ['all_pages', 'service_pages'],
  checkout_page: ['all_pages', 'checkout_or_conversion_pages'],
  custom: ['all_pages', 'custom_rules', 'selected_pages'],
};

function urlMatchesPattern(pattern: string | null | undefined, path: string | null | undefined): boolean {
  if (!pattern) return true; // no pattern → applies to all paths of that page type
  if (!path) return false;
  try {
    // Support simple glob with * as wildcard
    const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
    return new RegExp(`^${escaped}$`).test(path) || path.includes(pattern.replace(/\*/g, ''));
  } catch {
    return path.includes(pattern);
  }
}

/**
 * Retrieve active tracking config for a generated/edited page.
 * Returns ONLY active configs for the given business that match the page
 * type, URL/path rules, and scope. Never returns another business's data.
 */
export async function getTrackingConfigForPage(
  businessId: string,
  pageContext: { pageType: string; path?: string | null }
): Promise<{
  businessId: string;
  pageType: string;
  path: string | null;
  pixels: any[];
  events: any[];
  routes: any[];
}> {
  const pageType = pageContext.pageType || 'website_page';
  const path = pageContext.path ?? null;
  const matchingScopes = PAGE_TYPE_TO_SCOPES[pageType] || ['all_pages'];

  const [allPixels, allEvents, allRoutes] = await Promise.all([
    prisma.trackingPixel.findMany({
      where: { businessId, status: 'active' },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.trackingEvent.findMany({
      where: { businessId, status: 'active' },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.trackingEventRoute.findMany({
      where: { businessId, status: 'active', pageType },
      orderBy: { createdAt: 'asc' },
    }),
  ]);

  // Filter pixels by scope match
  const pixels = allPixels.filter((p) => matchingScopes.includes(p.scope) || p.scope === 'all_pages');

  // Filter events by page scope match
  const events = allEvents.filter(
    (e) => e.pageScope === 'all_pages' || matchingScopes.includes(e.pageScope)
  );

  // Filter routes by URL pattern
  const routes = allRoutes.filter((r) => urlMatchesPattern(r.pageUrlPattern, path));

  return { businessId, pageType, path, pixels, events, routes };
}
