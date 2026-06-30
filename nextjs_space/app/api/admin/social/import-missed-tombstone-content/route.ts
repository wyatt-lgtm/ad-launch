export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';
import {
  fetchQueueByBusiness,
  filterBySince,
  enrichQueueItem,
  isRejected,
  classifyPost,
  buildSocialPostRecord,
  type EnrichedPost,
  type RejectedItem,
} from '@/lib/social-import';

/**
 * Admin-only backfill: reconnect recent Tombstone social renders into Launch OS
 * for a specific business.
 *
 * POST body:
 *   {
 *     businessId: string            // Launch OS Business id (REQUIRED)
 *     tombstoneBusinessId?: number  // override the business->tombstone mapping
 *     since?: string                // ISO date; only import renders on/after this
 *     dryRun?: boolean              // DEFAULT true -- preview only, writes nothing
 *   }
 *
 * Hard guarantees:
 *  - Defaults to a dry-run preview. Nothing is written unless dryRun === false.
 *  - Business-scoped: the Tombstone queue is filtered by business_id server-side,
 *    so no cross-business content can leak in.
 *  - Stores durable R2 keys, never signed URLs.
 *  - NEVER publishes -- imported rows are pending_approval / diagnostic shells.
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if ((session.user as any)?.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden — admin only' }, { status: 403 });
  }

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const businessId: string | undefined = body.businessId;
  const tombstoneBusinessIdOverride =
    body.tombstoneBusinessId !== undefined && body.tombstoneBusinessId !== null
      ? Number(body.tombstoneBusinessId)
      : undefined;
  const since: string | undefined = body.since;
  // Default to dry-run unless explicitly set to false.
  const dryRun: boolean = body.dryRun !== false;

  if (!businessId) {
    return NextResponse.json(
      { error: 'businessId is required' },
      { status: 400 }
    );
  }

  // Resolve the target Launch OS business + its owner.
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: { id: true, businessName: true, userId: true, tombstoneBusinessId: true },
  });

  if (!business) {
    return NextResponse.json(
      { error: `Business ${businessId} not found` },
      { status: 404 }
    );
  }

  if (!business.userId) {
    return NextResponse.json(
      {
        error: `Business ${businessId} ("${business.businessName}") has no owner (userId is null). ` +
          `Assign an owner before backfilling so imported posts have a user. ` +
          `This endpoint does NOT auto-assign ownership.`,
      },
      { status: 409 }
    );
  }

  const tsBizId =
    tombstoneBusinessIdOverride ??
    (business.tombstoneBusinessId !== null && business.tombstoneBusinessId !== undefined
      ? Number(business.tombstoneBusinessId)
      : undefined);

  if (tsBizId === undefined || Number.isNaN(tsBizId)) {
    return NextResponse.json(
      {
        error: `No Tombstone business mapping for business ${businessId} ("${business.businessName}"). ` +
          `Pass tombstoneBusinessId explicitly to backfill.`,
      },
      { status: 409 }
    );
  }

  const userId = business.userId;

  // 1) Pull the publish-ready queue for this single Tombstone business.
  const rawQueue = await fetchQueueByBusiness(tsBizId, { limit: 100 });

  // 2) Date-bound it.
  const queue = filterBySince(rawQueue, since);

  // 3) Dedup against everything this user has already imported.
  const existing = await prisma.socialPost.findMany({
    where: { userId, tombstoneTaskId: { not: null } },
    select: { tombstoneTaskId: true },
  });
  const importedIds = new Set(
    existing.map((e) => e.tombstoneTaskId).filter(Boolean) as string[]
  );

  const duplicates: string[] = [];
  const candidates: any[] = [];
  for (const item of queue) {
    const taskId = String(item.task_id);
    if (importedIds.has(taskId)) {
      duplicates.push(taskId);
    } else {
      candidates.push(item);
    }
  }

  // 4) Enrich each new candidate and classify it.
  const skipped: RejectedItem[] = [];
  const toWrite: ReturnType<typeof buildSocialPostRecord>[] = [];
  const sample: Array<{ taskId: string; status: string; imageKey: string | null }> = [];

  for (const item of candidates) {
    const enriched = await enrichQueueItem(item);
    if (isRejected(enriched)) {
      skipped.push(enriched);
      continue;
    }
    const post = enriched as EnrichedPost;
    const classification = classifyPost(post);
    const completedAt = post.createdAt ? new Date(post.createdAt) : new Date();
    const record = buildSocialPostRecord(post, {
      userId,
      analysisId: null,
      businessId: business.id,
      classification,
      generationRunId: null,
      generationCompletedAt: isNaN(completedAt.getTime()) ? new Date() : completedAt,
    });
    toWrite.push(record);
    if (sample.length < 5) {
      sample.push({
        taskId: post.tombstoneTaskId,
        status: classification.status,
        imageKey: post.imageUrl,
      });
    }
  }

  const summary = {
    business: { id: business.id, name: business.businessName, tombstoneBusinessId: tsBizId },
    since: since ?? null,
    dryRun,
    queueFetched: rawQueue.length,
    afterSinceFilter: queue.length,
    wouldImport: toWrite.length,
    duplicates: duplicates.length,
    duplicateTaskIds: duplicates.slice(0, 25),
    skipped: skipped.length,
    skippedDetail: skipped.slice(0, 25),
    sample,
  };

  if (dryRun) {
    return NextResponse.json({
      ...summary,
      imported: 0,
      note: 'DRY RUN — nothing was written. Re-send with dryRun:false to execute.',
    });
  }

  // 5) Execute the write (business-scoped, never published).
  let imported = 0;
  if (toWrite.length > 0) {
    const result = await prisma.socialPost.createMany({
      data: toWrite as any,
      skipDuplicates: true,
    });
    imported = result.count;
  }

  return NextResponse.json({
    ...summary,
    imported,
    note: `Imported ${imported} post(s) for business "${business.businessName}". No content was published.`,
  });
}
