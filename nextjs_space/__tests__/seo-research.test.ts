/**
 * Tests for the SEO Research Consumption Layer (Phase 1 + 2).
 *
 * Validates the pure, DB-free core of the pipeline:
 *  - provider top URLs are classified (service / question / video inputs)
 *  - Reddit/forum/PAA -> question_input; YouTube/video -> video_input
 *  - NO Google scraping: forbidden SERP endpoints are rejected
 *  - extraction aggregation produces common patterns + mined questions
 *  - question topic classification + freshness/staleness rules
 *  - page/content/video briefs are produced from a meta-analysis aggregation
 *  - the build gate resolves the correct research status
 */
import {
  classifyResultInput,
  normalizeResultType,
  isForbiddenSerpScrapeUrl,
  assertFetchableTopUrl,
  classifyQuestionTopic,
  topicFunnelStage,
  recommendedContentUseForTopic,
  isMetaAnalysisStale,
  resolvePageResearchStatus,
  safeHostname,
} from '@/lib/seo-research/classification';
import {
  aggregateExtractions,
  type AnalyzedCompetitor,
} from '@/lib/seo-research/meta-analysis';
import {
  buildPageBrief,
  buildContentBriefs,
  buildVideoBriefs,
} from '@/lib/seo-research/brief-generators';
import type { MetaRecommendations } from '@/lib/seo-research/meta-analysis';

// ── Helpers ──
function comp(partial: Partial<AnalyzedCompetitor>): AnalyzedCompetitor {
  return {
    url: 'https://example.com/page',
    domain: 'example.com',
    resultType: 'organic',
    classifiedInput: 'service_page',
    pageTitle: null,
    metaDescription: null,
    h1: null,
    headings: [],
    topics: [],
    faqs: [],
    schemaTypes: [],
    ctaSummary: null,
    trustElements: [],
    localTerms: [],
    mediaElements: [],
    videoElements: [],
    contentGaps: [],
    conversionElements: [],
    analysisSummary: null,
    extractedQuestions: [],
    ...partial,
  };
}

describe('result-input classification', () => {
  test('organic + service host -> service_page', () => {
    expect(classifyResultInput('organic', 'https://acme-plumbing.com/services')).toBe('service_page');
    expect(classifyResultInput('local_pack', 'https://acme.com')).toBe('service_page');
  });

  test('Reddit / forum / PAA -> question_input', () => {
    expect(classifyResultInput('organic', 'https://www.reddit.com/r/plumbing/abc')).toBe('question_input');
    expect(classifyResultInput('people_also_ask', null)).toBe('question_input');
    expect(classifyResultInput('organic', 'https://community.example.com/thread')).toBe('question_input');
    expect(classifyResultInput('organic', 'https://www.quora.com/q')).toBe('question_input');
  });

  test('YouTube / video -> video_input', () => {
    expect(classifyResultInput('video', 'https://www.youtube.com/watch?v=x')).toBe('video_input');
    expect(classifyResultInput('organic', 'https://youtu.be/x')).toBe('video_input');
    expect(classifyResultInput('youtube', null)).toBe('video_input');
  });

  test('normalizeResultType maps hosts + types', () => {
    expect(normalizeResultType('organic', 'https://reddit.com/r/x')).toBe('reddit');
    expect(normalizeResultType('organic', 'https://youtube.com/watch')).toBe('youtube');
    expect(normalizeResultType('paid_ad')).toBe('paid');
    expect(normalizeResultType('people_also_ask')).toBe('people_also_ask');
  });
});

describe('NO Google scraping guard', () => {
  test('forbidden SERP endpoints are rejected', () => {
    expect(isForbiddenSerpScrapeUrl('https://www.google.com/search?q=plumber')).toBe(true);
    expect(isForbiddenSerpScrapeUrl('https://google.com/serp')).toBe(true);
    expect(isForbiddenSerpScrapeUrl('https://www.bing.com/search?q=x')).toBe(true);
    expect(isForbiddenSerpScrapeUrl('not a url')).toBe(true);
  });

  test('a normal competitor URL is allowed', () => {
    expect(isForbiddenSerpScrapeUrl('https://acme-plumbing.com/drain-cleaning')).toBe(false);
    expect(() => assertFetchableTopUrl('https://acme-plumbing.com/drain-cleaning')).not.toThrow();
  });

  test('assertFetchableTopUrl throws for google search', () => {
    expect(() => assertFetchableTopUrl('https://www.google.com/search?q=x')).toThrow(/never scrapes/i);
  });

  test('safeHostname strips www', () => {
    expect(safeHostname('https://www.Example.com/x')).toBe('example.com');
  });
});

describe('question topic classification', () => {
  test('classifies common topic types', () => {
    expect(classifyQuestionTopic('What are the signs I need a new roof?')).toBe('warning_signs');
    expect(classifyQuestionTopic('How much does drain cleaning cost?')).toBe('cost');
    expect(classifyQuestionTopic('Tankless vs tank water heater?')).toBe('comparison');
    expect(classifyQuestionTopic('Can I do this myself or hire a pro?')).toBe('DIY_vs_professional');
    expect(classifyQuestionTopic('How long does an install take?')).toBe('timing');
  });

  test('funnel stage + content use mapping are stable', () => {
    expect(topicFunnelStage('cost')).toBe('consideration');
    expect(topicFunnelStage('warning_signs')).toBe('awareness');
    expect(recommendedContentUseForTopic('cost')).toBe('service_page_section');
    expect(recommendedContentUseForTopic('video_topic')).toBe('short_video');
  });
});

describe('freshness / staleness rules', () => {
  const now = new Date('2026-06-29T00:00:00Z');
  test('high priority stale after 30 days', () => {
    expect(isMetaAnalysisStale({ createdAt: new Date('2026-05-01T00:00:00Z'), now, priority: 'high' })).toBe(true);
    expect(isMetaAnalysisStale({ createdAt: new Date('2026-06-20T00:00:00Z'), now, priority: 'high' })).toBe(false);
  });
  test('low priority stale after 90 days', () => {
    expect(isMetaAnalysisStale({ createdAt: new Date('2026-06-01T00:00:00Z'), now, priority: 'low' })).toBe(false);
    expect(isMetaAnalysisStale({ createdAt: new Date('2026-01-01T00:00:00Z'), now, priority: 'low' })).toBe(true);
  });
  test('material competitor movement forces stale', () => {
    expect(isMetaAnalysisStale({ createdAt: now, now, priority: 'low', materialCompetitorMovement: true })).toBe(true);
  });
});

describe('build-gate research status', () => {
  test('provider unavailable', () => {
    expect(resolvePageResearchStatus({ hasApprovedBrief: false, providerConfigured: false })).toBe('provider_unavailable');
  });
  test('research ready requires approved brief + complete meta', () => {
    expect(resolvePageResearchStatus({ hasApprovedBrief: true, metaAnalysisStatus: 'complete', providerConfigured: true })).toBe('research_ready');
  });
  test('missing meta -> seo_research_missing', () => {
    expect(resolvePageResearchStatus({ hasApprovedBrief: false, metaAnalysisStatus: null, providerConfigured: true })).toBe('seo_research_missing');
  });
  test('stale meta -> research_stale', () => {
    expect(resolvePageResearchStatus({ hasApprovedBrief: false, metaAnalysisStatus: 'stale', providerConfigured: true })).toBe('research_stale');
  });
  test('admin override -> generated_without_research', () => {
    expect(resolvePageResearchStatus({ hasApprovedBrief: false, providerConfigured: true, adminOverride: true })).toBe('generated_without_research');
  });
});

describe('meta-analysis aggregation', () => {
  const competitors: AnalyzedCompetitor[] = [
    comp({
      url: 'https://a-plumbing.com/drain',
      headings: ['Our Drain Services', 'Pricing'],
      topics: ['drain cleaning', 'hydro jetting'],
      faqs: ['How much does drain cleaning cost?', 'How long does it take?'],
      schemaTypes: ['LocalBusiness', 'FAQPage'],
      ctaSummary: 'Call for a free quote',
      trustElements: ['25 years in business'],
      contentGaps: ['no emergency info'],
      conversionElements: ['quote form'],
    }),
    comp({
      url: 'https://b-plumbing.com/drain',
      headings: ['Drain Services', 'Pricing'],
      topics: ['drain cleaning', 'camera inspection'],
      faqs: ['How much does drain cleaning cost?'],
      schemaTypes: ['LocalBusiness'],
      ctaSummary: 'Book online',
      contentGaps: ['no emergency info'],
    }),
    comp({
      url: 'https://www.reddit.com/r/plumbing/x',
      resultType: 'reddit',
      classifiedInput: 'question_input',
      extractedQuestions: ['Is hydro jetting worth it?', 'Can I snake the drain myself?'],
    }),
    comp({
      url: 'https://www.youtube.com/watch?v=z',
      resultType: 'youtube',
      classifiedInput: 'video_input',
      extractedQuestions: ['How to unclog a drain fast'],
    }),
  ];

  const agg = aggregateExtractions(competitors);

  test('counts inputs by classification', () => {
    expect(agg.competitorCount).toBe(4);
    expect(agg.servicePageCount).toBe(2);
    expect(agg.questionInputCount).toBe(1);
    expect(agg.videoInputCount).toBe(1);
  });

  test('tallies repeated patterns with frequency', () => {
    const cost = agg.commonFaqs.find((f) => /how much does drain cleaning cost/i.test(f.value));
    expect(cost?.count).toBe(2);
    const gap = agg.contentGaps.find((g) => /emergency/i.test(g.value));
    expect(gap?.count).toBe(2);
  });

  test('mines questions and tags video topics from youtube', () => {
    const vid = agg.questions.find((q) => /unclog a drain fast/i.test(q.questionText));
    expect(vid?.topicType).toBe('video_topic');
    expect(agg.questionBuckets['video_topic']?.length).toBeGreaterThan(0);
  });

  test('cost questions get elevated priority from frequency', () => {
    const cost = agg.questions.find((q) => /how much does drain cleaning cost/i.test(q.questionText));
    expect(cost?.topicType).toBe('cost');
    expect(['high', 'critical']).toContain(cost?.priority);
  });
});

describe('brief generation from aggregation', () => {
  const competitors: AnalyzedCompetitor[] = [
    comp({ topics: ['drain cleaning', 'hydro jetting', 'camera inspection'], faqs: ['How much does it cost?'], headings: ['Services', 'Pricing'], mediaElements: ['before/after photos'] }),
    comp({ url: 'https://reddit.com/r/x', resultType: 'reddit', classifiedInput: 'question_input', extractedQuestions: ['Tankless vs tank?', 'What are the warning signs of a clog?'] }),
  ];
  const agg = aggregateExtractions(competitors);
  const rec: MetaRecommendations = {
    recommendedAngle: 'Most complete local drain guide',
    recommendedSections: ['Overview', 'Pricing', 'Process'],
    recommendedFaqs: ['How much does it cost?'],
    recommendedSchema: ['LocalBusiness', 'FAQPage'],
    recommendedCtas: ['Call for a free quote'],
    recommendedVideoTopics: ['How to spot a clog'],
    confidenceScore: 0.5,
  };
  const ctx = { targetKeyword: 'drain cleaning', targetLocation: 'Austin TX', serviceLine: 'plumbing' };

  test('page brief has slug, sections, schema and evidence', () => {
    const pb = buildPageBrief(agg, rec, ctx);
    expect(pb.recommendedSlug).toContain('drain-cleaning');
    expect(pb.recommendedSections.length).toBeGreaterThan(0);
    expect(pb.recommendedSchema).toContain('LocalBusiness');
    expect(pb.evidenceSummary).toMatch(/provider-returned/);
    expect(pb.differentiationAngle).toBe('Most complete local drain guide');
  });

  test('content briefs include a blog article', () => {
    const cbs = buildContentBriefs(agg, rec, ctx);
    expect(cbs.some((c) => c.contentType === 'blog_article')).toBe(true);
  });

  test('video briefs derive from question/video buckets', () => {
    const vbs = buildVideoBriefs(agg, rec, ctx);
    expect(vbs.length).toBeGreaterThan(0);
    expect(vbs.every((v) => Array.isArray(v.recommendedScriptOutline) && v.recommendedScriptOutline.length > 0)).toBe(true);
  });
});
