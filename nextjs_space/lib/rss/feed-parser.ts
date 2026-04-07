/**
 * Phase 4: RSS Feed Parser
 *
 * Universal parser for RSS 2.0, RSS 1.0 (RDF), and Atom feeds.
 * Uses fast-xml-parser for zero-dependency XML → JS conversion,
 * then normalizes into a common RssItemRaw shape.
 *
 * Design:
 *   - Tolerant of malformed XML (lenient mode)
 *   - Extracts enclosure/media images
 *   - Extracts categories/tags
 *   - Handles CDATA, namespaced elements, relative URLs
 */

import { XMLParser } from 'fast-xml-parser';

// ═══════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════

export interface ParsedFeedMeta {
  title: string | null;
  description: string | null;
  siteUrl: string | null;
  language: string | null;
  generator: string | null;
  lastBuildDate: Date | null;
  format: 'rss2' | 'atom' | 'rss1' | 'unknown';
}

export interface ParsedItem {
  guid: string;
  title: string | null;
  description: string | null;
  link: string | null;
  pubDate: Date | null;
  author: string | null;
  imageUrl: string | null;
  categories: string[];
}

export interface ParsedFeed {
  meta: ParsedFeedMeta;
  items: ParsedItem[];
}

// ═══════════════════════════════════════════════════════════════
// Fetch + Parse
// ═══════════════════════════════════════════════════════════════

const FETCH_TIMEOUT_MS = 15_000;
const MAX_BODY_BYTES = 5 * 1024 * 1024; // 5 MB cap

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  isArray: (name) => ['item', 'entry', 'category', 'link'].includes(name),
  trimValues: true,
  parseTagValue: false,       // keep values as strings
  processEntities: true,
  htmlEntities: true,
});

/**
 * Fetch an RSS/Atom feed URL and parse its contents.
 * Returns null on network/parse failure (never throws).
 */
export async function fetchAndParseFeed(url: string): Promise<{ feed: ParsedFeed | null; error: string | null; httpStatus: number | null; redirectUrl: string | null }> {
  let httpStatus: number | null = null;
  let redirectUrl: string | null = null;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'AdLaunch-RSSBot/1.0 (+https://adlaunch.ai)',
        'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*',
      },
      redirect: 'follow',
    });
    clearTimeout(timer);

    httpStatus = res.status;
    if (res.url !== url) redirectUrl = res.url;

    if (!res.ok) {
      return { feed: null, error: `HTTP ${res.status}`, httpStatus, redirectUrl };
    }

    const contentType = res.headers.get('content-type') ?? '';
    // Accept XML or text responses
    if (!contentType.match(/xml|text|rss|atom|html/i) && !contentType.includes('octet-stream')) {
      return { feed: null, error: `Unexpected content-type: ${contentType}`, httpStatus, redirectUrl };
    }

    const body = await res.text();
    if (body.length > MAX_BODY_BYTES) {
      return { feed: null, error: `Response too large: ${body.length} bytes`, httpStatus, redirectUrl };
    }

    const feed = parseXml(body, url);
    if (!feed) {
      return { feed: null, error: 'XML parse failed or unrecognized format', httpStatus, redirectUrl };
    }

    return { feed, error: null, httpStatus, redirectUrl };
  } catch (err: any) {
    const msg = err?.name === 'AbortError' ? 'Timeout' : (err?.message ?? 'Unknown fetch error');
    return { feed: null, error: msg, httpStatus, redirectUrl };
  }
}

// ═══════════════════════════════════════════════════════════════
// XML Parsing (internal)
// ═══════════════════════════════════════════════════════════════

function parseXml(xml: string, feedUrl: string): ParsedFeed | null {
  try {
    const doc = parser.parse(xml);
    if (!doc || typeof doc !== 'object') return null;

    // Detect format
    if (doc.rss?.channel) return parseRss2(doc.rss.channel, feedUrl);
    if (doc.feed) return parseAtom(doc.feed, feedUrl);
    if (doc['rdf:RDF'] || doc['RDF']) {
      const rdf = doc['rdf:RDF'] ?? doc['RDF'];
      return parseRss1(rdf, feedUrl);
    }
    // Some feeds wrap in <?xml?> and have <channel> at root level
    if (doc.channel) return parseRss2(doc.channel, feedUrl);

    return null;
  } catch {
    return null;
  }
}

// ── RSS 2.0 ───────────────────────────────────────────────────

function parseRss2(channel: any, feedUrl: string): ParsedFeed {
  const items = ensureArray(channel.item).map((item: any): ParsedItem => ({
    guid: extractGuid(item) || extractText(item.link) || feedUrl + '#' + extractText(item.title),
    title: stripHtml(extractText(item.title)),
    description: stripHtml(extractText(item.description) ?? extractText(item['content:encoded'])),
    link: extractText(item.link),
    pubDate: parseDate(extractText(item.pubDate) ?? extractText(item['dc:date'])),
    author: extractText(item.author) ?? extractText(item['dc:creator']),
    imageUrl: extractImage(item),
    categories: extractCategories(item),
  }));

  return {
    meta: {
      title: extractText(channel.title),
      description: stripHtml(extractText(channel.description)),
      siteUrl: extractText(channel.link),
      language: extractText(channel.language) ?? extractText(channel['dc:language']),
      generator: extractText(channel.generator),
      lastBuildDate: parseDate(extractText(channel.lastBuildDate)),
      format: 'rss2',
    },
    items,
  };
}

// ── Atom ──────────────────────────────────────────────────────

function parseAtom(feed: any, feedUrl: string): ParsedFeed {
  const items = ensureArray(feed.entry).map((entry: any): ParsedItem => {
    const link = extractAtomLink(entry.link, 'alternate') ?? extractAtomLink(entry.link);
    return {
      guid: extractText(entry.id) || link || feedUrl + '#' + extractText(entry.title),
      title: stripHtml(extractText(entry.title)),
      description: stripHtml(extractText(entry.summary) ?? extractText(entry.content)),
      link,
      pubDate: parseDate(extractText(entry.published) ?? extractText(entry.updated)),
      author: extractAtomAuthor(entry.author),
      imageUrl: extractImage(entry),
      categories: extractAtomCategories(entry),
    };
  });

  return {
    meta: {
      title: extractText(feed.title),
      description: stripHtml(extractText(feed.subtitle)),
      siteUrl: extractAtomLink(feed.link, 'alternate') ?? extractAtomLink(feed.link),
      language: feed['@_xml:lang'] ?? null,
      generator: extractText(feed.generator),
      lastBuildDate: parseDate(extractText(feed.updated)),
      format: 'atom',
    },
    items,
  };
}

// ── RSS 1.0 (RDF) ────────────────────────────────────────────

function parseRss1(rdf: any, feedUrl: string): ParsedFeed {
  const channel = rdf.channel ?? {};
  const items = ensureArray(rdf.item).map((item: any): ParsedItem => ({
    guid: extractText(item['@_rdf:about']) || extractText(item.link) || feedUrl + '#' + extractText(item.title),
    title: stripHtml(extractText(item.title)),
    description: stripHtml(extractText(item.description) ?? extractText(item['content:encoded'])),
    link: extractText(item.link),
    pubDate: parseDate(extractText(item['dc:date'])),
    author: extractText(item['dc:creator']),
    imageUrl: extractImage(item),
    categories: extractCategories(item),
  }));

  return {
    meta: {
      title: extractText(channel.title),
      description: stripHtml(extractText(channel.description)),
      siteUrl: extractText(channel.link),
      language: extractText(channel['dc:language']),
      generator: null,
      lastBuildDate: parseDate(extractText(channel['dc:date'])),
      format: 'rss1',
    },
    items,
  };
}

// ═══════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════

function ensureArray(v: any): any[] {
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
}

function extractText(v: any): string | null {
  if (v == null) return null;
  if (typeof v === 'string') return v.trim() || null;
  if (typeof v === 'number') return String(v);
  if (v['#text'] != null) return String(v['#text']).trim() || null;
  if (v['@_href']) return v['@_href'];
  return null;
}

function extractGuid(item: any): string | null {
  const g = item.guid;
  if (!g) return null;
  return extractText(g) ?? null;
}

function extractImage(item: any): string | null {
  // enclosure
  const enc = item.enclosure;
  if (enc) {
    const url = enc['@_url'] ?? extractText(enc);
    if (url && /image/i.test(enc['@_type'] ?? '')) return url;
    if (url && /\.(jpg|jpeg|png|gif|webp)/i.test(url)) return url;
  }
  // media:content or media:thumbnail
  const media = item['media:content'] ?? item['media:thumbnail'];
  if (media) {
    const url = media['@_url'] ?? extractText(media);
    if (url) return url;
  }
  // image element inside item
  if (item.image) {
    const url = extractText(item.image?.url) ?? extractText(item.image);
    if (url) return url;
  }
  return null;
}

function extractCategories(item: any): string[] {
  const cats = ensureArray(item.category);
  return cats.map((c: any) => extractText(c)).filter(Boolean) as string[];
}

function extractAtomCategories(entry: any): string[] {
  const cats = ensureArray(entry.category);
  return cats.map((c: any) => c['@_term'] ?? extractText(c)).filter(Boolean) as string[];
}

function extractAtomLink(links: any, rel?: string): string | null {
  const arr = ensureArray(links);
  if (rel) {
    const match = arr.find((l: any) => l['@_rel'] === rel);
    if (match) return match['@_href'] ?? extractText(match);
  }
  // Fall back to first link with href
  for (const l of arr) {
    const href = l['@_href'] ?? extractText(l);
    if (href) return href;
  }
  return null;
}

function extractAtomAuthor(author: any): string | null {
  if (!author) return null;
  if (typeof author === 'string') return author;
  return extractText(author.name) ?? extractText(author.email);
}

function stripHtml(s: string | null): string | null {
  if (!s) return null;
  return s.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() || null;
}

function parseDate(s: string | null): Date | null {
  if (!s) return null;
  const d = new Date(s);
  if (isNaN(d.getTime())) return null;
  // Reject dates in the far future (>1 year ahead) — likely malformed
  const maxFuture = Date.now() + 365 * 24 * 60 * 60 * 1000;
  if (d.getTime() > maxFuture) return null;
  return d;
}
