export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { resolveBusinessAccess } from '@/lib/tracking-auth';
import {
  buildWebsiteResearchContract,
  toResearchContractPayload,
} from '@/lib/website-research-contract';
import { getDataForSeoConfig } from '@/lib/dataforseo-provider';

/**
 * GET /api/businesses/[id]/website/research-diagnostics
 *
 * READ-ONLY diagnostics for website research / competitor-discovery detection.
 * It runs the SAME helper used by website generation
 * (buildWebsiteResearchContract + toResearchContractPayload) so the operator
 * can inspect the exact provider / stored-research state and the resulting
 * War Room diagnostic message WITHOUT starting a generation mission.
 *
 * SAFETY — this endpoint is strictly read-only. It does NOT:
 *   - create a website mission            - call Tombstone /commands/run
 *   - generate images                     - create tasks
 *   - create WebsiteProject/Concept/Production rows
 *   - publish anything
 *   - mutate social / import / R2 / Search Intelligence state
 * The underlying helper only performs findUnique/findFirst/findMany reads,
 * all business-scoped (no cross-business leakage).
 *
 * AUTH / SCOPING (via resolveBusinessAccess):
 *   - unauthenticated            -> 401
 *   - admin OR owner             -> 200
 *   - wrong / non-owned business -> 404
 *
 * Optional query params (all read-only inputs; none trigger side effects):
 *   ?targetKeyword=...            single primary keyword
 *   ?targetLocations=a,b         comma-separated locations
 *   ?competitorUrls=u1,u2        comma-separated manual competitor URLs
 *   ?analyzeCompetitors=false    defaults to true (mirrors the discovery path)
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const access = await resolveBusinessAccess(req, params.id);
  if ('error' in access) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const { searchParams } = new URL(req.url);
  const csv = (v: string | null): string[] =>
    (v ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  const targetKeyword = searchParams.get('targetKeyword') || undefined;
  const targetLocations = csv(searchParams.get('targetLocations'));
  const competitorUrls = csv(searchParams.get('competitorUrls'));
  // Mirror the generation flow: competitor discovery is assumed ON unless the
  // caller explicitly disables it. This governs whether a warning is surfaced.
  const analyzeCompetitors = searchParams.get('analyzeCompetitors') !== 'false';

  let contract;
  try {
    contract = await buildWebsiteResearchContract({
      businessId: access.business.id,
      targetKeyword,
      targetLocations: targetLocations.length ? targetLocations : undefined,
      competitorUrls: competitorUrls.length ? competitorUrls : undefined,
    });
  } catch (e: any) {
    console.error('[research-diagnostics] contract build failed:', e?.message);
    return NextResponse.json(
      { error: 'Failed to build research diagnostics', detail: e?.message ?? 'unknown error' },
      { status: 500 },
    );
  }

  // Same warning rule as generation: only warn when discovery is requested AND
  // none of research-priorities 1-5 are available.
  const warnings: string[] =
    analyzeCompetitors && contract.shouldWarn ? [contract.diagnosticMessage] : [];

  // Provider health is only meaningfully known once the provider is configured;
  // otherwise report it as "unknown" rather than a misleading "no".
  const providerHealthy: 'yes' | 'no' | 'unknown' = contract.providerConfigured
    ? contract.providerHealthy
      ? 'yes'
      : 'no'
    : 'unknown';

  // Correct DataForSEO env-var detection (the exact names the provider reads).
  const dfsCfg = getDataForSeoConfig();
  const dataForSeoConfigDetected =
    process.env.DATAFORSEO_ENABLED === 'true' &&
    !!process.env.DATAFORSEO_API_LOGIN &&
    !!process.env.DATAFORSEO_API_PASSWORD;

  // searchDiagnostics — identical shape to /api/generate-concept-site response.
  const searchDiagnostics = {
    activeSearchProvider: contract.activeSearchProvider,
    providerConfigured: contract.providerConfigured,
    providerHealthy: contract.providerHealthy,
    providerSource: contract.providerSource,
    searchIntelligenceAvailable: contract.searchIntelligenceAvailable,
    latestSearchRunAt: contract.latestSearchRunAt,
    seoMetaAnalysisId: contract.seoMetaAnalysisId,
    approvedPageBriefId: contract.approvedPageBriefId,
    usedApprovedPageBrief: Boolean(contract.approvedPageBriefId),
    competitorUrlCount: contract.competitorUrlCount,
    researchFreshnessStatus: contract.researchFreshnessStatus,
    fallbackReason: contract.fallbackReason,
    manualCompetitorFallbackAvailable: contract.hasManualCompetitorUrls,
    warningState: contract.warningState,
    diagnosticMessage: contract.diagnosticMessage,
  };

  return NextResponse.json({
    readOnly: true,
    businessId: access.business.id,
    // Flattened, human-readable diagnostics (the fields requested for review).
    searchDiagnostics,
    warnings,
    research_contract: toResearchContractPayload(contract),
    providerConfigured: contract.providerConfigured ? 'yes' : 'no',
    providerHealthy,
    activeProvider: contract.activeSearchProvider,
    dataForSeoConfigDetected: dataForSeoConfigDetected ? 'yes' : 'no',
    dataForSeoEnvVarsChecked: ['DATAFORSEO_API_LOGIN', 'DATAFORSEO_API_PASSWORD', 'DATAFORSEO_ENABLED'],
    dataForSeoSandboxMode: dfsCfg.useSandbox ?? null,
    storedSearchIntelligenceAvailable: contract.searchIntelligenceAvailable ? 'yes' : 'no',
    latestSearchIntelligenceRunDate: contract.latestSearchRunAt,
    approvedPageBriefId: contract.approvedPageBriefId,
    metaAnalysisId: contract.seoMetaAnalysisId,
    competitorUrlCount: contract.competitorUrlCount,
    warningState: contract.warningState,
    diagnosticMessage: contract.diagnosticMessage,
    should_warn: contract.shouldWarn,
  });
}
