export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

/**
 * PATCH /api/analysis/[id]/confirm-location
 * Confirms or updates the auto-extracted business location.
 * Body: { city?, state?, zip?, address?, phone? }
 * Sets geoConfirmed=true and geoSource='user_input' if any field was changed.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();

    const analysis = await prisma.analysis.findUnique({ where: { id } });
    if (!analysis) {
      return NextResponse.json({ error: 'Analysis not found' }, { status: 404 });
    }

    // Determine if user made changes vs just confirming
    const changed =
      (body.city !== undefined && body.city !== analysis.businessCity) ||
      (body.state !== undefined && body.state !== analysis.businessState) ||
      (body.zip !== undefined && body.zip !== analysis.businessZip) ||
      (body.address !== undefined && body.address !== analysis.businessAddr) ||
      (body.phone !== undefined && body.phone !== analysis.businessPhone);

    const data: Record<string, any> = {
      geoConfirmed: true,
    };

    if (body.city !== undefined) data.businessCity = body.city;
    if (body.state !== undefined) data.businessState = body.state;
    if (body.zip !== undefined) data.businessZip = body.zip;
    if (body.address !== undefined) data.businessAddr = body.address;
    if (body.phone !== undefined) data.businessPhone = body.phone;

    // If user edited, mark source as user_input
    if (changed) {
      data.geoSource = 'user_input';
    }

    const updated = await prisma.analysis.update({
      where: { id },
      data,
      select: {
        id: true,
        businessCity: true,
        businessState: true,
        businessZip: true,
        businessAddr: true,
        businessPhone: true,
        geoSource: true,
        geoConfirmed: true,
      },
    });

    // Sync confirmed location to the Business record
    if (analysis.businessId) {
      try {
        await prisma.business.update({
          where: { id: analysis.businessId },
          data: {
            ...(updated.businessCity ? { businessCity: updated.businessCity } : {}),
            ...(updated.businessState ? { businessState: updated.businessState } : {}),
            ...(updated.businessZip ? { businessZip: updated.businessZip } : {}),
            ...(updated.businessAddr ? { businessAddr: updated.businessAddr } : {}),
            ...(updated.businessPhone ? { businessPhone: updated.businessPhone } : {}),
            ...(analysis.businessName ? { businessName: analysis.businessName } : {}),
          },
        });
      } catch (bizErr: any) {
        console.error('[confirm-location] Business sync error (non-fatal):', bizErr?.message);
      }
    }

    console.log(`[confirm-location] Analysis ${id} location confirmed (changed=${changed}) source=${updated.geoSource}`);

    return NextResponse.json({
      success: true,
      location: {
        address: updated.businessAddr ?? '',
        city: updated.businessCity ?? '',
        state: updated.businessState ?? '',
        zip: updated.businessZip ?? '',
        phone: updated.businessPhone ?? '',
        source: updated.geoSource ?? '',
        confirmed: updated.geoConfirmed,
      },
    });
  } catch (err: any) {
    console.error('[confirm-location] Error:', err?.message);
    return NextResponse.json({ error: 'Failed to confirm location' }, { status: 500 });
  }
}
