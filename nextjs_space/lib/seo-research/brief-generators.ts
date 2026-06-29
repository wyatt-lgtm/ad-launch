/**
 * SEO Research — brief generators.
 *
 * Turn an aggregated meta-analysis (patterns + recommendations + mined
 * questions) into structured PAGE / CONTENT / VIDEO briefs. Briefs are
 * recommendations only — they are created in `draft` and require approval
 * before any page/content/video is generated from them (no auto-publish).
 */
import type { AggregatedPatterns, MetaRecommendations } from './meta-analysis';

export interface PageBriefDraft {
  targetPageType: string;
  recommendedSlug: string | null;
  recommendedMetaTitle: string | null;
  recommendedMetaDescription: string | null;
  recommendedH1: string | null;
  recommendedSections: string[];
  recommendedFaqs: string[];
  recommendedSchema: string[];
  internalLinkRecommendations: string[];
  ctaRecommendations: string[];
  formRecommendations: string[];
  trackingRecommendations: string[];
  differentiationAngle: string | null;
  evidenceSummary: string;
}

export interface ContentBriefDraft {
  contentType: string;
  recommendedTitle: string | null;
  recommendedOutline: string[];
  recommendedFaqs: string[];
  recommendedCta: string | null;
  recommendedInternalLinks: string[];
  recommendedMedia: string[];
  audience: string | null;
  evidenceSummary: string;
}

export interface VideoBriefDraft {
  videoType: string;
  hook: string | null;
  recommendedScriptOutline: string[];
  keyQuestionsToAnswer: string[];
  visualShots: string[];
  recommendedCta: string | null;
  audience: string | null;
  funnelStage: string;
  evidenceSummary: string;
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function evidence(agg: AggregatedPatterns, context: { targetKeyword?: string | null; targetLocation?: string | null }): string {
  return [
    `Derived from ${agg.competitorCount} provider-returned result(s)`,
    `(${agg.servicePageCount} service pages, ${agg.questionInputCount} question inputs, ${agg.videoInputCount} video inputs)`,
    context.targetKeyword ? `for "${context.targetKeyword}"` : '',
    context.targetLocation ? `in ${context.targetLocation}` : '',
    `— ${agg.questions.length} customer questions mined; ${agg.contentGaps.length} content gaps identified.`,
  ]
    .filter(Boolean)
    .join(' ');
}

/** Build a PAGE brief from the aggregation + recommendations. */
export function buildPageBrief(
  agg: AggregatedPatterns,
  rec: MetaRecommendations,
  context: { targetKeyword?: string | null; targetLocation?: string | null; serviceLine?: string | null; targetPageType?: string },
): PageBriefDraft {
  const kw = context.targetKeyword || context.serviceLine || 'service';
  const loc = context.targetLocation ? ` ${context.targetLocation}` : '';
  const high = agg.questions.filter((q) => q.priority === 'high' || q.priority === 'critical');
  return {
    targetPageType: context.targetPageType || (context.targetLocation ? 'location' : 'service'),
    recommendedSlug: slugify(`${kw}${loc}`),
    recommendedMetaTitle: `${kw}${loc}`.replace(/\b\w/g, (m) => m.toUpperCase()).slice(0, 60),
    recommendedMetaDescription: rec.recommendedAngle ? rec.recommendedAngle.slice(0, 155) : null,
    recommendedH1: `${kw}${loc}`.replace(/\b\w/g, (m) => m.toUpperCase()),
    recommendedSections: rec.recommendedSections,
    recommendedFaqs: rec.recommendedFaqs.length ? rec.recommendedFaqs : high.slice(0, 8).map((q) => q.questionText),
    recommendedSchema: rec.recommendedSchema,
    internalLinkRecommendations: agg.commonTopics.slice(0, 8).map((t) => t.value),
    ctaRecommendations: rec.recommendedCtas,
    formRecommendations: agg.conversionPatterns.filter((c) => /form|quote|book|contact|estimate/i.test(c.value)).map((c) => c.value).slice(0, 5),
    trackingRecommendations: ['Track form submissions', 'Track click-to-call', 'Track quote/booking starts'],
    differentiationAngle: rec.recommendedAngle,
    evidenceSummary: evidence(agg, context),
  };
}

/** Build the default set of CONTENT briefs (blog/FAQ/etc.) from mined questions. */
export function buildContentBriefs(
  agg: AggregatedPatterns,
  rec: MetaRecommendations,
  context: { targetKeyword?: string | null; targetLocation?: string | null; serviceLine?: string | null },
): ContentBriefDraft[] {
  const ev = evidence(agg, context);
  const briefs: ContentBriefDraft[] = [];

  // 1) A pillar blog article from the top question buckets.
  const blogQuestions = agg.questions.filter((q) => q.recommendedContentUse === 'blog_article').slice(0, 10);
  if (blogQuestions.length || agg.commonTopics.length) {
    briefs.push({
      contentType: 'blog_article',
      recommendedTitle: context.targetKeyword
        ? `${context.targetKeyword}: What Homeowners Should Know`
        : 'Guide',
      recommendedOutline: (blogQuestions.length ? blogQuestions.map((q) => q.questionText) : agg.commonTopics.slice(0, 8).map((t) => t.value)),
      recommendedFaqs: rec.recommendedFaqs.slice(0, 8),
      recommendedCta: rec.recommendedCtas[0] || null,
      recommendedInternalLinks: agg.commonTopics.slice(0, 6).map((t) => t.value),
      recommendedMedia: agg.mediaPatterns.slice(0, 5).map((m) => m.value),
      audience: 'Local homeowners researching the service',
      evidenceSummary: ev,
    });
  }

  // 2) An FAQ page from high-frequency FAQ/objection questions.
  const faqQuestions = agg.questions.filter((q) => q.topicType === 'FAQ' || q.topicType === 'objection').slice(0, 12);
  if (faqQuestions.length) {
    briefs.push({
      contentType: 'faq_page',
      recommendedTitle: context.targetKeyword ? `${context.targetKeyword} FAQs` : 'Frequently Asked Questions',
      recommendedOutline: faqQuestions.map((q) => q.questionText),
      recommendedFaqs: faqQuestions.map((q) => q.questionText),
      recommendedCta: rec.recommendedCtas[0] || null,
      recommendedInternalLinks: [],
      recommendedMedia: [],
      audience: 'Decision-stage prospects',
      evidenceSummary: ev,
    });
  }

  return briefs;
}

/** Build VIDEO briefs from video-topic + high-value question buckets. */
export function buildVideoBriefs(
  agg: AggregatedPatterns,
  rec: MetaRecommendations,
  context: { targetKeyword?: string | null; targetLocation?: string | null; serviceLine?: string | null },
): VideoBriefDraft[] {
  const ev = evidence(agg, context);
  const briefs: VideoBriefDraft[] = [];
  const videoTopics = rec.recommendedVideoTopics.length
    ? rec.recommendedVideoTopics
    : (agg.questionBuckets['video_topic'] || []);

  // Short-form videos for the top warning-sign / comparison / cost questions.
  const shortFormQuestions = agg.questions
    .filter((q) => ['warning_signs', 'comparison', 'cost', 'DIY_vs_professional', 'risk'].includes(q.topicType))
    .slice(0, 5);

  for (const q of shortFormQuestions) {
    briefs.push({
      videoType:
        q.topicType === 'comparison' ? 'comparison' : q.topicType === 'warning_signs' ? 'myth_buster' : 'faq_answer',
      hook: q.questionText,
      recommendedScriptOutline: [
        `Open with the question: "${q.questionText}"`,
        'Give the honest, specific answer',
        'Show one concrete local example or proof point',
        'Close with a clear next step',
      ],
      keyQuestionsToAnswer: [q.questionText],
      visualShots: agg.mediaPatterns.slice(0, 4).map((m) => m.value),
      recommendedCta: rec.recommendedCtas[0] || 'Call or request a free quote',
      audience: 'Local social-feed viewers',
      funnelStage: q.funnelStage,
      evidenceSummary: ev,
    });
  }

  // A service-overview explainer if we have strong structural coverage.
  if (agg.commonTopics.length >= 3) {
    briefs.push({
      videoType: 'service_overview',
      hook: context.targetKeyword ? `Everything you need to know about ${context.targetKeyword}` : 'Service overview',
      recommendedScriptOutline: ['What the service is', 'When you need it', 'How the process works', 'Why choose a local pro'],
      keyQuestionsToAnswer: videoTopics.slice(0, 4),
      visualShots: agg.mediaPatterns.slice(0, 5).map((m) => m.value),
      recommendedCta: rec.recommendedCtas[0] || 'Book your service today',
      audience: 'Consideration-stage local prospects',
      funnelStage: 'consideration',
      evidenceSummary: ev,
    });
  }

  return briefs;
}
