/**
 * Ad Image Generation — calls OpenAI Images API directly.
 * Env vars:
 *   OPENAI_API_KEY       — Required.
 *   OPENAI_IMAGE_MODEL   — "gpt-image-1.5" (default). Override to "gpt-image-2", "dall-e-3", etc.
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
  const model = process.env.OPENAI_IMAGE_MODEL ?? 'gpt-image-1.5';
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    console.error(`[generate-ad] OPENAI_API_KEY not set — cannot generate image`);
    return null;
  }

  const prompt = buildImagePrompt(brief);
  const isDallE = model.startsWith('dall-e');
  const size = isDallE ? '1024x1024' : '1024x1536';

  // Build payload — DALL-E uses different params than GPT Image models
  const payload: Record<string, any> = {
    model,
    prompt,
    n: 1,
    size,
  };
  if (!isDallE) {
    payload.quality = 'high';
  }

  console.log(`[generate-ad] provider=${provider} model=${model} size=${size} business=${brief.businessName} angle=${brief.angle ?? 'general'} prompt_len=${prompt.length}`);

  const MAX_ATTEMPTS = 2;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
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

      if (res.status === 429 && attempt < MAX_ATTEMPTS) {
        const retryAfter = parseInt(res.headers.get('retry-after') ?? '5', 10);
        console.warn(`[generate-ad] 429 rate-limited, retrying in ${retryAfter}s (attempt ${attempt}/${MAX_ATTEMPTS})`);
        await new Promise(r => setTimeout(r, retryAfter * 1000));
        continue;
      }

      if (!res.ok) {
        const errText = await res.text().catch(() => 'Unknown error');
        console.error(`[generate-ad] provider=${provider} model=${model} HTTP ${res.status} (${elapsed}s): ${errText.slice(0, 300)}`);
        return null;
      }

      const data = await res.json();
      const item = data?.data?.[0];

      if (item?.url) {
        console.log(`[generate-ad] SUCCESS provider=${provider} model=${model} format=url elapsed=${elapsed}s`);
        return item.url;
      }
      if (item?.b64_json) {
        const dataUrl = `data:image/png;base64,${item.b64_json}`;
        console.log(`[generate-ad] SUCCESS provider=${provider} model=${model} format=b64 elapsed=${elapsed}s`);
        return dataUrl;
      }

      console.error(`[generate-ad] No image in response. provider=${provider} model=${model} keys=${JSON.stringify(Object.keys(data ?? {}))}`);
      return null;
    } catch (err: any) {
      console.error(`[generate-ad] provider=${provider} model=${model} attempt=${attempt} error="${err?.message}"`);
      if (attempt >= MAX_ATTEMPTS) return null;
    }
  }
  return null;
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
