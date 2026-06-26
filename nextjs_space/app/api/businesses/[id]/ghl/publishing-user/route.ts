export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';
import { lookupGhlUserId } from '@/lib/ghl-social-planner';

type RouteContext = { params: { id: string } };

/**
 * GET /api/businesses/[id]/ghl/publishing-user
 *
 * Returns the saved default GHL publishing user for a business,
 * and optionally attempts to look up available users from GHL Users API.
 */
export async function GET(request: NextRequest, { params }: RouteContext) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const userId = (session.user as any).id;

    const business = await prisma.business.findFirst({
      where: { id: params.id, userId },
      select: {
        id: true,
        ghlLocationId: true,
        ghlApiToken: true,
        defaultGhlUserId: true,
        defaultGhlUserName: true,
        defaultGhlUserEmail: true,
        lastGhlUserVerifiedAt: true,
      },
    });
    if (!business) return NextResponse.json({ error: 'Business not found' }, { status: 404 });

    const savedUser = business.defaultGhlUserId ? {
      id: business.defaultGhlUserId,
      name: business.defaultGhlUserName,
      email: business.defaultGhlUserEmail,
      verifiedAt: business.lastGhlUserVerifiedAt,
    } : null;

    // Attempt dynamic lookup if CRM credentials exist
    let availableUsers: Array<{ id: string; name: string; email: string; role: string }> = [];
    let lookupStatus: 'success' | 'auth_failed' | 'no_users' | 'network_error' | 'no_crm' | 'error' = 'no_crm';
    let lookupError: string | null = null;

    if (business.ghlLocationId && business.ghlApiToken) {
      console.log('[ghl-publishing-user] Auto-discovering users', {
        businessId: business.id, ghlLocationId: business.ghlLocationId,
      });
      const result = await lookupGhlUserId(business.ghlLocationId, business.ghlApiToken);
      if (result.userId) {
        lookupStatus = 'success';
        availableUsers = [{ id: result.userId, name: result.userName || '', email: result.userEmail || '', role: 'admin' }];
        console.log('[ghl-publishing-user] Auto-discovered user', {
          businessId: business.id, ghlLocationId: business.ghlLocationId,
          userId: result.userId, userName: result.userName, email: result.userEmail,
        });
      } else {
        lookupStatus = result.errorCode || 'error';
        lookupError = result.error || null;
        console.warn('[ghl-publishing-user] User lookup failed', {
          businessId: business.id, ghlLocationId: business.ghlLocationId,
          status: lookupStatus, error: lookupError,
        });
      }
    }

    return NextResponse.json({
      savedUser,
      availableUsers,
      lookupStatus,
      lookupError,
      canUseSavedUser: !!savedUser,
      autoDiscoveryAvailable: lookupStatus === 'success',
    });
  } catch (err: any) {
    console.error('[ghl-publishing-user GET]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * PUT /api/businesses/[id]/ghl/publishing-user
 *
 * Save or update the default GHL publishing user for a business.
 * Accepts either a user from the dropdown (dynamic lookup) or
 * a manually entered user ID.
 */
export async function PUT(request: NextRequest, { params }: RouteContext) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const userId = (session.user as any).id;

    const business = await prisma.business.findFirst({
      where: { id: params.id, userId },
      select: { id: true },
    });
    if (!business) return NextResponse.json({ error: 'Business not found' }, { status: 404 });

    const body = await request.json();
    const { ghlUserId, ghlUserName, ghlUserEmail } = body;

    if (!ghlUserId || typeof ghlUserId !== 'string' || !ghlUserId.trim()) {
      return NextResponse.json({ error: 'ghlUserId is required' }, { status: 400 });
    }

    await prisma.business.update({
      where: { id: business.id },
      data: {
        defaultGhlUserId: ghlUserId.trim(),
        defaultGhlUserName: ghlUserName?.trim() || null,
        defaultGhlUserEmail: ghlUserEmail?.trim() || null,
        lastGhlUserVerifiedAt: new Date(),
      },
    });

    return NextResponse.json({
      success: true,
      savedUser: {
        id: ghlUserId.trim(),
        name: ghlUserName?.trim() || null,
        email: ghlUserEmail?.trim() || null,
        verifiedAt: new Date(),
      },
    });
  } catch (err: any) {
    console.error('[ghl-publishing-user PUT]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
