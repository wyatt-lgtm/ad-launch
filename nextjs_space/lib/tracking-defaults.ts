/**
 * Default templates for tracking events, audiences and page routes.
 * These are offered as one-click "Add default" templates in the UI and are
 * always business-scoped when persisted.
 */

export interface EventTemplate {
  key: string;
  label: string;
  eventName: string;
  platformEventName: string;
  eventType: string;
  triggerType: string;
  pageScope: string;
  consentCategory: string;
  requiresConsent: boolean;
}

export const EVENT_TEMPLATES: EventTemplate[] = [
  { key: 'landing_page_visit', label: 'Landing Page Visit', eventName: 'landing_page_view', platformEventName: 'LandingPageView', eventType: 'page_view', triggerType: 'page_load', pageScope: 'landing_pages', consentCategory: 'analytics', requiresConsent: false },
  { key: 'thank_you_page_visit', label: 'Thank You Page Visit', eventName: 'thank_you_page_view', platformEventName: 'thank_you_page_view', eventType: 'conversion', triggerType: 'thank_you_page_load', pageScope: 'thank_you_pages', consentCategory: 'conversion_tracking', requiresConsent: false },
  { key: 'lead', label: 'Lead', eventName: 'lead', platformEventName: 'Lead', eventType: 'lead', triggerType: 'thank_you_page_load', pageScope: 'thank_you_pages', consentCategory: 'conversion_tracking', requiresConsent: false },
  { key: 'form_submit', label: 'Form Submit', eventName: 'form_submit', platformEventName: 'SubmitForm', eventType: 'form', triggerType: 'form_submit', pageScope: 'all_pages', consentCategory: 'conversion_tracking', requiresConsent: false },
  { key: 'phone_click', label: 'Phone Click', eventName: 'phone_click', platformEventName: 'Contact', eventType: 'phone', triggerType: 'phone_link_click', pageScope: 'all_pages', consentCategory: 'analytics', requiresConsent: false },
  { key: 'quote_request', label: 'Quote Request', eventName: 'quote_request', platformEventName: 'Lead', eventType: 'lead', triggerType: 'form_submit', pageScope: 'all_pages', consentCategory: 'conversion_tracking', requiresConsent: false },
  { key: 'appointment_click', label: 'Appointment Click', eventName: 'appointment_click', platformEventName: 'Schedule', eventType: 'click', triggerType: 'button_click', pageScope: 'all_pages', consentCategory: 'conversion_tracking', requiresConsent: false },
];

export interface AudienceTemplate {
  key: string;
  label: string;
  audienceName: string;
  audienceType: string;
  sourceEvent: string;
  includeRules: any;
  excludeRules: any;
  retentionDays: number;
  funnelStage: string;
}

export const AUDIENCE_TEMPLATES: AudienceTemplate[] = [
  { key: 'all_website_visitors', label: 'All Website Visitors', audienceName: 'All Website Visitors', audienceType: 'website_visitors', sourceEvent: 'page_view', includeRules: { events: ['page_view'] }, excludeRules: null, retentionDays: 30, funnelStage: 'top_of_funnel' },
  { key: 'landing_page_visitors', label: 'Landing Page Visitors', audienceName: 'Landing Page Visitors', audienceType: 'landing_page_visitors', sourceEvent: 'landing_page_view', includeRules: { events: ['landing_page_view'] }, excludeRules: null, retentionDays: 30, funnelStage: 'top_of_funnel' },
  { key: 'landing_no_conversion', label: 'Landing Page Visitors - No Conversion', audienceName: 'Landing Page Visitors - No Conversion', audienceType: 'non_converting_visitors', sourceEvent: 'landing_page_view', includeRules: { events: ['landing_page_view'] }, excludeRules: { events: ['thank_you_page_view', 'lead'] }, retentionDays: 30, funnelStage: 'mid_funnel' },
  { key: 'thank_you_visitors', label: 'Thank You Page Visitors', audienceName: 'Thank You Page Visitors', audienceType: 'thank_you_page_visitors', sourceEvent: 'thank_you_page_view', includeRules: { events: ['thank_you_page_view', 'lead'] }, excludeRules: null, retentionDays: 30, funnelStage: 'bottom_funnel' },
  { key: 'converted_leads', label: 'Converted Leads', audienceName: 'Converted Leads', audienceType: 'converted_leads', sourceEvent: 'lead', includeRules: { events: ['lead', 'thank_you_page_view'] }, excludeRules: null, retentionDays: 30, funnelStage: 'converted' },
  { key: 'bottom_funnel_retargeting', label: 'Bottom-Funnel Retargeting', audienceName: 'Bottom-Funnel Retargeting', audienceType: 'bottom_funnel', sourceEvent: 'thank_you_page_view', includeRules: { events: ['thank_you_page_view', 'form_submit', 'generate_lead'] }, excludeRules: null, retentionDays: 30, funnelStage: 'bottom_funnel' },
  { key: 'converted_lead_exclusion', label: 'Converted Lead Exclusion Audience', audienceName: 'Converted Lead Exclusion Audience', audienceType: 'exclusion', sourceEvent: 'lead', includeRules: { events: ['lead'] }, excludeRules: null, retentionDays: 30, funnelStage: 'converted' },
  { key: 'high_value_converted', label: 'High-Value Converted Leads', audienceName: 'High-Value Converted Leads', audienceType: 'lookalike_seed', sourceEvent: 'lead', includeRules: { events: ['lead'], minValue: true }, excludeRules: null, retentionDays: 180, funnelStage: 'customer' },
];

export interface RouteTemplate {
  key: string;
  label: string;
  pageType: string;
  eventName: string;
  firesOn: string;
  platforms: string[];
}

export const ROUTE_TEMPLATES: RouteTemplate[] = [
  { key: 'landing_page_view', label: 'Landing Page → page_view', pageType: 'landing_page', eventName: 'page_view', firesOn: 'page_load', platforms: ['ga4', 'meta'] },
  { key: 'landing_landing_view', label: 'Landing Page → landing_page_view', pageType: 'landing_page', eventName: 'landing_page_view', firesOn: 'page_load', platforms: ['ga4', 'meta', 'google_ads'] },
  { key: 'social_landing_page_view', label: 'Social Landing → page_view', pageType: 'social_landing_page', eventName: 'page_view', firesOn: 'page_load', platforms: ['ga4'] },
  { key: 'social_landing_visit', label: 'Social Landing → social_landing_page_visit', pageType: 'social_landing_page', eventName: 'social_landing_page_visit', firesOn: 'page_load', platforms: ['ga4', 'meta'] },
  { key: 'thank_you_view', label: 'Thank You → thank_you_page_view', pageType: 'thank_you_page', eventName: 'thank_you_page_view', firesOn: 'page_load', platforms: ['ga4', 'meta', 'google_ads', 'choozle'] },
  { key: 'thank_you_lead', label: 'Thank You → generate_lead', pageType: 'thank_you_page', eventName: 'generate_lead', firesOn: 'page_load', platforms: ['ga4', 'meta', 'google_ads'] },
];

/**
 * Build a starter snippet preview for guided platform setups. These are
 * reference snippets shown to the user — they are NEVER executed in the UI.
 */
export function buildGuidedSnippet(platform: string, ids: Record<string, string | undefined>): string {
  switch (platform) {
    case 'ga4': {
      const id = ids.ga4MeasurementId || 'G-XXXXXXXXXX';
      return `<!-- Google tag (gtag.js) -->\n<script async src="https://www.googletagmanager.com/gtag/js?id=${id}"></script>\n<script>\n  window.dataLayer = window.dataLayer || [];\n  function gtag(){dataLayer.push(arguments);}\n  gtag('js', new Date());\n  gtag('config', '${id}');\n</script>`;
    }
    case 'google_tag_manager': {
      const id = ids.gtmContainerId || 'GTM-XXXXXXX';
      return `<!-- Google Tag Manager -->\n<script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','${id}');</script>`;
    }
    case 'meta':
    case 'facebook': {
      const id = ids.metaPixelId || 'XXXXXXXXXXXXXXX';
      return `<!-- Meta Pixel Code -->\n<script>\n  !function(f,b,e,v,n,t,s){...}(window, document,'script','https://connect.facebook.net/en_US/fbevents.js');\n  fbq('init', '${id}');\n  fbq('track', 'PageView');\n</script>`;
    }
    case 'choozle': {
      const id = ids.choozlePixelId || ids.choozleAdvertiserId || 'XXXXXX';
      return `<!-- Choozle Universal Pixel -->\n<script src="https://pixel.choozle.com/universal/${id}.js" async></script>`;
    }
    default:
      return '';
  }
}
