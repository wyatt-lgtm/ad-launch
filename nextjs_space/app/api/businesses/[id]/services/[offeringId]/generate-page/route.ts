export const dynamic = 'force-dynamic';
export const maxDuration = 60;

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';
import { generateServicePage } from '@/lib/service-content-generator';

/**
 * POST /api/businesses/[id]/services/[offeringId]/generate-page
 * Generates a draft SEO service page. Defaults pageStatus to needs_review.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string; offeringId: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const user = await prisma.user.findUnique({ where: { email: session.user.email }, select: { id: true, role: true } });
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const business = await prisma.business.findFirst({
    where: user.role === 'admin' ? { id: params.id } : { id: params.id, userId: user.id },
    select: { id: true },
  });
  if (!business) return NextResponse.json({ error: 'Business not found' }, { status: 404 });

  const offering = await prisma.businessServiceOffering.findFirst({ where: { id: params.offeringId, businessId: params.id }, select: { id: true, status: true } });
  if (!offering) return NextResponse.json({ error: 'Service not found' }, { status: 404 });
  if (offering.status !== 'confirmed') {
    return NextResponse.json({ error: 'Only confirmed services can generate pages' }, { status: 400 });
  }

  try {
    const page = await generateServicePage(params.offeringId);
    if (!page) return NextResponse.json({ error: 'Generation failed' }, { status: 500 });
    return NextResponse.json({ ok: true, page });
  } catch (e: any) {
    console.error('[generate-page]', e?.message);
    return NextResponse.json({ error: e?.message || 'Generation failed' }, { status: 500 });
  }
}
