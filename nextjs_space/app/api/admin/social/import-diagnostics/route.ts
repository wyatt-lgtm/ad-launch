export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';
import { fetchQueueByBusiness } from '@/lib/social-import';

/**
 * Admin-only operator diagnostics for the Tombstone -> Launch OS social import.
 *
 * GET /api/admin/social/import-diagnostics?businessId=<optional>
 *
 * Surfaces, at a glance:
 *  - newest imported SocialPost (global, and per-business if scoped)
 *  - newest imported tombstoneTaskId
 *  - last GenerationRun timestamp
 *  - count of diagnostic shells (generation_incomplete / generation_failed)
 *  - every Business that has a tombstoneBusinessId mapping (flagging any with
 *    a null owner, which silently breaks the on-demand poll)
 *  - live recent-queue count per mapped business (and whether the newest item
 *    carries a usable R2 image key) so the operator can see exactly what is
 *    waiting to be imported.
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if ((session.user as any)?.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden — admin only' }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const businessId = searchParams.get('businessId') || undefined;

  // ── Global / scoped SocialPost stats ──────────────────────────────────────
  const baseWhere: any = {};
  if (businessId) baseWhere.businessId = businessId;

  const newestPost = await prisma.socialPost.findFirst({
    where: { ...baseWhere, tombstoneTaskId: { not: null } },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      createdAt: true,
      tombstoneTaskId: true,
      businessId: true,
      status: true,
      imageUrl: true,
    },
  });

  const totalImported = await prisma.socialPost.count({
    where: { ...baseWhere, tombstoneTaskId: { not: null } },
  });

  const incompleteCount = await prisma.socialPost.count({
    where: { ...baseWhere, status: 'generation_incomplete' },
  });
  const failedCount = await prisma.socialPost.count({
    where: { ...baseWhere, status: 'generation_failed' },
  });
  const pendingApprovalCount = await prisma.socialPost.count({
    where: { ...baseWhere, status: 'pending_approval' },
  });

  const lastRun = await prisma.generationRun.findFirst({
    orderBy: { createdAt: 'desc' },
    select: { id: true, createdAt: true, status: true, businessId: true },
  });

  // ── Business <-> Tombstone mapping health ─────────────────────────────────
  const mappedBusinesses = await prisma.business.findMany({
    where: { tombstoneBusinessId: { not: null } },
    select: {
      id: true,
      businessName: true,
      userId: true,
      tombstoneBusinessId: true,
    },
    orderBy: { businessName: 'asc' },
  });

  // Optionally probe the live queue for each mapped business (or just the one
  // requested). Kept best-effort so the dashboard never hangs on a cold start.
  const probeTargets = businessId
    ? mappedBusinesses.filter((b) => b.id === businessId)
    : mappedBusinesses;

  const mappingHealth = await Promise.all(
    mappedBusinesses.map(async (b) => {
      const ownerMissing = !b.userId;
      let recentQueueCount: number | null = null;
      let r2KeyFound: boolean | null = null;
      let newestQueueTaskId: string | null = null;

      if (probeTargets.some((p) => p.id === b.id) && b.tombstoneBusinessId != null) {
        try {
          const queue = await fetchQueueByBusiness(Number(b.tombstoneBusinessId), {
            limit: 100,
          });
          recentQueueCount = queue.length;
          if (queue.length > 0) {
            const newest = queue[0];
            newestQueueTaskId = newest?.task_id != null ? String(newest.task_id) : null;
            r2KeyFound = !!newest?.first_image_url;
          }
        } catch {
          recentQueueCount = null;
        }
      }

      return {
        businessId: b.id,
        name: b.businessName,
        tombstoneBusinessId: b.tombstoneBusinessId,
        ownerUserId: b.userId,
        ownerMissing,
        recentQueueCount,
        newestQueueTaskId,
        r2KeyFound,
      };
    })
  );

  return NextResponse.json({
    scope: businessId ? { businessId } : 'global',
    newestImportedPost: newestPost
      ? {
          id: newestPost.id,
          createdAt: newestPost.createdAt,
          tombstoneTaskId: newestPost.tombstoneTaskId,
          businessId: newestPost.businessId,
          status: newestPost.status,
          imageKeySample: newestPost.imageUrl,
        }
      : null,
    totalImported,
    statusCounts: {
      pending_approval: pendingApprovalCount,
      generation_incomplete: incompleteCount,
      generation_failed: failedCount,
    },
    lastGenerationRun: lastRun,
    mappedBusinessCount: mappedBusinesses.length,
    mappingHealth,
  });
}
