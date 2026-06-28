/**
 * Service webpage + explainer video brief generation.
 *
 * Generates draft SEO service pages and short-form explainer video
 * briefs/scripts for confirmed BusinessServiceOffering rows using the LLM.
 *
 * Pages default to `draft` / `needs_review` (never auto-published).
 * Video briefs default to `script_ready`.
 */
import { prisma } from '@/lib/db';
import { offeringDisplayName } from '@/lib/industry-services';

const LLM_URL = 'https://apps.abacus.ai/v1/chat/completions';
const MODEL = 'claude-sonnet-4-6';

async function callLlmJson(systemPrompt: string, userPrompt: string, maxTokens = 2500): Promise<any | null> {
  const apiKey = process.env.ABACUSAI_API_KEY;
  if (!apiKey) throw new Error('LLM API not configured');

  const res = await fetch(LLM_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: maxTokens,
      temperature: 0.6,
      response_format: { type: 'json_object' },
    }),
  });
  if (!res.ok) {
    console.error('[service-content] LLM error:', await res.text());
    return null;
  }
  const data = await res.json();
  const content = data.choices?.[0]?.message?.content || '';
  try {
    return JSON.parse(content);
  } catch {
    // Try to extract a JSON object from the text
    const m = content.match(/\{[\s\S]*\}/);
    if (m) {
      try { return JSON.parse(m[0]); } catch { return null; }
    }
    return null;
  }
}

async function loadOfferingContext(offeringId: string) {
  const offering = await prisma.businessServiceOffering.findUnique({
    where: { id: offeringId },
    include: { industryService: true, industry: true, business: true },
  });
  if (!offering) return null;

  const business = offering.business;
  // Confirmed sibling services for internal links / related services
  const siblings = await prisma.businessServiceOffering.findMany({
    where: { businessId: offering.businessId, status: 'confirmed', id: { not: offeringId } },
    include: { industryService: true },
    take: 12,
  });
  const relatedNames = siblings.map((s) => offeringDisplayName(s)).filter(Boolean);

  // Confirmed locations for local relevance
  const locations = await prisma.businessLocation.findMany({
    where: { businessId: offering.businessId, isConfirmed: true },
    select: { city: true, state: true, locationName: true, pageSlug: true },
  });

  return { offering, business, relatedNames, siblings, locations };
}

export interface ServicePageContent {
  serviceName: string;
  slug: string;
  pageUrl: string;
  pageTitle: string;
  metaDescription: string;
  h1: string;
  intro: string;
  fullExplanation: string;
  symptomsProblems: string[];
  whyItMatters: string;
  processSteps: { title: string; description: string }[];
  faqs: { question: string; answer: string }[];
  relatedServices: { name: string; url: string }[];
  internalLinks: { label: string; url: string }[];
  trustProof: string;
  callToAction: string;
  serviceAreaRelevance: string;
  schemaType: string;
  schemaJsonLd: string;
  generatedAt: string;
}

export async function generateServicePage(offeringId: string): Promise<ServicePageContent | null> {
  const ctx = await loadOfferingContext(offeringId);
  if (!ctx) return null;
  const { offering, business, relatedNames, siblings, locations } = ctx;
  const tmpl = offering.industryService;
  const serviceName = offeringDisplayName(offering);
  const businessName = business.businessName || 'the business';

  const primaryCity = locations.find((l) => l.city)?.city || business.businessCity || business.primaryMarketCity || '';
  const primaryState = locations.find((l) => l.state)?.state || business.businessState || business.primaryMarketState || '';
  const isMultiLocation = locations.length > 1;

  const pageUrl = isMultiLocation && locations[0]?.pageSlug
    ? `/locations/${locations[0].pageSlug}/services/${offering.slug}`
    : `/services/${offering.slug}`;

  const systemPrompt = `You are an expert local-SEO copywriter creating a service page for a local business. Write trustworthy, specific, conversion-focused copy. Avoid unverifiable superlatives and compliance-risky guarantees. Output ONLY valid JSON matching the requested schema. Do not invent licenses, certifications, awards, or specific statistics.`;

  const userPrompt = `Create a service webpage for this service.

Business: ${businessName}
Website: ${business.websiteUrl || ''}
Service: ${serviceName}
Industry: ${offering.industry?.name || tmpl?.industryId || ''}
Service area / location: ${[primaryCity, primaryState].filter(Boolean).join(', ') || 'local service area'}
Short description: ${offering.overrideShortDescription || tmpl?.shortDescription || ''}
Customer problem: ${tmpl?.customerProblem || ''}
Existing confirmed services (for related links): ${relatedNames.join(', ') || 'none'}
Recommended page title: ${tmpl?.recommendedPageTitle || ''}
Recommended meta description: ${tmpl?.recommendedMetaDescription || ''}
Recommended H1: ${tmpl?.recommendedH1 || ''}
Schema type: ${tmpl?.recommendedSchemaType || 'Service'}

Return JSON with EXACTLY these keys:
{
  "pageTitle": string (<= 60 chars, include service + city if known),
  "metaDescription": string (<= 160 chars),
  "h1": string,
  "intro": string (2-3 sentences),
  "fullExplanation": string (2-4 paragraphs explaining the service),
  "symptomsProblems": string[] (4-7 signs/problems that lead a customer to need this),
  "whyItMatters": string (1-2 paragraphs),
  "processSteps": [{ "title": string, "description": string }] (3-5 steps of what to expect),
  "faqs": [{ "question": string, "answer": string }] (4-6 FAQs),
  "relatedServices": [{ "name": string }] (2-4 names chosen from existing confirmed services),
  "trustProof": string (1 paragraph; generic trust language only, no fabricated specifics),
  "callToAction": string (1-2 sentences),
  "serviceAreaRelevance": string (1 paragraph referencing the local area if known)
}`;

  const result = await callLlmJson(systemPrompt, userPrompt);
  if (!result) return null;

  // Build related service internal links from sibling slugs
  const slugByName = new Map(siblings.map((s) => [offeringDisplayName(s).toLowerCase(), s.slug]));
  const relatedServices = (Array.isArray(result.relatedServices) ? result.relatedServices : [])
    .map((r: any) => {
      const nm = typeof r === 'string' ? r : r?.name;
      if (!nm) return null;
      const sl = slugByName.get(String(nm).toLowerCase());
      return { name: nm, url: sl ? `/services/${sl}` : `/services/${slugify(nm)}` };
    })
    .filter(Boolean);

  const internalLinks: { label: string; url: string }[] = [
    { label: 'All Services', url: '/services' },
    ...relatedServices.map((r: any) => ({ label: r.name, url: r.url })),
    ...locations.filter((l) => l.pageSlug).map((l) => ({
      label: `${serviceName} in ${l.city || l.locationName || 'our area'}`,
      url: `/locations/${l.pageSlug}/services/${offering.slug}`,
    })),
  ];

  const schemaType = tmpl?.recommendedSchemaType || 'Service';
  const schemaJsonLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': schemaType,
    name: serviceName,
    provider: { '@type': 'LocalBusiness', name: businessName, url: business.websiteUrl || undefined },
    areaServed: [primaryCity, primaryState].filter(Boolean).join(', ') || undefined,
    description: result.metaDescription || offering.overrideShortDescription || tmpl?.shortDescription || '',
  });

  const page: ServicePageContent = {
    serviceName,
    slug: offering.slug,
    pageUrl,
    pageTitle: result.pageTitle || `${serviceName} | ${businessName}`,
    metaDescription: result.metaDescription || '',
    h1: result.h1 || serviceName,
    intro: result.intro || '',
    fullExplanation: result.fullExplanation || '',
    symptomsProblems: Array.isArray(result.symptomsProblems) ? result.symptomsProblems : [],
    whyItMatters: result.whyItMatters || '',
    processSteps: Array.isArray(result.processSteps) ? result.processSteps : [],
    faqs: Array.isArray(result.faqs) ? result.faqs : [],
    relatedServices: relatedServices as any,
    internalLinks,
    trustProof: result.trustProof || '',
    callToAction: result.callToAction || '',
    serviceAreaRelevance: result.serviceAreaRelevance || '',
    schemaType,
    schemaJsonLd,
    generatedAt: new Date().toISOString(),
  };

  await prisma.businessServiceOffering.update({
    where: { id: offeringId },
    data: { generatedPageJson: page as any, pageStatus: 'needs_review' },
  });

  return page;
}

export interface VideoBriefContent {
  serviceName: string;
  title: string;
  durationSeconds: number;
  orientation: string;
  script: string;
  scenes: { sceneNumber: number; visual: string; voiceover?: string }[];
  bRollSuggestions: string[];
  callToAction: string;
  complianceNotes: string[];
  generatedAt: string;
}

export async function generateExplainerVideoBrief(offeringId: string): Promise<VideoBriefContent | null> {
  const ctx = await loadOfferingContext(offeringId);
  if (!ctx) return null;
  const { offering, business } = ctx;
  const tmpl = offering.industryService;
  const serviceName = offeringDisplayName(offering);
  const businessName = business.businessName || 'the business';

  const systemPrompt = `You are a short-form video scriptwriter for local businesses. Write a punchy 30-60 second vertical explainer. Be concrete and helpful, avoid compliance-risky guarantees or medical/legal claims. Output ONLY valid JSON.`;

  const userPrompt = `Create a short explainer video brief for this service.

Business: ${businessName}
Service: ${serviceName}
Industry: ${offering.industry?.name || ''}
Short description: ${offering.overrideShortDescription || tmpl?.shortDescription || ''}
Customer problem: ${tmpl?.customerProblem || ''}
Template title (optional): ${tmpl?.explainerVideoTitle || ''}
Template brief (optional): ${tmpl?.explainerVideoBrief || ''}

Return JSON with EXACTLY these keys:
{
  "title": string (attention-grabbing, customer-centric),
  "script": string (30-60 seconds of spoken narration),
  "scenes": [{ "sceneNumber": number, "visual": string, "voiceover": string }] (4-6 scenes),
  "bRollSuggestions": string[] (4-6 b-roll / asset ideas),
  "callToAction": string,
  "complianceNotes": string[] (any claims that need verification or disclaimers; empty array if none)
}`;

  const result = await callLlmJson(systemPrompt, userPrompt, 1800);
  if (!result) return null;

  const brief: VideoBriefContent = {
    serviceName,
    title: result.title || tmpl?.explainerVideoTitle || `${serviceName} Explainer`,
    durationSeconds: 45,
    orientation: 'vertical 1080x1920',
    script: result.script || '',
    scenes: Array.isArray(result.scenes) ? result.scenes : [],
    bRollSuggestions: Array.isArray(result.bRollSuggestions) ? result.bRollSuggestions : [],
    callToAction: result.callToAction || '',
    complianceNotes: Array.isArray(result.complianceNotes) ? result.complianceNotes : [],
    generatedAt: new Date().toISOString(),
  };

  await prisma.businessServiceOffering.update({
    where: { id: offeringId },
    data: { videoBriefJson: brief as any, videoStatus: 'script_ready' },
  });

  return brief;
}

function slugify(s: string): string {
  return (s || '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'service';
}
