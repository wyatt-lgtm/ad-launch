export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';
import { provisionGhlLocation } from '@/lib/ghl';

const ADMIN_API_KEY = process.env.ADMIN_API_KEY ?? '';

/**
 * POST /api/businesses/[businessId]/ghl/provision
 *
 * Provisions a GHL Location (sub-account) for the given business.
 * Idempotent — returns 200 with existing data if already provisioned.
 *
 * Auth: session user must own the business, OR valid ADMIN_API_KEY header.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const businessId = params.id;
    if (!businessId) {
      return NextResponse.json({ error: 'Missing businessId' }, { status: 400 });
    }

    // ── Auth: session OR admin key ──────────────────────────────────
    let userId: string | null = null;
    const apiKey = request.headers.get('x-api-key') || request.headers.get('authorization')?.replace('Bearer ', '');
    const isAdmin = ADMIN_API_KEY && apiKey === ADMIN_API_KEY;

    if (!isAdmin) {
      const session = await getServerSession(authOptions);
      userId = (session?.user as any)?.id ?? null;
      if (!userId) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
    }

    // ── Fetch business ──────────────────────────────────────────────
    const business = await prisma.business.findUnique({
      where: { id: businessId },
      select: {
        id: true,
        userId: true,
        businessName: true,
        businessAddr: true,
        businessCity: true,
        businessState: true,
        businessZip: true,
        businessPhone: true,
        websiteUrl: true,
        ghlLocationId: true,
        ghlSubtenantId: true,
        ghlProvisioningStatus: true,
        ghlProvisionedAt: true,
        ghlProvisioningError: true,
        user: { select: { email: true } },
      },
    });

    if (!business) {
      return NextResponse.json({ error: 'Business not found' }, { status: 404 });
    }

    // Ownership check (skip for admin)
    if (!isAdmin && business.userId !== userId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // ── Idempotency: already provisioned ────────────────────────────
    if (business.ghlLocationId && business.ghlProvisioningStatus === 'provisioned') {
      return NextResponse.json({
        alreadyProvisioned: true,
        ghlLocationId: business.ghlLocationId,
        ghlSubtenantId: business.ghlSubtenantId,
        ghlProvisioningStatus: business.ghlProvisioningStatus,
        ghlProvisionedAt: business.ghlProvisionedAt,
      });
    }

    // ── Validate required fields ────────────────────────────────────
    if (!business.businessName) {
      return NextResponse.json(
        { error: 'Business must have a name before provisioning a GHL tenant' },
        { status: 422 }
      );
    }

    // ── Mark as pending ─────────────────────────────────────────────
    await prisma.business.update({
      where: { id: businessId },
      data: {
        ghlProvisioningStatus: 'pending',
        ghlProvisioningError: null,
      },
    });

    // ── Call GHL ────────────────────────────────────────────────────
    const result = await provisionGhlLocation({
      businessName: business.businessName,
      businessAddr: business.businessAddr,
      businessCity: business.businessCity,
      businessState: business.businessState,
      businessZip: business.businessZip,
      businessPhone: business.businessPhone,
      websiteUrl: business.websiteUrl,
      ownerEmail: business.user?.email ?? null,
    });

    if (!result.success) {
      await prisma.business.update({
        where: { id: businessId },
        data: {
          ghlProvisioningStatus: 'failed',
          ghlProvisioningError: result.error ?? 'Unknown error',
        },
      });
      return NextResponse.json(
        {
          error: 'GHL provisioning failed',
          detail: result.error,
          ghlProvisioningStatus: 'failed',
        },
        { status: 502 }
      );
    }

    // ── Save success ────────────────────────────────────────────────
    const updated = await prisma.business.update({
      where: { id: businessId },
      data: {
        ghlLocationId: result.locationId,
        ghlSubtenantId: result.subtenantId ?? null,
        ghlProvisioningStatus: 'provisioned',
        ghlProvisionedAt: new Date(),
        ghlProvisioningError: null,
      },
      select: {
        ghlLocationId: true,
        ghlSubtenantId: true,
        ghlProvisioningStatus: true,
        ghlProvisionedAt: true,
      },
    });

    console.log(`[GHL] Business ${businessId} provisioned → location ${result.locationId}`);

    return NextResponse.json({
      ...updated,
      alreadyProvisioned: false,
    });
  } catch (err: any) {
    console.error('[GHL provision] unexpected error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
