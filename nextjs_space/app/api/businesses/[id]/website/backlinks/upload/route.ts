/**
 * Backlink Inventory — file upload + manual URL entry (Milestone 10).
 * business-scoped.
 *
 * POST -> accept an uploaded backlink export (CSV or newline URL list) and/or a
 *         manual list of URLs, build an inventory snapshot, persist it, return
 *         it. NEVER scrapes Google. NEVER deploys/publishes/mutates DNS. Never
 *         fabricates backlink counts — absent columns stay null.
 *
 * Body: { content?: string, manualUrls?: string[], liveDomain?: string }
 */
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { authorizeBusiness, rejectDeployIntent } from '@/lib/site-backlinks/api-guard';
import { ensureWebsiteProject } from '@/lib/website-workflow';
import {
  buildInventory,
  parseUploadedBacklinks,
  urlsFromManualList,
  type InventorySourceInput,
} from '@/lib/site-backlinks/inventory';
import { saveInventory } from '@/lib/site-backlinks/store';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await authorizeBusiness(params.id);
  if ('error' in guard) return guard.error;

  const body = await req.json().catch(() => ({} as any));
  const deployReject = rejectDeployIntent(body);
  if (deployReject) return deployReject;

  const content = typeof body?.content === 'string' ? body.content : '';
  const manualUrls: string[] = Array.isArray(body?.manualUrls) ? body.manualUrls : [];

  if (!content.trim() && manualUrls.length === 0) {
    return NextResponse.json(
      { error: 'Provide an uploaded backlink export (content) or a manual URL list.' },
      { status: 400 },
    );
  }

  const warnings: string[] = [];
  const sources: InventorySourceInput[] = [];

  if (content.trim()) {
    const parsed = parseUploadedBacklinks(content);
    warnings.push(...parsed.warnings);
    sources.push({ source: 'uploaded_file', urls: parsed.urls });
  }
  if (manualUrls.length) {
    sources.push({ source: 'manual', urls: urlsFromManualList(manualUrls) });
  }

  const project = await ensureWebsiteProject(params.id);
  const inventory = buildInventory({
    liveDomain: (body?.liveDomain as string) || null,
    crawledAt: null,
    sources,
    providerAvailable: false,
    extraWarnings: warnings,
  });

  const saved = await saveInventory({
    businessId: params.id,
    websiteProjectId: project.id,
    inventory,
  });

  return NextResponse.json({
    inventoryId: saved.id,
    status: inventory.status,
    totalBacklinkUrls: inventory.totalBacklinkUrls,
    highValueUrlCount: inventory.highValueUrlCount,
    providerMissing: inventory.providerMissing,
    warnings: inventory.warnings,
    urls: inventory.urls,
  });
}
