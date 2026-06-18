/**
 * Carousel Slide Image Generator
 *
 * Generates square images for carousel slides using the Abacus AI image API.
 * Each image contains a headline + 2-3 bullet points with readable typography.
 * Uploads to S3 and returns public URLs.
 */

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

  // Tombstone must return imageUrl — frontend does not upload to S3
  console.error(`[carousel-img] Tombstone did not return imageUrl for slide ${slide.slide_number} (${elapsed}s)`);
  return null;
}
