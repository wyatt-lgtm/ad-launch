export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-guard';
import { prisma } from '@/lib/db';
import { slugify } from '@/lib/industry-services';

/**
 * GET /api/admin/industries/[industryId]/services
 */
export async function GET(req: NextRequest, { params }: { params: { industryId: string } }) {
  const auth = await requireAdmin();
  if (!auth.authorized) return auth.response;
  const services = await prisma.industryService.findMany({
    where: { industryId: params.industryId },
    orderBy: { sortOrder: 'asc' },
  });
  return NextResponse.json({ services });
}

/**
 * POST /api/admin/industries/[industryId]/services
 * Add a service to an industry.
 */
export async function POST(req: NextRequest, { params }: { params: { industryId: string } }) {
  const auth = await requireAdmin();
  if (!auth.authorized) return auth.response;

  const industry = await prisma.industry.findUnique({ where: { id: params.industryId }, select: { id: true } });
  if (!industry) return NextResponse.json({ error: 'Industry not found' }, { status: 404 });

  const body = await req.json();
  const name = (body.name || '').trim();
  if (!name) return NextResponse.json({ error: 'Name required' }, { status: 400 });

  const slug = body.slug ? slugify(body.slug) : slugify(name);
  const dupe = await prisma.industryService.findUnique({ where: { industryId_slug: { industryId: params.industryId, slug } } });
  if (dupe) return NextResponse.json({ error: 'A service with this slug already exists in this industry' }, { status: 409 });

  const count = await prisma.industryService.count({ where: { industryId: params.industryId } });
  const service = await prisma.industryService.create({
    data: {
      industryId: params.industryId,
      name,
      slug,
      shortDescription: body.shortDescription || '',
      fullDescriptionTemplate: body.fullDescriptionTemplate || '',
      customerProblem: body.customerProblem || '',
      commonQuestions: Array.isArray(body.commonQuestions) ? body.commonQuestions : [],
      commonObjections: Array.isArray(body.commonObjections) ? body.commonObjections : [],
      relatedServices: Array.isArray(body.relatedServices) ? body.relatedServices : [],
      recommendedPageTitle: body.recommendedPageTitle || '',
      recommendedMetaDescription: body.recommendedMetaDescription || '',
      recommendedH1: body.recommendedH1 || '',
      recommendedSchemaType: body.recommendedSchemaType || 'Service',
      explainerVideoTitle: body.explainerVideoTitle || '',
      explainerVideoBrief: body.explainerVideoBrief || '',
      explainerVideoScriptTemplate: body.explainerVideoScriptTemplate || '',
      matchKeywords: Array.isArray(body.matchKeywords) ? body.matchKeywords : [name.toLowerCase()],
      conditional: !!body.conditional,
      enabled: body.enabled !== false,
      sortOrder: typeof body.sortOrder === 'number' ? body.sortOrder : count,
    },
  });
  return NextResponse.json({ ok: true, service });
}
