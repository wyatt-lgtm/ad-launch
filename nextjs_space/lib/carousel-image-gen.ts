/**
 * Carousel Slide Image Generator
 *
 * Generates square images for carousel slides using the Abacus AI image API.
 * Each image contains a headline + 2-3 bullet points with readable typography.
 * Uploads to S3 and returns public URLs.
 */

import { PutObjectCommand } from '@aws-sdk/client-s3';
import { createS3Client, getBucketConfig } from './aws-config';
import type { CarouselSlide } from './article-carousel';

const TOMBSTONE_URL = process.env.TOMBSTONE_API_URL ?? 'https://tombstone-api-xjc4.onrender.com';

export interface SlideImageResult {
  slideNumber: number;
  imageUrl: string | null;
  error?: string;
}

/**
 * Generate images for all carousel slides.
 * Runs sequentially to avoid rate limits.
 */
export async function generateCarouselImages(
  slides: CarouselSlide[],
  context: {
    businessName: string;
    brandColors?: string;
    sourcePublisher: string;
    articleTitle: string;
  },
): Promise<SlideImageResult[]> {
  const results: SlideImageResult[] = [];

  for (const slide of slides.slice(0, 3)) {
    try {
      const imageUrl = await generateSlideImage(slide, context);
      results.push({ slideNumber: slide.slide_number, imageUrl });
    } catch (err: any) {
      console.error(`[carousel-img] Slide ${slide.slide_number} generation failed:`, err.message);
      results.push({ slideNumber: slide.slide_number, imageUrl: null, error: err.message });
    }
  }

  return results;
}

/**
 * Generate a single slide image with text overlay.
 */
async function generateSlideImage(
  slide: CarouselSlide,
  context: {
    businessName: string;
    brandColors?: string;
    sourcePublisher: string;
    articleTitle: string;
  },
): Promise<string | null> {
  console.log(`[carousel-img] Requesting slide ${slide.slide_number} from Tombstone: "${slide.headline.slice(0, 50)}"`);
  const startTime = Date.now();

  const res = await fetch(`${TOMBSTONE_URL}/carousel/generate-slide-image`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slide, context }),
  });

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Tombstone slide image API error ${res.status} (${elapsed}s): ${errText.slice(0, 200)}`);
  }

  const data = await res.json();

  // Tombstone may return { imageUrl } directly (if it uploads to S3) or { base64 }
  if (data.imageUrl) {
    console.log(`[carousel-img] Slide ${slide.slide_number} received URL from Tombstone in ${elapsed}s`);
    return data.imageUrl;
  }

  const base64Data = data.base64;
  if (!base64Data) {
    console.error(`[carousel-img] No image data for slide ${slide.slide_number} from Tombstone (${elapsed}s)`);
    return null;
  }

  console.log(`[carousel-img] Slide ${slide.slide_number} generated via Tombstone in ${elapsed}s, uploading to S3...`);

  // Upload to S3 from frontend
  const imageUrl = await uploadSlideToS3(
    base64Data,
    context.businessName,
    slide.slide_number,
  );

  return imageUrl;
}

/**
 * Upload a carousel slide image to S3.
 */
async function uploadSlideToS3(
  base64Data: string,
  businessName: string,
  slideNumber: number,
): Promise<string | null> {
  try {
    const s3 = createS3Client();
    const { bucketName, folderPrefix } = getBucketConfig();

    const safeName = businessName.toLowerCase().replace(/[^a-z0-9]/g, '-').slice(0, 30);
    const timestamp = Date.now();
    const key = `${folderPrefix}public/carousels/${safeName}/slide-${slideNumber}-${timestamp}.png`;

    const buffer = Buffer.from(base64Data, 'base64');

    await s3.send(new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      Body: buffer,
      ContentType: 'image/png',
      ContentDisposition: 'inline',
    }));

    const region = process.env.AWS_REGION ?? 'us-west-2';
    return `https://${bucketName}.s3.${region}.amazonaws.com/${key}`;
  } catch (err: any) {
    console.error(`[carousel-img] S3 upload failed for slide ${slideNumber}:`, err.message);
    return null;
  }
}
