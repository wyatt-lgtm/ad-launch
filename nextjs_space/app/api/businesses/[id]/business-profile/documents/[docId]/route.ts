import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';
export const dynamic = 'force-dynamic';

/**
 * PATCH /api/businesses/[id]/business-profile/documents/[docId]
 * Updates a generated document's status or content.
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string; docId: string } }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const userId = (session.user as any).id;

    const business = await prisma.business.findFirst({ where: { id: params.id, userId }, select: { id: true } });
    if (!business) return NextResponse.json({ error: 'Business not found' }, { status: 404 });

    const body = await req.json();
    const data: any = {};

    if (body.status !== undefined) data.status = body.status;
    if (body.content !== undefined) data.content = body.content;
    if (body.title !== undefined) data.title = body.title;
    if (body.approvedForAI !== undefined) data.approvedForAI = body.approvedForAI;
    if (body.publicUseAllowed !== undefined) data.publicUseAllowed = body.publicUseAllowed;
    if (body.requiresReview !== undefined) data.requiresReview = body.requiresReview;

    const updated = await prisma.generatedBusinessProfileDocument.update({
      where: { id: params.docId },
      data,
    });

    return NextResponse.json(updated);
  } catch (err: any) {
    console.error('[business-profile/documents] PATCH error:', err);
    return NextResponse.json({ error: 'Failed to update document' }, { status: 500 });
  }
}

/**
 * DELETE /api/businesses/[id]/business-profile/documents/[docId]
 */
export async function DELETE(req: NextRequest, { params }: { params: { id: string; docId: string } }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const userId = (session.user as any).id;

    const business = await prisma.business.findFirst({ where: { id: params.id, userId }, select: { id: true } });
    if (!business) return NextResponse.json({ error: 'Business not found' }, { status: 404 });

    await prisma.generatedBusinessProfileDocument.delete({ where: { id: params.docId } });

    return NextResponse.json({ deleted: true });
  } catch (err: any) {
    console.error('[business-profile/documents] DELETE error:', err);
    return NextResponse.json({ error: 'Failed to delete document' }, { status: 500 });
  }
}
