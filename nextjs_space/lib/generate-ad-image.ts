/**
 * Ad Image Generation — calls OpenAI Images API directly.
 * Env vars:
 *   OPENAI_API_KEY       — Required.
 *   OPENAI_IMAGE_MODEL   — "gpt-image-2" (default). Must match Render env.
 *   IMAGE_PROVIDER       — "openai" (default). Reserved for future providers.
 */

const OPENAI_IMAGES_URL = 'https://api.openai.com/v1/images/generations';

export interface AdBrief {
  businessName: string;
  industry: string;
  headline: string;
  subheadline: string;
  cta: string;
  brandColors: string;
  socialProof: string;
  logoDescription: string;
  websiteUrl: string;
  angle?: string;
}

export function buildAdBrief(
  research: any,
  creative: any,
  adData: { headline?: string; caption?: string; cta?: string; angle?: string },
  websiteUrl: string,
): AdBrief {
  const biz = research?.business_summary ?? {};
  const palette = research?.brand_palette ?? research?.brand_assets?.palette ?? null;
  const businessName = biz?.name ?? 'Business';
  const industry = biz?.category ?? 'business';
  const targetCustomer = biz?.target_customer ?? 'customers';

  let brandColors = 'professional blue and dark navy';
  if (palette) {
    if (Array.isArray(palette)) brandColors = palette.slice(0, 3).join(', ');
    else if (typeof palette === 'object') {
      const colors = Object.values(palette).filter(v => typeof v === 'string').slice(0, 3);
      if (colors.length > 0) brandColors = colors.join(', ');
    } else if (typeof palette === 'string') brandColors = palette;
  }

  const logoUrl = research?.brand_assets?.logo_url ?? '';
  const logoDescription = logoUrl
    ? `The business logo from ${businessName}`
    : `A professional logo mark for ${businessName}`;

  return {
    businessName,
    industry,
    headline: adData.headline || 'Your Ad Headline',
    subheadline: adData.caption
      ? adData.caption.slice(0, 120)
      : `Professional ${industry} services for ${targetCustomer}`,
    cta: adData.cta || 'Learn More',
    brandColors,
    socialProof: `Trusted by ${targetCustomer} | ${businessName}`,
    logoDescription,
    websiteUrl,
    angle: adData.angle,
  };
}

/**
 * Build a detailed image generation prompt from an AdBrief.
 */
function buildImagePrompt(brief: AdBrief): string {
  return [
    `Professional Facebook ad creative for ${brief.businessName} (${brief.industry}).`,
    `Angle: ${brief.angle ?? 'general'}.`,
    `Headline text: "${brief.headline}".`,
    `Subheadline: "${brief.subheadline}".`,
    `CTA button: "${brief.cta}".`,
    `Brand colors: ${brief.brandColors}.`,
    `${brief.logoDescription}.`,
    `The image should be photorealistic, high quality, modern design, clean layout.`,
    `Social proof badge: "${brief.socialProof}".`,
    `Style: premium digital ad, professional typography, bold headline, clear hierarchy.`,
  ].join(' ');
}

/**
 * Generate a single ad image via OpenAI Images API.
 * Returns the image URL on success, null on failure. Never throws.
 */
export async function generateAdImage(brief: AdBrief): Promise<string | null> {
  const provider = process.env.IMAGE_PROVIDER ?? 'openai';
  const model = process.env.OPENAI_IMAGE_MODEL ?? 'gpt-image-2';
  const apiKey = process.env.OPENAI_API_KEY;
  const keySuffix = apiKey ? `...${apiKey.slice(-6)}` : 'MISSING';

  if (!apiKey) {
    console.error(`[generate-ad] OPENAI_API_KEY not set — cannot generate image`);
    return null;
  }

  const prompt = buildImagePrompt(brief);
  const isDallE = model.startsWith('dall-e');
  const size = isDallE ? '1024x1024' : '1024x1536';

  const payload: Record<string, any> = {
    model,
    prompt,
    n: 1,
    size,
  };
  if (!isDallE) {
    payload.quality = 'high';
  }

  console.log(
    `[generate-ad] endpoint=${OPENAI_IMAGES_URL} method=POST provider=${provider} model=${model} ` +
    `key=${keySuffix} size=${size} business=${brief.businessName} angle=${brief.angle ?? 'general'} prompt_len=${prompt.length}`
  );

  // Single attempt — no blind retry while diagnosing 429 issue
  try {
    const startTime = Date.now();
    const res = await fetch(OPENAI_IMAGES_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(120_000),
    });

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const contentType = res.headers.get('content-type') ?? 'null';
    const retryAfterRaw = res.headers.get('retry-after');
    const ratelimitHeaders: Record<string, string | null> = {};
    res.headers.forEach((v, k) => {
      if (k.startsWith('x-ratelimit')) ratelimitHeaders[k] = v;
    });

    console.log(
      `[generate-ad] RESPONSE status=${res.status} elapsed=${elapsed}s ` +
      `content-type="${contentType}" retry-after-raw="${retryAfterRaw ?? 'null'}" ` +
      `x-ratelimit=${JSON.stringify(ratelimitHeaders)} ` +
      `endpoint=${OPENAI_IMAGES_URL} model=${model} key=${keySuffix}`
    );

    if (res.ok) {
      const data = await res.json();
      const item = data?.data?.[0];

      if (item?.url) {
        console.log(`[generate-ad] SUCCESS format=url elapsed=${elapsed}s model=${model}`);
        return item.url;
      }
      if (item?.b64_json) {
        const dataUrl = `data:image/png;base64,${item.b64_json}`;
        console.log(`[generate-ad] SUCCESS format=b64 elapsed=${elapsed}s model=${model}`);
        return dataUrl;
      }

      console.error(`[generate-ad] 200 OK but no image. keys=${JSON.stringify(Object.keys(data ?? {}))}`);
      return null;
    }

    // ── Non-OK: full diagnostic logging ──────────────────────────────
    const rawBody = await res.text().catch(() => '');
    const isJson = contentType.includes('application/json');
    const isHtml = rawBody.trimStart().startsWith('<') || contentType.includes('text/html');
    let bodyPreview: string;

    if (isJson) {
      try {
        const parsed = JSON.parse(rawBody);
        bodyPreview = JSON.stringify({
          type: parsed?.error?.type,
          code: parsed?.error?.code,
          message: parsed?.error?.message?.slice(0, 300),
        });
      } catch {
        bodyPreview = rawBody.slice(0, 300);
      }
    } else if (isHtml) {
      bodyPreview = `[HTML] ${rawBody.slice(0, 300)}`;
    } else {
      bodyPreview = rawBody.slice(0, 300);
    }

    console.error(
      `[generate-ad] HTTP_ERROR status=${res.status} content-type="${contentType}" ` +
      `is_json=${isJson} is_html=${isHtml} retry-after-raw="${retryAfterRaw ?? 'null'}" ` +
      `body=${bodyPreview} x-ratelimit=${JSON.stringify(ratelimitHeaders)} ` +
      `endpoint=${OPENAI_IMAGES_URL} model=${model} key=${keySuffix}`
    );
    return null;
  } catch (err: any) {
    console.error(`[generate-ad] EXCEPTION endpoint=${OPENAI_IMAGES_URL} model=${model} key=${keySuffix} error="${err?.message}"`);
    return null;
  }
}

/**
 * Generate ad images for a completed analysis.
 * Runs sequentially to avoid rate limits.
 */
export async function generateAllAdImages(
  research: any,
  creative: any,
  enrichedAds: any[],
  websiteUrl: string,
): Promise<{ imageUrl: string | null; angle: string }[]> {
  const results: { imageUrl: string | null; angle: string }[] = [];
  const angles = ['awareness', 'conversion', 'trust'];

  for (let i = 0; i < Math.min(enrichedAds.length, 3); i++) {
    const ad = enrichedAds[i];
    const angle = ad?.campaignName?.toLowerCase()?.includes('awareness') ? 'awareness'
      : ad?.campaignName?.toLowerCase()?.includes('conversion') ? 'conversion'
      : ad?.campaignName?.toLowerCase()?.includes('trust') ? 'trust'
      : angles[i] ?? 'general';

    const brief = buildAdBrief(research, creative, {
      headline: ad?.headline ?? '',
      caption: ad?.caption ?? '',
      cta: ad?.cta ?? '',
      angle,
    }, websiteUrl);

    const imageUrl = await generateAdImage(brief);
    results.push({ imageUrl, angle });
  }

  return results;
}
