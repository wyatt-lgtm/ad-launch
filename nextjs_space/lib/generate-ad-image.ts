/**
 * GPT-5.1 Designer Brief Ad Generation
 * Generates professional Facebook ad creatives using a structured "agency brief" prompt pattern.
 * Returns a public S3 URL for the generated image.
 */

import { PutObjectCommand } from '@aws-sdk/client-s3';
import { createS3Client, getBucketConfig } from './aws-config';

const OPENAI_IMAGE_API = 'https://api.openai.com/v1/chat/completions';

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
  angle?: string; // awareness, conversion, trust
}

/**
 * Extract an AdBrief from Tombstone research + creative data.
 */
export function buildAdBrief(
  research: any,
  creative: any,
  adData: { headline?: string; caption?: string; cta?: string; angle?: string },
  websiteUrl: string,
): AdBrief {
  const biz = research?.business_summary ?? {};
  const voice = research?.brand_voice ?? {};
  const palette = research?.brand_palette ?? research?.brand_assets?.palette ?? null;

  const businessName = biz?.name ?? 'Business';
  const industry = biz?.category ?? 'business';
  const targetCustomer = biz?.target_customer ?? 'customers';

  // Try to extract brand colors from research
  let brandColors = 'professional blue and dark navy';
  if (palette) {
    if (Array.isArray(palette)) {
      brandColors = palette.slice(0, 3).join(', ');
    } else if (typeof palette === 'object') {
      const colors = Object.values(palette).filter(v => typeof v === 'string').slice(0, 3);
      if (colors.length > 0) brandColors = colors.join(', ');
    } else if (typeof palette === 'string') {
      brandColors = palette;
    }
  }

  // Logo description from research
  const logoUrl = research?.brand_assets?.logo_url ?? '';
  const logoDescription = logoUrl
    ? `The business logo from ${businessName}`
    : `A professional logo mark for ${businessName}`;

  // Build social proof from what we know
  const socialProof = `Trusted by ${targetCustomer} | ${businessName}`;

  // Headline and caption from the specific ad
  const headline = adData.headline || 'Your Ad Headline';
  const subheadline = adData.caption
    ? adData.caption.slice(0, 120)
    : `Professional ${industry} services for ${targetCustomer}`;
  const cta = adData.cta || 'Learn More';

  return {
    businessName,
    industry,
    headline,
    subheadline,
    cta,
    brandColors,
    socialProof,
    logoDescription,
    websiteUrl,
    angle: adData.angle,
  };
}

/**
 * Generate a single Facebook ad image using GPT-5.1 Designer Brief strategy.
 * Returns a public S3 URL.
 */
export async function generateAdImage(brief: AdBrief): Promise<string | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error('[generate-ad] No OPENAI_API_KEY');
    return null;
  }

  // Angle-specific creative direction
  let angleDirective = '';
  switch (brief.angle?.toLowerCase()) {
    case 'awareness':
      angleDirective = '\n- MOOD: Warm, inviting, aspirational. Show the lifestyle benefit of the product/service.\n- Focus on emotional connection and brand discovery.';
      break;
    case 'conversion':
      angleDirective = '\n- MOOD: Urgent, action-oriented. Emphasize the offer and CTA prominently.\n- Make the CTA button large and impossible to miss. Use contrasting colors for the button.';
      break;
    case 'trust':
      angleDirective = '\n- MOOD: Reliable, professional, authoritative. Showcase credibility and social proof.\n- Emphasize the social proof section. Use a trustworthy color palette.';
      break;
  }

  const prompt = [
    `You are a senior graphic designer at a top advertising agency. Create a Facebook ad creative.`,
    '',
    `CLIENT: ${brief.businessName}`,
    `INDUSTRY: ${brief.industry}`,
    `WEBSITE: ${brief.websiteUrl}`,
    '',
    'CREATIVE BRIEF:',
    `- Primary message: "${brief.headline}"`,
    `- Supporting copy: "${brief.subheadline}"`,
    `- Call to action: "${brief.cta}"`,
    `- Social proof: ${brief.socialProof}`,
    `- Brand palette: ${brief.brandColors}`,
    `- Brand identity: ${brief.logoDescription}`,
    `- Marketing angle: ${brief.angle ?? 'general'}`,
    '',
    'DESIGN DIRECTION:',
    '- Create a polished, multi-layered ad composition (NOT just a photo with text)',
    '- Use distinct visual zones: branded header area, copy area, lifestyle imagery, CTA bar',
    '- Typography should be bold, modern, and highly legible',
    '- Include subtle graphic elements (icons, patterns, gradients) that enhance the brand feel',
    '- The final output should look like it was made in Figma/Photoshop by a professional',
    '- This should look like a real ad you would see scrolling Facebook on your phone',
    '- The lifestyle/product photo should be realistic and warm',
    '- Text must be PERFECTLY readable with high contrast',
    angleDirective,
  ].join('\n');

  try {
    console.log(`[generate-ad] Starting GPT-5.1 generation for ${brief.businessName} (${brief.angle ?? 'general'})...`);
    const startTime = Date.now();

    const res = await fetch(OPENAI_IMAGE_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-5.1',
        messages: [{ role: 'user', content: prompt }],
        modalities: ['image'],
        image_config: { image_size: '1024x1536', quality: 'high' },
      }),
    });

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    if (!res.ok) {
      const errText = await res.text().catch(() => 'Unknown error');
      console.error(`[generate-ad] API error (${elapsed}s):`, res.status, errText.slice(0, 300));
      return null;
    }

    const data = await res.json();
    const images = data?.choices?.[0]?.message?.images ?? [];

    let base64Data: string | null = null;
    if (images.length > 0) {
      const img = images[0];
      const url = img?.image_url?.url ?? img?.url ?? '';
      if (url.startsWith('data:image')) {
        base64Data = url.split(',')[1];
      } else if (img?.b64_json) {
        base64Data = img.b64_json;
      }
    }

    if (!base64Data) {
      console.error(`[generate-ad] No image data in response (${elapsed}s)`);
      return null;
    }

    console.log(`[generate-ad] Image generated in ${elapsed}s, uploading to S3...`);

    // Upload to S3
    const imageUrl = await uploadAdImageToS3(base64Data, brief.businessName, brief.angle ?? 'ad');
    console.log(`[generate-ad] Upload complete: ${imageUrl ? 'success' : 'failed'}`);
    return imageUrl;
  } catch (err: any) {
    console.error('[generate-ad] Error:', err?.message);
    return null;
  }
}

/**
 * Upload a base64 PNG image to S3 and return a public URL.
 */
async function uploadAdImageToS3(
  base64Data: string,
  businessName: string,
  angle: string,
): Promise<string | null> {
  try {
    const s3 = createS3Client();
    const { bucketName, folderPrefix } = getBucketConfig();

    const safeName = businessName.toLowerCase().replace(/[^a-z0-9]/g, '-').slice(0, 30);
    const timestamp = Date.now();
    const key = `${folderPrefix}public/ads/${safeName}/${angle}-${timestamp}.png`;

    const buffer = Buffer.from(base64Data, 'base64');

    await s3.send(new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      Body: buffer,
      ContentType: 'image/png',
      ContentDisposition: 'inline',
    }));

    const region = process.env.AWS_REGION ?? 'us-west-2';
    const publicUrl = `https://${bucketName}.s3.${region}.amazonaws.com/${key}`;
    return publicUrl;
  } catch (err: any) {
    console.error('[s3-upload] Error:', err?.message);
    return null;
  }
}

/**
 * Generate all 3 ad images for a completed analysis.
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
