export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';

async function resolve(req: NextRequest, businessId: string, offeringId: string) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return { error: 'Unauthorized', status: 401 as const };
  const user = await prisma.user.findUnique({ where: { email: session.user.email }, select: { id: true, role: true } });
  if (!user) return { error: 'Unauthorized', status: 401 as const };
  const business = await prisma.business.findFirst({
    where: user.role === 'admin' ? { id: businessId } : { id: businessId, userId: user.id },
    select: { id: true },
  });
  if (!business) return { error: 'Business not found', status: 404 as const };
  const offering = await prisma.businessServiceOffering.findFirst({ where: { id: offeringId, businessId } });
  if (!offering) return { error: 'Service not found', status: 404 as const };
  return { user, business, offering };
}

const VALID_STATUS = ['suggested', 'confirmed', 'rejected', 'hidden', 'needs_review'];
const VALID_PRIORITY = ['primary', 'secondary', 'optional', 'do_not_promote'];

/**
 * PATCH /api/businesses/[id]/services/[offeringId]
 * Confirm / reject / edit / set priority / toggle promote / edit details.
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string; offeringId: string } }) {
  const r = await resolve(req, params.id, params.offeringId);
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: r.status });
  const { user, offering } = r;

  const body = await req.json();
  const data: any = {};

  if (typeof body.status === 'string' && VALID_STATUS.includes(body.status)) {
    data.status = body.status;
    if (body.status === 'confirmed') {
      data.ownerConfirmed = true;
      data.source = 'owner_confirmed';
      data.confidence = 'high';
      data.confirmedAt = new Date();
      data.confirmedByUserId = user.id;
    }
    if (body.status === 'rejected' || body.status === 'hidden') {
      data.ownerConfirmed = false;
    }
  }
  if (typeof body.priority === 'string' && VALID_PRIORITY.includes(body.priority)) {
    data.priority = body.priority;
  }
  if (typeof body.seoEnabled === 'boolean') data.seoEnabled = body.seoEnabled;
  if (typeof body.name === 'string' && body.name.trim()) data.overrideName = body.name.trim();
  if (typeof body.shortDescription === 'string') data.overrideShortDescription = body.shortDescription;
  if (typeof body.fullDescription === 'string') data.overrideFullDescription = body.fullDescription;
  if (typeof body.pageStatus === 'string') data.pageStatus = body.pageStatus;
  if (typeof body.videoStatus === 'string') data.videoStatus = body.videoStatus;

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
  }

  const updated = await prisma.businessServiceOffering.update({ where: { id: offering.id }, data });
  return NextResponse.json({ ok: true, status: updated.status, priority: updated.priority });
}

/**
 * DELETE /api/businesses/[id]/services/[offeringId]
 * Hard-deletes a custom service; for taxonomy services, marks as hidden instead.
 */
export async function DELETE(req: NextRequest, { params }: { params: { id: string; offeringId: string } }) {
  const r = await resolve(req, params.id, params.offeringId);
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: r.status });
  const { offering } = r;

  if (!offering.industryServiceId) {
    await prisma.businessServiceOffering.delete({ where: { id: offering.id } });
    return NextResponse.json({ ok: true, deleted: true });
  }
  await prisma.businessServiceOffering.update({ where: { id: offering.id }, data: { status: 'hidden', ownerConfirmed: false } });
  return NextResponse.json({ ok: true, hidden: true });
}

/**
 * GET /api/businesses/[id]/services/[offeringId]
 * Returns full offering detail incl. generated page + video brief.
 */
export async function GET(req: NextRequest, { params }: { params: { id: string; offeringId: string } }) {
  const r = await resolve(req, params.id, params.offeringId);
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: r.status });
  const full = await prisma.businessServiceOffering.findUnique({
    where: { id: r.offering.id },
    include: { industryService: true, industry: true },
  });
  return NextResponse.json({ offering: full });
}
