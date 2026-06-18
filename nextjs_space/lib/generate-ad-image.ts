/**
 * GPT-5.1 Designer Brief Ad Generation
 * Generates professional Facebook ad creatives using a structured "agency brief" prompt pattern.
 * Returns a public S3 URL for the generated image.
 */

import { PutObjectCommand } from '@aws-sdk/client-s3';
import { createS3Client, getBucketConfig } from './aws-config';
import { reviewMediaConceptBeforeGeneration } from './media-war-room';
import { reviewRenderedMediaBeforeReady } from './media-qa';

const TOMBSTONE_URL = process.env.TOMBSTONE_API_URL ?? 'https://tombstone-api-xjc4.onrender.com';

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
  try {
    // ── War Room: review concept before expensive generation ──
    const warRoomInput = {
      businessName: brief.businessName,
      platform: 'facebook',
      postCopy: brief.subheadline,
      headline: brief.headline,
      cta: brief.cta,
      visualDirection: `${brief.angle ?? 'general'} angle ad for ${brief.industry}. Brand colors: ${brief.brandColors}. ${brief.logoDescription}.`,
      generationPrompt: `Ad creative for ${brief.businessName}`,
      mediaType: 'image' as const,
    };

    const warRoom = await reviewMediaConceptBeforeGeneration(warRoomInput);

    if (warRoom.decision === 'reject') {
      console.warn(`[generate-ad] War Room REJECTED concept for ${brief.businessName} (${brief.angle}): ${warRoom.failReasons.join(' | ')}`);
      return null;
    }

    console.log(`[generate-ad] Requesting image from Tombstone for ${brief.businessName} (${brief.angle ?? 'general'})...`);
    const startTime = Date.now();

    const res = await fetch(`${TOMBSTONE_URL}/generate-ad-image`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        brief,
        revisedPrompt: warRoom.decision === 'revise' ? warRoom.revisedGenerationPrompt : undefined,
      }),
    });

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    if (!res.ok) {
      const errText = await res.text().catch(() => 'Unknown error');
      console.error(`[generate-ad] Tombstone error (${elapsed}s):`, res.status, errText.slice(0, 300));
      return null;
    }

    const data = await res.json();

    // Tombstone may return { base64, imageUrl } — prefer imageUrl if Tombstone uploaded to S3
    if (data.imageUrl) {
      console.log(`[generate-ad] Tombstone returned image URL in ${elapsed}s`);

      // ── Post-generation QA ──
      const qaResult = await reviewRenderedMediaBeforeReady({
        imageUrl: data.imageUrl,
        postCopy: brief.subheadline,
        headline: brief.headline,
        cta: brief.cta,
        businessName: brief.businessName,
        storyTitle: `${brief.angle ?? 'general'} ad for ${brief.businessName}`,
        mediaType: 'image',
        platform: 'facebook',
      });

      if (!qaResult.passed && qaResult.score >= 0) {
        console.warn(`[generate-ad] Post-gen QA REJECTED image for ${brief.businessName} (${brief.angle}): ${qaResult.failReasons.join(' | ')}`);
        return null;
      }

      return data.imageUrl;
    }

    // Fallback: Tombstone returned base64, upload to S3 from frontend
    const base64Data = data.base64;
    if (!base64Data) {
      console.error(`[generate-ad] No image data from Tombstone (${elapsed}s)`);
      return null;
    }

    console.log(`[generate-ad] Image generated via Tombstone in ${elapsed}s, uploading to S3...`);
    const imageUrl = await uploadAdImageToS3(base64Data, brief.businessName, brief.angle ?? 'ad');
    console.log(`[generate-ad] Upload complete: ${imageUrl ? 'success' : 'failed'}`);

    // ── Post-generation QA ──
    if (imageUrl) {
      const qaResult = await reviewRenderedMediaBeforeReady({
        imageUrl,
        postCopy: brief.subheadline,
        headline: brief.headline,
        cta: brief.cta,
        businessName: brief.businessName,
        storyTitle: `${brief.angle ?? 'general'} ad for ${brief.businessName}`,
        mediaType: 'image',
        platform: 'facebook',
      });

      if (!qaResult.passed && qaResult.score >= 0) {
        console.warn(`[generate-ad] Post-gen QA REJECTED image for ${brief.businessName} (${brief.angle}): ${qaResult.failReasons.join(' | ')}`);
        return null;
      }
    }

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
