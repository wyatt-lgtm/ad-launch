export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';
import { getConfirmedServicesForSeo } from '@/lib/industry-services';

/**
 * GET /api/businesses/[id]/services/seo-index
 * Returns confirmed services available to the SEO agent.
 * Query: ?includeSuggested=true to also include suggestions (recommendations).
 *
 * Auth: owner / admin, OR a valid internal agent API key for server-to-server calls.
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const url = new URL(req.url);
  const includeSuggested = url.searchParams.get('includeSuggested') === 'true';

  // Internal agent access via shared API key
  const agentKey = req.headers.get('x-agent-key');
  const expectedKey = process.env.AGENT_INTERNAL_API_KEY;
  const isAgent = !!agentKey && !!expectedKey && agentKey === expectedKey;

  if (!isAgent) {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const user = await prisma.user.findUnique({ where: { email: session.user.email }, select: { id: true, role: true } });
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const business = await prisma.business.findFirst({
      where: user.role === 'admin' ? { id: params.id } : { id: params.id, userId: user.id },
      select: { id: true },
    });
    if (!business) return NextResponse.json({ error: 'Business not found' }, { status: 404 });
  }

  const services = await getConfirmedServicesForSeo(params.id, { includeSuggested });
  return NextResponse.json({ businessId: params.id, count: services.length, services });
}
