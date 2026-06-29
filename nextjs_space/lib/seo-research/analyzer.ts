/**
 * SEO Research — competitor page analyzer.
 *
 * Takes a fetched provider top-URL page and extracts STRUCTURE and INTENT
 * only (headings, topics covered, FAQs/questions answered, schema types, CTAs,
 * trust + local signals, media/video usage, conversion elements, content gaps).
 *
 * COMPLIANCE: we never copy competitor wording for reuse. We capture what a
 * page covers and how it is organized so our own original content can be at
 * least as complete — differentiation, not duplication.
 */
import { callLlmJson } from './llm';
import type { FetchedPage } from './page-fetcher';
import { classifyResultInput, normalizeResultType, type ClassifiedInput } from './classification';

export interface CompetitorPageExtraction {
  pageTitle: string | null;
  metaDescription: string | null;
  h1: string | null;
  headings: string[];
  topics: string[];
  faqs: string[];
  schemaTypes: string[];
  ctaSummary: string | null;
  trustElements: string[];
  localTerms: string[];
  mediaElements: string[];
  videoElements: string[];
  contentGaps: string[];
  conversionElements: string[];
  analysisSummary: string | null;
  extractedQuestions: string[];
}

const SYSTEM_PROMPT = `You are an SEO content STRUCTURE analyst for a local-services marketing platform.
You are given the readable text of ONE web page that ranked for a target query.
Your job is to describe HOW the page is structured and WHAT topics/intents it covers — NOT to copy its wording.
Never reproduce sentences for reuse. Extract structure and intent only.
Return STRICT JSON with these keys:
{
  "page_title": string|null,
  "meta_description": string|null,
  "h1": string|null,
  "headings": string[],            // section headings / outline
  "topics": string[],              // distinct topics/subjects covered
  "faqs": string[],                // questions the page answers (as questions)
  "schema_types": string[],        // likely schema.org types (LocalBusiness, FAQPage, Service, Review, VideoObject...)
  "cta_summary": string|null,      // what the page asks visitors to do
  "trust_elements": string[],      // reviews, certifications, guarantees, awards, years in business
  "local_terms": string[],         // cities/neighborhoods/regional phrasing used
  "media_elements": string[],      // photos, galleries, before/after, diagrams
  "video_elements": string[],      // embedded/linked videos and what they show
  "conversion_elements": string[], // forms, phone CTAs, quote tools, chat, booking
  "content_gaps": string[],        // intents a thorough page SHOULD cover that this one misses
  "extracted_questions": string[], // customer questions implied or asked (for question mining)
  "analysis_summary": string       // 2-3 sentence neutral summary of the page's structure & intent
}`;

function asStringArray(v: any): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => (typeof x === 'string' ? x : x == null ? '' : String(x))).map((s) => s.trim()).filter(Boolean).slice(0, 40);
}

/**
 * Run LLM structural extraction on a fetched page. Returns null if the page
 * had no usable content or the LLM is unavailable.
 */
export async function analyzeFetchedPage(
  page: FetchedPage,
  context: { targetKeyword?: string | null; targetLocation?: string | null; serviceLine?: string | null },
): Promise<CompetitorPageExtraction | null> {
  if (!page.ok || !page.readableText || page.readableText.length < 120) return null;

  const userPrompt = [
    `TARGET QUERY: ${context.targetKeyword || '(unknown)'}`,
    context.targetLocation ? `TARGET LOCATION: ${context.targetLocation}` : '',
    context.serviceLine ? `SERVICE LINE: ${context.serviceLine}` : '',
    `PAGE URL: ${page.finalUrl}`,
    `PAGE TITLE: ${page.title || '(none)'}`,
    '',
    'PAGE READABLE TEXT (truncated):',
    page.readableText,
  ]
    .filter(Boolean)
    .join('\n');

  const raw = await callLlmJson(SYSTEM_PROMPT, userPrompt, 3000);
  if (!raw) return null;

  return {
    pageTitle: raw.page_title ?? page.title ?? null,
    metaDescription: raw.meta_description ?? null,
    h1: raw.h1 ?? null,
    headings: asStringArray(raw.headings),
    topics: asStringArray(raw.topics),
    faqs: asStringArray(raw.faqs),
    schemaTypes: asStringArray(raw.schema_types),
    ctaSummary: raw.cta_summary ?? null,
    trustElements: asStringArray(raw.trust_elements),
    localTerms: asStringArray(raw.local_terms),
    mediaElements: asStringArray(raw.media_elements),
    videoElements: asStringArray(raw.video_elements),
    contentGaps: asStringArray(raw.content_gaps),
    conversionElements: asStringArray(raw.conversion_elements),
    analysisSummary: raw.analysis_summary ?? null,
    extractedQuestions: asStringArray(raw.extracted_questions),
  };
}

/** Re-export classification helpers commonly used alongside analysis. */
export function classifyForAnalysis(resultType: string | null | undefined, url?: string | null): {
  classifiedInput: ClassifiedInput;
  resultType: string;
} {
  return {
    classifiedInput: classifyResultInput(resultType, url),
    resultType: normalizeResultType(resultType, url),
  };
}
