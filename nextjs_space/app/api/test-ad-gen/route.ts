export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';

const TOMBSTONE_URL = process.env.TOMBSTONE_API_URL ?? 'https://tombstone-api-xjc4.onrender.com';

/**
 * POST /api/test-ad-gen
 *
 * Dev/test endpoint for ad image generation strategy comparison.
 * Routes through Tombstone backend — the frontend does NOT hold model-provider credentials.
 *
 * Body: { strategies?: string[], businessName, industry, headline, subheadline, cta, brandColors, socialProof, logoDescription, websiteUrl }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));

    console.log('[test-ad-gen] Proxying to Tombstone backend...');
    const res = await fetch(`${TOMBSTONE_URL}/test-ad-gen`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.error(`[test-ad-gen] Tombstone error: ${res.status} ${errText.slice(0, 300)}`);
      return NextResponse.json(
        { error: 'Tombstone backend unavailable or returned an error', detail: errText.slice(0, 200) },
        { status: res.status >= 500 ? 502 : res.status },
      );
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (err: any) {
    console.error('[test-ad-gen] Error:', err?.message);
    return NextResponse.json(
      { error: 'Failed to proxy to Tombstone backend', detail: err?.message },
      { status: 502 },
    );
  }
}
