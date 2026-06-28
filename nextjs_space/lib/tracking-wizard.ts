/**
 * Guided "Help Me Create a Pixel" wizard configuration.
 *
 * This module is pure data + pure helpers. It powers the multi-step wizard that
 * walks a customer through creating the correct tracking setup on platforms that
 * Tombstone cannot auto-create (e.g. Meta via Launch CRM / GHL).
 *
 * CRITICAL design principle:
 *   ONE base pixel/tag per business + site + platform.
 *   We do NOT create a separate pixel per page or per funnel stage.
 *   Funnel stages are represented as EVENTS, PAGE ROUTES and AUDIENCES that all
 *   reference the same base pixel.
 *
 * Nothing in here executes any script. Snippets are reference-only.
 */

// ── Setup + install status vocabularies ────────────────────────────
export const SETUP_STATUSES = [
  'needs_setup',
  'needs_customer_action',
  'waiting_for_pixel_id',
  'waiting_for_script',
  'ready_to_install',
  'installed',
  'verified',
  'failed_verification',
  'inactive',
] as const;
export type SetupStatus = (typeof SETUP_STATUSES)[number];

export const INSTALLATION_TARGETS = [
  'tombstone_generated_site',
  'ghl_funnel',
  'ghl_website',
  'wordpress',
  'gtm',
  'manual',
  'unknown',
] as const;
export type InstallationTarget = (typeof INSTALLATION_TARGETS)[number];

export const INSTALL_TARGET_LABELS: Record<string, string> = {
  tombstone_generated_site: 'Tombstone-generated pages (automatic)',
  ghl_funnel: 'Launch CRM funnel',
  ghl_website: 'Launch CRM website',
  wordpress: 'WordPress site',
  gtm: 'Google Tag Manager',
  manual: 'Manual / other',
  unknown: 'Not decided yet',
};

// ── Platform capability matrix (Step 1) ────────────────────────────
export interface PlatformCapability {
  key: string;
  label: string;
  /** Can Tombstone create + configure the pixel automatically through an API. */
  canAutoCreate: boolean;
  /** Can Tombstone detect an already-installed pixel (future capability). */
  canDetectExisting: boolean;
  /** Tombstone provides a guided manual creation flow. */
  guidesManualCreation: boolean;
  /** Customer must log in / grant access on the platform themselves. */
  requiresCustomerLogin: boolean;
  /** Customer must copy an id or script back into Tombstone. */
  requiresManualPaste: boolean;
  /** Where the customer creates the pixel. */
  setupUrl: string;
  /** Human label for the id we ask for. */
  idLabel: string;
  /** Field on TrackingPixel that stores the platform id. */
  idField: string;
}

export const PLATFORM_CAPABILITIES: PlatformCapability[] = [
  { key: 'meta', label: 'Meta / Facebook', canAutoCreate: false, canDetectExisting: false, guidesManualCreation: true, requiresCustomerLogin: true, requiresManualPaste: true, setupUrl: 'https://business.facebook.com/events_manager2', idLabel: 'Meta Pixel ID', idField: 'metaPixelId' },
  { key: 'ga4', label: 'Google Analytics 4', canAutoCreate: false, canDetectExisting: false, guidesManualCreation: true, requiresCustomerLogin: true, requiresManualPaste: true, setupUrl: 'https://analytics.google.com/', idLabel: 'GA4 Measurement ID (G-XXXXXXX)', idField: 'ga4MeasurementId' },
  { key: 'google_tag_manager', label: 'Google Tag Manager', canAutoCreate: false, canDetectExisting: false, guidesManualCreation: true, requiresCustomerLogin: true, requiresManualPaste: true, setupUrl: 'https://tagmanager.google.com/', idLabel: 'GTM Container ID (GTM-XXXXXXX)', idField: 'gtmContainerId' },
  { key: 'google_ads', label: 'Google Ads', canAutoCreate: false, canDetectExisting: false, guidesManualCreation: true, requiresCustomerLogin: true, requiresManualPaste: true, setupUrl: 'https://ads.google.com/', idLabel: 'Conversion ID (AW-XXXXXXX)', idField: 'googleAdsConversionId' },
  { key: 'tiktok', label: 'TikTok', canAutoCreate: false, canDetectExisting: false, guidesManualCreation: true, requiresCustomerLogin: true, requiresManualPaste: true, setupUrl: 'https://ads.tiktok.com/i18n/events_manager', idLabel: 'TikTok Pixel ID', idField: 'tiktokPixelId' },
  { key: 'linkedin', label: 'LinkedIn', canAutoCreate: false, canDetectExisting: false, guidesManualCreation: true, requiresCustomerLogin: true, requiresManualPaste: true, setupUrl: 'https://www.linkedin.com/campaignmanager/', idLabel: 'LinkedIn Partner ID', idField: 'linkedinPartnerId' },
  { key: 'bing', label: 'Bing / Microsoft Ads', canAutoCreate: false, canDetectExisting: false, guidesManualCreation: true, requiresCustomerLogin: true, requiresManualPaste: true, setupUrl: 'https://ads.microsoft.com/', idLabel: 'UET Tag ID', idField: 'bingUetTagId' },
  { key: 'choozle', label: 'Choozle', canAutoCreate: false, canDetectExisting: false, guidesManualCreation: true, requiresCustomerLogin: true, requiresManualPaste: true, setupUrl: 'https://app.choozle.com/', idLabel: 'Choozle Pixel / Advertiser ID', idField: 'choozlePixelId' },
  { key: 'pinterest', label: 'Pinterest', canAutoCreate: false, canDetectExisting: false, guidesManualCreation: true, requiresCustomerLogin: true, requiresManualPaste: true, setupUrl: 'https://ads.pinterest.com/', idLabel: 'Pinterest Tag ID', idField: 'pixelId' },
  { key: 'x', label: 'X / Twitter', canAutoCreate: false, canDetectExisting: false, guidesManualCreation: true, requiresCustomerLogin: true, requiresManualPaste: true, setupUrl: 'https://ads.x.com/', idLabel: 'X Pixel ID', idField: 'pixelId' },
  { key: 'custom', label: 'Custom Script', canAutoCreate: false, canDetectExisting: false, guidesManualCreation: true, requiresCustomerLogin: false, requiresManualPaste: true, setupUrl: '', idLabel: 'Pixel / Tag ID (optional)', idField: 'pixelId' },
];

export function getPlatformCapability(platform: string): PlatformCapability | undefined {
  return PLATFORM_CAPABILITIES.find((p) => p.key === platform);
}

// ── Tracking goals (Step 2) ────────────────────────────────────────
export interface TrackingGoal {
  key: string;
  label: string;
  description: string;
}

export const TRACKING_GOALS: TrackingGoal[] = [
  { key: 'website_retargeting', label: 'Website visitor retargeting', description: 'Build an audience of everyone who visits the website so you can run retargeting ads to them later.' },
  { key: 'landing_page_tracking', label: 'Landing page visit tracking', description: 'Track visits to specific landing pages so you can measure campaign traffic and retarget people who landed but did not convert.' },
  { key: 'service_page_tracking', label: 'Service page high-intent tracking', description: 'Track visits to high-intent service pages (people researching a specific service) and build a warm, high-intent audience.' },
  { key: 'thank_you_conversion', label: 'Thank-you page / lead conversion tracking', description: 'Fire a conversion when someone reaches a thank-you page or becomes a lead, and build a converted-leads audience for exclusion and lookalikes.' },
  { key: 'phone_click_tracking', label: 'Phone click tracking', description: 'Track clicks on phone-number links as a conversion signal.' },
  { key: 'form_submit_tracking', label: 'Form submit tracking', description: 'Track form submissions as lead conversions across the site.' },
  { key: 'custom_event', label: 'Custom event', description: 'Track a custom event you define (button click, scheduling click, quote request, etc.).' },
];

export function getTrackingGoal(key: string): TrackingGoal | undefined {
  return TRACKING_GOALS.find((g) => g.key === key);
}

// ── Canonical funnel building blocks ───────────────────────────────
interface CanonicalEvent {
  eventName: string;
  eventType: string;
  triggerType: string;
  pageScope: string;
  consentCategory: string;
}

const CANONICAL_EVENTS: Record<string, CanonicalEvent> = {
  page_view: { eventName: 'page_view', eventType: 'page_view', triggerType: 'page_load', pageScope: 'all_pages', consentCategory: 'analytics' },
  landing_page_view: { eventName: 'landing_page_view', eventType: 'page_view', triggerType: 'page_load', pageScope: 'landing_pages', consentCategory: 'analytics' },
  service_page_view: { eventName: 'service_page_view', eventType: 'page_view', triggerType: 'page_load', pageScope: 'service_pages', consentCategory: 'analytics' },
  thank_you_page_view: { eventName: 'thank_you_page_view', eventType: 'conversion', triggerType: 'thank_you_page_load', pageScope: 'thank_you_pages', consentCategory: 'conversion_tracking' },
  lead: { eventName: 'lead', eventType: 'lead', triggerType: 'thank_you_page_load', pageScope: 'thank_you_pages', consentCategory: 'conversion_tracking' },
  phone_click: { eventName: 'phone_click', eventType: 'phone', triggerType: 'phone_link_click', pageScope: 'all_pages', consentCategory: 'analytics' },
  form_submit: { eventName: 'form_submit', eventType: 'form', triggerType: 'form_submit', pageScope: 'all_pages', consentCategory: 'conversion_tracking' },
};

/** Platform-specific event name mapping. Falls back to the canonical name. */
const PLATFORM_EVENT_NAMES: Record<string, Record<string, string>> = {
  meta: { page_view: 'PageView', landing_page_view: 'ViewContent', service_page_view: 'ViewContent', thank_you_page_view: 'Lead', lead: 'Lead', phone_click: 'Contact', form_submit: 'Lead' },
  ga4: { page_view: 'page_view', landing_page_view: 'page_view', service_page_view: 'page_view', thank_you_page_view: 'conversion', lead: 'generate_lead', phone_click: 'phone_call_click', form_submit: 'generate_lead' },
  google_ads: { page_view: 'page_view', landing_page_view: 'page_view', service_page_view: 'page_view', thank_you_page_view: 'conversion', lead: 'conversion', phone_click: 'conversion', form_submit: 'conversion' },
  google_tag_manager: { page_view: 'page_view', landing_page_view: 'landing_page_view', service_page_view: 'service_page_view', thank_you_page_view: 'thank_you_page_view', lead: 'generate_lead', phone_click: 'phone_click', form_submit: 'form_submit' },
  tiktok: { page_view: 'ViewContent', landing_page_view: 'ViewContent', service_page_view: 'ViewContent', thank_you_page_view: 'CompleteRegistration', lead: 'SubmitForm', phone_click: 'Contact', form_submit: 'SubmitForm' },
  linkedin: { page_view: 'PageView', landing_page_view: 'PageView', service_page_view: 'PageView', thank_you_page_view: 'Conversion', lead: 'Conversion', phone_click: 'Conversion', form_submit: 'Conversion' },
  bing: { page_view: 'page_view', landing_page_view: 'page_view', service_page_view: 'page_view', thank_you_page_view: 'conversion', lead: 'conversion', phone_click: 'conversion', form_submit: 'conversion' },
  choozle: { page_view: 'page_view', landing_page_view: 'page_view', service_page_view: 'page_view', thank_you_page_view: 'conversion', lead: 'conversion', phone_click: 'conversion', form_submit: 'conversion' },
  pinterest: { page_view: 'pagevisit', landing_page_view: 'pagevisit', service_page_view: 'pagevisit', thank_you_page_view: 'lead', lead: 'lead', phone_click: 'custom', form_submit: 'lead' },
  x: { page_view: 'PageView', landing_page_view: 'PageView', service_page_view: 'PageView', thank_you_page_view: 'Conversion', lead: 'Conversion', phone_click: 'Conversion', form_submit: 'Conversion' },
  custom: {},
};

function platformEventName(platform: string, canonical: string): string {
  return PLATFORM_EVENT_NAMES[platform]?.[canonical] || canonical;
}

// ── Recommended plan (Step 3) ──────────────────────────────────────
export interface RecommendedPlan {
  /** Plain-language summary shown at the top of Step 3. */
  summary: string;
  /** How many base pixels/tags to create (almost always one). */
  pixelCount: number;
  /** What the single base pixel is for. */
  pixelPurpose: string;
  /** Canonical event keys recommended for this platform. */
  eventKeys: string[];
  /** Audience keys recommended for this platform. */
  audienceKeys: string[];
  /** Extra notes / clarifications for the platform. */
  notes: string[];
}

const ALL_EVENT_KEYS = ['page_view', 'landing_page_view', 'service_page_view', 'thank_you_page_view', 'lead', 'phone_click', 'form_submit'];
const ALL_AUDIENCE_KEYS = ['all_website_visitors', 'landing_no_conversion', 'service_page_visitors', 'thank_you_visitors', 'converted_leads', 'converted_lead_exclusion'];

export const RECOMMENDED_PLANS: Record<string, RecommendedPlan> = {
  meta: {
    summary: 'Create ONE Meta Pixel for the whole business. You do NOT need a separate pixel per page or funnel stage. Instead, the single pixel fires different events on different pages, and you build audiences from those events.',
    pixelCount: 1,
    pixelPurpose: 'One base Meta Pixel installed site-wide. Service-page and thank-you-page "pixels" are the SAME pixel firing on those pages with an audience rule — not new pixels.',
    eventKeys: ALL_EVENT_KEYS,
    audienceKeys: ALL_AUDIENCE_KEYS,
    notes: [
      'One Meta Pixel = one base code installed on every page.',
      'PageView fires on all pages; ViewContent fires on landing/service pages; Lead fires on thank-you pages.',
      'Audiences (website visitors, landing visitors, service visitors, converted leads, exclusion) are all built from this one pixel — no extra pixels needed.',
    ],
  },
  ga4: {
    summary: 'Create ONE GA4 property + web data stream for the business. A single Measurement ID powers all page and conversion tracking.',
    pixelCount: 1,
    pixelPurpose: 'One GA4 Measurement ID (G-XXXXXXX) installed site-wide. Conversions are marked as key events in GA4.',
    eventKeys: ['page_view', 'landing_page_view', 'service_page_view', 'thank_you_page_view', 'lead', 'form_submit'],
    audienceKeys: ['all_website_visitors', 'landing_no_conversion', 'service_page_visitors', 'thank_you_visitors', 'converted_leads', 'converted_lead_exclusion'],
    notes: [
      'GA4 uses one Measurement ID for the whole site.',
      'Mark generate_lead / thank_you_page_view as key events (conversions) inside GA4.',
      'Audiences are defined inside GA4 from these events for Google Ads remarketing.',
    ],
  },
  google_ads: {
    summary: 'Create ONE Google Ads conversion setup. Add conversion actions for leads and thank-you pages; remarketing tag covers retargeting.',
    pixelCount: 1,
    pixelPurpose: 'One Google Ads tag (AW-XXXXXXX) with conversion actions for lead + thank-you-page conversions.',
    eventKeys: ['page_view', 'thank_you_page_view', 'lead', 'phone_click', 'form_submit'],
    audienceKeys: ['all_website_visitors', 'service_page_visitors', 'thank_you_visitors', 'converted_leads', 'converted_lead_exclusion'],
    notes: [
      'One Google Ads remarketing tag site-wide; each conversion action shares it.',
      'Best practice: import GA4 conversions into Google Ads instead of duplicating tags.',
    ],
  },
  google_tag_manager: {
    summary: 'Create ONE GTM container for the business. GTM then manages all other tags (GA4, Meta, Ads) from one place.',
    pixelCount: 1,
    pixelPurpose: 'One GTM container (GTM-XXXXXXX) installed site-wide that orchestrates every other tag and the dataLayer events below.',
    eventKeys: ALL_EVENT_KEYS,
    audienceKeys: ['all_website_visitors', 'landing_no_conversion', 'service_page_visitors', 'thank_you_visitors', 'converted_leads', 'converted_lead_exclusion'],
    notes: [
      'One container per site. Add GA4 / Meta / Ads tags inside GTM rather than hard-coding each.',
      'Tombstone pushes the dataLayer events listed below so your GTM triggers can fire on them.',
    ],
  },
  tiktok: {
    summary: 'Create ONE TikTok Pixel for the business. A single pixel covers page views and conversions.',
    pixelCount: 1,
    pixelPurpose: 'One TikTok Pixel installed site-wide firing ViewContent / SubmitForm / CompleteRegistration.',
    eventKeys: ['page_view', 'landing_page_view', 'service_page_view', 'thank_you_page_view', 'lead', 'form_submit'],
    audienceKeys: ['all_website_visitors', 'landing_no_conversion', 'service_page_visitors', 'thank_you_visitors', 'converted_lead_exclusion'],
    notes: ['One TikTok Pixel site-wide; events differentiate the funnel stages.'],
  },
  linkedin: {
    summary: 'Create ONE LinkedIn Insight Tag for the business plus conversion rules.',
    pixelCount: 1,
    pixelPurpose: 'One LinkedIn Insight Tag (Partner ID) installed site-wide; conversions defined in Campaign Manager.',
    eventKeys: ['page_view', 'landing_page_view', 'thank_you_page_view', 'lead', 'form_submit'],
    audienceKeys: ['all_website_visitors', 'landing_no_conversion', 'thank_you_visitors', 'converted_lead_exclusion'],
    notes: ['One Insight Tag site-wide; matched audiences and conversions are built in Campaign Manager.'],
  },
  bing: {
    summary: 'Create ONE Microsoft UET tag for the business.',
    pixelCount: 1,
    pixelPurpose: 'One UET tag installed site-wide; conversion goals defined in Microsoft Ads.',
    eventKeys: ['page_view', 'landing_page_view', 'thank_you_page_view', 'lead', 'form_submit'],
    audienceKeys: ['all_website_visitors', 'landing_no_conversion', 'thank_you_visitors', 'converted_lead_exclusion'],
    notes: ['One UET tag site-wide; remarketing lists and goals are built in Microsoft Ads.'],
  },
  choozle: {
    summary: 'Create ONE Choozle universal pixel for the business, then add conversion pixels for key actions.',
    pixelCount: 1,
    pixelPurpose: 'One Choozle universal pixel installed site-wide; conversion pixels fire on thank-you / lead actions.',
    eventKeys: ['page_view', 'landing_page_view', 'service_page_view', 'thank_you_page_view', 'lead'],
    audienceKeys: ['all_website_visitors', 'landing_no_conversion', 'service_page_visitors', 'thank_you_visitors', 'converted_lead_exclusion'],
    notes: [
      'Choozle uses one universal/base pixel site-wide; conversion pixels are events on top of it.',
      'Provide the Choozle advertiser/pixel ID supplied by your Choozle account or rep.',
    ],
  },
  pinterest: {
    summary: 'Create ONE Pinterest tag for the business.',
    pixelCount: 1,
    pixelPurpose: 'One Pinterest tag installed site-wide; pagevisit + lead events.',
    eventKeys: ['page_view', 'landing_page_view', 'thank_you_page_view', 'lead'],
    audienceKeys: ['all_website_visitors', 'landing_no_conversion', 'thank_you_visitors'],
    notes: ['One Pinterest tag site-wide; conversions tracked via the lead event.'],
  },
  x: {
    summary: 'Create ONE X (Twitter) pixel for the business.',
    pixelCount: 1,
    pixelPurpose: 'One X pixel installed site-wide; PageView + Conversion events.',
    eventKeys: ['page_view', 'landing_page_view', 'thank_you_page_view', 'lead'],
    audienceKeys: ['all_website_visitors', 'landing_no_conversion', 'thank_you_visitors'],
    notes: ['One X pixel site-wide; conversions tracked via the conversion event.'],
  },
  custom: {
    summary: 'Add ONE custom base script for the business and define the events you need.',
    pixelCount: 1,
    pixelPurpose: 'One custom base script installed site-wide. Tombstone stores it for reference and never executes it in the admin UI.',
    eventKeys: ['page_view', 'landing_page_view', 'thank_you_page_view', 'lead', 'form_submit'],
    audienceKeys: ['all_website_visitors', 'thank_you_visitors'],
    notes: ['Paste the base script you were given. Tombstone stores it and installs it on generated pages; it is never run inside this admin UI.'],
  },
};

export function getRecommendedPlan(platform: string): RecommendedPlan {
  return RECOMMENDED_PLANS[platform] || RECOMMENDED_PLANS.custom;
}

// ── Audience definitions ───────────────────────────────────────────
interface AudienceDef {
  audienceName: string;
  audienceType: string;
  sourceEvent: string;
  includeRules: any;
  excludeRules: any;
  funnelStage: string;
}

const AUDIENCE_DEFS: Record<string, AudienceDef> = {
  all_website_visitors: { audienceName: 'All Website Visitors', audienceType: 'website_visitors', sourceEvent: 'page_view', includeRules: { events: ['page_view'] }, excludeRules: null, funnelStage: 'top_of_funnel' },
  landing_no_conversion: { audienceName: 'Landing Page Visitors - No Conversion', audienceType: 'non_converting_visitors', sourceEvent: 'landing_page_view', includeRules: { events: ['landing_page_view'] }, excludeRules: { events: ['thank_you_page_view', 'lead'] }, funnelStage: 'mid_funnel' },
  service_page_visitors: { audienceName: 'Service Page Visitors', audienceType: 'high_intent_visitors', sourceEvent: 'service_page_view', includeRules: { events: ['service_page_view'] }, excludeRules: { events: ['lead'] }, funnelStage: 'mid_funnel' },
  thank_you_visitors: { audienceName: 'Thank You Page Visitors', audienceType: 'thank_you_page_visitors', sourceEvent: 'thank_you_page_view', includeRules: { events: ['thank_you_page_view', 'lead'] }, excludeRules: null, funnelStage: 'bottom_funnel' },
  converted_leads: { audienceName: 'Converted Leads', audienceType: 'converted_leads', sourceEvent: 'lead', includeRules: { events: ['lead', 'thank_you_page_view'] }, excludeRules: null, funnelStage: 'converted' },
  converted_lead_exclusion: { audienceName: 'Converted Lead Exclusion Audience', audienceType: 'exclusion', sourceEvent: 'lead', includeRules: { events: ['lead'] }, excludeRules: null, funnelStage: 'converted' },
};

// ── Page route definitions ─────────────────────────────────────────
interface RouteDef {
  pageType: string;
  eventName: string;
  firesOn: string;
}

const ROUTE_DEFS: Record<string, RouteDef[]> = {
  page_view: [{ pageType: 'website_page', eventName: 'page_view', firesOn: 'page_load' }],
  landing_page_view: [{ pageType: 'landing_page', eventName: 'landing_page_view', firesOn: 'page_load' }],
  service_page_view: [{ pageType: 'service_page', eventName: 'service_page_view', firesOn: 'page_load' }],
  thank_you_page_view: [{ pageType: 'thank_you_page', eventName: 'thank_you_page_view', firesOn: 'page_load' }],
  lead: [{ pageType: 'thank_you_page', eventName: 'lead', firesOn: 'page_load' }],
  phone_click: [{ pageType: 'website_page', eventName: 'phone_click', firesOn: 'phone_link_click' }],
  form_submit: [{ pageType: 'website_page', eventName: 'form_submit', firesOn: 'form_submit' }],
};

// ── Manual setup instructions (Step 4) ─────────────────────────────
export interface ManualInstructions {
  /** Ordered step-by-step instructions to create the pixel on the platform. */
  steps: string[];
  /** Optional Launch CRM / GHL placement guide. */
  ghlPlacementGuide?: string[];
  /** What we ask the customer to bring back. */
  askFor: string[];
}

const META_STEPS = [
  'Open Meta Business Manager at business.facebook.com.',
  'Go to Events Manager.',
  'Click Connect Data Sources.',
  'Choose Web as the data source.',
  'Select Meta Pixel and click Connect.',
  'Name the pixel "[Business Name] Website Pixel".',
  'Enter your website URL.',
  'Click Create / Continue.',
  'Copy the Pixel ID (a long number).',
  'Optionally copy the base pixel code (the full <script> snippet).',
  'Return to Tombstone.',
  'Paste the Pixel ID (and base code, if you have it) into the field below.',
  'Tombstone maps that one pixel to all your page rules, events and audiences automatically.',
];

const GHL_PLACEMENT_GUIDE = [
  'Open Launch CRM.',
  'Go to Sites.',
  'Open the funnel or website you want to track.',
  'Open Settings for that funnel / website.',
  'Find the Head Tracking Code (or Custom Code / Header) field.',
  'Paste the base pixel code into the Head Tracking Code field so it loads on every page.',
  'For thank-you / lead conversions: add the conversion event on the thank-you page step, or fire it from a workflow / Conversions API.',
  'Save and publish the funnel / website.',
];

function genericSteps(cap: PlatformCapability): string[] {
  return [
    `Log in to ${cap.label} at ${cap.setupUrl || 'the platform dashboard'}.`,
    `Create a new pixel / tag for this business and name it "[Business Name] Website ${cap.label}".`,
    'Enter your website URL if prompted.',
    `Copy the ${cap.idLabel}.`,
    'Optionally copy the base install snippet.',
    'Return to Tombstone and paste the id (and snippet, if you have it) below.',
    'Tombstone maps that one pixel to all your page rules, events and audiences automatically.',
  ];
}

export function getManualInstructions(platform: string): ManualInstructions {
  const cap = getPlatformCapability(platform);
  if (platform === 'meta') {
    return { steps: META_STEPS, ghlPlacementGuide: GHL_PLACEMENT_GUIDE, askFor: ['Meta Pixel ID', 'Base pixel code (optional)', 'Website URL', 'Install method'] };
  }
  if (!cap) {
    return { steps: [], ghlPlacementGuide: GHL_PLACEMENT_GUIDE, askFor: ['Pixel / Tag ID'] };
  }
  return {
    steps: genericSteps(cap),
    ghlPlacementGuide: GHL_PLACEMENT_GUIDE,
    askFor: [cap.idLabel, 'Base install snippet (optional)', 'Website URL', 'Install method'],
  };
}

// ── Display copy (used across steps) ───────────────────────────────
export const DISPLAY_COPY: Record<string, string> = {
  one_pixel_rule: 'One base pixel per business per platform. Funnel stages are events and audiences on that single pixel — not separate pixels.',
  meta: 'For Meta, create ONE Meta Pixel for the business. The same pixel fires PageView on every page, ViewContent on landing and service pages, and Lead on thank-you pages. Your "service page pixel" is simply this pixel firing on service pages with an audience rule — it is not a second pixel.',
  website_retargeting: 'We will build an audience of everyone who visits the website so you can retarget them with ads. This uses the base pixel\'s PageView event — no extra pixel required.',
  service_page_tracking: 'We will track visits to your high-intent service pages and build a Service Page Visitors audience. This is the same base pixel firing on service pages — not a new pixel.',
  thank_you_conversion: 'We will fire a Lead conversion on your thank-you pages and build Converted Leads + a Converted Lead Exclusion audience so you stop paying to retarget people who already converted.',
  choozle: 'For Choozle, create ONE universal pixel for the business. Conversion pixels for thank-you / lead actions are events layered on that single universal pixel — not separate base pixels. Enter the Choozle advertiser/pixel ID from your Choozle account.',
};

// ── Plan builder ───────────────────────────────────────────────────
export interface WizardPlanEvent {
  eventName: string;
  platformEventName: string;
  eventType: string;
  triggerType: string;
  pageScope: string;
  consentCategory: string;
  requiresConsent: boolean;
}
export interface WizardPlanAudience {
  audienceName: string;
  platform: string;
  audienceType: string;
  sourceEvent: string;
  includeRulesJson: any;
  excludeRulesJson: any;
  funnelStage: string;
}
export interface WizardPlanRoute {
  pageType: string;
  eventName: string;
  firesOn: string;
  platformsJson: string[];
}
export interface WizardPlan {
  pixel: Record<string, any>;
  events: WizardPlanEvent[];
  audiences: WizardPlanAudience[];
  routes: WizardPlanRoute[];
  setupInstructionsJson: any;
}

/**
 * Build the full set of records the wizard will create for a platform + goal.
 * Always one base pixel + the recommended events/audiences/routes.
 */
export function buildWizardPlan(
  platform: string,
  goal: string,
  businessName: string,
): WizardPlan {
  const cap = getPlatformCapability(platform);
  const plan = getRecommendedPlan(platform);
  const name = `${(businessName || 'Your Business').trim()} Website ${cap?.label || 'Pixel'}`;

  // Ensure the goal's primary event is always included.
  const goalEventKey: Record<string, string> = {
    website_retargeting: 'page_view',
    landing_page_tracking: 'landing_page_view',
    service_page_tracking: 'service_page_view',
    thank_you_conversion: 'thank_you_page_view',
    phone_click_tracking: 'phone_click',
    form_submit_tracking: 'form_submit',
    custom_event: 'page_view',
  };
  const eventKeys = Array.from(new Set([...(plan.eventKeys || []), goalEventKey[goal]].filter(Boolean))) as string[];

  const events: WizardPlanEvent[] = eventKeys
    .map((k) => CANONICAL_EVENTS[k])
    .filter(Boolean)
    .map((ce) => ({
      eventName: ce.eventName,
      platformEventName: platformEventName(platform, ce.eventName),
      eventType: ce.eventType,
      triggerType: ce.triggerType,
      pageScope: ce.pageScope,
      consentCategory: ce.consentCategory,
      requiresConsent: false,
    }));

  const audiences: WizardPlanAudience[] = (plan.audienceKeys || [])
    .map((k) => AUDIENCE_DEFS[k])
    .filter(Boolean)
    .map((ad) => ({
      audienceName: ad.audienceName,
      platform,
      audienceType: ad.audienceType,
      sourceEvent: ad.sourceEvent,
      includeRulesJson: ad.includeRules,
      excludeRulesJson: ad.excludeRules,
      funnelStage: ad.funnelStage,
    }));

  const routes: WizardPlanRoute[] = [];
  for (const k of eventKeys) {
    for (const rd of ROUTE_DEFS[k] || []) {
      routes.push({ pageType: rd.pageType, eventName: rd.eventName, firesOn: rd.firesOn, platformsJson: [platform] });
    }
  }

  const instructions = getManualInstructions(platform);
  const setupInstructionsJson = {
    platform,
    goal,
    summary: plan.summary,
    pixelPurpose: plan.pixelPurpose,
    notes: plan.notes,
    steps: instructions.steps,
    ghlPlacementGuide: instructions.ghlPlacementGuide,
    askFor: instructions.askFor,
  };

  const pixel: Record<string, any> = {
    name,
    platform,
    pixelType: 'base_pixel',
    scope: 'all_pages',
    placement: 'head',
    manualSetupRequired: true,
    platformSetupUrl: cap?.setupUrl || null,
    setupInstructionsJson,
  };

  return { pixel, events, audiences, routes, setupInstructionsJson };
}

/** Lightweight metadata payload for the wizard UI. */
export function getWizardMetadata() {
  return {
    platforms: PLATFORM_CAPABILITIES,
    goals: TRACKING_GOALS,
    plans: RECOMMENDED_PLANS,
    installTargets: INSTALLATION_TARGETS,
    installTargetLabels: INSTALL_TARGET_LABELS,
    setupStatuses: SETUP_STATUSES,
    displayCopy: DISPLAY_COPY,
  };
}
