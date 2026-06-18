export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-guard';
import { prisma } from '@/lib/db';

const TOMBSTONE_URL = process.env.TOMBSTONE_API_URL || '';

interface TombstoneBusiness {
  id: number;
  business_uuid: string | null;
  name: string;
  website: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  status: string;
  created_at: string | null;
  task_count: number;
  workflow_count: number;
}

async function fetchTombstoneBusinesses(search: string, page: number, limit: number): Promise<{ businesses: TombstoneBusiness[]; total: number } | null> {
  if (!TOMBSTONE_URL) return null;
  try {
    const params = new URLSearchParams({ page: String(page), limit: String(limit) });
    if (search) params.set('search', search);
    const res = await fetch(`${TOMBSTONE_URL}/businesses?${params}`, {
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      console.error(`[admin/businesses] Tombstone /businesses returned ${res.status}`);
      return null;
    }
    return await res.json();
  } catch (err: any) {
    console.error('[admin/businesses] Tombstone fetch error:', err?.message);
    return null;
  }
}

export async function GET(req: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.authorized) return auth.response;

  const url = new URL(req.url);
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1'));
  const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') || '50')));
  const search = url.searchParams.get('search')?.trim() || '';
  const skip = (page - 1) * limit;

  // Fetch from both sources in parallel
  const [frontendResult, tombstoneResult] = await Promise.all([
    (async () => {
      const where = search
        ? {
            OR: [
              { businessName: { contains: search, mode: 'insensitive' as const } },
              { websiteUrl: { contains: search, mode: 'insensitive' as const } },
              { user: { email: { contains: search, mode: 'insensitive' as const } } },
            ],
          }
        : {};
      const [businesses, total] = await Promise.all([
        prisma.business.findMany({
          where,
          select: {
            id: true,
            websiteUrl: true,
            businessName: true,
            businessCity: true,
            businessState: true,
            businessZip: true,
            tombstoneBusinessId: true,
            createdAt: true,
            updatedAt: true,
            user: { select: { id: true, email: true } },
            _count: { select: { analyses: true, socialPosts: true } },
            analyses: {
              select: {
                id: true,
                status: true,
                createdAt: true,
                _count: { select: { ads: true } },
              },
              orderBy: { createdAt: 'desc' as const },
              take: 1,
            },
          },
          orderBy: { createdAt: 'desc' as const },
        }),
        prisma.business.count({ where }),
      ]);
      return { businesses, total };
    })(),
    fetchTombstoneBusinesses(search, 1, 500), // Fetch all for merging
  ]);

  // Build a set of tombstoneBusinessIds that the frontend already knows about
  const knownTombstoneIds = new Set<number>();
  for (const b of frontendResult.businesses) {
    if ((b as any).tombstoneBusinessId != null) {
      knownTombstoneIds.add((b as any).tombstoneBusinessId as number);
    }
  }

  // Convert frontend businesses to unified format
  const mergedItems: any[] = frontendResult.businesses.map((b: any) => {
    const latestAnalysis = b.analyses?.[0] || null;
    return {
      id: b.id,
      source: 'frontend',
      tombstoneBusinessId: b.tombstoneBusinessId ?? null,
      websiteUrl: b.websiteUrl,
      businessName: b.businessName,
      businessCity: b.businessCity,
      businessState: b.businessState,
      businessZip: b.businessZip,
      ownerEmail: b.user?.email || null,
      ownerId: b.user?.id || null,
      analysisCount: b._count?.analyses || 0,
      socialPostCount: b._count?.socialPosts || 0,
      adCount: latestAnalysis?._count?.ads || 0,
      latestAnalysisId: latestAnalysis?.id || null,
      latestAnalysisStatus: latestAnalysis?.status || null,
      taskCount: 0,
      workflowCount: 0,
      createdAt: b.createdAt,
      updatedAt: b.updatedAt,
    };
  });

  // Enrich frontend items with Tombstone task/workflow counts
  if (tombstoneResult?.businesses) {
    const tombMap = new Map<number, TombstoneBusiness>();
    for (const tb of tombstoneResult.businesses) {
      tombMap.set(tb.id, tb);
    }
    for (const item of mergedItems) {
      if (item.tombstoneBusinessId != null) {
        const tb = tombMap.get(item.tombstoneBusinessId);
        if (tb) {
          item.taskCount = tb.task_count || 0;
          item.workflowCount = tb.workflow_count || 0;
        }
      }
    }

    // Add Tombstone-only businesses (not linked to any frontend Business)
    for (const tb of tombstoneResult.businesses) {
      if (!knownTombstoneIds.has(tb.id)) {
        // Parse address for city/state
        let city = '';
        let state = '';
        if (tb.address) {
          // Attempt to extract city, state from "..., City, ST, ZIP" format
          const parts = tb.address.split(',').map((s: string) => s.trim());
          if (parts.length >= 3) {
            city = parts[parts.length - 3] || '';
            state = parts[parts.length - 2] || '';
          }
        }
        mergedItems.push({
          id: `tombstone-${tb.id}`,
          source: 'tombstone',
          tombstoneBusinessId: tb.id,
          tombstoneBusinessUuid: tb.business_uuid,
          websiteUrl: tb.website,
          businessName: tb.name,
          businessCity: city,
          businessState: state,
          businessZip: '',
          ownerEmail: tb.email || null,
          ownerId: null,
          analysisCount: 0,
          socialPostCount: 0,
          adCount: 0,
          latestAnalysisId: null,
          latestAnalysisStatus: tb.status || 'provisional',
          taskCount: tb.task_count || 0,
          workflowCount: tb.workflow_count || 0,
          createdAt: tb.created_at || null,
          updatedAt: null,
        });
      }
    }
  }

  // Sort merged by createdAt desc
  mergedItems.sort((a, b) => {
    const da = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const db = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return db - da;
  });

  // Paginate the merged result
  const total = mergedItems.length;
  const paginatedItems = mergedItems.slice(skip, skip + limit);

  return NextResponse.json({
    businesses: paginatedItems,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
}
