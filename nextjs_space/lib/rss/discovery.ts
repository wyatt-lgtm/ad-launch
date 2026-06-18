// @ts-nocheck
/**
 * Phase 3: RSS Feed Discovery Engine
 *
 * Three discovery strategies:
 *   1. HTML <link rel="alternate"> extraction from known source homepages
 *   2. Common RSS path probing (/feed, /rss, /atom.xml, etc.)
 *   3. URL pattern matching for known feed URL conventions
 *
 * Google Search API is intentionally omitted (requires API key + quota).
 * Instead we rely on curated seed URLs + path probing.
 */
import * as cheerio from 'cheerio';
import { XMLParser } from 'fast-xml-parser';

// ── Types ──────────────────────────────────────────────────────────────────
export interface DiscoveredFeed {
  url: string;
  title: string | null;
  siteUrl: string;        // homepage we discovered it from
  discoveryMethod: 'html_link' | 'path_probe' | 'curated' | 'sitemap';
  feedFormat: 'rss2' | 'atom' | 'rss1' | 'unknown';
  language: string | null;
  description: string | null;
}

// ── Common RSS paths to probe ──────────────────────────────────────────────
const PROBE_PATHS = [
  '/feed',
  '/rss',
  '/feed/rss',
  '/rss.xml',
  '/atom.xml',
  '/feed.xml',
  '/index.xml',
  '/feeds/posts/default',        // Blogger
  '/feed/atom',
  '/?feed=rss2',                  // WordPress
  '/wp-feed.php',
  '/blog/feed',
  '/news/feed',
  '/blog/rss',
  '/news/rss',
  '/rss/headlines',
  '/rss/news',
];

const USER_AGENT = 'AdLaunch-FeedDiscovery/1.0 (+https://connect.launchmarketing.com)';
const FETCH_TIMEOUT = 8000;

// ── Helpers ────────────────────────────────────────────────────────────────
async function safeFetch(url: string, opts?: { timeout?: number }): Promise<{ ok: boolean; status: number; text: string; finalUrl: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts?.timeout ?? FETCH_TIMEOUT);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml, text/html, */*' },
      redirect: 'follow',
    });
    const text = await res.text();
    return { ok: res.ok, status: res.status, text, finalUrl: res.url || url };
  } catch {
    return { ok: false, status: 0, text: '', finalUrl: url };
  } finally {
    clearTimeout(timer);
  }
}

function isXmlFeed(text: string): boolean {
  const trimmed = text.trim().slice(0, 500).toLowerCase();
  return (
    trimmed.includes('<rss') ||
    trimmed.includes('<feed') ||
    trimmed.includes('<rdf:rdf') ||
    trimmed.includes('<?xml') && (trimmed.includes('<channel') || trimmed.includes('<entry'))
  );
}

function detectFeedFormat(text: string): 'rss2' | 'atom' | 'rss1' | 'unknown' {
  const t = text.trim().slice(0, 1000).toLowerCase();
  if (t.includes('<rss')) return 'rss2';
  if (t.includes('<feed') && t.includes('xmlns="http://www.w3.org/2005/atom"')) return 'atom';
  if (t.includes('<feed')) return 'atom';
  if (t.includes('<rdf:rdf')) return 'rss1';
  return 'unknown';
}

function extractFeedMeta(xmlText: string): { title: string | null; description: string | null; language: string | null } {
  try {
    const parser = new XMLParser({ ignoreAttributes: false, trimValues: true });
    const parsed = parser.parse(xmlText);
    // RSS 2.0
    const channel = parsed?.rss?.channel;
    if (channel) {
      return {
        title: channel.title || null,
        description: channel.description || null,
        language: channel.language || null,
      };
    }
    // Atom
    const feed = parsed?.feed;
    if (feed) {
      return {
        title: typeof feed.title === 'string' ? feed.title : feed.title?.['#text'] || null,
        description: feed.subtitle || null,
        language: feed['@_xml:lang'] || null,
      };
    }
  } catch { /* parse error — skip */ }
  return { title: null, description: null, language: null };
}

/** Normalize a feed URL (strip tracking params, lowercase host) */
export function canonicalizeFeedUrl(url: string): string {
  try {
    const u = new URL(url);
    // Remove common tracking params
    ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'fbclid', 'gclid'].forEach(p => u.searchParams.delete(p));
    u.hostname = u.hostname.toLowerCase();
    // Remove trailing slash for consistency
    let path = u.pathname.replace(/\/+$/, '') || '/';
    return `${u.protocol}//${u.hostname}${path}${u.search}`;
  } catch {
    return url;
  }
}

// ── Strategy 1: HTML <link> extraction ────────────────────────────────────
export async function discoverFromHtml(siteUrl: string): Promise<DiscoveredFeed[]> {
  const result = await safeFetch(siteUrl);
  if (!result.ok) return [];

  const feeds: DiscoveredFeed[] = [];
  const $ = cheerio.load(result.text);

  // Look for <link rel="alternate" type="application/rss+xml">
  $('link[rel="alternate"]').each((_, el) => {
    const type = $(el).attr('type') || '';
    if (!type.includes('rss') && !type.includes('atom') && !type.includes('xml')) return;
    const href = $(el).attr('href');
    if (!href) return;

    let feedUrl: string;
    try {
      feedUrl = new URL(href, siteUrl).toString();
    } catch { return; }

    feeds.push({
      url: canonicalizeFeedUrl(feedUrl),
      title: $(el).attr('title') || null,
      siteUrl,
      discoveryMethod: 'html_link',
      feedFormat: type.includes('atom') ? 'atom' : 'rss2',
      language: null,
      description: null,
    });
  });

  return feeds;
}

// ── Strategy 2: Common path probing ───────────────────────────────────────
export async function discoverFromPathProbe(siteUrl: string): Promise<DiscoveredFeed[]> {
  const base = siteUrl.replace(/\/+$/, '');
  const feeds: DiscoveredFeed[] = [];

  // Probe in parallel batches of 4 to avoid hammering
  const BATCH = 4;
  for (let i = 0; i < PROBE_PATHS.length; i += BATCH) {
    const batch = PROBE_PATHS.slice(i, i + BATCH);
    const results = await Promise.allSettled(
      batch.map(async (p) => {
        const url = `${base}${p}`;
        const res = await safeFetch(url, { timeout: 6000 });
        if (!res.ok || !isXmlFeed(res.text)) return null;
        const meta = extractFeedMeta(res.text);
        return {
          url: canonicalizeFeedUrl(res.finalUrl),
          title: meta.title,
          siteUrl,
          discoveryMethod: 'path_probe' as const,
          feedFormat: detectFeedFormat(res.text),
          language: meta.language,
          description: meta.description,
        };
      })
    );
    for (const r of results) {
      if (r.status === 'fulfilled' && r.value) feeds.push(r.value);
    }
  }

  return feeds;
}

// ── Combined discovery for a single site ──────────────────────────────────
export async function discoverFeedsFromSite(siteUrl: string): Promise<DiscoveredFeed[]> {
  const [htmlFeeds, probeFeeds] = await Promise.all([
    discoverFromHtml(siteUrl),
    discoverFromPathProbe(siteUrl),
  ]);

  // Deduplicate by canonical URL
  const seen = new Set<string>();
  const all: DiscoveredFeed[] = [];
  // Prefer HTML-discovered (more reliable) over probe
  for (const f of [...htmlFeeds, ...probeFeeds]) {
    const canonical = canonicalizeFeedUrl(f.url);
    if (seen.has(canonical)) continue;
    seen.add(canonical);
    all.push({ ...f, url: canonical });
  }

  return all;
}

// ── Batch discovery across many sites ─────────────────────────────────────
export async function discoverFeedsFromSites(
  siteUrls: string[],
  concurrency: number = 3,
  onProgress?: (completed: number, total: number, site: string) => void
): Promise<DiscoveredFeed[]> {
  const allFeeds: DiscoveredFeed[] = [];
  let completed = 0;

  for (let i = 0; i < siteUrls.length; i += concurrency) {
    const batch = siteUrls.slice(i, i + concurrency);
    const results = await Promise.allSettled(
      batch.map(url => discoverFeedsFromSite(url))
    );
    for (const r of results) {
      if (r.status === 'fulfilled') allFeeds.push(...r.value);
    }
    completed += batch.length;
    if (onProgress) onProgress(completed, siteUrls.length, batch[0]);
  }

  // Global dedup
  const seen = new Set<string>();
  return allFeeds.filter(f => {
    const c = canonicalizeFeedUrl(f.url);
    if (seen.has(c)) return false;
    seen.add(c);
    return true;
  });
}
