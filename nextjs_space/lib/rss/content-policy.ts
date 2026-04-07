/**
 * RSS Intelligence System — Content Policy Engine
 *
 * Multi-layer content classification:
 *   Layer 1: Fast keyword/regex scan (< 1ms per item)
 *   Layer 2: LLM-based classification for ambiguous content (batch)
 *   Layer 3: Source-level preemptive blocking
 *
 * Hard-block categories (sexual/adult, political/opinion) are blocked
 * immediately on keyword match — no LLM needed.
 *
 * Tombstone research agents call this engine indirectly via the
 * trade area query, which only returns items with filterStatus = 'approved'.
 */

import { prisma } from '@/lib/db';
import type { FilterDecision, ContentCategory, FilterStatus } from './types';

// ═══════════════════════════════════════════════════════════════
// KEYWORD BLOCKLISTS
// High-precision patterns — tuned for zero false negatives on
// hard-block categories. False positives go to manual_review.
// ═══════════════════════════════════════════════════════════════

const SEXUAL_ADULT_KEYWORDS: RegExp[] = [
  // Explicit terms — case insensitive
  /\b(porn|pornograph|xxx|nsfw|onlyfans|sex\s?tape|erotic|hentai)\b/i,
  /\b(escort\s?service|strip\s?club|adult\s?entertainment|nude|nudity)\b/i,
  /\b(sexually\s+explicit|sex\s?worker|prostitut|brothel)\b/i,
  /\b(fetish|bdsm|orgasm|genitalia)\b/i,
];

const POLITICAL_OPINION_KEYWORDS: RegExp[] = [
  // Editorial / opinion markers
  /\b(op-?ed|editorial|opinion|letter\s+to\s+(the\s+)?editor|my\s+take|commentary)\b/i,
  // Partisan language
  /\b(republican|democrat|gop|dnc|rnc|maga|liberal|conservative)\b.*\b(should|must|need\s+to|wrong|right|fail|destroy)\b/i,
  /\b(vote\s+for|vote\s+against|endorse|endorsement|ballot\s+measure)\b/i,
  // Campaign / election opinion
  /\b(campaign\s+trail|election\s+fraud|stolen\s+election|rigged)\b/i,
  /\b(far[- ]right|far[- ]left|woke|anti[- ]woke)\b/i,
  // Partisan advocacy
  /\b(defund\s+(the\s+)?police|gun\s+control|second\s+amendment\s+rights|pro[- ]life|pro[- ]choice)\b.*\b(should|must|need)\b/i,
];

/** Political terms that are ONLY blocked when combined with opinion indicators */
const POLITICAL_CONTEXT_TERMS = /\b(republican|democrat|gop|liberal|conservative|trump|biden|congress)\b/i;
const OPINION_INDICATORS = /\b(should|must|wrong|terrible|destroy|radical|extreme|outrageous|shame|disgrace)\b/i;

// ═══════════════════════════════════════════════════════════════
// SOFT-FILTER KEYWORDS (send to manual_review)
// ═══════════════════════════════════════════════════════════════

const VIOLENCE_KEYWORDS: RegExp[] = [
  /\b(mass\s+shoot|gunman|massacre|beheading|execution|graphic\s+content)\b/i,
  /\b(murder|homicide|stabbing|assault\s+with)\b.*\b(graphic|disturbing|warning)\b/i,
];

const DRUG_ALCOHOL_KEYWORDS: RegExp[] = [
  /\b(marijuana\s+dispensary|cannabis\s+shop|drug\s+deal|meth\s+lab|cocaine|heroin)\b/i,
  /\b(binge\s+drink|alcohol\s+promotion|get\s+drunk|beer\s+pong\s+tournament)\b/i,
];

const GAMBLING_KEYWORDS: RegExp[] = [
  /\b(sports\s?bet|online\s+casino|gambling|poker\s+tournament|slot\s+machine)\b/i,
  /\b(betting\s+odds|point\s+spread|parlay|wager)\b/i,
];

// ═══════════════════════════════════════════════════════════════
// SAFE CONTENT INDICATORS (boost toward auto-approve)
// ═══════════════════════════════════════════════════════════════

const SAFE_LOCAL_INDICATORS: RegExp[] = [
  /\b(ribbon\s+cutting|grand\s+opening|community\s+event|farmers\s+market)\b/i,
  /\b(city\s+council\s+meeting|school\s+board|town\s+hall|public\s+hearing)\b/i,
  /\b(local\s+business|small\s+business|chamber\s+of\s+commerce)\b/i,
  /\b(festival|parade|fundraiser|charity|volunteer|donation\s+drive)\b/i,
  /\b(weather\s+forecast|road\s+closure|traffic\s+update|school\s+closure)\b/i,
  /\b(new\s+restaurant|store\s+opening|business\s+spotlight|employee\s+of)\b/i,
  /\b(high\s+school\s+football|little\s+league|local\s+sports|homecoming)\b/i,
  /\b(library\s+event|book\s+club|storytime|summer\s+reading)\b/i,
  /\b(parks?\s+(and\s+)?rec|hiking\s+trail|playground|community\s+center)\b/i,
];

// ═══════════════════════════════════════════════════════════════
// POLICY ENGINE — PUBLIC API
// ═══════════════════════════════════════════════════════════════

/**
 * Load active content policies from DB.
 * Policies supplement the hardcoded keyword lists with admin-managed
 * keywords and category overrides.
 */
export async function loadPolicies() {
  return prisma.contentPolicy.findMany({
    where: { isActive: true },
  });
}

/**
 * Classify a single RSS item's content against all policy layers.
 *
 * @param title - Item title
 * @param description - Item description / body snippet
 * @param feedSourceType - The feed's sourceType (for source-level policy)
 * @param feedStatus - The feed's status (blocked feeds → block all items)
 * @param dbPolicies - Pre-loaded policies from loadPolicies() to avoid per-item DB calls
 * @returns FilterDecision with status, category, confidence, reason, and method
 */
export function classifyContent(
  title: string | null,
  description: string | null,
  feedSourceType?: string,
  feedStatus?: string,
  dbPolicies?: Awaited<ReturnType<typeof loadPolicies>>,
): FilterDecision {
  const text = `${title ?? ''} ${description ?? ''}`.trim();

  // === Layer 3: Source-level blocking (check first — fastest) ===
  if (feedStatus === 'blocked') {
    return {
      status: 'blocked',
      category: null,
      confidence: 1.0,
      reason: 'Feed is blocked at source level',
      method: 'source_block',
    };
  }

  // Empty content — can't classify
  if (!text) {
    return {
      status: 'manual_review',
      category: null,
      confidence: 0,
      reason: 'No title or description to classify',
      method: 'keyword',
    };
  }

  // === Layer 1a: HARD BLOCK — Sexual / Adult ===
  for (const pattern of SEXUAL_ADULT_KEYWORDS) {
    if (pattern.test(text)) {
      return {
        status: 'blocked',
        category: 'sexual_adult',
        confidence: 0.95,
        reason: `Matched sexual/adult keyword pattern: ${pattern.source.slice(0, 60)}`,
        method: 'keyword',
      };
    }
  }

  // Check DB-managed keywords for sexual_adult
  const sexualPolicy = dbPolicies?.find(p => p.category === 'sexual_adult');
  if (sexualPolicy?.keywords?.length) {
    for (const kw of sexualPolicy.keywords) {
      if (text.toLowerCase().includes(kw.toLowerCase())) {
        return {
          status: 'blocked',
          category: 'sexual_adult',
          confidence: 0.90,
          reason: `Matched DB keyword: "${kw}"`,
          method: 'keyword',
        };
      }
    }
  }

  // === Layer 1b: HARD BLOCK — Political / Opinion ===
  for (const pattern of POLITICAL_OPINION_KEYWORDS) {
    if (pattern.test(text)) {
      return {
        status: 'blocked',
        category: 'political_opinion',
        confidence: 0.90,
        reason: `Matched political/opinion keyword pattern: ${pattern.source.slice(0, 60)}`,
        method: 'keyword',
      };
    }
  }

  // Context-dependent political detection (political term + opinion indicator)
  if (POLITICAL_CONTEXT_TERMS.test(text) && OPINION_INDICATORS.test(text)) {
    return {
      status: 'blocked',
      category: 'political_opinion',
      confidence: 0.80,
      reason: 'Political context term combined with opinion indicator',
      method: 'keyword',
    };
  }

  // Check DB-managed keywords for political_opinion
  const politicalPolicy = dbPolicies?.find(p => p.category === 'political_opinion');
  if (politicalPolicy?.keywords?.length) {
    for (const kw of politicalPolicy.keywords) {
      if (text.toLowerCase().includes(kw.toLowerCase())) {
        return {
          status: 'blocked',
          category: 'political_opinion',
          confidence: 0.85,
          reason: `Matched DB keyword: "${kw}"`,
          method: 'keyword',
        };
      }
    }
  }

  // === Layer 1c: SOFT FILTER — Violence ===
  for (const pattern of VIOLENCE_KEYWORDS) {
    if (pattern.test(text)) {
      return {
        status: 'manual_review',
        category: 'violence_graphic',
        confidence: 0.70,
        reason: `Matched violence keyword: ${pattern.source.slice(0, 60)}`,
        method: 'keyword',
      };
    }
  }

  // === Layer 1d: SOFT FILTER — Drug/Alcohol ===
  for (const pattern of DRUG_ALCOHOL_KEYWORDS) {
    if (pattern.test(text)) {
      return {
        status: 'manual_review',
        category: 'drug_alcohol',
        confidence: 0.70,
        reason: `Matched drug/alcohol keyword: ${pattern.source.slice(0, 60)}`,
        method: 'keyword',
      };
    }
  }

  // === Layer 1e: SOFT FILTER — Gambling ===
  for (const pattern of GAMBLING_KEYWORDS) {
    if (pattern.test(text)) {
      return {
        status: 'manual_review',
        category: 'gambling',
        confidence: 0.70,
        reason: `Matched gambling keyword: ${pattern.source.slice(0, 60)}`,
        method: 'keyword',
      };
    }
  }

  // === Check remaining DB-managed soft-filter policies ===
  if (dbPolicies?.length) {
    for (const policy of dbPolicies) {
      if (policy.action !== 'soft_filter' || !policy.keywords?.length) continue;
      if (policy.category === 'sexual_adult' || policy.category === 'political_opinion') continue; // Already checked
      for (const kw of policy.keywords) {
        if (text.toLowerCase().includes(kw.toLowerCase())) {
          return {
            status: 'manual_review',
            category: policy.category as ContentCategory,
            confidence: 0.65,
            reason: `Matched DB soft-filter keyword "${kw}" in policy "${policy.category}"`,
            method: 'keyword',
          };
        }
      }
    }
  }

  // === Safe content boost — auto-approve if strong local signals ===
  let safeMatches = 0;
  for (const pattern of SAFE_LOCAL_INDICATORS) {
    if (pattern.test(text)) safeMatches++;
  }

  if (safeMatches >= 1) {
    return {
      status: 'approved',
      category: 'community_news',
      confidence: 0.75 + Math.min(safeMatches * 0.05, 0.20),
      reason: `Matched ${safeMatches} safe local indicator(s)`,
      method: 'keyword',
    };
  }

  // === No keyword matches — default behavior ===
  // Content with no matches either way goes to 'approved' with lower confidence.
  // The LLM classifier (Phase 6) will handle ambiguous cases in batch.
  // For now, we auto-approve with a note that LLM review is pending.
  return {
    status: 'approved',
    category: null,
    confidence: 0.50,
    reason: 'No keyword matches — auto-approved (LLM review pending in Phase 6)',
    method: 'auto_allow',
  };
}

/**
 * Batch classify multiple items. Loads policies once, then classifies all.
 * Returns array of decisions in same order as input.
 */
export async function batchClassify(
  items: Array<{
    title: string | null;
    description: string | null;
    feedSourceType?: string;
    feedStatus?: string;
  }>,
): Promise<FilterDecision[]> {
  const policies = await loadPolicies();
  return items.map(item =>
    classifyContent(
      item.title,
      item.description,
      item.feedSourceType,
      item.feedStatus,
      policies,
    ),
  );
}

/**
 * Apply a filter decision to an RssItem in the DB.
 * Creates an ItemAudit record for the audit trail.
 */
export async function applyFilterDecision(
  itemId: string,
  decision: FilterDecision,
  performedBy: string = 'system',
) {
  await prisma.$transaction([
    prisma.rssItem.update({
      where: { id: itemId },
      data: {
        filterStatus: decision.status,
        filterReason: decision.reason,
        blockedCategory: decision.category,
      },
    }),
    prisma.itemAudit.create({
      data: {
        itemId,
        action: decision.status === 'blocked' ? 'auto_blocked' : decision.status === 'approved' ? 'auto_approved' : 'auto_blocked',
        category: decision.category,
        confidence: decision.confidence,
        reason: `[${decision.method}] ${decision.reason}`,
        performedBy,
      },
    }),
  ]);
}

/**
 * Mark an item as used by the Tombstone creative workflow.
 * This prevents the same item from being served to other trade area queries
 * (when excludeUsed = true) and creates an audit trail.
 */
export async function markItemUsedInPost(
  itemId: string,
  postReference: string,
  agentName: string = 'tombstone:creative',
) {
  await prisma.$transaction([
    prisma.rssItem.update({
      where: { id: itemId },
      data: {
        usedInPost: true,
        usedAt: new Date(),
        postReference,
      },
    }),
    prisma.itemAudit.create({
      data: {
        itemId,
        action: 'used_in_post',
        reason: `Used in social post: ${postReference}`,
        performedBy: agentName,
      },
    }),
  ]);
}
