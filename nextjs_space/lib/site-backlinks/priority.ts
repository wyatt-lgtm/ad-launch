/**
 * Milestone 10 — backlink priority classifier (pure).
 *
 * Classifies each inventoried URL as critical | high | medium | low based on
 * referring-domain volume, authority, commercial intent, and known trash
 * signals. Never discards silently — low-value URLs are still returned (the
 * caller marks them ignore_no_value WITH a reason).
 */

import type { BacklinkPriority, BacklinkUrlRecord } from '@/lib/site-backlinks/types';
import { pathTokens } from '@/lib/site-backlinks/url-normalize';

/** Tokens that strongly signal commercial-intent service pages. */
const COMMERCIAL_TOKENS = new Set([
  'repair', 'service', 'services', 'install', 'installation', 'replacement', 'replace',
  'maintenance', 'brake', 'brakes', 'oil', 'transmission', 'tire', 'tires', 'ac', 'hvac',
  'plumbing', 'plumber', 'electrical', 'electrician', 'roofing', 'roof', 'dental', 'dentist',
  'legal', 'lawyer', 'attorney', 'clean', 'cleaning', 'pest', 'landscaping', 'towing',
  'inspection', 'diagnostic', 'tuneup', 'alignment', 'detailing', 'emergency', 'quote',
]);

/** Tokens/patterns that signal thin, obsolete, or trash URLs. */
const TRASH_TOKENS = new Set([
  'coupon', 'coupons', 'promo', 'promotion', 'deal', 'deals', 'sale', 'blackfriday',
  'cyber', 'test', 'tmp', 'temp', 'old', 'draft', 'wp-admin', 'wp-login', 'cart', 'checkout',
  'tag', 'tags', 'author', 'feed', 'attachment', 'trackback', 'lostpassword', 'login',
  'sitemap', 'search', 'thankyou', 'thanks', '404',
]);

/** Spammy referring-domain fragments (best-effort). */
const SPAMMY_DOMAIN_FRAGMENTS = ['xyz-seo', 'link-farm', 'buy-links', 'spam', '.ru', '.tk', '.cn'];

export interface PriorityInputs {
  normalizedTargetPath: string;
  referringDomainCount?: number | null;
  backlinkCount?: number | null;
  authorityScore?: number | null;
  referringDomain?: string | null;
  isHomepage?: boolean;
  knownRankingValue?: boolean;
  knownTraffic?: boolean;
}

function isSpammyDomain(domain?: string | null): boolean {
  if (!domain) return false;
  const d = domain.toLowerCase();
  return SPAMMY_DOMAIN_FRAGMENTS.some((f) => d.includes(f));
}

function hasCommercialIntent(path: string): boolean {
  return pathTokens(path).some((t) => COMMERCIAL_TOKENS.has(t));
}

function isTrashPath(path: string): boolean {
  const p = (path || '').toLowerCase();
  if (p === '/') return false;
  if (/\.(png|jpg|jpeg|gif|pdf|zip|css|js|xml)$/.test(p)) return true;
  const toks = pathTokens(path);
  if (toks.length === 0) return false;
  return toks.some((t) => TRASH_TOKENS.has(t));
}

/** Classify a single URL's backlink priority. */
export function classifyPriority(inp: PriorityInputs): BacklinkPriority {
  const path = inp.normalizedTargetPath || '/';
  const refDomains = inp.referringDomainCount ?? 0;
  const backlinks = inp.backlinkCount ?? 0;
  const authority = inp.authorityScore ?? 0;
  const spammy = isSpammyDomain(inp.referringDomain);
  const trash = isTrashPath(path);
  const commercial = hasCommercialIntent(path) || Boolean(inp.isHomepage);

  // Homepage / major category with any equity is always critical.
  if (inp.isHomepage && (refDomains > 0 || backlinks > 0 || inp.knownRankingValue)) {
    return 'critical';
  }

  // Strong external signals -> high/critical (unless obviously trash/spam).
  const strongSignals =
    refDomains >= 5 || authority >= 40 || inp.knownTraffic === true || inp.knownRankingValue === true;
  const someSignals = refDomains >= 2 || backlinks >= 3 || authority >= 20;

  if (trash && !strongSignals) return 'low';
  if (spammy && !strongSignals) return 'low';

  if (strongSignals && commercial) return 'critical';
  if (strongSignals) return 'high';
  if (someSignals && commercial) return 'high';
  if (someSignals) return 'medium';
  if (commercial && (refDomains > 0 || backlinks > 0)) return 'medium';

  // Discovered by crawl only (no external counts) but a real service page.
  if (commercial) return 'medium';
  return 'low';
}

/** Priority rank for comparisons / sorting (higher = more important). */
export function priorityRank(p: BacklinkPriority): number {
  switch (p) {
    case 'critical':
      return 4;
    case 'high':
      return 3;
    case 'medium':
      return 2;
    default:
      return 1;
  }
}

/** True when a priority is considered “high-value” for readiness gating. */
export function isHighValue(p: BacklinkPriority): boolean {
  return p === 'critical' || p === 'high';
}

/** Attach a computed priority to a URL record (returns a new record). */
export function withPriority(u: BacklinkUrlRecord): BacklinkUrlRecord {
  const priority = classifyPriority({
    normalizedTargetPath: u.normalizedTargetPath,
    referringDomainCount: u.referringDomain ? 1 : null,
    backlinkCount: u.backlinkCount ?? null,
    authorityScore: u.authorityScore ?? null,
    referringDomain: u.referringDomain,
    isHomepage: u.normalizedTargetPath === '/',
  });
  return { ...u, priority };
}
