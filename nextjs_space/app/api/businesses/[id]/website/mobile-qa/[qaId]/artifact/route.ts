export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';
import { resolveBusinessAccess } from '@/lib/website-workflow';

/**
 * Milestone 7 — serve the durable website_mobile_qa.json artifact from the DB.
 *
 * GET /api/businesses/{id}/website/mobile-qa/{qaId}/artifact
 *   Returns the persisted qaJson (the durable, auditable QA report). Served
 *   from the database — never from disk, never from a public upload. Business
 *   scoped: another business's record returns 404.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string; qaId: string } },
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const businessId = params.id;
    const access = await resolveBusinessAccess(session.user.email, businessId);
    if (!access) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const qa = await prisma.websiteMobileQa.findUnique({
      where: { id: params.qaId },
      select: { businessId: true, qaJson: true, status: true },
    });

    if (!qa || qa.businessId !== businessId) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    if (!qa.qaJson) {
      return NextResponse.json({ error: 'No artifact recorded for this QA result.' }, { status: 404 });
    }

    return new NextResponse(JSON.stringify(qa.qaJson, null, 2), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': 'inline; filename="website_mobile_qa.json"',
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Failed to load mobile QA artifact' },
      { status: 500 },
    );
  }
}
