export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';
import { offeringDisplayName, slugify } from '@/lib/industry-services';

async function resolveBusiness(req: NextRequest, businessId: string) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return { error: 'Unauthorized', status: 401 as const };
  const user = await prisma.user.findUnique({ where: { email: session.user.email }, select: { id: true, role: true } });
  if (!user) return { error: 'Unauthorized', status: 401 as const };
  const business = await prisma.business.findFirst({
    where: user.role === 'admin' ? { id: businessId } : { id: businessId, userId: user.id },
  });
  if (!business) return { error: 'Business not found', status: 404 as const };
  return { user, business };
}

/**
 * GET /api/businesses/[id]/services
 * Returns matched industry + grouped service offerings.
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const r = await resolveBusiness(req, params.id);
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: r.status });
  const { business } = r;

  const [offerings, matchedIndustry, allIndustries] = await Promise.all([
    prisma.businessServiceOffering.findMany({
      where: { businessId: business.id },
      include: { industryService: true, industry: true },
      orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
    }),
    business.matchedIndustryId
      ? prisma.industry.findUnique({ where: { id: business.matchedIndustryId } })
      : Promise.resolve(null),
    prisma.industry.findMany({ where: { enabled: true }, orderBy: { sortOrder: 'asc' }, select: { id: true, name: true, slug: true } }),
  ]);

  const mapped = offerings.map((o) => ({
    id: o.id,
    name: offeringDisplayName(o),
    slug: o.slug,
    status: o.status,
    source: o.source,
    confidence: o.confidence,
    priority: o.priority,
    seoEnabled: o.seoEnabled,
    pageStatus: o.pageStatus,
    videoStatus: o.videoStatus,
    ownerConfirmed: o.ownerConfirmed,
    isCustom: !o.industryServiceId,
    industryServiceId: o.industryServiceId,
    shortDescription: o.overrideShortDescription || o.industryService?.shortDescription || '',
    customerProblem: o.industryService?.customerProblem || '',
    evidence: (o.bridgerEvidenceJson as any)?.evidenceSources || [],
    hasPage: !!o.generatedPageJson,
    hasVideoBrief: !!o.videoBriefJson,
  }));

  return NextResponse.json({
    business: {
      id: business.id,
      name: business.businessName,
      matchedIndustryId: business.matchedIndustryId,
      matchedIndustryConfidence: business.matchedIndustryConfidence,
      industryMatchSource: business.industryMatchSource,
      industryMatchEvidence: business.industryMatchEvidence || [],
      ownerConfirmedIndustry: business.ownerConfirmedIndustry,
    },
    matchedIndustry: matchedIndustry ? { id: matchedIndustry.id, name: matchedIndustry.name, slug: matchedIndustry.slug } : null,
    industries: allIndustries,
    offerings: mapped,
    summary: {
      confirmed: mapped.filter((o) => o.status === 'confirmed').length,
      suggested: mapped.filter((o) => o.status === 'suggested').length,
      needsReview: mapped.filter((o) => o.status === 'needs_review').length,
      rejected: mapped.filter((o) => o.status === 'rejected').length,
    },
  });
}

/**
 * POST /api/businesses/[id]/services
 * Add a custom service offering.
 * Body: { name, shortDescription?, priority? }
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const r = await resolveBusiness(req, params.id);
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: r.status });
  const { user, business } = r;

  const body = await req.json();
  const name = (body.name || '').trim();
  if (!name) return NextResponse.json({ error: 'Service name required' }, { status: 400 });

  // Ensure unique slug per business
  const existing = await prisma.businessServiceOffering.findMany({ where: { businessId: business.id }, select: { slug: true } });
  const slugs = new Set(existing.map((e) => e.slug));
  let slug = slugify(name);
  let suffix = 1;
  while (slugs.has(slug)) slug = `${slugify(name)}-${suffix++}`;

  const offering = await prisma.businessServiceOffering.create({
    data: {
      businessId: business.id,
      industryId: business.matchedIndustryId || null,
      customServiceName: name,
      slug,
      status: 'confirmed',
      source: 'manual',
      confidence: 'high',
      ownerConfirmed: true,
      confirmedAt: new Date(),
      confirmedByUserId: user.id,
      priority: body.priority || 'secondary',
      overrideShortDescription: body.shortDescription || null,
      seoEnabled: true,
    },
  });

  return NextResponse.json({ ok: true, offeringId: offering.id });
}
