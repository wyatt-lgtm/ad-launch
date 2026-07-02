/**
 * Milestone 10 — old-URL → new-sitemap mapping + content-intent scoring (pure).
 *
 * For every inventoried old URL it decides how to preserve SEO equity against
 * the newly PROPOSED sitemap:
 *   - preserve_same_url : the exact path exists in the new sitemap
 *   - redirect_301      : no exact path, but a close intent match exists
 *   - rebuild_page      : unique value, no equivalent → recommend keeping it
 *   - ignore_no_value   : low-value / trash (requires a reason)
 *   - needs_review      : ambiguous / weak intent match on a high-value URL
 *
 * Network-free + deterministic. Matching is token/Jaccard based over normalized
 * paths (plus page title / H1 / service name tokens).
 */

import type { SitemapPage, WebsiteSitemapArtifact } from '@/lib/website-sitemap';
import { pathTokens, normalizePath } from '@/lib/site-backlinks/url-normalize';
import {
  classifyPriority,
  isHighValue,
  type PriorityInputs,
} from '@/lib/site-backlinks/priority';
import type {
  BacklinkPriority,
  BacklinkUrlRecord,
  PreservationAction,
  PreservationMapping,
  PreservationStatus,
} from '@/lib/site-backlinks/types';

/** Minimum Jaccard overlap to treat two pages as the same topical intent. */
const STRONG_MATCH = 0.5;
const WEAK_MATCH = 0.25;

function tokenSet(...parts: (string | null | undefined)[]): Set<string> {
  const set = new Set<string>();
  for (const part of parts) {
    if (!part) continue;
    for (const t of pathTokens('/' + part.replace(/[^a-zA-Z0-9]+/g, '-'))) set.add(t);
  }
  return set;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter += 1;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

export interface PageCandidate {
  page: SitemapPage;
  path: string;
  tokens: Set<string>;
}

/** Build the candidate list of proposed pages (path + topical tokens). */
export function buildPageCandidates(sitemap: WebsiteSitemapArtifact): PageCandidate[] {
  return (sitemap.pages || [])
    .filter((p) => p.confirmationStatus !== 'rejected')
    .map((p) => {
      const path = normalizePath(p.slug);
      const tokens = tokenSet(path, p.title, p.h1, p.serviceName);
      // Include path tokens directly too.
      for (const t of pathTokens(path)) tokens.add(t);
      return { page: p, path, tokens };
    });
}

export interface MatchResult {
  candidate: PageCandidate | null;
  score: number;
}

/** Find the best-matching proposed page for an old normalized path. */
export function findBestMatch(
  oldPath: string,
  oldTokens: Set<string>,
  candidates: PageCandidate[],
): MatchResult {
  // 1) Exact path match wins outright.
  const exact = candidates.find((c) => c.path === oldPath);
  if (exact) return { candidate: exact, score: 1 };

  // 2) Best token overlap.
  let best: PageCandidate | null = null;
  let bestScore = 0;
  for (const c of candidates) {
    const s = jaccard(oldTokens, c.tokens);
    if (s > bestScore) {
      bestScore = s;
      best = c;
    }
  }
  return { candidate: best, score: bestScore };
}

export interface MappingOptions {
  /** Base URL for the NEW site (used to build absolute newUrl). */
  newSiteBaseUrl?: string | null;
}

function toAbsolute(base: string | null | undefined, path: string): string | null {
  if (!path) return null;
  if (!base) return path;
  try {
    return new URL(path, base.startsWith('ht') ? base : `https://${base}`).toString();
  } catch {
    return path;
  }
}

/**
 * Produce a preservation mapping for a single old URL against the proposed
 * sitemap. Deterministic + pure.
 */
export function mapOldUrl(
  url: BacklinkUrlRecord,
  candidates: PageCandidate[],
  opts: MappingOptions = {},
): PreservationMapping {
  const oldPath = url.normalizedTargetPath || normalizePath(url.targetUrl);
  const oldTokens = tokenSet(oldPath);
  for (const t of pathTokens(oldPath)) oldTokens.add(t);
  if (url.anchorText) for (const t of tokenSet(url.anchorText)) oldTokens.add(t);

  const priorityInputs: PriorityInputs = {
    normalizedTargetPath: oldPath,
    referringDomainCount: url.referringDomain ? 1 : null,
    backlinkCount: url.backlinkCount ?? null,
    authorityScore: url.authorityScore ?? null,
    referringDomain: url.referringDomain,
    isHomepage: oldPath === '/',
  };
  const priority: BacklinkPriority = url.priority || classifyPriority(priorityInputs);
  const backlinkCount = url.backlinkCount ?? 0;

  const { candidate, score } = findBestMatch(oldPath, oldTokens, candidates);
  const matchedPath = candidate?.path || null;
  const newUrl = matchedPath ? toAbsolute(opts.newSiteBaseUrl, matchedPath) : null;

  let action: PreservationAction;
  let status: PreservationStatus = 'proposed';
  let reason = '';

  const highValue = isHighValue(priority);
  const lowValue = priority === 'low';

  if (matchedPath && matchedPath === oldPath) {
    // The EXACT same path exists in the new sitemap — preserve it in place.
    action = 'preserve_same_url';
    reason = `Exact path preserved in the new sitemap (${matchedPath}).`;
  } else if (score >= STRONG_MATCH && matchedPath) {
    action = 'redirect_301';
    reason = `Closest topical match is ${matchedPath} (match ${(score * 100).toFixed(0)}%). 301 preserves link equity.`;
  } else if (score >= WEAK_MATCH && matchedPath && !highValue) {
    action = 'redirect_301';
    reason = `Weak topical match to ${matchedPath} (${(score * 100).toFixed(0)}%); low/medium value URL 301-redirected.`;
  } else if (score >= WEAK_MATCH && matchedPath && highValue) {
    action = 'needs_review';
    status = 'needs_review';
    reason = `Weak intent match (${(score * 100).toFixed(0)}%) for a high-value URL. Confirm ${matchedPath} covers the same topic before redirecting.`;
  } else if (lowValue) {
    action = 'ignore_no_value';
    reason =
      backlinkCount > 0
        ? `Low-value URL with ${backlinkCount} backlink(s) and no equivalent new page; ignored (review before discarding).`
        : 'Low-value / trash URL with no equivalent new page; ignored.';
    if (backlinkCount > 0) status = 'needs_review';
  } else {
    // High/medium value but nothing matched → keep the page (rebuild) or review.
    if (highValue) {
      action = 'needs_review';
      status = 'needs_review';
      reason = 'High-value URL has no matching page in the new sitemap. Rebuild an equivalent page or add a 301 target.';
    } else {
      action = 'rebuild_page';
      reason = 'Unique URL with some value and no equivalent; recommend rebuilding an equivalent page to keep the equity.';
    }
  }

  return {
    oldUrl: url.targetUrl || oldPath,
    oldPath,
    newUrl,
    newPath: matchedPath,
    action,
    confidence: Number(score.toFixed(3)),
    reason,
    contentIntent: candidate ? `${candidate.page.pageType}:${candidate.page.serviceName || candidate.page.title || matchedPath}` : null,
    matchedPageType: candidate?.page.pageType || null,
    matchedServiceName: candidate?.page.serviceName || null,
    status,
    priority,
    backlinkCount,
  };
}

/** Map an entire inventory against the proposed sitemap. */
export function mapInventory(
  urls: BacklinkUrlRecord[],
  sitemap: WebsiteSitemapArtifact,
  opts: MappingOptions = {},
): PreservationMapping[] {
  const candidates = buildPageCandidates(sitemap);
  return urls.map((u) => mapOldUrl(u, candidates, opts));
}

/**
 * Content-intent similarity between an old page snapshot and the new page copy.
 * Returns a 0..1 score plus a short human summary. Used to flag preserved URLs
 * whose new content drifts from the original topic.
 */
export function contentIntentSimilarity(args: {
  oldTitle?: string | null;
  oldH1?: string | null;
  oldSummary?: string | null;
  newH1?: string | null;
  newSummary?: string | null;
}): { score: number; summary: string; weak: boolean } {
  const oldSet = tokenSet(args.oldTitle, args.oldH1, args.oldSummary);
  const newSet = tokenSet(args.newH1, args.newSummary);
  const score = Number(jaccard(oldSet, newSet).toFixed(3));
  const weak = score < WEAK_MATCH;
  const summary = weak
    ? `Content intent drift: only ${(score * 100).toFixed(0)}% topical overlap between the old and new page.`
    : `Content intent preserved (${(score * 100).toFixed(0)}% topical overlap).`;
  return { score, summary, weak };
}

export { jaccard, tokenSet };
