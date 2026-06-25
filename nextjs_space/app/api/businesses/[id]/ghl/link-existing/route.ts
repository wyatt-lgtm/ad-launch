export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';
import { lookupGhlLocation } from '@/lib/ghl';

const ADMIN_API_KEY = process.env.ADMIN_API_KEY ?? '';

/**
 * POST /api/businesses/[id]/ghl/link-existing
 *
 * Links an existing GHL Location to the given business.
 * Validates the location exists via the GHL API before saving.
 * Checks for duplicate linking across businesses.
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

    // ── Parse body ─────────────────────────────────────────────────
    const body = await request.json().catch(() => ({}));
    const { ghlLocationId, ghlSubtenantId, notes } = body;

    if (!ghlLocationId || typeof ghlLocationId !== 'string' || !ghlLocationId.trim()) {
      return NextResponse.json(
        { error: 'ghlLocationId is required' },
        { status: 400 }
      );
    }

    const trimmedLocationId = ghlLocationId.trim();

    // ── Fetch business ──────────────────────────────────────────────
    const business = await prisma.business.findUnique({
      where: { id: businessId },
      select: {
        id: true,
        userId: true,
        businessName: true,
        ghlLocationId: true,
        ghlProvisioningStatus: true,
      },
    });

    if (!business) {
      return NextResponse.json({ error: 'Business not found' }, { status: 404 });
    }

    // Ownership check (skip for admin)
    if (!isAdmin && business.userId !== userId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // ── Idempotency: same location already linked to this business ──
    if (
      business.ghlLocationId === trimmedLocationId &&
      business.ghlProvisioningStatus === 'provisioned'
    ) {
      return NextResponse.json({
        alreadyLinked: true,
        ghlLocationId: business.ghlLocationId,
        ghlProvisioningStatus: 'provisioned',
        message: 'This CRM account is already linked to this business.',
      });
    }

    // ── If already provisioned with a DIFFERENT location, block unless admin force ──
    if (
      business.ghlLocationId &&
      business.ghlProvisioningStatus === 'provisioned' &&
      business.ghlLocationId !== trimmedLocationId
    ) {
      const forceOverwrite = body.forceOverwrite === true;
      if (!isAdmin || !forceOverwrite) {
        return NextResponse.json(
          {
            error: 'business_already_connected',
            message: 'This business is already connected to a different CRM account. Admin override required to change.',
            existingLocationId: business.ghlLocationId,
          },
          { status: 409 }
        );
      }
    }

    // ── Duplicate check: is this GHL location linked to another business? ──
    const existingLink = await prisma.business.findFirst({
      where: {
        ghlLocationId: trimmedLocationId,
        ghlProvisioningStatus: 'provisioned',
        id: { not: businessId },
      },
      select: { id: true, businessName: true },
    });

    if (existingLink) {
      const forceOverwrite = body.forceOverwrite === true;
      if (!isAdmin || !forceOverwrite) {
        return NextResponse.json(
          {
            error: 'ghl_location_already_linked',
            message: 'This CRM location is already linked to another business.',
            linkedBusinessId: existingLink.id,
            linkedBusinessName: existingLink.businessName,
          },
          { status: 409 }
        );
      }
    }

    // ── Validate location exists in GHL ─────────────────────────────
    const lookup = await lookupGhlLocation(trimmedLocationId);
    if (!lookup.exists) {
      return NextResponse.json(
        {
          error: 'ghl_location_not_found',
          message: 'Could not verify this CRM location ID. Please check the ID and try again.',
          detail: lookup.error,
        },
        { status: 422 }
      );
    }

    // ── Save link ──────────────────────────────────────────────────
    const updated = await prisma.business.update({
      where: { id: businessId },
      data: {
        ghlLocationId: lookup.locationId || trimmedLocationId,
        ghlSubtenantId: ghlSubtenantId?.trim() || null,
        ghlProvisioningStatus: 'provisioned',
        ghlProvisionedAt: new Date(),
        ghlProvisioningError: null,
        ghlConnectionType: 'linked_existing',
        ghlLinkedAt: new Date(),
        ghlLinkNotes: notes?.trim() || null,
      },
      select: {
        ghlLocationId: true,
        ghlSubtenantId: true,
        ghlProvisioningStatus: true,
        ghlProvisionedAt: true,
        ghlConnectionType: true,
        ghlLinkedAt: true,
      },
    });

    console.log(
      `[GHL] Business ${businessId} linked to existing location ${trimmedLocationId}` +
      (lookup.name ? ` (${lookup.name})` : '')
    );

    return NextResponse.json({
      ...updated,
      ghlLocationName: lookup.name || null,
      alreadyLinked: false,
    });
  } catch (err: any) {
    console.error('[GHL link-existing] unexpected error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
