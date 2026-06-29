/**
 * SEO Research Consumption Layer — orchestrator.
 *
 * Pipeline:
 *   provider SERP observations (top URLs only)
 *     -> fetch each top URL (never a search-engine results page)
 *     -> LLM structural extraction  -> SeoCompetitorPageAnalysis
 *     -> aggregate into SeoContentMetaAnalysis (+ SeoExtractedQuestion rows)
 *     -> generate SeoPageBrief / SeoContentBrief / SeoVideoBrief (draft)
 *
 * Compliance guarantees enforced here:
 *   - Only provider-returned URLs are fetched (forbidden SERP hosts rejected).
 *   - No competitor copying — only structure/intent/gaps are stored.
 *   - Nothing is auto-published; briefs are created as drafts.
 *   - Everything is business-scoped; provider task_id + check_url preserved.
 */
import { prisma } from '@/lib/db';
import { getDataForSeoConfig } from '@/lib/dataforseo-provider';
import { fetchCompetitorPage } from './page-fetcher';
import { analyzeFetchedPage, classifyForAnalysis } from './analyzer';
import { storeRawSeoSnapshot } from './storage';
import {
  aggregateExtractions,
  recommendFromAggregation,
  type AnalyzedCompetitor,
} from './meta-analysis';
import { buildPageBrief, buildContentBriefs, buildVideoBriefs } from './brief-generators';
import {
  isMetaAnalysisStale,
  resolvePageResearchStatus,
  safeHostname,
  type SeoResearchStatus,
} from './classification';

export interface RunSeoResearchParams {
  businessId: string;
  runId?: string | null;
  keywordId?: string | null;
  locationId?: string | null;
  targetKeyword?: string | null;
  targetLocation?: string | null;
  serviceLine?: string | null;
  marketOrientation?: string | null;
  maxUrls?: number;
}

export interface RunSeoResearchResult {
  ok: boolean;
  reason?: string;
  metaAnalysisId?: string;
  competitorAnalyzed: number;
  questionsExtracted: number;
  pageBriefId?: string;
  contentBriefIds: string[];
  videoBriefIds: string[];
  providerConfigured: boolean;
}

/**
 * Run the full research pipeline for a business + (optional) keyword/location.
 * Pulls the provider's already-recorded SERP observations (we do NOT call a
 * search engine here) and analyzes each returned top URL.
 */
export async function runSeoResearchForKeyword(params: RunSeoResearchParams): Promise<RunSeoResearchResult> {
  const providerConfigured = getDataForSeoConfig().hasCredentials;
  const result: RunSeoResearchResult = {
    ok: false,
    competitorAnalyzed: 0,
    questionsExtracted: 0,
    contentBriefIds: [],
    videoBriefIds: [],
    providerConfigured,
  };

  // 1) Pull provider SERP observations for this business + filters. These are
  //    the ONLY source of URLs we will fetch. We never query a search engine.
  const observations = await prisma.searchVisibilityObservation.findMany({
    where: {
      businessId: params.businessId,
      ...(params.runId ? { runId: params.runId } : {}),
      ...(params.keywordId ? { keywordId: params.keywordId } : {}),
      ...(params.locationId ? { locationId: params.locationId } : {}),
      url: { not: null },
      isSelf: false,
    },
    orderBy: [{ observedAt: 'desc' }, { rankAbsolute: 'asc' }],
    take: 60,
  });

  // Dedupe by URL, keep best-ranked, cap to maxUrls.
  const seen = new Set<string>();
  const targets: typeof observations = [];
  for (const o of observations) {
    const u = (o.url || '').trim();
    if (!u || seen.has(u)) continue;
    seen.add(u);
    targets.push(o);
    if (targets.length >= (params.maxUrls ?? 12)) break;
  }

  if (!targets.length) {
    result.reason = 'no_provider_urls';
    return result;
  }

  // 2) Provider evidence (task_id + check_url) from the originating run.
  let providerTaskId: string | null = null;
  let checkUrl: string | null = null;
  if (params.runId) {
    const run = await prisma.searchIntelligenceRun.findFirst({
      where: { id: params.runId, businessId: params.businessId },
      select: { providerTaskId: true, checkUrl: true },
    });
    providerTaskId = run?.providerTaskId ?? null;
    checkUrl = run?.checkUrl ?? null;
  }

  // 3) Create the meta-analysis shell (pending) so competitor analyses can link.
  const meta = await prisma.seoContentMetaAnalysis.create({
    data: {
      businessId: params.businessId,
      runId: params.runId ?? null,
      keywordId: params.keywordId ?? null,
      locationId: params.locationId ?? null,
      targetKeyword: params.targetKeyword ?? null,
      targetLocation: params.targetLocation ?? null,
      serviceLine: params.serviceLine ?? null,
      marketOrientation: params.marketOrientation ?? null,
      dataSource: 'dataforseo',
      providerTaskId,
      checkUrl,
      competitorUrlsJson: targets.map((t) => ({ url: t.url, domain: t.domain, resultType: t.resultType, rankAbsolute: t.rankAbsolute })),
      status: 'pending',
    },
  });
  result.metaAnalysisId = meta.id;

  const ctx = {
    targetKeyword: params.targetKeyword,
    targetLocation: params.targetLocation,
    serviceLine: params.serviceLine,
  };

  // 4) Fetch + analyze each provider URL.
  const analyzed: AnalyzedCompetitor[] = [];
  for (const obs of targets) {
    const url = (obs.url || '').trim();
    const { classifiedInput, resultType } = classifyForAnalysis(obs.resultType, url);
    let status = 'pending';
    let rawSnapshotRef: string | null = null;
    let extraction = null as Awaited<ReturnType<typeof analyzeFetchedPage>> | null;

    try {
      const page = await fetchCompetitorPage(url);
      if (page.rawHtml) {
        rawSnapshotRef = await storeRawSeoSnapshot({
          businessId: params.businessId,
          kind: 'competitor_page',
          identifier: safeHostname(url) || obs.id,
          body: page.rawHtml,
          contentType: 'text/html; charset=utf-8',
        });
      }
      extraction = await analyzeFetchedPage(page, ctx);
      status = extraction ? 'complete' : page.ok ? 'skipped' : 'failed';
    } catch (err) {
      console.error('[seo-research] fetch/analyze failed for', url, err);
      status = 'failed';
    }

    await prisma.seoCompetitorPageAnalysis.create({
      data: {
        businessId: params.businessId,
        metaAnalysisId: meta.id,
        runId: params.runId ?? null,
        keywordId: params.keywordId ?? null,
        locationId: params.locationId ?? null,
        providerTaskId,
        checkUrl,
        rawSnapshotRef,
        domain: obs.domain ?? safeHostname(url) ?? null,
        url,
        rankGroup: obs.rankGroup ?? null,
        rankAbsolute: obs.rankAbsolute ?? null,
        resultType,
        classifiedInput,
        pageTitle: extraction?.pageTitle ?? null,
        metaDescription: extraction?.metaDescription ?? null,
        h1: extraction?.h1 ?? null,
        headingsJson: extraction?.headings ?? undefined,
        topicsJson: extraction?.topics ?? undefined,
        faqsJson: extraction?.faqs ?? undefined,
        schemaTypesJson: extraction?.schemaTypes ?? undefined,
        ctaSummary: extraction?.ctaSummary ?? null,
        trustElementsJson: extraction?.trustElements ?? undefined,
        localTermsJson: extraction?.localTerms ?? undefined,
        mediaElementsJson: extraction?.mediaElements ?? undefined,
        videoElementsJson: extraction?.videoElements ?? undefined,
        contentGapsJson: extraction?.contentGaps ?? undefined,
        conversionElementsJson: extraction?.conversionElements ?? undefined,
        analysisSummary: extraction?.analysisSummary ?? null,
        status,
      },
    });

    if (extraction) {
      analyzed.push({
        ...extraction,
        url,
        domain: obs.domain ?? safeHostname(url) ?? null,
        resultType,
        classifiedInput,
      });
    }
  }

  result.competitorAnalyzed = analyzed.length;

  if (!analyzed.length) {
    await prisma.seoContentMetaAnalysis.update({ where: { id: meta.id }, data: { status: 'failed' } });
    result.reason = 'no_pages_analyzed';
    return result;
  }

  // 5) Aggregate + recommend.
  const agg = aggregateExtractions(analyzed);
  const rec = await recommendFromAggregation(agg, ctx);

  // 6) Persist extracted questions.
  if (agg.questions.length) {
    await prisma.seoExtractedQuestion.createMany({
      data: agg.questions.slice(0, 80).map((q) => ({
        businessId: params.businessId,
        metaAnalysisId: meta.id,
        questionText: q.questionText,
        topicType: q.topicType,
        frequencyCount: q.frequencyCount,
        sourceUrlsJson: q.sourceUrls,
        sourceResultTypesJson: q.sourceResultTypes,
        funnelStage: q.funnelStage,
        recommendedContentUse: q.recommendedContentUse,
        priority: q.priority,
      })),
    });
  }
  result.questionsExtracted = agg.questions.length;

  // 7) Update the meta-analysis with aggregated patterns + recommendations.
  const bucket = (k: string) => agg.questionBuckets[k] || [];
  await prisma.seoContentMetaAnalysis.update({
    where: { id: meta.id },
    data: {
      competitorUrlsJson: analyzed.map((a) => ({ url: a.url, domain: a.domain, resultType: a.resultType, classifiedInput: a.classifiedInput })),
      commonHeadingsJson: agg.commonHeadings,
      commonTopicsJson: agg.commonTopics,
      commonFaqsJson: agg.commonFaqs,
      commonSchemaJson: agg.commonSchema,
      commonCtasJson: agg.commonCtas,
      trustElementsJson: agg.trustElements,
      localTermsJson: agg.localTerms,
      mediaPatternsJson: agg.mediaPatterns,
      videoPatternsJson: agg.videoPatterns,
      conversionPatternsJson: agg.conversionPatterns,
      contentGapsJson: agg.contentGaps,
      commonCustomerQuestionsJson: agg.questions.slice(0, 40).map((q) => ({ q: q.questionText, type: q.topicType, freq: q.frequencyCount, priority: q.priority })),
      questionPatternsJson: agg.questionBuckets,
      listiclePatternsJson: agg.commonHeadings.filter((h) => /\b\d+\b/.test(h.value) || /tips|ways|signs|reasons|things/i.test(h.value)),
      comparisonTopicsJson: bucket('comparison'),
      warningSignTopicsJson: bucket('warning_signs'),
      costTopicsJson: bucket('cost'),
      serviceProcessTopicsJson: bucket('process'),
      objectionTopicsJson: bucket('objection'),
      paaQuestionsJson: agg.questions.filter((q) => q.sourceResultTypes.includes('people_also_ask')).map((q) => q.questionText),
      faqQuestionsJson: agg.commonFaqs.map((f) => f.value),
      recommendedAngle: rec.recommendedAngle,
      recommendedSectionsJson: rec.recommendedSections,
      recommendedFaqsJson: rec.recommendedFaqs,
      recommendedSchemaJson: rec.recommendedSchema,
      recommendedCtasJson: rec.recommendedCtas,
      recommendedVideoTopicsJson: rec.recommendedVideoTopics,
      confidenceScore: rec.confidenceScore,
      status: 'complete',
    },
  });

  // 8) Generate briefs (drafts — require approval before use).
  const pageBriefDraft = buildPageBrief(agg, rec, ctx);
  const pageBrief = await prisma.seoPageBrief.create({
    data: {
      businessId: params.businessId,
      metaAnalysisId: meta.id,
      targetPageType: pageBriefDraft.targetPageType,
      recommendedSlug: pageBriefDraft.recommendedSlug,
      recommendedMetaTitle: pageBriefDraft.recommendedMetaTitle,
      recommendedMetaDescription: pageBriefDraft.recommendedMetaDescription,
      recommendedH1: pageBriefDraft.recommendedH1,
      recommendedSectionsJson: pageBriefDraft.recommendedSections,
      recommendedFaqsJson: pageBriefDraft.recommendedFaqs,
      recommendedSchemaJson: pageBriefDraft.recommendedSchema,
      internalLinkRecommendationsJson: pageBriefDraft.internalLinkRecommendations,
      ctaRecommendationsJson: pageBriefDraft.ctaRecommendations,
      formRecommendationsJson: pageBriefDraft.formRecommendations,
      trackingRecommendationsJson: pageBriefDraft.trackingRecommendations,
      differentiationAngle: pageBriefDraft.differentiationAngle,
      evidenceSummary: pageBriefDraft.evidenceSummary,
      sourceCompetitorAnalysisIdsJson: analyzed.map((a) => a.url),
      status: 'draft',
    },
  });
  result.pageBriefId = pageBrief.id;

  for (const cb of buildContentBriefs(agg, rec, ctx)) {
    const row = await prisma.seoContentBrief.create({
      data: {
        businessId: params.businessId,
        metaAnalysisId: meta.id,
        contentType: cb.contentType,
        recommendedTitle: cb.recommendedTitle,
        recommendedOutlineJson: cb.recommendedOutline,
        recommendedFaqsJson: cb.recommendedFaqs,
        recommendedCta: cb.recommendedCta,
        recommendedInternalLinksJson: cb.recommendedInternalLinks,
        recommendedMediaJson: cb.recommendedMedia,
        audience: cb.audience,
        evidenceSummary: cb.evidenceSummary,
        status: 'draft',
      },
    });
    result.contentBriefIds.push(row.id);
  }

  for (const vb of buildVideoBriefs(agg, rec, ctx)) {
    const row = await prisma.seoVideoBrief.create({
      data: {
        businessId: params.businessId,
        metaAnalysisId: meta.id,
        videoType: vb.videoType,
        hook: vb.hook,
        recommendedScriptOutlineJson: vb.recommendedScriptOutline,
        keyQuestionsToAnswerJson: vb.keyQuestionsToAnswer,
        visualShotsJson: vb.visualShots,
        recommendedCta: vb.recommendedCta,
        audience: vb.audience,
        funnelStage: vb.funnelStage,
        evidenceSummary: vb.evidenceSummary,
        status: 'draft',
      },
    });
    result.videoBriefIds.push(row.id);
  }

  result.ok = true;
  return result;
}

/**
 * Build-gate helper: report the SEO research status for a website page build
 * for a given business + target keyword/service. The production website
 * workflow consults this BEFORE generating a page. It NEVER auto-runs research
 * — it only reports the gate state (and marks stale meta-analyses).
 */
export async function getPageBuildResearchStatus(params: {
  businessId: string;
  targetKeyword?: string | null;
  serviceLine?: string | null;
  adminOverride?: boolean;
}): Promise<{ status: SeoResearchStatus; metaAnalysisId?: string; approvedPageBriefId?: string }> {
  const providerConfigured = getDataForSeoConfig().hasCredentials;

  const meta = await prisma.seoContentMetaAnalysis.findFirst({
    where: {
      businessId: params.businessId,
      ...(params.targetKeyword ? { targetKeyword: params.targetKeyword } : {}),
      ...(params.serviceLine ? { serviceLine: params.serviceLine } : {}),
    },
    orderBy: { createdAt: 'desc' },
  });

  let metaStatus = meta?.status ?? null;
  // Mark stale (never auto-regenerate).
  if (meta && meta.status === 'complete') {
    const stale = isMetaAnalysisStale({ createdAt: meta.createdAt, priority: 'high' });
    if (stale) {
      await prisma.seoContentMetaAnalysis.update({ where: { id: meta.id }, data: { status: 'stale' } });
      metaStatus = 'stale';
    }
  }

  let approvedBrief = null as { id: string } | null;
  if (meta) {
    approvedBrief = await prisma.seoPageBrief.findFirst({
      where: { businessId: params.businessId, metaAnalysisId: meta.id, status: 'approved' },
      select: { id: true },
      orderBy: { approvedAt: 'desc' },
    });
  }

  const status = resolvePageResearchStatus({
    hasApprovedBrief: Boolean(approvedBrief),
    metaAnalysisStatus: metaStatus,
    providerConfigured,
    adminOverride: params.adminOverride,
  });

  return { status, metaAnalysisId: meta?.id, approvedPageBriefId: approvedBrief?.id };
}

export * from './classification';
