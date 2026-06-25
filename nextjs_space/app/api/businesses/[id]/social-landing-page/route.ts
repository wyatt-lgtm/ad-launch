import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

// GET – fetch the current social landing page settings for a business
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const user = await prisma.user.findUnique({ where: { email: session.user.email } });
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  const business = await prisma.business.findFirst({
    where: { id: params.id, userId: user.id },
    select: {
      defaultSocialLandingPageUrl: true,
      defaultSocialLandingPageEnabled: true,
      defaultSocialCtaText: true,
    },
  });
  if (!business) return NextResponse.json({ error: 'Business not found' }, { status: 404 });

  return NextResponse.json(business);
}

// PUT – save social landing page settings
export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const user = await prisma.user.findUnique({ where: { email: session.user.email } });
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  // Verify ownership
  const existing = await prisma.business.findFirst({
    where: { id: params.id, userId: user.id },
    select: { id: true },
  });
  if (!existing) return NextResponse.json({ error: 'Business not found' }, { status: 404 });

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { url, enabled, ctaText } = body;

  // Validate URL if provided and non-empty
  const trimmedUrl = typeof url === 'string' ? url.trim() : null;
  if (trimmedUrl) {
    if (!/^https?:\/\//i.test(trimmedUrl)) {
      return NextResponse.json(
        { error: 'Please enter a valid landing page URL.', field: 'url' },
        { status: 422 }
      );
    }
    try {
      const parsed = new URL(trimmedUrl);
      if (!parsed.hostname || !parsed.hostname.includes('.')) {
        throw new Error('Invalid hostname');
      }
      // Check for malformed characters
      if (/[\s<>{}|\\^`]/.test(trimmedUrl)) {
        throw new Error('Malformed characters');
      }
    } catch {
      return NextResponse.json(
        { error: 'Please enter a valid landing page URL.', field: 'url' },
        { status: 422 }
      );
    }
  }

  const resolvedEnabled = typeof enabled === 'boolean' ? enabled : false;
  const resolvedCtaText = typeof ctaText === 'string' && ctaText.trim()
    ? ctaText.trim()
    : 'Learn more here:';

  const updated = await prisma.business.update({
    where: { id: params.id },
    data: {
      defaultSocialLandingPageUrl: trimmedUrl || null,
      defaultSocialLandingPageEnabled: resolvedEnabled,
      defaultSocialCtaText: resolvedCtaText,
    },
    select: {
      defaultSocialLandingPageUrl: true,
      defaultSocialLandingPageEnabled: true,
      defaultSocialCtaText: true,
    },
  });

  // Apply to existing posts if requested
  const applyTo = body.applyTo; // 'future' | 'drafts' | 'scheduled'
  let appliedCount = 0;

  if (trimmedUrl && resolvedEnabled && (applyTo === 'drafts' || applyTo === 'scheduled')) {
    const { buildLandingPageBlock } = await import('@/lib/social-landing-page');
    const ctaConfig = { url: trimmedUrl, ctaText: resolvedCtaText, enabled: true };

    if (applyTo === 'drafts') {
      // Update existing draft social posts (pending_approval, approved)
      const drafts = await prisma.socialPost.findMany({
        where: {
          businessId: params.id,
          status: { in: ['pending_approval', 'approved'] },
        },
        select: { id: true, caption: true },
      });
      for (const draft of drafts) {
        const block = buildLandingPageBlock(draft.caption || '', ctaConfig);
        if (block) {
          await prisma.socialPost.update({
            where: { id: draft.id },
            data: { caption: (draft.caption || '') + block },
          });
          appliedCount++;
        }
      }
    } else if (applyTo === 'scheduled') {
      // Update existing scheduled posts
      const scheduled = await prisma.scheduledPost.findMany({
        where: {
          businessId: params.id,
          status: { in: ['needs_approval', 'approved', 'scheduled'] },
        },
        select: { id: true, caption: true },
      });
      for (const sp of scheduled) {
        const block = buildLandingPageBlock(sp.caption || '', ctaConfig);
        if (block) {
          await prisma.scheduledPost.update({
            where: { id: sp.id },
            data: { caption: (sp.caption || '') + block },
          });
          appliedCount++;
        }
      }
    }
  }

  return NextResponse.json({ ...updated, appliedCount });
}
