/**
 * Search Intelligence → website / SEO brief evidence rules.
 *
 * When a service-page brief is generated using Search Intelligence data, the
 * evidence must be selected and cited responsibly:
 *
 *   1. PREFER stable competitor SERVICE / LOCAL / business pages (domains that
 *      recur across multiple observations) as the competitive model.
 *   2. Treat Reddit / forum / video / People-Also-Ask results as CUSTOMER-
 *      QUESTION input (topics to answer) — NOT as the primary competitor model.
 *   3. NEVER copy competitor text. Use evidence only to understand intent,
 *      topics and structure; write original copy.
 *   4. CITE the DataForSEO evidence: include the provider Task ID and check_url
 *      so the SERP observation behind the brief is independently verifiable.
 *   5. Treat results as an observed SERP snapshot at a point in time, not an
 *      absolute ranking truth.
 */

import { prisma } from '@/lib/db';
import { computeSerpVariance, type SerpVarianceResult } from '@/lib/serp-variance';

export const SERP_EVIDENCE_RULE = [
  'When using Search Intelligence (DataForSEO) evidence to inform this brief:',
  '- Model the page on STABLE competitor service/local/business pages (domains that recurred across observations). These are the strong signals.',
  '- Use Reddit, forums, video and “People also ask” results only as CUSTOMER QUESTIONS to answer, not as the competitor model to emulate.',
  '- Do NOT copy competitor wording. Understand intent and topics, then write original copy.',
  '- Treat the SERP data as an observed snapshot at one point in time, not an absolute ranking truth.',
].join('\n');

export interface BriefEvidence {
  hasEvidence: boolean;
  stableCompetitorPages: { domain: string; resultTypes: string[]; bestRank: number | null }[];
  customerQuestionSources: { domain: string; resultTypes: string[] }[];
  citation: { providerTaskId: string | null; checkUrl: string | null; observedAt: string | null } | null;
  /** Ready-to-append prompt block (already includes the rule + cited evidence). */
  promptBlock: string;
}

const WEAK_TYPES = new Set(['people_also_ask', 'related_searches', 'video', 'image']);
const WEAK_DOMAIN_HINTS = ['reddit.com', 'quora.com', 'youtube.com', 'facebook.com', 'pinterest.com', 'tiktok.com', 'wikipedia.org'];
function isQuestionSource(domain: string, resultTypes: string[]): boolean {
  const d = domain.toLowerCase();
  if (WEAK_DOMAIN_HINTS.some((h) => d === h || d.endsWith(`.${h}`) || d.includes(h))) return true;
  return resultTypes.length > 0 && resultTypes.every((t) => WEAK_TYPES.has(t));
}

/**
 * Build cited Search Intelligence evidence for a business' SEO brief. Best-effort
 * and side-effect free: reads stored observations + the latest run's audit
 * fields. Returns an empty (hasEvidence:false) block when no data exists.
 */
export async function buildSearchIntelligenceEvidence(
  businessId: string,
  opts: { keywordId?: string | null; locationId?: string | null; intent?: 'commercial' | 'local' | 'informational' | null } = {},
): Promise<BriefEvidence> {
  const empty: BriefEvidence = {
    hasEvidence: false,
    stableCompetitorPages: [],
    customerQuestionSources: [],
    citation: null,
    promptBlock: '',
  };

  let variance: SerpVarianceResult;
  try {
    variance = await computeSerpVariance({ businessId, keywordId: opts.keywordId ?? null, locationId: opts.locationId ?? null, intent: opts.intent ?? null });
  } catch {
    return empty;
  }
  if (variance.observationsCount === 0) return empty;

  const stableCompetitorPages = variance.stableDomains
    .filter((d) => d.signalStrength === 'strong' && !isQuestionSource(d.domain, d.resultTypes))
    .slice(0, 8)
    .map((d) => ({ domain: d.domain, resultTypes: d.resultTypes, bestRank: d.bestRankAbsolute ?? d.bestRankGroup ?? null }));

  const seenQuestion = new Set<string>();
  const customerQuestionSources: { domain: string; resultTypes: string[] }[] = [];
  for (const d of [...variance.stableDomains, ...variance.volatileDomains]) {
    if (isQuestionSource(d.domain, d.resultTypes) && !seenQuestion.has(d.domain)) {
      seenQuestion.add(d.domain);
      customerQuestionSources.push({ domain: d.domain, resultTypes: d.resultTypes });
    }
    if (customerQuestionSources.length >= 8) break;
  }

  // Citation from the most recent run for this business (task id + check_url).
  let citation: BriefEvidence['citation'] = null;
  try {
    const run = await prisma.searchIntelligenceRun.findFirst({
      where: { businessId, providerTaskId: { not: null } },
      orderBy: { createdAt: 'desc' },
      select: { providerTaskId: true, checkUrl: true, providerDatetime: true } as any,
    }) as any;
    if (run) {
      citation = {
        providerTaskId: run.providerTaskId ?? null,
        checkUrl: run.checkUrl ?? null,
        observedAt: run.providerDatetime ?? null,
      };
    }
  } catch { /* ignore */ }

  const lines: string[] = [SERP_EVIDENCE_RULE, ''];
  if (stableCompetitorPages.length > 0) {
    lines.push('Stable competitor pages observed (model the page structure/topics on these, do not copy text):');
    for (const c of stableCompetitorPages) {
      lines.push(`- ${c.domain}${c.bestRank != null ? ` (best position ~${c.bestRank})` : ''} [${c.resultTypes.join(', ')}]`);
    }
  }
  if (customerQuestionSources.length > 0) {
    lines.push('', 'Customer-question sources (use only to surface questions to answer in FAQs):');
    for (const q of customerQuestionSources) {
      lines.push(`- ${q.domain} [${q.resultTypes.join(', ')}]`);
    }
  }
  if (citation && (citation.providerTaskId || citation.checkUrl)) {
    lines.push('', 'Evidence citation (DataForSEO — include in internal notes, the SERP is verifiable here):');
    if (citation.providerTaskId) lines.push(`- Provider Task ID: ${citation.providerTaskId}`);
    if (citation.checkUrl) lines.push(`- Check URL: ${citation.checkUrl}`);
    if (citation.observedAt) lines.push(`- Observed at: ${citation.observedAt}`);
  }

  return {
    hasEvidence: stableCompetitorPages.length > 0 || customerQuestionSources.length > 0,
    stableCompetitorPages,
    customerQuestionSources,
    citation,
    promptBlock: lines.join('\n'),
  };
}
