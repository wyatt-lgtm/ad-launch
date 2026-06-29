export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { resolveBusinessAccess } from '@/lib/tracking-auth';
import { prisma } from '@/lib/db';

/**
 * Manual Comparison Notes for Search Intelligence.
 *
 * Lets an admin attach a hand-recorded observation to a run (e.g. "my local
 * browser showed different results"). This is for RECORDING a manual
 * observation only — it is NOT scraping and performs no automated fetching.
 *
 * GET  /api/businesses/[id]/search-intelligence/manual-notes?runId=...
 * POST /api/businesses/[id]/search-intelligence/manual-notes
 *   body: { runId?, keyword?, location?, manualObservedAt?, manualNotes,
 *           manualTopResults?: any[], screenshotRef? }
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const r = await resolveBusinessAccess(req, params.id);
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: r.status });
  const businessId = r.business.id;
  const runId = req.nextUrl.searchParams.get('runId');

  try {
    const notes = await prisma.searchManualComparisonNote.findMany({
      where: { businessId, ...(runId ? { runId } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return NextResponse.json({ ok: true, notes });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: String(err?.message || err).slice(0, 500) }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const r = await resolveBusinessAccess(req, params.id);
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: r.status });
  const businessId = r.business.id;
  const createdByUserId = r.user.id;

  const body = await req.json().catch(() => ({} as any));
  const manualNotes = String(body?.manualNotes || '').trim();
  if (!manualNotes) {
    return NextResponse.json({ error: 'manualNotes is required' }, { status: 400 });
  }

  // If a runId is supplied, ensure it belongs to this business (no cross-tenant).
  let runId: string | null = body?.runId ? String(body.runId) : null;
  if (runId) {
    const run = await prisma.searchIntelligenceRun.findFirst({
      where: { id: runId, businessId },
      select: { id: true },
    });
    if (!run) runId = null;
  }

  let manualObservedAt: Date = new Date();
  if (body?.manualObservedAt) {
    const d = new Date(body.manualObservedAt);
    if (!isNaN(d.getTime())) manualObservedAt = d;
  }

  const manualTopResults = Array.isArray(body?.manualTopResults) ? body.manualTopResults : null;

  try {
    const note = await prisma.searchManualComparisonNote.create({
      data: {
        businessId,
        runId,
        keyword: body?.keyword ? String(body.keyword).slice(0, 500) : null,
        location: body?.location ? String(body.location).slice(0, 500) : null,
        manualObservedAt,
        manualNotes: manualNotes.slice(0, 5000),
        manualTopResultsJson: (manualTopResults as any) ?? undefined,
        screenshotRef: body?.screenshotRef ? String(body.screenshotRef).slice(0, 1000) : null,
        createdByUserId,
      } as any,
    });
    return NextResponse.json({ ok: true, note });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: String(err?.message || err).slice(0, 500) }, { status: 500 });
  }
}
