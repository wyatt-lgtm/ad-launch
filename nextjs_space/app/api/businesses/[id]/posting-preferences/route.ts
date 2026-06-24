export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';

/**
 * GET /api/businesses/[id]/posting-preferences
 * Returns the posting preferences (PublishSettings) for a business.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const userId = (session.user as any).id;
    const businessId = params.id;

    // Verify ownership
    const business = await prisma.business.findFirst({
      where: { id: businessId, userId },
    });
    if (!business) {
      return NextResponse.json({ error: 'Business not found' }, { status: 404 });
    }

    const settings = await prisma.publishSettings.findUnique({
      where: { businessId },
    });

    return NextResponse.json({ settings: settings ?? null });
  } catch (err: any) {
    console.error('[posting-preferences GET]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * PUT /api/businesses/[id]/posting-preferences
 * Upsert posting preferences for a business.
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const userId = (session.user as any).id;
    const businessId = params.id;

    const business = await prisma.business.findFirst({
      where: { id: businessId, userId },
    });
    if (!business) {
      return NextResponse.json({ error: 'Business not found' }, { status: 404 });
    }

    const body = await request.json().catch(() => ({}));
    const {
      postingGoal,
      approvalMode,
      cadence,
      preferredDays,
      preferredTimes,
      defaultChannels,
      autopilotEnabled,
      onboardingComplete,
      timezone,
      frequency,
    } = body;

    const settings = await prisma.publishSettings.upsert({
      where: { businessId },
      create: {
        businessId,
        postingGoal: postingGoal ?? null,
        approvalMode: approvalMode ?? 'review_first',
        cadence: cadence ?? 'standard',
        preferredDays: preferredDays ?? [],
        preferredTimes: preferredTimes ?? [],
        defaultChannels: defaultChannels ?? [],
        autopilotEnabled: autopilotEnabled ?? false,
        onboardingComplete: onboardingComplete ?? false,
        timezone: timezone ?? 'America/Denver',
        frequency: frequency ?? '3x_week',
      },
      update: {
        ...(postingGoal !== undefined && { postingGoal }),
        ...(approvalMode !== undefined && { approvalMode }),
        ...(cadence !== undefined && { cadence }),
        ...(preferredDays !== undefined && { preferredDays }),
        ...(preferredTimes !== undefined && { preferredTimes }),
        ...(defaultChannels !== undefined && { defaultChannels }),
        ...(autopilotEnabled !== undefined && { autopilotEnabled }),
        ...(onboardingComplete !== undefined && { onboardingComplete }),
        ...(timezone !== undefined && { timezone }),
        ...(frequency !== undefined && { frequency }),
      },
    });

    return NextResponse.json({ settings });
  } catch (err: any) {
    console.error('[posting-preferences PUT]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
