export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';
import { verifyMagicToken } from '@/lib/magic-token';

/**
 * GET /api/post-package/[id]/download
 *
 * Downloads the post package as a JSON bundle (lightweight).
 * For MVP, returns a JSON file with all post data.
 * Auth via session or magic token.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  let userId: string | null = null;

  const session = await getServerSession(authOptions);
  if (session?.user?.email) {
    const user = await prisma.user.findUnique({ where: { email: session.user.email }, select: { id: true } });
    userId = user?.id || null;
  }

  if (!userId) {
    const token = req.nextUrl.searchParams.get('token');
    if (token) {
      const result = await verifyMagicToken(token);
      if (result.valid && result.payload) userId = result.payload.userId;
    }
  }

  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const pkg = await prisma.postPackage.findUnique({
    where: { id: params.id },
    include: { business: { select: { businessName: true, websiteUrl: true } } },
  });

  if (!pkg || pkg.userId !== userId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  if (pkg.status === 'generating') {
    return NextResponse.json({ error: 'Post is still being generated' }, { status: 409 });
  }

  // Build the download package
  const postCopyTxt = [
    pkg.headline ? `Headline: ${pkg.headline}` : '',
    '',
    pkg.postCopy || '',
    '',
    pkg.hashtags?.length ? `Hashtags: ${pkg.hashtags.join(' ')}` : '',
    '',
    pkg.cta ? `Call to Action: ${pkg.cta}` : '',
  ].filter(line => line !== undefined).join('\n').trim();

  const sourceInfoTxt = [
    `Story: ${pkg.storyTitle}`,
    `Source: ${pkg.storySource}`,
    `URL: ${pkg.storyUrl}`,
    `Summary: ${pkg.storySummary}`,
    `Suggested Angle: ${pkg.suggestedAngle}`,
  ].join('\n');

  const postingInstructionsTxt = [
    'POSTING INSTRUCTIONS',
    '====================',
    '',
    '1. Review the post copy in post-copy.txt',
    '2. Download the image (link below) and save to your device',
    '3. Open your social media platform (Facebook, Instagram, etc.)',
    '4. Create a new post, paste the copy, and attach the image',
    '5. Review and publish!',
    '',
    pkg.imageUrl ? `Image URL: ${pkg.imageUrl}` : 'No image was generated for this post.',
    '',
    `Business: ${pkg.business?.businessName || 'N/A'}`,
    `Website: ${pkg.business?.websiteUrl || 'N/A'}`,
    `Generated: ${pkg.completedAt?.toISOString() || pkg.createdAt.toISOString()}`,
    `Package ID: ${pkg.id}`,
  ].join('\n');

  const bundle = {
    'post-copy.txt': postCopyTxt,
    'source-info.txt': sourceInfoTxt,
    'posting-instructions.txt': postingInstructionsTxt,
    imageUrl: pkg.imageUrl || null,
  };

  // Update status if first download
  if (pkg.status === 'ready') {
    await prisma.postPackage.update({
      where: { id: pkg.id },
      data: { status: 'downloaded' },
    });
  }

  // Fire-and-forget: record feedback event for defensibility layers
  try {
    const TOMBSTONE_URL = process.env.TOMBSTONE_API_URL ?? 'https://tombstone-api-xjc4.onrender.com';
    fetch(`${TOMBSTONE_URL}/feedback-events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        business_id: pkg.businessId || pkg.business?.businessName?.toLowerCase().replace(/[^a-z0-9]+/g, '_') || 'unknown',
        event_type: 'package_downloaded',
        post_package_id: pkg.id,
        topic: pkg.suggestedAngle || pkg.storyTitle,
        cta: pkg.cta,
        metadata: {
          package_id: pkg.id,
          headline: pkg.headline,
          cta: pkg.cta,
          story_title: pkg.storyTitle,
          source: 'ad_launch',
        },
      }),
    }).catch(() => {});
  } catch (_) {}

  const filename = `ad-launch-post-${pkg.id.slice(0, 8)}.json`;
  return new NextResponse(JSON.stringify(bundle, null, 2), {
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}
