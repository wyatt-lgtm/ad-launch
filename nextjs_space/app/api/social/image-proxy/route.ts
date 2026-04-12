export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';

const TOMBSTONE_URL = process.env.TOMBSTONE_API_URL ?? 'https://tombstone-api-xjc4.onrender.com';

/**
 * Extracts the R2 object key from a full R2 URL or bare key.
 */
function extractR2Key(input: string): string {
  if (!input) return '';
  try {
    if (input.startsWith('http')) {
      const url = new URL(input);
      let path = url.pathname.replace(/^\/+/, '');
      if (path.startsWith('tombstoner2/')) path = path.slice('tombstoner2/'.length);
      return path;
    }
  } catch {}
  if (input.startsWith('tombstoner2/')) return input.slice('tombstoner2/'.length);
  return input;
}

/**
 * GET /api/social/image-proxy?key=renders/task_899/task_899_20260412_043940.png
 * 
 * Resolves the R2 artifact key to a presigned URL via Tombstone, fetches the image,
 * and streams it back to the client. This avoids CORS / presigned URL expiry issues.
 */
export async function GET(request: NextRequest) {
  const rawKey = request.nextUrl.searchParams.get('key') ?? '';
  if (!rawKey) {
    return NextResponse.json({ error: 'Missing key parameter' }, { status: 400 });
  }

  // S3 public URLs — redirect directly
  if (rawKey.includes('.s3.') && rawKey.includes('amazonaws.com')) {
    return NextResponse.redirect(rawKey);
  }

  const r2Key = extractR2Key(rawKey);

  try {
    // Resolve to presigned URL
    const resolveRes = await fetch(
      `${TOMBSTONE_URL}/artifacts/resolve?artifact_path=${encodeURIComponent(r2Key)}`,
      { cache: 'no-store' }
    );
    if (!resolveRes.ok) {
      return NextResponse.json({ error: 'Failed to resolve artifact' }, { status: 502 });
    }
    const resolveData = await resolveRes.json();
    const artifactUrl = resolveData?.artifact_url;
    if (!artifactUrl) {
      return NextResponse.json({ error: 'No artifact URL returned' }, { status: 502 });
    }

    // Fetch the actual image through the presigned URL (server-side, no CORS)
    const imgRes = await fetch(artifactUrl, { cache: 'no-store' });
    if (!imgRes.ok) {
      // If presigned fails, try direct fetch of the raw URL
      return NextResponse.json({ error: `Image fetch failed: ${imgRes.status}` }, { status: 502 });
    }

    const contentType = imgRes.headers.get('content-type') || 'image/png';
    const imgBuffer = await imgRes.arrayBuffer();

    return new NextResponse(imgBuffer, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=86400, immutable',
      },
    });
  } catch (err: any) {
    console.error('[image-proxy] Error:', err?.message);
    return NextResponse.json({ error: 'Image proxy failed' }, { status: 500 });
  }
}
