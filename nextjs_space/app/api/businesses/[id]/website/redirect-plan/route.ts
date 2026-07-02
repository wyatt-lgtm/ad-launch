/**
 * Redirect Plan API (Milestone 10) — business-scoped.
 *
 * GET -> the durable redirect-plan artifact computed from persisted
 *        preservation mappings + enriched mapping rows (or null when there are
 *        no mappings yet). This is a READINESS artifact only — it is never
 *        deployed and never mutates live DNS.
 */
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { authorizeBusiness } from '@/lib/site-backlinks/api-guard';
import { loadRedirectPlan, loadEnrichedMappings, loadMappings } from '@/lib/site-backlinks/store';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await authorizeBusiness(params.id);
  if ('error' in guard) return guard.error;

  const [plan, enriched, rows] = await Promise.all([
    loadRedirectPlan(params.id),
    loadEnrichedMappings(params.id),
    loadMappings(params.id),
  ]);

  // Attach the durable row id to each enriched mapping (edit target needs it).
  const idByPath = new Map(rows.map((r) => [r.oldPath, r.id]));
  const mappings = enriched.map((m) => ({ ...m, id: idByPath.get(m.oldPath) || null }));

  return NextResponse.json({
    plan: plan || null,
    mappings,
  });
}
