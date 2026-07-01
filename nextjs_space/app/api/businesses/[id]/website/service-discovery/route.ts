/**
 * Service Confirmation API (Milestone 2) — business-scoped.
 *
 * GET  -> latest service discovery (services + counts) or null.
 * POST -> update / seed the service discovery.
 *          body: { seed?: boolean, candidates?: ServiceCandidate[], services?: DiscoveredService[] }
 *          - seed: true  -> re-seed candidates from the business's stored offerings.
 *          - candidates  -> classify raw candidates deterministically.
 *          - services    -> accept already-classified services as-is.
 *
 * NO copy generation, NO image generation, NO publish/deploy. Read/write of the
 * sitemap-first service-discovery artifact only.
 */
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { resolveBusinessAccess, ensureWebsiteProject } from '@/lib/website-workflow';
import {
  classifyServices,
  serviceDiscoveryCounts,
  DiscoveredService,
  ServiceCandidate,
} from '@/lib/website-sitemap';
import {
  loadLatestServiceDiscovery,
  saveServiceDiscovery,
  seedServiceCandidatesFromOfferings,
} from '@/lib/website-sitemap-store';

async function authorize(req: NextRequest, businessId: string) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }
  const access = await resolveBusinessAccess(session.user.email, businessId);
  if (!access) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  }
  return { access };
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const { error } = await authorize(req, params.id);
  if (error) return error;

  const row = await loadLatestServiceDiscovery(params.id);
  if (!row) {
    return NextResponse.json({ discovery: null, services: [], counts: null });
  }
  const services: DiscoveredService[] = (row.discoveryJson as any)?.services ?? [];
  return NextResponse.json({
    discovery: {
      id: row.id,
      version: row.version,
      source: row.source,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    },
    services,
    counts: serviceDiscoveryCounts(services),
  });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { access, error } = await authorize(req, params.id);
  if (error) return error;

  const body = await req.json().catch(() => ({} as any));
  const project = await ensureWebsiteProject(params.id);

  let services: DiscoveredService[];

  if (body?.seed) {
    const seeded: ServiceCandidate[] = await seedServiceCandidatesFromOfferings(params.id);
    services = classifyServices(seeded);
  } else if (Array.isArray(body?.candidates)) {
    services = classifyServices(body.candidates as ServiceCandidate[]);
  } else if (Array.isArray(body?.services)) {
    services = body.services as DiscoveredService[];
  } else {
    return NextResponse.json(
      { error: 'Provide { seed: true } or { candidates: [...] } or { services: [...] }.' },
      { status: 400 },
    );
  }

  const saved = await saveServiceDiscovery({
    businessId: params.id,
    websiteProjectId: project.id,
    services,
    source: body?.seed ? 'business_settings' : 'user',
  });

  return NextResponse.json({
    discovery: { id: saved.id, version: saved.version, source: saved.source },
    services,
    counts: serviceDiscoveryCounts(services),
  });
}
