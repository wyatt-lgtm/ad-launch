/**
 * Article-to-Carousel Pipeline
 *
 * Fetches an article URL, parses its content, detects if it's a listicle/tips/ranking,
 * extracts key points, and builds a structured carousel package for social posting.
 *
 * Falls back to standard article-summary when the article isn't list-based.
 */

import * as cheerio from 'cheerio';

const TOMBSTONE_URL = process.env.TOMBSTONE_API_URL ?? 'https://tombstone-api-xjc4.onrender.com';

// ─── Types ────────────────────────────────────────────────────────────

export interface KeyPoint {
  title: string;
  summary: string;
  importance_score: number;
}

export interface SlideOverlayText {
  headline: string;
  bullets: string[];
}

export interface CarouselSlide {
  slide_number: number;
  headline: string;
  bullets: string[];
  image_prompt: string;
  overlay_text: SlideOverlayText;
}

export interface PlatformNotes {
  facebook: string;
  instagram: string;
  linkedin: string;
}

export interface CarouselPackage {
  post_type: 'carousel' | 'standard';
  source_url: string;
  source_publisher: string;
  article_title: string;
  detected_article_type: 'listicle' | 'tips' | 'ranking' | 'how-to' | 'standard_article';
  key_points: KeyPoint[];
  slides: CarouselSlide[];
  caption: string;
  source_attribution: string;
  platform_notes: PlatformNotes;
  fallback_reason?: string;
}

export interface ArticleContent {
  title: string;
  publisher: string;
  headings: string[];
  listItems: string[];
  bodyText: string;
  url: string;
}

// ─── Article Fetching & Parsing ───────────────────────────────────────

const FETCH_TIMEOUT_MS = 15_000;
const MAX_BODY_CHARS = 25_000;

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';

/**
 * Fetch an article URL and extract structured content.
 * Strips ads, nav, comments, footers, and other non-article noise.
 */
export async function fetchAndParseArticle(url: string): Promise<ArticleContent> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' },
      signal: controller.signal,
      redirect: 'follow',
    });
    clearTimeout(timer);

    if (!res.ok) {
      throw new Error(`HTTP ${res.status} fetching ${url}`);
    }

    const html = await res.text();
    return parseArticleHtml(html, url);
  } catch (err: any) {
    clearTimeout(timer);
    throw new Error(`Failed to fetch article: ${err.message}`);
  }
}

/**
 * Parse raw HTML into structured article content using Cheerio.
 */
export function parseArticleHtml(html: string, url: string): ArticleContent {
  const $ = cheerio.load(html);

  // Remove noise elements
  const noiseSelectors = [
    'nav', 'header', 'footer', 'aside', '.ad', '.ads', '.advertisement',
    '.sidebar', '.related-posts', '.related-articles', '.comments',
    '.comment-section', '#comments', '.newsletter', '.newsletter-signup',
    '.author-bio', '.social-share', '.share-buttons', '.breadcrumb',
    'script', 'style', 'noscript', 'iframe', '.cookie-banner',
    '.popup', '.modal', '[role="navigation"]', '[role="banner"]',
    '.wp-block-latest-posts', '.tag-cloud', '.categories-list',
  ];
  noiseSelectors.forEach(sel => $(sel).remove());

  // Extract title
  const title =
    $('h1').first().text().trim() ||
    $('meta[property="og:title"]').attr('content')?.trim() ||
    $('title').text().trim() ||
    '';

  // Extract publisher
  const publisher = extractPublisher($, url);

  // Extract headings (h2, h3 — typically section headers in articles)
  const headings: string[] = [];
  $('article h2, article h3, .post-content h2, .post-content h3, .entry-content h2, .entry-content h3, main h2, main h3').each((_, el) => {
    const text = $(el).text().trim();
    if (text && text.length > 3 && text.length < 200) {
      headings.push(text);
    }
  });

  // If no headings found in article scope, try broader scope
  if (headings.length === 0) {
    $('h2, h3').each((_, el) => {
      const text = $(el).text().trim();
      if (text && text.length > 3 && text.length < 200) {
        headings.push(text);
      }
    });
  }

  // Extract list items (ol li, ul li) within article body
  const listItems: string[] = [];
  $('article li, .post-content li, .entry-content li, main li').each((_, el) => {
    const text = $(el).text().trim();
    if (text && text.length > 5 && text.length < 300) {
      listItems.push(text);
    }
  });

  // Extract body text (paragraphs)
  const paragraphs: string[] = [];
  $('article p, .post-content p, .entry-content p, main p').each((_, el) => {
    const text = $(el).text().trim();
    if (text && text.length > 20) {
      paragraphs.push(text);
    }
  });

  // Fallback: if nothing found in article scope, try all p tags
  if (paragraphs.length === 0) {
    $('p').each((_, el) => {
      const text = $(el).text().trim();
      if (text && text.length > 20) {
        paragraphs.push(text);
      }
    });
  }

  const bodyText = paragraphs.join('\n\n').slice(0, MAX_BODY_CHARS);

  return { title, publisher, headings, listItems, bodyText, url };
}

function extractPublisher($: cheerio.CheerioAPI, url: string): string {
  // Try meta tags first
  const ogSite = $('meta[property="og:site_name"]').attr('content')?.trim();
  if (ogSite) return ogSite;

  const publisher = $('meta[name="publisher"]').attr('content')?.trim();
  if (publisher) return publisher;

  // Fall back to domain
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, '');
    // Capitalize nicely: "howtogeek.com" → "How To Geek"
    const name = hostname.split('.')[0];
    return name.charAt(0).toUpperCase() + name.slice(1);
  } catch {
    return 'Unknown';
  }
}

// ─── Listicle Detection + Key Point Extraction (LLM) ─────────────────

/**
 * Use LLM to detect article type, extract key points, and build the full carousel package.
 * Single LLM call that handles detection + extraction + slide creation + caption generation.
 */
export async function buildCarouselPackage(
  article: ArticleContent,
  businessContext: {
    businessName: string;
    industry?: string;
    brandColors?: string;
    websiteUrl?: string;
  },
): Promise<CarouselPackage> {
  console.log(`[carousel] Analyzing article via Tombstone: "${article.title.slice(0, 80)}" from ${article.publisher}`);

  const res = await fetch(`${TOMBSTONE_URL}/carousel/build`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ article, businessContext }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Tombstone carousel API error ${res.status}: ${errText.slice(0, 200)}`);
  }

  const data = await res.json();

  // Tombstone returns the full carousel package — normalize for safety
  return normalizeCarouselPackage(data, article);
}

// ─── Prompts ──────────────────────────────────────────────────────────

const CAROUSEL_SYSTEM_PROMPT = `You are a social media content strategist who creates carousel posts from articles.
You analyze articles to detect if they are list-based (listicle, tips, ranking, how-to, "best X", "features you should enable").
You extract key points, rewrite them in plain language, and create carousel slide structures.

RULES:
- NEVER copy long article text verbatim. Summarize and rewrite in your own words.
- Keep each bullet under 12 words.
- Each slide should have a short headline and 2-3 concise bullets.
- Maximum 3 slides.
- Prioritize key points that are specific, actionable, useful, not obvious, and easy to express visually.
- Source attribution is mandatory.
- Do not imply the advertiser wrote the article unless they did.
- If the article is NOT list-based, set post_type to "standard" and provide a fallback_reason.

Respond with valid JSON only.`;

function buildCarouselPrompt(
  article: ArticleContent,
  biz: { businessName: string; industry?: string; brandColors?: string; websiteUrl?: string },
): string {
  const headingsList = article.headings.length > 0
    ? `\n\nARTICLE HEADINGS (h2/h3):\n${article.headings.map((h, i) => `${i + 1}. ${h}`).join('\n')}`
    : '';

  const listItemsList = article.listItems.length > 0
    ? `\n\nARTICLE LIST ITEMS:\n${article.listItems.slice(0, 30).map((li, i) => `- ${li.slice(0, 150)}`).join('\n')}`
    : '';

  const bodyExcerpt = article.bodyText.slice(0, 8000);

  return `Analyze this article and create a carousel social media post package.

ARTICLE TITLE: ${article.title}
SOURCE PUBLISHER: ${article.publisher}
SOURCE URL: ${article.url}
${headingsList}
${listItemsList}

ARTICLE BODY (excerpt):
${bodyExcerpt}

---

BUSINESS SHARING THIS POST:
Name: ${biz.businessName}
Industry: ${biz.industry || 'general'}
${biz.brandColors ? `Brand colors: ${biz.brandColors}` : ''}
${biz.websiteUrl ? `Website: ${biz.websiteUrl}` : ''}

---

INSTRUCTIONS:
1. Detect the article type: listicle, tips, ranking, how-to, or standard_article.
2. If list-based, extract all key points from the article.
3. Score each key point 1-10 based on: specificity, actionability, usefulness, non-obviousness.
4. Apply carousel distribution rules:
   - 3 or fewer key points → 1 image per key point
   - 4–9 key points → 3 images, distribute evenly
   - 10+ key points → select best 6–9, create 3 images with 2–3 points each
5. For each slide, create:
   - A short headline (5-8 words)
   - 2-3 concise bullets (each under 12 words)
   - An image_prompt describing the visual theme (abstract, brand-safe, no screenshots)
6. Write a caption with:
   - Hook based on the article's main benefit
   - Short summary of the points
   - CTA for engagement
   - Source attribution
7. If the article is NOT list-based, set post_type to "standard" and explain in fallback_reason.

Return this exact JSON structure:
{
  "post_type": "carousel" or "standard",
  "detected_article_type": "listicle" | "tips" | "ranking" | "how-to" | "standard_article",
  "key_points": [
    { "title": "...", "summary": "...", "importance_score": 1-10 }
  ],
  "slides": [
    {
      "slide_number": 1,
      "headline": "...",
      "bullets": ["...", "..."],
      "image_prompt": "...",
      "overlay_text": { "headline": "...", "bullets": ["...", "..."] }
    }
  ],
  "caption": "...",
  "platform_notes": {
    "facebook": "...",
    "instagram": "...",
    "linkedin": "..."
  },
  "fallback_reason": null or "reason this isn't a carousel"
}`;
}

// ─── Carousel From User-Written Draft Text ───────────────────────────

const DRAFT_CAROUSEL_SYSTEM_PROMPT = `You are a social media content strategist who creates carousel posts from user-written text.
You detect if the text contains lists, events, dates, tips, rankings, steps, or other structured content.
If it does, you convert it into a carousel format. If not, you return post_type: "standard".

RULES:
- Keep the user's voice and intent. Improve grammar/flow but don't rewrite from scratch.
- Keep each bullet under 12 words.
- Each slide should have a short headline and 2-3 concise bullets.
- Maximum 3 slides.
- Prioritize items that are specific, timely, actionable.
- If the text has dates/events, each slide groups 2-3 events chronologically.
- If the text is NOT list-based, set post_type to "standard" and provide a fallback_reason.

Respond with valid JSON only.`;

/**
 * Build a carousel package from user-written draft text (not an article URL).
 * Detects list/event/tip content and creates slides.
 */
export async function buildCarouselFromDraft(
  draftText: string,
  businessContext: {
    businessName: string;
    industry?: string;
    brandColors?: string;
    websiteUrl?: string;
  },
): Promise<CarouselPackage> {
  console.log(`[carousel-draft] Analyzing user draft via Tombstone (${draftText.length} chars)`);

  const res = await fetch(`${TOMBSTONE_URL}/carousel/build-from-draft`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ draftText: draftText.slice(0, 8000), businessContext }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Tombstone carousel-draft API error ${res.status}: ${errText.slice(0, 200)}`);
  }

  const data = await res.json();

  // Normalize using a synthetic ArticleContent
  const syntheticArticle: ArticleContent = {
    title: '',
    publisher: businessContext.businessName,
    headings: [],
    listItems: [],
    bodyText: draftText,
    url: businessContext.websiteUrl || '',
  };

  const pkg = normalizeCarouselPackage(data, syntheticArticle);
  // Override source fields since this is user-written, not an article
  pkg.source_url = businessContext.websiteUrl || '';
  pkg.source_publisher = businessContext.businessName;
  pkg.article_title = '';
  pkg.source_attribution = `Posted by ${businessContext.businessName}`;

  console.log(`[carousel-draft] Result: type=${pkg.post_type}, detected=${pkg.detected_article_type}, slides=${pkg.slides.length}`);

  return pkg;
}

// ─── Response Normalization ───────────────────────────────────────────

function normalizeCarouselPackage(raw: any, article: ArticleContent): CarouselPackage {
  const isCarousel = raw.post_type === 'carousel' && Array.isArray(raw.slides) && raw.slides.length > 0;

  const keyPoints: KeyPoint[] = (raw.key_points || []).map((kp: any) => ({
    title: String(kp.title || '').slice(0, 100),
    summary: String(kp.summary || '').slice(0, 200),
    importance_score: Math.min(10, Math.max(1, Number(kp.importance_score) || 5)),
  }));

  const slides: CarouselSlide[] = isCarousel
    ? (raw.slides || []).slice(0, 3).map((s: any, i: number) => ({
        slide_number: i + 1,
        headline: String(s.headline || '').slice(0, 60),
        bullets: (s.bullets || []).slice(0, 3).map((b: string) => String(b).slice(0, 80)),
        image_prompt: String(s.image_prompt || '').slice(0, 500),
        overlay_text: {
          headline: String(s.overlay_text?.headline || s.headline || '').slice(0, 60),
          bullets: (s.overlay_text?.bullets || s.bullets || []).slice(0, 3).map((b: string) => String(b).slice(0, 80)),
        },
      }))
    : [];

  return {
    post_type: isCarousel ? 'carousel' : 'standard',
    source_url: article.url,
    source_publisher: article.publisher,
    article_title: article.title,
    detected_article_type: raw.detected_article_type || 'standard_article',
    key_points: keyPoints,
    slides,
    caption: String(raw.caption || '').slice(0, 2200),
    source_attribution: `Source: ${article.publisher}`,
    platform_notes: {
      facebook: String(raw.platform_notes?.facebook || ''),
      instagram: String(raw.platform_notes?.instagram || ''),
      linkedin: String(raw.platform_notes?.linkedin || ''),
    },
    fallback_reason: raw.fallback_reason || undefined,
  };
}
