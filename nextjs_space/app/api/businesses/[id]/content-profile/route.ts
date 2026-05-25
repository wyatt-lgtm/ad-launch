export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';
import { getOrEnrichContentProfile, TOPIC_CATEGORIES, AUDIENCE_OPTIONS, TONE_OPTIONS } from '@/lib/content-profile';

/**
 * GET /api/businesses/[id]/content-profile
 * Returns the content profile for a business. Enriches via LLM if missing.
 *
 * POST /api/businesses/[id]/content-profile
 * Force-refreshes the content profile.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const user = await prisma.user.findUnique({ where: { email: session.user.email }, select: { id: true } });
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const business = await prisma.business.findFirst({
    where: { id: params.id, userId: user.id },
    select: { id: true },
  });
  if (!business) return NextResponse.json({ error: 'Business not found' }, { status: 404 });

  const profile = await getOrEnrichContentProfile(params.id);
  if (!profile) {
    return NextResponse.json({ error: 'Failed to generate content profile' }, { status: 500 });
  }

  return NextResponse.json({
    ...profile,
    topicCategories: TOPIC_CATEGORIES,
    audienceOptions: AUDIENCE_OPTIONS,
    toneOptions: TONE_OPTIONS,
  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const user = await prisma.user.findUnique({ where: { email: session.user.email }, select: { id: true } });
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const business = await prisma.business.findFirst({
    where: { id: params.id, userId: user.id },
    select: { id: true },
  });
  if (!business) return NextResponse.json({ error: 'Business not found' }, { status: 404 });

  const profile = await getOrEnrichContentProfile(params.id, true);
  if (!profile) {
    return NextResponse.json({ error: 'Failed to refresh content profile' }, { status: 500 });
  }

  return NextResponse.json({
    ...profile,
    topicCategories: TOPIC_CATEGORIES,
    audienceOptions: AUDIENCE_OPTIONS,
    toneOptions: TONE_OPTIONS,
    refreshed: true,
  });
}
