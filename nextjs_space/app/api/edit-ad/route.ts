export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';

const TOMBSTONE_URL = process.env.TOMBSTONE_API_URL ?? 'https://tombstone-api-xjc4.onrender.com';

/**
 * POST /api/edit-ad
 *
 * Proxies ad-image edit requests to Tombstone.
 * The frontend MUST NOT hold model-provider credentials — all AI/image
 * generation routes through Tombstone which owns model keys and routing.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const { prompt, headline, caption, angle, businessId } = body ?? {};

    if (!prompt) {
      return NextResponse.json({ error: 'Edit prompt is required' }, { status: 400 });
    }

    const res = await fetch(`${TOMBSTONE_URL}/edit-ad-image`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt,
        headline: headline ?? '',
        caption: caption ?? '',
        angle: angle ?? 'General',
        business_id: businessId ?? null,
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.error(`[edit-ad] Tombstone error ${res.status}:`, errText.slice(0, 300));
      return NextResponse.json(
        { error: res.status === 422 ? 'Creative concept needs improvement. Please refine your edit request.' : 'Image generation failed' },
        { status: res.status >= 400 && res.status < 500 ? res.status : 500 },
      );
    }

    const data = await res.json();
    return NextResponse.json({ imageUrl: data?.imageUrl ?? data?.image_url ?? null });
  } catch (err: any) {
    console.error('[edit-ad] Error:', err?.message ?? err);
    return NextResponse.json({ error: 'Failed to generate edited image' }, { status: 500 });
  }
}
