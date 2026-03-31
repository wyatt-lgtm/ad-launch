export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';

const ABACUS_API = 'https://apps.abacus.ai/v1/chat/completions';

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
    const systemPrompt = [
      'You are an expert Facebook ad designer.',
      'Generate a professional, eye-catching Facebook ad image.',
      'The image should be clean, high-quality, and suitable for a social media ad.',
      'Do NOT include any text overlays, watermarks, or logos in the image.',
      'Focus on compelling visual imagery that supports the ad message.',
    ].join(' ');

    const userPrompt = [
      `Create a Facebook ad image for the following ad:`,
      `Marketing Angle: ${angle ?? 'General'}`,
      `Headline: ${headline ?? 'Ad'}`,
      `Caption: ${caption ?? ''}`,
      '',
      `User's specific request for this image: ${prompt}`,
      '',
      'Generate a professional ad image that incorporates the user\'s request while maintaining ad quality.',
    ].join('\n');

    const fullPrompt = `${systemPrompt}\n\n${userPrompt}`;

    const res = await fetch(ABACUS_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt_image15',
        messages: [
          { role: 'user', content: fullPrompt },
        ],
        modalities: ['image'],
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

    return NextResponse.json({ imageUrl });
  } catch (err: any) {
    console.error('Edit ad error:', err?.message ?? err);
    return NextResponse.json({ error: 'Failed to generate edited image' }, { status: 500 });
  }
}
