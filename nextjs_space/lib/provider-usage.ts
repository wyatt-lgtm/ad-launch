/**
 * Provider usage tracking + status helpers for Search Intelligence providers.
 *
 * - logProviderUsage(): persists ProviderUsageEvent rows for each request a
 *   provider made during a run/test. NEVER stores credentials — only metadata.
 * - getDataForSeoStatus(): derives the UI status (disabled / missing
 *   credentials / sandbox / live) plus the last successful + last error event
 *   for a given business, scoped strictly by businessId.
 */

import { prisma } from '@/lib/db';
import {
  getDataForSeoConfig,
  describeProviderStatus,
  type ProviderUsageDescriptor,
} from '@/lib/dataforseo-provider';

export const DATAFORSEO_PROVIDER = 'dataforseo';

/**
 * Persist a batch of usage descriptors for a business. Safe to call with an
 * empty array (no-op). Failures are swallowed so usage logging never breaks a
 * run, but they are surfaced to the server log (without any credential data).
 */
export async function logProviderUsage(
  businessId: string,
  provider: string,
  descriptors: ProviderUsageDescriptor[],
  runId?: string | null,
): Promise<void> {
  if (!businessId || !descriptors || descriptors.length === 0) return;
  try {
    await prisma.providerUsageEvent.createMany({
      data: descriptors.map((d) => ({
        businessId,
        provider,
        endpoint: d.endpoint,
        queryType: d.queryType,
        targetKeyword: d.targetKeyword ?? null,
        targetLocation: d.targetLocation ?? null,
        requestCount: d.requestCount ?? 1,
        responseStatus: d.responseStatus,
        providerStatusCode: d.providerStatusCode ?? null,
        unitsUsed: d.unitsUsed ?? null,
        costEstimate: d.costEstimate ?? null,
        isSandbox: d.isSandbox ?? false,
        errorMessage: d.errorMessage ?? null,
        runId: runId ?? null,
      })),
    });
  } catch (err: any) {
    // Do not leak anything sensitive; descriptors carry no credentials.
    console.error('[provider-usage] failed to log usage events:', err?.message ?? err);
  }
}

export type DataForSeoStatusMode =
  | 'disabled'
  | 'missing_credentials'
  | 'sandbox'
  | 'live';

/**
 * Precise classification of the MOST RECENT request for this business. Lets the
 * UI distinguish "API OK with results" from "API OK but zero items" from a true
 * error — instead of showing a stale error after a newer empty/ok request.
 */
export type DataForSeoRequestState =
  | 'never'
  | 'ok_results'
  | 'ok_zero_items'
  | 'error'
  | 'disabled'
  | 'missing_credentials';

export interface DataForSeoStatus {
  provider: 'dataforseo';
  mode: DataForSeoStatusMode;
  enabled: boolean;
  configured: boolean;
  useSandbox: boolean;
  message: string;
  baseUrl: string;
  credentialsRef: string;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastErrorMessage: string | null;
  // Most-recent-request classification (any status).
  requestState: DataForSeoRequestState;
  lastRequestAt: string | null;
  lastRequestStatus: string | null; // ok | empty | error | ...
  lastProviderStatusCode: number | null;
  lastRequestSummary: string | null; // human, credential-free
  lastRequestKeyword: string | null;
  lastRequestLocation: string | null;
}

/**
 * Compute the current DataForSEO status for a business. Reads the env-derived
 * config (no credentials returned) and the most recent ok/error usage events
 * for this business only.
 */
export async function getDataForSeoStatus(businessId: string): Promise<DataForSeoStatus> {
  const cfg = getDataForSeoConfig();

  let mode: DataForSeoStatusMode;
  let message: string;
  if (!cfg.enabled) {
    mode = 'disabled';
    message = 'DataForSEO is disabled (DATAFORSEO_ENABLED is not true).';
  } else if (!cfg.hasCredentials) {
    mode = 'missing_credentials';
    message = 'DataForSEO is enabled but API credentials are not configured.';
  } else if (cfg.useSandbox) {
    mode = 'sandbox';
    message = 'DataForSEO connected in SANDBOX mode (test data only).';
  } else {
    mode = 'live';
    message = 'DataForSEO connected in LIVE mode.';
  }

  let lastSuccessAt: string | null = null;
  let lastErrorAt: string | null = null;
  let lastErrorMessage: string | null = null;
  let requestState: DataForSeoRequestState =
    mode === 'disabled' ? 'disabled' : mode === 'missing_credentials' ? 'missing_credentials' : 'never';
  let lastRequestAt: string | null = null;
  let lastRequestStatus: string | null = null;
  let lastProviderStatusCode: number | null = null;
  let lastRequestSummary: string | null = null;
  let lastRequestKeyword: string | null = null;
  let lastRequestLocation: string | null = null;

  // Only query history when the table is reachable; failures degrade silently.
  try {
    const [lastOk, lastErr, lastEvent] = await Promise.all([
      prisma.providerUsageEvent.findFirst({
        where: { businessId, provider: DATAFORSEO_PROVIDER, responseStatus: 'ok' },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      }),
      prisma.providerUsageEvent.findFirst({
        where: { businessId, provider: DATAFORSEO_PROVIDER, responseStatus: 'error' },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true, errorMessage: true },
      }),
      // The single most recent request of ANY status — drives the headline state.
      prisma.providerUsageEvent.findFirst({
        where: { businessId, provider: DATAFORSEO_PROVIDER, queryType: { in: ['serp_organic', 'serp_with_paid'] } },
        orderBy: { createdAt: 'desc' },
        select: {
          createdAt: true, responseStatus: true, providerStatusCode: true,
          errorMessage: true, targetKeyword: true, targetLocation: true,
        },
      }),
    ]);
    lastSuccessAt = lastOk?.createdAt ? lastOk.createdAt.toISOString() : null;
    lastErrorAt = lastErr?.createdAt ? lastErr.createdAt.toISOString() : null;
    lastErrorMessage = lastErr?.errorMessage ?? null;

    if (lastEvent && mode !== 'disabled' && mode !== 'missing_credentials') {
      lastRequestAt = lastEvent.createdAt ? lastEvent.createdAt.toISOString() : null;
      lastRequestStatus = lastEvent.responseStatus ?? null;
      lastProviderStatusCode = lastEvent.providerStatusCode ?? null;
      lastRequestKeyword = lastEvent.targetKeyword ?? null;
      lastRequestLocation = lastEvent.targetLocation ?? null;
      const st = lastEvent.responseStatus;
      if (st === 'ok') {
        requestState = 'ok_results';
        lastRequestSummary = 'Last request returned SERP results.';
      } else if (st === 'empty') {
        requestState = 'ok_zero_items';
        lastRequestSummary =
          lastEvent.errorMessage ||
          `API returned OK (status ${lastEvent.providerStatusCode ?? '20000'}) but no SERP items. Inspect location/payload/parser — not a funds issue.`;
      } else if (st === 'error') {
        requestState = 'error';
        const info = describeProviderStatus(lastEvent.providerStatusCode);
        lastRequestSummary = lastEvent.errorMessage || info.message;
      }
    }
  } catch (err: any) {
    console.error('[provider-usage] failed to read usage history:', err?.message ?? err);
  }

  return {
    provider: 'dataforseo',
    mode,
    enabled: cfg.enabled,
    configured: cfg.enabled && cfg.hasCredentials,
    useSandbox: cfg.useSandbox,
    message,
    baseUrl: cfg.effectiveBaseUrl,
    credentialsRef: 'DATAFORSEO_API_LOGIN / DATAFORSEO_API_PASSWORD',
    lastSuccessAt,
    lastErrorAt,
    lastErrorMessage,
    requestState,
    lastRequestAt,
    lastRequestStatus,
    lastProviderStatusCode,
    lastRequestSummary,
    lastRequestKeyword,
    lastRequestLocation,
  };
}
