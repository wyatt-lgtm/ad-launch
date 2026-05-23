export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const userId = (session.user as any).id;

  const biz = await prisma.business.findUnique({
    where: { id: params.id },
    select: { userId: true },
  });
  if (!biz || biz.userId !== userId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const settings = await prisma.scoutEmailSettings.findUnique({
    where: { businessId: params.id },
  });

  // Return defaults if no settings yet
  return NextResponse.json({
    settings: settings || {
      enabled: false,
      recipientEmail: (session.user as any).email || '',
      sendTimeUtc: '14:00',
      includeLocal: true,
      includeIndustry: true,
      includeNational: true,
      maxStories: 10,
    },
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const userId = (session.user as any).id;

  const biz = await prisma.business.findUnique({
    where: { id: params.id },
    select: { userId: true },
  });
  if (!biz || biz.userId !== userId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const body = await req.json();
  const {
    enabled,
    recipientEmail,
    sendTimeUtc,
    includeLocal,
    includeIndustry,
    includeNational,
    maxStories,
  } = body;

  // Validate
  if (typeof enabled !== 'undefined' && typeof enabled !== 'boolean') {
    return NextResponse.json({ error: 'enabled must be a boolean' }, { status: 400 });
  }
  if (recipientEmail !== undefined && typeof recipientEmail !== 'string') {
    return NextResponse.json({ error: 'recipientEmail must be a string' }, { status: 400 });
  }
  if (maxStories !== undefined && (typeof maxStories !== 'number' || maxStories < 1 || maxStories > 25)) {
    return NextResponse.json({ error: 'maxStories must be 1-25' }, { status: 400 });
  }
  if (sendTimeUtc !== undefined) {
    const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;
    if (!timeRegex.test(sendTimeUtc)) {
      return NextResponse.json({ error: 'sendTimeUtc must be HH:MM format' }, { status: 400 });
    }
  }

  const data: Record<string, any> = {};
  if (enabled !== undefined) data.enabled = enabled;
  if (recipientEmail !== undefined) data.recipientEmail = recipientEmail;
  if (sendTimeUtc !== undefined) data.sendTimeUtc = sendTimeUtc;
  if (includeLocal !== undefined) data.includeLocal = !!includeLocal;
  if (includeIndustry !== undefined) data.includeIndustry = !!includeIndustry;
  if (includeNational !== undefined) data.includeNational = !!includeNational;
  if (maxStories !== undefined) data.maxStories = maxStories;

  const settings = await prisma.scoutEmailSettings.upsert({
    where: { businessId: params.id },
    create: {
      businessId: params.id,
      ...data,
    },
    update: data,
  });

  return NextResponse.json({ settings });
}
