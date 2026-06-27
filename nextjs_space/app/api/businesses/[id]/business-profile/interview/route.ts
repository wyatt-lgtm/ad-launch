import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';
export const dynamic = 'force-dynamic';

/**
 * GET /api/businesses/[id]/business-profile/interview
 * Returns the latest interview for a business.
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const userId = (session.user as any).id;
    const businessId = params.id;

    const business = await prisma.business.findFirst({ where: { id: businessId, userId }, select: { id: true } });
    if (!business) return NextResponse.json({ error: 'Business not found' }, { status: 404 });

    const interview = await prisma.businessProfileInterview.findFirst({
      where: { businessId },
      orderBy: { updatedAt: 'desc' },
      include: { generatedDocuments: { orderBy: { createdAt: 'asc' } } },
    });

    return NextResponse.json({ interview });
  } catch (err: any) {
    console.error('[business-profile/interview] GET error:', err);
    return NextResponse.json({ error: 'Failed to load interview' }, { status: 500 });
  }
}

/**
 * POST /api/businesses/[id]/business-profile/interview
 * Creates a new interview.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const userId = (session.user as any).id;
    const businessId = params.id;

    const business = await prisma.business.findFirst({ where: { id: businessId, userId }, select: { id: true } });
    if (!business) return NextResponse.json({ error: 'Business not found' }, { status: 404 });

    const body = await req.json();
    const interview = await prisma.businessProfileInterview.create({
      data: {
        businessId,
        currentStep: body.currentStep ?? 0,
        answersJson: body.answersJson ?? {},
        status: body.status ?? 'draft',
      },
    });

    return NextResponse.json(interview);
  } catch (err: any) {
    console.error('[business-profile/interview] POST error:', err);
    return NextResponse.json({ error: 'Failed to create interview' }, { status: 500 });
  }
}

/**
 * PUT /api/businesses/[id]/business-profile/interview
 * Updates an existing interview.
 */
export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const userId = (session.user as any).id;
    const businessId = params.id;

    const business = await prisma.business.findFirst({ where: { id: businessId, userId }, select: { id: true } });
    if (!business) return NextResponse.json({ error: 'Business not found' }, { status: 404 });

    const body = await req.json();
    if (!body.id) return NextResponse.json({ error: 'Interview ID required' }, { status: 400 });

    const data: any = {};
    if (body.currentStep !== undefined) data.currentStep = body.currentStep;
    if (body.answersJson !== undefined) data.answersJson = body.answersJson;
    if (body.status !== undefined) {
      data.status = body.status;
      if (body.status === 'completed') data.completedAt = new Date();
      if (body.status === 'approved') data.approvedAt = new Date();
    }

    const updated = await prisma.businessProfileInterview.update({
      where: { id: body.id },
      data,
    });

    return NextResponse.json(updated);
  } catch (err: any) {
    console.error('[business-profile/interview] PUT error:', err);
    return NextResponse.json({ error: 'Failed to update interview' }, { status: 500 });
  }
}
