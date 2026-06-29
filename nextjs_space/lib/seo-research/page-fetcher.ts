/**
 * SEO Research — competitor page fetcher.
 *
 * Fetches ONLY the individual top URLs the provider (DataForSEO) returned for
 * a SERP. It never fetches a search-engine results page. Returns cleaned,
 * truncated readable text suitable for LLM structural analysis.
 */
import { assertFetchableTopUrl } from './classification';

export interface FetchedPage {
  url: string;
  ok: boolean;
  status: number;
  finalUrl: string;
  contentType: string;
  rawHtml: string;
  readableText: string;
  title: string;
  error?: string;
}

const MAX_BYTES = 600_000; // cap raw payload we keep
const MAX_READABLE = 18_000; // chars of cleaned text passed to the LLM

function stripHtml(html: string): { text: string; title: string } {
  let title = '';
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (titleMatch) title = decodeEntities(titleMatch[1]).trim();
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/(p|div|section|li|h[1-6]|tr|article|header|footer)>/gi, '\n')
    .replace(/<br\s*\/?>(?=)/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { text: decodeEntities(text), title };
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => {
      try { return String.fromCharCode(parseInt(n, 10)); } catch { return ' '; }
    });
}

/**
 * Fetch a single provider-returned top URL. Guards against forbidden SERP
 * scraping endpoints and times out quickly so a slow competitor site can't
 * stall the research run.
 */
export async function fetchCompetitorPage(url: string, timeoutMs = 12_000): Promise<FetchedPage> {
  // Hard compliance guard — throws for any Google/search scraping endpoint.
  assertFetchableTopUrl(url);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (compatible; LaunchOS-SEO-Research/1.0; structural analysis; +https://launchmarketing.com)',
        Accept: 'text/html,application/xhtml+xml',
      },
    });
    const contentType = res.headers.get('content-type') || '';
    let rawHtml = '';
    if (contentType.includes('text/html') || contentType.includes('text/') || contentType === '') {
      const buf = await res.arrayBuffer();
      rawHtml = Buffer.from(buf).toString('utf-8').slice(0, MAX_BYTES);
    }
    const { text, title } = stripHtml(rawHtml);
    return {
      url,
      ok: res.ok,
      status: res.status,
      finalUrl: res.url || url,
      contentType,
      rawHtml,
      readableText: text.slice(0, MAX_READABLE),
      title,
    };
  } catch (err: any) {
    return {
      url,
      ok: false,
      status: 0,
      finalUrl: url,
      contentType: '',
      rawHtml: '',
      readableText: '',
      title: '',
      error: err?.name === 'AbortError' ? 'timeout' : String(err?.message || err),
    };
  } finally {
    clearTimeout(timer);
  }
}
