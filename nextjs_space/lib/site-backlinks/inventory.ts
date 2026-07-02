/**
 * Milestone 10 — backlink inventory builder (pure aggregation).
 *
 * Combines URL records from the supported data sources (priority order):
 *   1. Google Search Console (top linked pages)      [provider, if configured]
 *   2. approved backlink provider / SEO provider      [provider, if configured]
 *   3. existing Search Intelligence / SEO research     [seo_research]
 *   4. current-site crawl (sitemap/robots/links)       [site_crawl]  (always)
 *   5. user-uploaded backlink export                   [uploaded_file]
 *   6. manual URL list                                 [manual]
 *
 * When NO external backlink provider is available, inventory status is
 * `incomplete_provider_missing` with an explicit warning — we still inventory
 * the current-site URLs. We NEVER fabricate backlink counts.
 */

import { normalizePath, normalizeUrl } from '@/lib/site-backlinks/url-normalize';
import { withPriority } from '@/lib/site-backlinks/priority';
import { isHighValue } from '@/lib/site-backlinks/priority';
import type {
  BacklinkInventory,
  BacklinkSource,
  BacklinkUrlRecord,
  InventoryStatus,
} from '@/lib/site-backlinks/types';

export interface InventorySourceInput {
  source: BacklinkSource;
  urls: BacklinkUrlRecord[];
}

export interface BuildInventoryArgs {
  liveDomain: string | null;
  crawledAt: string | null;
  providerCheckedAt?: string | null;
  sources: InventorySourceInput[];
  /** True when at least one EXTERNAL backlink provider contributed data. */
  providerAvailable: boolean;
  extraWarnings?: string[];
  reachable?: boolean;
}

const PROVIDER_SOURCES: BacklinkSource[] = ['gsc', 'provider', 'seo_research'];

/** De-duplicate + merge URL records by normalized path (keep richest record). */
function mergeUrls(all: BacklinkUrlRecord[]): BacklinkUrlRecord[] {
  const byPath = new Map<string, BacklinkUrlRecord>();
  for (const u of all) {
    const norm = u.normalizedTargetPath || normalizePath(u.targetUrl);
    const rec: BacklinkUrlRecord = { ...u, normalizedTargetPath: norm };
    const cur = byPath.get(norm);
    if (!cur) {
      byPath.set(norm, rec);
      continue;
    }
    // Merge: prefer non-null external signals + higher counts.
    byPath.set(norm, {
      ...cur,
      referringDomain: cur.referringDomain || rec.referringDomain || null,
      anchorText: cur.anchorText || rec.anchorText || null,
      linkType: cur.linkType || rec.linkType || null,
      authorityScore: Math.max(cur.authorityScore ?? 0, rec.authorityScore ?? 0) || null,
      backlinkCount: Math.max(cur.backlinkCount ?? 0, rec.backlinkCount ?? 0) || null,
      firstSeenAt: cur.firstSeenAt || rec.firstSeenAt || null,
      lastSeenAt: cur.lastSeenAt || rec.lastSeenAt || null,
      status: cur.status === 'active' || rec.status === 'active' ? 'active' : cur.status,
    });
  }
  return [...byPath.values()];
}

export function buildInventory(args: BuildInventoryArgs): BacklinkInventory {
  const warnings: string[] = [...(args.extraWarnings || [])];
  const providerContributed =
    args.providerAvailable &&
    args.sources.some((s) => PROVIDER_SOURCES.includes(s.source) && s.urls.length > 0);

  const allUrls = mergeUrls(args.sources.flatMap((s) => s.urls)).map(withPriority);
  const highValueUrlCount = allUrls.filter((u) => u.priority && isHighValue(u.priority)).length;

  let status: InventoryStatus;
  if (args.reachable === false && allUrls.length === 0) {
    status = 'failed';
    warnings.push('Existing site could not be reached and no other backlink source was available.');
  } else if (!providerContributed) {
    status = 'incomplete_provider_missing';
    warnings.push(
      'Backlink provider not configured. Current-site URLs were inventoried, but external backlink coverage may be incomplete.',
    );
  } else {
    status = 'complete';
  }

  // Determine the dominant source label for the snapshot.
  const source: BacklinkSource =
    args.sources.find((s) => PROVIDER_SOURCES.includes(s.source) && s.urls.length > 0)?.source ||
    args.sources.find((s) => s.urls.length > 0)?.source ||
    'site_crawl';

  return {
    source,
    status,
    liveDomain: args.liveDomain,
    crawledAt: args.crawledAt,
    providerCheckedAt: args.providerCheckedAt || null,
    totalBacklinkUrls: allUrls.length,
    highValueUrlCount,
    urls: allUrls,
    warnings,
    providerMissing: !providerContributed,
  };
}

/**
 * Parse an uploaded backlink export into URL records. Supports:
 *   - CSV with a header row (columns matched case-insensitively:
 *     url/target/target_url, referring_domain/domain, anchor/anchor_text,
 *     backlinks/backlink_count, authority/domain_authority/authority_score,
 *     first_seen, last_seen, link_type)
 *   - a plain newline-separated list of URLs
 * Never fabricates counts — absent columns stay null.
 */
export function parseUploadedBacklinks(content: string): { urls: BacklinkUrlRecord[]; warnings: string[] } {
  const warnings: string[] = [];
  const text = (content || '').trim();
  if (!text) return { urls: [], warnings: ['Uploaded file was empty.'] };

  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { urls: [], warnings: ['Uploaded file had no rows.'] };

  // Detect CSV vs plain list.
  const first = lines[0];
  const looksCsv = first.includes(',') && /url|target|domain|anchor|backlink/i.test(first);

  const urls: BacklinkUrlRecord[] = [];

  if (looksCsv) {
    const header = splitCsvLine(first).map((h) => h.trim().toLowerCase());
    const idx = (names: string[]) => header.findIndex((h) => names.includes(h));
    const urlI = idx(['url', 'target', 'target_url', 'page', 'landing_page', 'target url']);
    const domI = idx(['referring_domain', 'domain', 'source', 'referring domain']);
    const anchorI = idx(['anchor', 'anchor_text', 'anchor text']);
    const blI = idx(['backlinks', 'backlink_count', 'links']);
    const authI = idx(['authority', 'domain_authority', 'authority_score', 'dr', 'da']);
    const typeI = idx(['link_type', 'type', 'nofollow']);
    const firstSeenI = idx(['first_seen', 'first seen', 'firstseen']);
    const lastSeenI = idx(['last_seen', 'last seen', 'lastseen']);

    if (urlI === -1) {
      warnings.push('CSV had no recognizable URL column; treated remaining lines as plain URLs.');
    }

    for (let i = 1; i < lines.length; i++) {
      const cols = splitCsvLine(lines[i]);
      const rawUrl = (urlI >= 0 ? cols[urlI] : cols[0] || '').trim();
      if (!rawUrl) continue;
      const norm = normalizeUrl(rawUrl);
      urls.push({
        sourceUrl: rawUrl,
        targetUrl: rawUrl,
        normalizedTargetPath: norm.path,
        referringDomain: domI >= 0 ? (cols[domI] || '').trim() || null : null,
        anchorText: anchorI >= 0 ? (cols[anchorI] || '').trim() || null : null,
        linkType: typeI >= 0 ? (cols[typeI] || '').trim() || null : null,
        backlinkCount: blI >= 0 ? toInt(cols[blI]) : null,
        authorityScore: authI >= 0 ? toInt(cols[authI]) : null,
        firstSeenAt: firstSeenI >= 0 ? (cols[firstSeenI] || '').trim() || null : null,
        lastSeenAt: lastSeenI >= 0 ? (cols[lastSeenI] || '').trim() || null : null,
        status: 'unknown',
      });
    }
  } else {
    for (const line of lines) {
      const rawUrl = line.trim();
      if (!/^https?:|^\//i.test(rawUrl) && !rawUrl.includes('.')) continue;
      const norm = normalizeUrl(rawUrl);
      urls.push({
        sourceUrl: rawUrl,
        targetUrl: rawUrl,
        normalizedTargetPath: norm.path,
        referringDomain: null,
        status: 'unknown',
      });
    }
  }

  if (urls.length === 0) warnings.push('No URLs could be parsed from the uploaded file.');
  return { urls, warnings };
}

function toInt(v: string | undefined): number | null {
  if (v == null) return null;
  const n = parseInt(String(v).replace(/[^0-9-]/g, ''), 10);
  return Number.isFinite(n) ? n : null;
}

/** Minimal CSV line splitter (handles simple quoted fields). */
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

/** Build URL records from a manual list of paths/URLs. */
export function urlsFromManualList(list: string[]): BacklinkUrlRecord[] {
  const out: BacklinkUrlRecord[] = [];
  for (const raw of list || []) {
    const s = (raw || '').trim();
    if (!s) continue;
    const norm = normalizeUrl(s);
    out.push({
      sourceUrl: s,
      targetUrl: s,
      normalizedTargetPath: norm.path,
      referringDomain: null,
      status: 'unknown',
    });
  }
  return out;
}
