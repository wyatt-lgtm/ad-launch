/**
 * Lightweight SEO auditor that checks a website URL for common issues.
 * Returns a score 0-100 and categorized findings.
 */

export interface SeoAuditItem {
  category: string;
  label: string;
  status: 'pass' | 'warn' | 'fail';
  detail: string;
  weight: number; // how much this item contributes to score
}

export interface SeoAuditResult {
  score: number;
  grade: string;
  items: SeoAuditItem[];
  summary: string;
}

const TIMEOUT = 8000;

async function fetchWithTimeout(url: string, ms = TIMEOUT): Promise<Response | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'User-Agent': 'AdLaunch-SEO-Audit/1.0' },
      cache: 'no-store',
    });
    return res;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function gradeFromScore(score: number): string {
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  if (score >= 65) return 'C';
  if (score >= 50) return 'D';
  return 'F';
}

export async function runSeoAudit(websiteUrl: string): Promise<SeoAuditResult> {
  const items: SeoAuditItem[] = [];
  const baseUrl = websiteUrl.startsWith('http') ? websiteUrl : `https://${websiteUrl}`;
  const parsedUrl = new URL(baseUrl);
  const origin = parsedUrl.origin;

  // 1. Fetch the homepage
  let html = '';
  let statusCode = 0;
  let responseTime = 0;
  const start = Date.now();
  const homeRes = await fetchWithTimeout(baseUrl);
  responseTime = Date.now() - start;

  if (!homeRes) {
    return {
      score: 0,
      grade: 'F',
      items: [{ category: 'Availability', label: 'Site Reachable', status: 'fail', detail: 'Could not reach the website. It may be down or blocking requests.', weight: 100 }],
      summary: 'Could not reach the website to perform an audit.',
    };
  }

  statusCode = homeRes.status;
  html = await homeRes.text().catch(() => '');
  const lowerHtml = html.toLowerCase();

  // --- HTTPS ---
  items.push({
    category: 'Security',
    label: 'HTTPS Enabled',
    status: parsedUrl.protocol === 'https:' ? 'pass' : 'fail',
    detail: parsedUrl.protocol === 'https:' ? 'Site uses HTTPS encryption.' : 'Site does not use HTTPS — this hurts SEO rankings and user trust.',
    weight: 10,
  });

  // --- Status Code ---
  items.push({
    category: 'Availability',
    label: 'Homepage Status',
    status: statusCode === 200 ? 'pass' : statusCode < 400 ? 'warn' : 'fail',
    detail: statusCode === 200 ? 'Homepage returns 200 OK.' : `Homepage returns HTTP ${statusCode}.`,
    weight: 10,
  });

  // --- Response Time ---
  items.push({
    category: 'Performance',
    label: 'Server Response Time',
    status: responseTime < 1500 ? 'pass' : responseTime < 3000 ? 'warn' : 'fail',
    detail: `Server responded in ${responseTime}ms.${responseTime > 3000 ? ' Slow response times hurt SEO and user experience.' : responseTime > 1500 ? ' Could be faster — aim for under 1.5s.' : ' Good server response time.'}`,
    weight: 8,
  });

  // --- Title Tag ---
  const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  const title = titleMatch?.[1]?.trim() ?? '';
  if (!title) {
    items.push({ category: 'On-Page SEO', label: 'Title Tag', status: 'fail', detail: 'No <title> tag found. Every page needs a unique, descriptive title (50-60 chars).', weight: 10 });
  } else if (title.length < 20) {
    items.push({ category: 'On-Page SEO', label: 'Title Tag', status: 'warn', detail: `Title is too short (${title.length} chars): "${title}". Aim for 50-60 characters.`, weight: 10 });
  } else if (title.length > 65) {
    items.push({ category: 'On-Page SEO', label: 'Title Tag', status: 'warn', detail: `Title is too long (${title.length} chars) — it may get truncated in search results.`, weight: 10 });
  } else {
    items.push({ category: 'On-Page SEO', label: 'Title Tag', status: 'pass', detail: `Title tag present (${title.length} chars): "${title.slice(0, 60)}"`, weight: 10 });
  }

  // --- Meta Description ---
  const metaDescMatch = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i)
    ?? html.match(/<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i);
  const metaDesc = metaDescMatch?.[1]?.trim() ?? '';
  if (!metaDesc) {
    items.push({ category: 'On-Page SEO', label: 'Meta Description', status: 'fail', detail: 'No meta description found. Add a compelling 150-160 character description for search results.', weight: 10 });
  } else if (metaDesc.length < 70) {
    items.push({ category: 'On-Page SEO', label: 'Meta Description', status: 'warn', detail: `Meta description is short (${metaDesc.length} chars). Aim for 150-160 characters.`, weight: 10 });
  } else if (metaDesc.length > 170) {
    items.push({ category: 'On-Page SEO', label: 'Meta Description', status: 'warn', detail: `Meta description is long (${metaDesc.length} chars) — may get truncated.`, weight: 10 });
  } else {
    items.push({ category: 'On-Page SEO', label: 'Meta Description', status: 'pass', detail: `Meta description present (${metaDesc.length} chars).`, weight: 10 });
  }

  // --- H1 Tag ---
  const h1Matches = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/gi) ?? [];
  if (h1Matches.length === 0) {
    items.push({ category: 'On-Page SEO', label: 'H1 Heading', status: 'fail', detail: 'No H1 heading found. Each page should have exactly one H1 that describes the main topic.', weight: 8 });
  } else if (h1Matches.length > 1) {
    items.push({ category: 'On-Page SEO', label: 'H1 Heading', status: 'warn', detail: `Found ${h1Matches.length} H1 tags — best practice is exactly one H1 per page.`, weight: 8 });
  } else {
    items.push({ category: 'On-Page SEO', label: 'H1 Heading', status: 'pass', detail: 'One H1 heading found — good structure.', weight: 8 });
  }

  // --- Viewport Meta (Mobile Friendly) ---
  const hasViewport = lowerHtml.includes('name="viewport"') || lowerHtml.includes("name='viewport'");
  items.push({
    category: 'Mobile',
    label: 'Viewport Meta Tag',
    status: hasViewport ? 'pass' : 'fail',
    detail: hasViewport ? 'Viewport meta tag present — site is mobile-responsive.' : 'No viewport meta tag — site may not display properly on mobile devices. This significantly hurts mobile SEO.',
    weight: 10,
  });

  // --- Open Graph Tags ---
  const hasOG = lowerHtml.includes('property="og:') || lowerHtml.includes("property='og:");
  items.push({
    category: 'Social & Sharing',
    label: 'Open Graph Tags',
    status: hasOG ? 'pass' : 'warn',
    detail: hasOG ? 'Open Graph tags found — content will display well when shared on social media.' : 'No Open Graph tags found. Add og:title, og:description, og:image for better social sharing.',
    weight: 5,
  });

  // --- Canonical Tag ---
  const hasCanonical = lowerHtml.includes('rel="canonical"') || lowerHtml.includes("rel='canonical'");
  items.push({
    category: 'Technical SEO',
    label: 'Canonical URL',
    status: hasCanonical ? 'pass' : 'warn',
    detail: hasCanonical ? 'Canonical tag present — helps prevent duplicate content issues.' : 'No canonical tag found. Add <link rel="canonical"> to prevent duplicate content indexing.',
    weight: 5,
  });

  // --- Image Alt Text ---
  const imgTags = html.match(/<img[^>]*>/gi) ?? [];
  const imgsWithoutAlt = imgTags.filter((tag) => !tag.match(/alt=["'][^"']+["']/i));
  const altRatio = imgTags.length > 0 ? ((imgTags.length - imgsWithoutAlt.length) / imgTags.length) : 1;
  if (imgTags.length === 0) {
    items.push({ category: 'Accessibility', label: 'Image Alt Text', status: 'warn', detail: 'No images found on the page.', weight: 6 });
  } else if (altRatio >= 0.9) {
    items.push({ category: 'Accessibility', label: 'Image Alt Text', status: 'pass', detail: `${imgTags.length - imgsWithoutAlt.length}/${imgTags.length} images have alt text — great for accessibility and SEO.`, weight: 6 });
  } else if (altRatio >= 0.5) {
    items.push({ category: 'Accessibility', label: 'Image Alt Text', status: 'warn', detail: `Only ${imgTags.length - imgsWithoutAlt.length}/${imgTags.length} images have alt text. Add descriptive alt text to all images.`, weight: 6 });
  } else {
    items.push({ category: 'Accessibility', label: 'Image Alt Text', status: 'fail', detail: `${imgsWithoutAlt.length}/${imgTags.length} images missing alt text. This hurts accessibility and image SEO.`, weight: 6 });
  }

  // --- Structured Data / Schema ---
  const hasSchema = lowerHtml.includes('application/ld+json') || lowerHtml.includes('itemtype="http://schema.org') || lowerHtml.includes('itemtype="https://schema.org');
  items.push({
    category: 'Technical SEO',
    label: 'Structured Data (Schema)',
    status: hasSchema ? 'pass' : 'warn',
    detail: hasSchema ? 'Structured data (Schema.org) found — helps search engines understand your content.' : 'No structured data found. Add JSON-LD schema markup (LocalBusiness, Product, etc.) for rich search results.',
    weight: 5,
  });

  // --- Robots.txt ---
  const robotsRes = await fetchWithTimeout(`${origin}/robots.txt`, 5000);
  const hasRobots = robotsRes?.ok && (await robotsRes.text().catch(() => '')).length > 10;
  items.push({
    category: 'Technical SEO',
    label: 'Robots.txt',
    status: hasRobots ? 'pass' : 'warn',
    detail: hasRobots ? 'robots.txt file found — search engines can read your crawl rules.' : 'No robots.txt found. Add one to control how search engines crawl your site.',
    weight: 3,
  });

  // --- Sitemap ---
  const sitemapRes = await fetchWithTimeout(`${origin}/sitemap.xml`, 5000);
  const hasSitemap = sitemapRes?.ok && (await sitemapRes.text().catch(() => '')).includes('<url');
  items.push({
    category: 'Technical SEO',
    label: 'XML Sitemap',
    status: hasSitemap ? 'pass' : 'warn',
    detail: hasSitemap ? 'XML sitemap found — helps search engines discover and index your pages.' : 'No XML sitemap found at /sitemap.xml. Create and submit one to Google Search Console.',
    weight: 5,
  });

  // --- Content Length ---
  // Strip tags and estimate word count
  const textContent = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  const wordCount = textContent.split(' ').filter(Boolean).length;
  if (wordCount < 100) {
    items.push({ category: 'Content', label: 'Content Length', status: 'fail', detail: `Homepage has ~${wordCount} words — thin content hurts rankings. Aim for 300+ words of quality content.`, weight: 5 });
  } else if (wordCount < 300) {
    items.push({ category: 'Content', label: 'Content Length', status: 'warn', detail: `Homepage has ~${wordCount} words — could use more content. Aim for 300+ words.`, weight: 5 });
  } else {
    items.push({ category: 'Content', label: 'Content Length', status: 'pass', detail: `Homepage has ~${wordCount} words of content — good content depth.`, weight: 5 });
  }

  // --- Internal Links ---
  const linkTags = html.match(/<a[^>]+href=["'][^"']*["'][^>]*>/gi) ?? [];
  const internalLinks = linkTags.filter((tag) => {
    const href = tag.match(/href=["']([^"']*)["']/i)?.[1] ?? '';
    return href.startsWith('/') || href.startsWith(origin);
  });
  if (internalLinks.length < 3) {
    items.push({ category: 'On-Page SEO', label: 'Internal Links', status: 'warn', detail: `Only ${internalLinks.length} internal links found. Add more internal links to help search engines crawl your site.`, weight: 5 });
  } else {
    items.push({ category: 'On-Page SEO', label: 'Internal Links', status: 'pass', detail: `${internalLinks.length} internal links found — good site structure.`, weight: 5 });
  }

  // Calculate score
  let totalWeight = 0;
  let earnedWeight = 0;
  for (const item of items) {
    totalWeight += item.weight;
    if (item.status === 'pass') earnedWeight += item.weight;
    else if (item.status === 'warn') earnedWeight += item.weight * 0.5;
    // fail = 0
  }
  const score = totalWeight > 0 ? Math.round((earnedWeight / totalWeight) * 100) : 0;
  const grade = gradeFromScore(score);

  const passCount = items.filter((i) => i.status === 'pass').length;
  const warnCount = items.filter((i) => i.status === 'warn').length;
  const failCount = items.filter((i) => i.status === 'fail').length;

  const summary = `Score: ${score}/100 (Grade ${grade}). ${passCount} passed, ${warnCount} warnings, ${failCount} issues found across ${items.length} checks.`;

  return { score, grade, items, summary };
}
