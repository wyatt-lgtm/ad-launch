export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';

const VALID_FREQUENCIES = [
  '1x_week', '2x_week', '3x_week', '5x_week',
  '1x_day', '2x_day', '3x_day',
];

/**
 * GET /api/publish/settings?businessId=xxx
 * Returns the auto-publish settings for a business.
 */
export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const businessId = request.nextUrl.searchParams.get('businessId');
  if (!businessId) {
    return NextResponse.json({ error: 'businessId is required' }, { status: 400 });
  }

  // Verify ownership
  const user = await prisma.user.findUnique({ where: { email: session.user.email } });
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  const business = await prisma.business.findFirst({
    where: { id: businessId, userId: user.id },
  });
  if (!business) {
    return NextResponse.json({ error: 'Business not found' }, { status: 404 });
  }

  const settings = await prisma.publishSettings.findUnique({
    where: { businessId },
  });

  // Return defaults if no settings exist yet
  if (!settings) {
    return NextResponse.json({
      autoPublish: false,
      frequency: '3x_week',
      preferredTime: '10:00',
      timezone: 'America/Denver',
      platforms: [],
    });
  }

  return NextResponse.json({
    autoPublish: settings.autoPublish,
    frequency: settings.frequency,
    preferredTime: settings.preferredTime,
    timezone: settings.timezone,
    platforms: settings.platforms,
  });
}

/**
 * PUT /api/publish/settings
 * Create or update auto-publish settings for a business.
 */
export async function PUT(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const { businessId, autoPublish, frequency, preferredTime, timezone, platforms } = body;

  if (!businessId) {
    return NextResponse.json({ error: 'businessId is required' }, { status: 400 });
  }

  // Verify ownership
  const user = await prisma.user.findUnique({ where: { email: session.user.email } });
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  const business = await prisma.business.findFirst({
    where: { id: businessId, userId: user.id },
  });
  if (!business) {
    return NextResponse.json({ error: 'Business not found' }, { status: 404 });
  }

  // Validate frequency
  if (frequency && !VALID_FREQUENCIES.includes(frequency)) {
    return NextResponse.json(
      { error: `Invalid frequency. Must be one of: ${VALID_FREQUENCIES.join(', ')}` },
      { status: 400 }
    );
  }

  // Validate preferredTime format HH:mm
  if (preferredTime && !/^\d{2}:\d{2}$/.test(preferredTime)) {
    return NextResponse.json(
      { error: 'preferredTime must be in HH:mm format' },
      { status: 400 }
    );
  }

  const settings = await prisma.publishSettings.upsert({
    where: { businessId },
    create: {
      businessId,
      autoPublish: autoPublish ?? false,
      frequency: frequency ?? '3x_week',
      preferredTime: preferredTime ?? '10:00',
      timezone: timezone ?? 'America/Denver',
      platforms: Array.isArray(platforms) ? platforms : [],
    },
    update: {
      ...(typeof autoPublish === 'boolean' && { autoPublish }),
      ...(frequency && { frequency }),
      ...(preferredTime && { preferredTime }),
      ...(timezone && { timezone }),
      ...(Array.isArray(platforms) && { platforms }),
    },
  });

  return NextResponse.json({
    autoPublish: settings.autoPublish,
    frequency: settings.frequency,
    preferredTime: settings.preferredTime,
    timezone: settings.timezone,
    platforms: settings.platforms,
  });
}
