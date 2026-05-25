/**
 * Internal Cost Ledger Service
 *
 * Tracks estimated internal costs (LLM tokens, image gen, render, storage)
 * separately from customer-facing credits.
 * Non-blocking: failures are logged but never break package completion.
 */
import { prisma } from '@/lib/db';

export type CostType =
  | 'llm'
  | 'image_generation'
  | 'video_generation'
  | 'render_runtime'
  | 'r2_storage'
  | 'r2_bandwidth'
  | 'email'
  | 'other';

export interface CostEntry {
  businessId?: string;
  userId?: string;
  postPackageId?: string;
  workflowId?: string;
  taskId?: string;
  provider?: string;
  costType: CostType;
  estimatedCostUsd?: number;
  inputTokens?: number;
  outputTokens?: number;
  imageCount?: number;
  videoSeconds?: number;
  renderRuntimeSeconds?: number;
  retryCount?: number;
  metadata?: Record<string, any>;
}

/** Write a cost entry. Non-blocking — errors are caught and logged. */
export async function logCost(entry: CostEntry): Promise<string | null> {
  try {
    const row = await prisma.internalCostLedger.create({
      data: {
        businessId: entry.businessId,
        userId: entry.userId,
        postPackageId: entry.postPackageId,
        workflowId: entry.workflowId,
        taskId: entry.taskId,
        provider: entry.provider,
        costType: entry.costType,
        estimatedCostUsd: entry.estimatedCostUsd ?? 0,
        inputTokens: entry.inputTokens,
        outputTokens: entry.outputTokens,
        imageCount: entry.imageCount,
        videoSeconds: entry.videoSeconds,
        renderRuntimeSeconds: entry.renderRuntimeSeconds,
        retryCount: entry.retryCount,
        metadata: entry.metadata ?? undefined,
      },
    });
    return row.id;
  } catch (err: any) {
    console.error('[cost-ledger] Failed to log cost:', err.message);
    return null;
  }
}

/** Write multiple cost entries. Non-blocking. */
export async function logCosts(entries: CostEntry[]): Promise<number> {
  let written = 0;
  for (const entry of entries) {
    const id = await logCost(entry);
    if (id) written++;
  }
  return written;
}

/** Estimate costs for a typical image post workflow. */
export function estimateImagePostCosts(opts: {
  businessId?: string;
  userId?: string;
  postPackageId?: string;
  workflowId?: string;
}): CostEntry[] {
  return [
    {
      ...opts,
      provider: 'openai',
      costType: 'llm',
      estimatedCostUsd: 0.015, // ~1500 tokens input + 500 output at gpt-4.1-mini
      inputTokens: 1500,
      outputTokens: 500,
      metadata: { stage: 'business_research' },
    },
    {
      ...opts,
      provider: 'openai',
      costType: 'llm',
      estimatedCostUsd: 0.008,
      inputTokens: 800,
      outputTokens: 400,
      metadata: { stage: 'copywriting' },
    },
    {
      ...opts,
      provider: 'openai',
      costType: 'image_generation',
      estimatedCostUsd: 0.04,
      imageCount: 1,
      metadata: { model: 'gpt-image-1', stage: 'image_render' },
    },
    {
      ...opts,
      provider: 'cloudflare_r2',
      costType: 'r2_storage',
      estimatedCostUsd: 0.0001,
      metadata: { stage: 'artifact_storage' },
    },
  ];
}

/** Get cost ledger entries for admin view. */
export async function getCostLedger(
  opts: { businessId?: string; postPackageId?: string; limit?: number; offset?: number } = {},
) {
  const where: any = {};
  if (opts.businessId) where.businessId = opts.businessId;
  if (opts.postPackageId) where.postPackageId = opts.postPackageId;

  const [entries, total] = await Promise.all([
    prisma.internalCostLedger.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: opts.limit ?? 50,
      skip: opts.offset ?? 0,
    }),
    prisma.internalCostLedger.count({ where }),
  ]);

  return { entries, total };
}
