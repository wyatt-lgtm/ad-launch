export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';

const VALID_PLATFORMS = ['facebook', 'instagram', 'youtube', 'tiktok', 'pinterest', 'snapchat'];

/**
 * GET /api/social/accounts — List linked social accounts for current user
 */
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const userId = (session.user as any).id;

    const accounts = await prisma.socialAccount.findMany({
      where: { userId },
      orderBy: { platform: 'asc' },
    });

    return NextResponse.json({ accounts });
  } catch (error: any) {
    console.error('Social accounts GET error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * POST /api/social/accounts — Link a social account
 * Body: { platform, handle, profileUrl?, displayName? }
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const userId = (session.user as any).id;

    const body = await req.json();
    const { platform, handle, profileUrl, displayName } = body;

    if (!platform || !VALID_PLATFORMS.includes(platform)) {
      return NextResponse.json({ error: `Invalid platform. Must be one of: ${VALID_PLATFORMS.join(', ')}` }, { status: 400 });
    }
    if (!handle || typeof handle !== 'string' || handle.trim().length === 0) {
      return NextResponse.json({ error: 'Handle is required' }, { status: 400 });
    }

    const account = await prisma.socialAccount.upsert({
      where: { userId_platform: { userId, platform } },
      update: {
        handle: handle.trim(),
        profileUrl: profileUrl || null,
        displayName: displayName || null,
        isActive: true,
      },
      create: {
        userId,
        platform,
        handle: handle.trim(),
        profileUrl: profileUrl || null,
        displayName: displayName || null,
      },
    });

    return NextResponse.json({ account });
  } catch (error: any) {
    console.error('Social accounts POST error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * DELETE /api/social/accounts — Unlink a social account
 * Body: { platform }
 */
export async function DELETE(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const userId = (session.user as any).id;

    const body = await req.json();
    const { platform } = body;

    if (!platform) {
      return NextResponse.json({ error: 'Platform is required' }, { status: 400 });
    }

    await prisma.socialAccount.deleteMany({
      where: { userId, platform },
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Social accounts DELETE error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
