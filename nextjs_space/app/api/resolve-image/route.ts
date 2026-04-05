export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';

const TOMBSTONE_API = process.env.TOMBSTONE_API_URL ?? 'https://tombstone-api-xjc4.onrender.com';

/**
 * Extracts the R2 object key from either:
 *  - A bare key like "ads/task_359_c0/task_359_campaign_1_1x1.png"
 *  - A full presigned URL like "https://...r2.cloudflarestorage.com/tombstoner2/ads/..."
 */
function extractR2Key(input: string): string {
  if (!input) return '';
  try {
    // If it looks like a URL, parse the path
    if (input.startsWith('http')) {
      const url = new URL(input);
      let path = url.pathname.replace(/^\/+/, '');
      // Strip bucket prefix if present
      if (path.startsWith('tombstoner2/')) {
        path = path.slice('tombstoner2/'.length);
      }
      return path;
    }
  } catch {}
  // Already a bare key — strip bucket prefix if someone passed it
  if (input.startsWith('tombstoner2/')) {
    return input.slice('tombstoner2/'.length);
  }
  return input;
}

/**
 * GET /api/resolve-image?key=ads/task_359_c0/task_359_campaign_1_1x1.png
 * Returns { url: "https://i.ytimg.com/vi/6P03CGoo5UU/hqdefault.jpg" }
 *
 * Also accepts the full presigned URL as the key — it will extract the R2 key.
 */
export async function GET(request: NextRequest) {
  const rawKey = request.nextUrl.searchParams.get('key') ?? '';

  if (!rawKey) {
    return NextResponse.json({ error: 'Missing key parameter' }, { status: 400 });
  }

  // Pass through S3 public URLs (GPT-5.1 generated images) — no resolution needed
  if (rawKey.includes('.s3.') && rawKey.includes('amazonaws.com')) {
    return NextResponse.json({ url: rawKey });
  }

  const r2Key = extractR2Key(rawKey);

  try {
    const res = await fetch(
      `${TOMBSTONE_API}/artifacts/resolve?artifact_path=${encodeURIComponent(r2Key)}`,
      { cache: 'no-store' },
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.artifact_url) {
      return NextResponse.json({ error: 'Failed to resolve image' }, { status: 502 });
    }
    return NextResponse.json({ url: data.artifact_url });
  } catch (err: any) {
    console.error('[resolve-image] Error:', err?.message);
    return NextResponse.json({ error: 'Failed to resolve image' }, { status: 500 });
  }
}
