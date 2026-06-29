/**
 * SEO Research — meta-analysis aggregation.
 *
 * Aggregates many per-competitor page extractions into common patterns and
 * question/intent buckets, then (optionally) asks the LLM for a recommended
 * angle + sections/FAQs/schema/CTAs/video topics. The aggregation step itself
 * is a PURE function so it can be unit tested without a DB or network.
 */
import { callLlmJson } from './llm';
import {
  classifyQuestionTopic,
  recommendedContentUseForTopic,
  topicFunnelStage,
  type ClassifiedInput,
  type TopicType,
} from './classification';
import type { CompetitorPageExtraction } from './analyzer';

export interface AnalyzedCompetitor extends CompetitorPageExtraction {
  url: string;
  domain: string | null;
  resultType: string;
  classifiedInput: ClassifiedInput;
}

export interface ExtractedQuestionAgg {
  questionText: string;
  topicType: TopicType;
  frequencyCount: number;
  sourceUrls: string[];
  sourceResultTypes: string[];
  funnelStage: string;
  recommendedContentUse: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
}

export interface AggregatedPatterns {
  commonHeadings: Array<{ value: string; count: number }>;
  commonTopics: Array<{ value: string; count: number }>;
  commonFaqs: Array<{ value: string; count: number }>;
  commonSchema: Array<{ value: string; count: number }>;
  commonCtas: string[];
  trustElements: Array<{ value: string; count: number }>;
  localTerms: Array<{ value: string; count: number }>;
  mediaPatterns: Array<{ value: string; count: number }>;
  videoPatterns: Array<{ value: string; count: number }>;
  conversionPatterns: Array<{ value: string; count: number }>;
  contentGaps: Array<{ value: string; count: number }>;
  questions: ExtractedQuestionAgg[];
  // question pattern buckets keyed by topic type
  questionBuckets: Record<string, string[]>;
  competitorCount: number;
  servicePageCount: number;
  questionInputCount: number;
  videoInputCount: number;
}

function tally(values: string[], map: Map<string, number>) {
  for (const v of values) {
    const key = v.trim();
    if (!key) continue;
    const norm = key.toLowerCase();
    map.set(norm, (map.get(norm) || 0) + 1);
    // preserve original casing for first occurrence
    if (!ORIGINALS.has(norm)) ORIGINALS.set(norm, key);
  }
}
const ORIGINALS = new Map<string, string>();

function toSorted(map: Map<string, number>, min = 1): Array<{ value: string; count: number }> {
  return Array.from(map.entries())
    .filter(([, c]) => c >= min)
    .sort((a, b) => b[1] - a[1])
    .map(([k, c]) => ({ value: ORIGINALS.get(k) || k, count: c }))
    .slice(0, 40);
}

function priorityFromFrequency(count: number, topicType: TopicType): 'low' | 'medium' | 'high' | 'critical' {
  const isHighValue = topicType === 'cost' || topicType === 'comparison' || topicType === 'warning_signs';
  if (count >= 4) return isHighValue ? 'critical' : 'high';
  if (count >= 2) return isHighValue ? 'high' : 'medium';
  return isHighValue ? 'medium' : 'low';
}

/**
 * PURE aggregation of competitor extractions into common patterns + question
 * buckets. No DB, no network — unit testable.
 */
export function aggregateExtractions(competitors: AnalyzedCompetitor[]): AggregatedPatterns {
  ORIGINALS.clear();
  const headings = new Map<string, number>();
  const topics = new Map<string, number>();
  const faqs = new Map<string, number>();
  const schema = new Map<string, number>();
  const trust = new Map<string, number>();
  const local = new Map<string, number>();
  const media = new Map<string, number>();
  const video = new Map<string, number>();
  const conversion = new Map<string, number>();
  const gaps = new Map<string, number>();
  const ctas: string[] = [];

  // question aggregation keyed by normalized question text
  const qMap = new Map<string, ExtractedQuestionAgg>();

  let servicePageCount = 0;
  let questionInputCount = 0;
  let videoInputCount = 0;

  for (const c of competitors) {
    if (c.classifiedInput === 'service_page') servicePageCount++;
    else if (c.classifiedInput === 'question_input') questionInputCount++;
    else if (c.classifiedInput === 'video_input') videoInputCount++;

    tally(c.headings, headings);
    tally(c.topics, topics);
    tally(c.faqs, faqs);
    tally(c.schemaTypes, schema);
    tally(c.trustElements, trust);
    tally(c.localTerms, local);
    tally(c.mediaElements, media);
    tally(c.videoElements, video);
    tally(c.conversionElements, conversion);
    tally(c.contentGaps, gaps);
    if (c.ctaSummary) ctas.push(c.ctaSummary.trim());

    // Questions come from FAQs + explicitly extracted questions. Video and
    // question inputs contribute their questions with their result type.
    const questionSources = [...c.faqs, ...c.extractedQuestions];
    for (const q of questionSources) {
      const text = q.trim();
      if (!text || text.length < 5) continue;
      const key = text.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
      if (!key) continue;
      const topicType: TopicType = c.classifiedInput === 'video_input' ? 'video_topic' : classifyQuestionTopic(text);
      const existing = qMap.get(key);
      if (existing) {
        existing.frequencyCount += 1;
        if (!existing.sourceUrls.includes(c.url)) existing.sourceUrls.push(c.url);
        if (!existing.sourceResultTypes.includes(c.resultType)) existing.sourceResultTypes.push(c.resultType);
        existing.priority = priorityFromFrequency(existing.frequencyCount, existing.topicType);
      } else {
        qMap.set(key, {
          questionText: text,
          topicType,
          frequencyCount: 1,
          sourceUrls: [c.url],
          sourceResultTypes: [c.resultType],
          funnelStage: topicFunnelStage(topicType),
          recommendedContentUse: recommendedContentUseForTopic(topicType),
          priority: priorityFromFrequency(1, topicType),
        });
      }
    }
  }

  const questions = Array.from(qMap.values()).sort((a, b) => b.frequencyCount - a.frequencyCount);

  const questionBuckets: Record<string, string[]> = {};
  for (const q of questions) {
    (questionBuckets[q.topicType] ||= []).push(q.questionText);
  }

  return {
    commonHeadings: toSorted(headings),
    commonTopics: toSorted(topics),
    commonFaqs: toSorted(faqs),
    commonSchema: toSorted(schema),
    commonCtas: Array.from(new Set(ctas)).slice(0, 20),
    trustElements: toSorted(trust),
    localTerms: toSorted(local),
    mediaPatterns: toSorted(media),
    videoPatterns: toSorted(video),
    conversionPatterns: toSorted(conversion),
    contentGaps: toSorted(gaps),
    questions,
    questionBuckets,
    competitorCount: competitors.length,
    servicePageCount,
    questionInputCount,
    videoInputCount,
  };
}

export interface MetaRecommendations {
  recommendedAngle: string | null;
  recommendedSections: string[];
  recommendedFaqs: string[];
  recommendedSchema: string[];
  recommendedCtas: string[];
  recommendedVideoTopics: string[];
  confidenceScore: number;
}

const REC_SYSTEM = `You are an SEO strategy lead. Given AGGREGATED competitor structure patterns and
mined customer questions for a target query, recommend how OUR original page should be built so it is
more complete and differentiated — WITHOUT copying competitor wording.
Return STRICT JSON:
{
  "recommended_angle": string,            // the differentiation angle to take
  "recommended_sections": string[],       // ordered section outline for our page
  "recommended_faqs": string[],           // FAQs our page should answer (questions)
  "recommended_schema": string[],         // schema.org types to implement
  "recommended_ctas": string[],           // conversion CTAs to include
  "recommended_video_topics": string[],   // short-form video topics from question/video inputs
  "confidence": number                    // 0..1 confidence given evidence breadth
}`;

/** Ask the LLM for recommendations on top of the aggregation. */
export async function recommendFromAggregation(
  agg: AggregatedPatterns,
  context: { targetKeyword?: string | null; targetLocation?: string | null; serviceLine?: string | null },
): Promise<MetaRecommendations> {
  const fallback: MetaRecommendations = {
    recommendedAngle: null,
    recommendedSections: agg.commonHeadings.slice(0, 10).map((h) => h.value),
    recommendedFaqs: agg.commonFaqs.slice(0, 10).map((f) => f.value),
    recommendedSchema: agg.commonSchema.slice(0, 6).map((s) => s.value),
    recommendedCtas: agg.commonCtas.slice(0, 5),
    recommendedVideoTopics: (agg.questionBuckets['video_topic'] || []).slice(0, 8),
    confidenceScore: Math.min(1, agg.competitorCount / 6),
  };

  const payload = {
    target_keyword: context.targetKeyword || null,
    target_location: context.targetLocation || null,
    service_line: context.serviceLine || null,
    competitor_count: agg.competitorCount,
    common_headings: agg.commonHeadings.slice(0, 20),
    common_topics: agg.commonTopics.slice(0, 20),
    common_faqs: agg.commonFaqs.slice(0, 20),
    common_schema: agg.commonSchema,
    common_ctas: agg.commonCtas,
    trust_elements: agg.trustElements.slice(0, 15),
    local_terms: agg.localTerms.slice(0, 15),
    media_patterns: agg.mediaPatterns.slice(0, 10),
    video_patterns: agg.videoPatterns.slice(0, 10),
    conversion_patterns: agg.conversionPatterns.slice(0, 10),
    content_gaps: agg.contentGaps.slice(0, 20),
    question_buckets: agg.questionBuckets,
  };

  const raw = await callLlmJson(REC_SYSTEM, JSON.stringify(payload), 3000).catch(() => null);
  if (!raw) return fallback;

  const arr = (v: any): string[] =>
    Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean).slice(0, 20) : [];
  return {
    recommendedAngle: raw.recommended_angle ?? fallback.recommendedAngle,
    recommendedSections: arr(raw.recommended_sections).length ? arr(raw.recommended_sections) : fallback.recommendedSections,
    recommendedFaqs: arr(raw.recommended_faqs).length ? arr(raw.recommended_faqs) : fallback.recommendedFaqs,
    recommendedSchema: arr(raw.recommended_schema).length ? arr(raw.recommended_schema) : fallback.recommendedSchema,
    recommendedCtas: arr(raw.recommended_ctas).length ? arr(raw.recommended_ctas) : fallback.recommendedCtas,
    recommendedVideoTopics: arr(raw.recommended_video_topics).length ? arr(raw.recommended_video_topics) : fallback.recommendedVideoTopics,
    confidenceScore: typeof raw.confidence === 'number' ? Math.max(0, Math.min(1, raw.confidence)) : fallback.confidenceScore,
  };
}
