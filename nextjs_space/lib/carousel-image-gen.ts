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

const IMAGE_API = 'https://apps.abacus.ai/v1/chat/completions';

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
  const apiKey = process.env.ABACUSAI_API_KEY;
  if (!apiKey) {
    throw new Error('ABACUSAI_API_KEY not configured');
  }

  const bulletsText = slide.overlay_text.bullets
    .map((b, i) => `  ${i + 1}. "${b}"`)
    .join('\n');

  const colorDirective = context.brandColors
    ? `Use these brand colors as accent: ${context.brandColors}. `
    : 'Use a clean, modern color palette with bold accent colors. ';

  const prompt = [
    `Create a square social media carousel slide image (1080×1080px style).`,
    '',
    'DESIGN REQUIREMENTS:',
    '- This is an INFORMATIONAL carousel slide, not an ad. Think educational/value content.',
    '- Clean, modern layout with clear visual hierarchy.',
    '- Large, bold headline text at the top that is PERFECTLY readable.',
    '- Numbered bullet points below, each concise and legible.',
    '- Optional small footer text at bottom.',
    '- Use subtle abstract background (gradient, geometric shapes, or soft photography).',
    '- Do NOT use busy or distracting backgrounds.',
    '- All text must have HIGH contrast against the background.',
    '- Professional typography — think LinkedIn carousel or Instagram infographic style.',
    `- ${colorDirective}`,
    '',
    `SLIDE ${slide.slide_number} CONTENT:`,
    `Headline: "${slide.overlay_text.headline}"`,
    `Bullets:`,
    bulletsText,
    `Footer: "Source: ${context.sourcePublisher}"`,
    '',
    `VISUAL THEME (for background/decoration only — the TEXT above is what matters):`,
    slide.image_prompt,
    '',
    'CRITICAL: The headline and bullet text MUST be rendered exactly as provided above.',
    'The text is the primary content — make it the visual focal point.',
    'Keep bullets to a single line each. Use icons or numbers as bullet markers.',
  ].join('\n');

  console.log(`[carousel-img] Generating slide ${slide.slide_number}: "${slide.headline.slice(0, 50)}"`);
  const startTime = Date.now();

  const res = await fetch(IMAGE_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-5.1',
      messages: [{ role: 'user', content: prompt }],
      modalities: ['image'],
      image_config: { image_size: '1024x1024', quality: 'high' },
    }),
  });

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Image API error ${res.status} (${elapsed}s): ${errText.slice(0, 200)}`);
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
    console.error(`[carousel-img] No image data for slide ${slide.slide_number} (${elapsed}s)`);
    return null;
  }

  console.log(`[carousel-img] Slide ${slide.slide_number} generated in ${elapsed}s, uploading...`);

  // Upload to S3
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
