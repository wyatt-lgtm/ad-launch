export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-guard';
import { prisma } from '@/lib/db';
import { slugify } from '@/lib/industry-services';

/**
 * GET /api/admin/industries
 * List all industries with service counts.
 */
export async function GET() {
  const auth = await requireAdmin();
  if (!auth.authorized) return auth.response;

  const industries = await prisma.industry.findMany({
    orderBy: { sortOrder: 'asc' },
    include: { _count: { select: { services: true, businessOfferings: true } } },
  });

  return NextResponse.json({
    industries: industries.map((i) => ({
      id: i.id,
      name: i.name,
      slug: i.slug,
      description: i.description,
      enabled: i.enabled,
      sortOrder: i.sortOrder,
      matchKeywords: i.matchKeywords,
      gbpCategories: i.gbpCategories,
      serviceCount: i._count.services,
      offeringCount: i._count.businessOfferings,
    })),
  });
}

/**
 * POST /api/admin/industries
 * Create a new industry.
 */
export async function POST(req: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.authorized) return auth.response;

  const body = await req.json();
  const name = (body.name || '').trim();
  if (!name) return NextResponse.json({ error: 'Name required' }, { status: 400 });

  let slug = body.slug ? slugify(body.slug) : slugify(name);
  const existing = await prisma.industry.findUnique({ where: { slug } });
  if (existing) return NextResponse.json({ error: 'An industry with this slug already exists' }, { status: 409 });

  const count = await prisma.industry.count();
  const industry = await prisma.industry.create({
    data: {
      name,
      slug,
      description: body.description || '',
      enabled: body.enabled !== false,
      matchKeywords: Array.isArray(body.matchKeywords) ? body.matchKeywords : [],
      gbpCategories: Array.isArray(body.gbpCategories) ? body.gbpCategories : [],
      sortOrder: typeof body.sortOrder === 'number' ? body.sortOrder : count,
    },
  });
  return NextResponse.json({ ok: true, industry });
}
