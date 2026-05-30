export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { reviewMediaConceptBeforeGeneration } from '@/lib/media-war-room';
import { reviewRenderedMediaBeforeReady } from '@/lib/media-qa';

const IMAGE_API = 'https://apps.abacus.ai/v1/chat/completions';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const { prompt, headline, caption, angle } = body ?? {};

    if (!prompt) {
      return NextResponse.json({ error: 'Edit prompt is required' }, { status: 400 });
    }

    const apiKey = process.env.ABACUSAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'Image generation not configured' }, { status: 500 });
    }

    // Build a rich prompt combining the ad context with user's edit request
    const fullPrompt = [
      `You are a senior graphic designer. Modify this Facebook ad creative based on the user's request.`,
      '',
      `CURRENT AD CONTEXT:`,
      `- Marketing Angle: ${angle ?? 'General'}`,
      `- Headline: ${headline ?? 'Ad'}`,
      `- Caption: ${caption ?? ''}`,
      '',
      `USER'S EDIT REQUEST: ${prompt}`,
      '',
      'DESIGN RULES:',
      '- Create a polished, multi-layered ad composition (NOT just a photo with text)',
      '- Use distinct visual zones: branded header, copy area, lifestyle imagery, CTA bar',
      '- Typography should be bold, modern, and highly legible',
      '- This should look like a real professionally designed Facebook sponsored post',
      '- Incorporate the user\'s specific request while maintaining professional ad quality',
    ].join('\n');

    // ── War Room: review edit concept before generation ──
    const warRoom = await reviewMediaConceptBeforeGeneration({
      businessName: angle ?? 'Ad',
      platform: 'facebook',
      postCopy: caption ?? '',
      headline: headline ?? '',
      cta: '',
      visualDirection: prompt,
      generationPrompt: fullPrompt,
      mediaType: 'image',
    });

    if (warRoom.decision === 'reject') {
      console.warn(`[edit-ad] War Room REJECTED edit concept: ${warRoom.failReasons.join(' | ')}`);
      return NextResponse.json({ error: 'Creative concept needs improvement. Please refine your edit request.' }, { status: 422 });
    }

    let finalPrompt = fullPrompt;
    if (warRoom.decision === 'revise' && warRoom.revisedGenerationPrompt) {
      console.log('[edit-ad] War Room REVISED edit prompt');
      finalPrompt = warRoom.revisedGenerationPrompt;
    }

    const res = await fetch(IMAGE_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-5.1',
        messages: [
          { role: 'user', content: finalPrompt },
        ],
        modalities: ['image'],
        image_config: { image_size: '1024x1536', quality: 'high' },
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => 'Unknown error');
      console.error('Image generation API error:', res.status, errText);
      return NextResponse.json({ error: 'Image generation failed' }, { status: 500 });
    }

    const data = await res.json();
    // Try multiple possible response shapes
    const images = data?.choices?.[0]?.message?.images
      ?? data?.data
      ?? [];

    let imageUrl: string | null = null;
    if (images.length > 0) {
      const img = images[0];
      if (img?.image_url?.url) {
        imageUrl = img.image_url.url;
      } else if (img?.url) {
        imageUrl = img.url;
      } else if (img?.b64_json) {
        imageUrl = `data:image/png;base64,${img.b64_json}`;
      }
    }

    if (!imageUrl) {
      console.error('No images in response:', JSON.stringify(data).slice(0, 800));
      return NextResponse.json({ error: 'No image was generated' }, { status: 500 });
    }

    // ── Post-generation QA ──
    const qaResult = await reviewRenderedMediaBeforeReady({
      imageUrl,
      postCopy: caption ?? '',
      headline: headline ?? '',
      cta: '',
      businessName: angle ?? 'Ad',
      storyTitle: prompt,
      mediaType: 'image',
      platform: 'facebook',
    });

    if (!qaResult.passed && qaResult.score >= 0) {
      console.warn(`[edit-ad] Post-gen QA REJECTED: ${qaResult.failReasons.join(' | ')}`);
      return NextResponse.json({ error: 'Generated image did not pass quality review. Please try a different edit.' }, { status: 422 });
    }

    return NextResponse.json({ imageUrl });
  } catch (err: any) {
    console.error('Edit ad error:', err?.message ?? err);
    return NextResponse.json({ error: 'Failed to generate edited image' }, { status: 500 });
  }
}
