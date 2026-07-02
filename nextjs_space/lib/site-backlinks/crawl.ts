/**
 * Milestone 10 — existing-site crawl (customer's OWN live site only).
 *
 * HARD RULE: this NEVER queries Google or any search engine. It fetches only
 * the customer's own live domain — sitemap.xml, robots.txt, and the homepage's
 * internal links — to discover which URLs currently exist (a floor for the
 * inventory when no backlink provider is configured).
 *
 * Network access is isolated here + guarded by a short timeout. All parsing is
 * pure string work. No secrets, tokens, or signed URLs are ever emitted.
 */

import { normalizeUrl, normalizePath } from '@/lib/site-backlinks/url-normalize';
import type { BacklinkUrlRecord } from '@/lib/site-backlinks/types';

const CRAWL_TIMEOUT = 8000;
const MAX_URLS = 300;

async function fetchWithTimeout(url: string, ms = CRAWL_TIMEOUT): Promise<Response | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'User-Agent': 'LaunchOS-Backlink-Inventory/1.0' },
      cache: 'no-store',
    });
    return res;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Extract <loc> entries from a sitemap.xml body (also handles sitemap index). */
export function parseSitemapXml(xml: string): string[] {
  const out: string[] = [];
  const re = /<loc>\s*([^<\s]+)\s*<\/loc>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    out.push(m[1].trim());
    if (out.length >= MAX_URLS * 2) break;
  }
  return out;
}

/** Extract same-host href paths from an HTML body. */
export function parseInternalLinks(html: string, host: string): string[] {
  const out: string[] = [];
  const re = /href\s*=\s*["']([^"'#]+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const href = m[1].trim();
    if (!href || href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('javascript:')) continue;
    const n = normalizeUrl(href);
    // Keep relative links, or absolute links to the same host.
    if (n.host && host && n.host !== host && n.host !== `www.${host}` && `www.${n.host}` !== host) continue;
    out.push(n.path);
    if (out.length >= MAX_URLS) break;
  }
  return out;
}

/** Extract Sitemap: directives from robots.txt. */
export function parseRobotsSitemaps(robots: string): string[] {
  const out: string[] = [];
  for (const line of (robots || '').split(/\r?\n/)) {
    const m = /^\s*sitemap:\s*(\S+)/i.exec(line);
    if (m) out.push(m[1].trim());
  }
  return out;
}

export interface CrawlResult {
  liveDomain: string | null;
  crawledAt: string;
  urls: BacklinkUrlRecord[];
  warnings: string[];
  reachable: boolean;
}

/**
 * Crawl the customer's own live site to discover existing URLs. Returns a
 * best-effort URL list; when the site is unreachable it returns an empty list
 * with a warning (never throws).
 */
export async function crawlExistingSite(liveUrl: string): Promise<CrawlResult> {
  const warnings: string[] = [];
  const crawledAt = new Date().toISOString();
  const base = (liveUrl || '').trim();
  if (!base) {
    return { liveDomain: null, crawledAt, urls: [], warnings: ['No live site URL configured.'], reachable: false };
  }
  let origin: string;
  let host: string;
  try {
    const u = new URL(base.startsWith('ht') ? base : `https://${base}`);
    origin = u.origin;
    host = u.hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return { liveDomain: null, crawledAt, urls: [], warnings: [`Invalid live site URL: ${base}`], reachable: false };
  }

  const found = new Map<string, BacklinkUrlRecord>();
  const addPath = (path: string) => {
    const norm = normalizePath(path);
    if (found.has(norm)) return;
    if (found.size >= MAX_URLS) return;
    found.set(norm, {
      sourceUrl: origin + norm,
      targetUrl: origin + norm,
      normalizedTargetPath: norm,
      referringDomain: null,
      status: 'active',
    });
  };

  // 1) robots.txt -> discover sitemap locations.
  const sitemapUrls: string[] = [`${origin}/sitemap.xml`];
  const robotsRes = await fetchWithTimeout(`${origin}/robots.txt`, 5000);
  let reachable = Boolean(robotsRes);
  if (robotsRes?.ok) {
    const robots = await robotsRes.text().catch(() => '');
    for (const s of parseRobotsSitemaps(robots)) sitemapUrls.push(s);
  }

  // 2) sitemap.xml (+ any declared sitemaps; one level of index expansion).
  const seenSitemaps = new Set<string>();
  const queue = [...new Set(sitemapUrls)];
  let expansions = 0;
  while (queue.length && expansions < 6 && found.size < MAX_URLS) {
    const sm = queue.shift()!;
    if (seenSitemaps.has(sm)) continue;
    seenSitemaps.add(sm);
    expansions += 1;
    const res = await fetchWithTimeout(sm, 6000);
    if (res) reachable = true;
    if (!res?.ok) continue;
    const xml = await res.text().catch(() => '');
    const locs = parseSitemapXml(xml);
    for (const loc of locs) {
      const n = normalizeUrl(loc);
      if (n.host && n.host.replace(/^www\./, '') !== host) continue;
      if (/sitemap.*\.xml$/i.test(loc) && !seenSitemaps.has(loc)) {
        queue.push(loc);
      } else {
        addPath(n.path);
      }
    }
  }

  // 3) Homepage internal links (fills gaps when no sitemap exists).
  const homeRes = await fetchWithTimeout(origin, 8000);
  if (homeRes) reachable = true;
  if (homeRes?.ok) {
    addPath('/');
    const html = await homeRes.text().catch(() => '');
    for (const p of parseInternalLinks(html, host)) addPath(p);
  }

  if (!reachable) warnings.push(`Could not reach the live site at ${origin}.`);
  if (found.size === 0 && reachable) warnings.push('Live site reachable but no URLs were discovered from sitemap or homepage links.');

  return {
    liveDomain: host,
    crawledAt,
    urls: [...found.values()],
    warnings,
    reachable,
  };
}
