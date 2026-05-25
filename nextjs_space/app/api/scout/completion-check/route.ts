export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSocialWorkflowResults } from '@/lib/tombstone';
import { sendNotificationEmailHelper, buildCompletionEmailHtml } from '@/lib/scout-email';
import { chargeForPostPackage, refundPostPackage } from '@/lib/credits';
import { logCosts, estimateImagePostCosts } from '@/lib/cost-ledger';

/**
 * POST /api/scout/completion-check
 *
 * Checks all generating PostPackages for completion.
 * When a workflow completes, updates the package and sends a completion email (once).
 * Auth: admin API key (Bearer token or ?key= query param).
 *
 * ## Scheduled Invocation
 *
 * This endpoint is designed to be called periodically:
 * - Abacus scheduled task runs every 1 hour as a safety net (automatic).
 * - For tighter latency, set up an external cron to POST every 5 minutes:
 *
 *     curl -X POST https://connect.launchmarketing.com/api/scout/completion-check \
 *       -H "Authorization: Bearer YOUR_ABACUSAI_API_KEY"
 *
 *   Suitable cron services: cron-job.org, EasyCron, Render Cron Jobs, Railway,
 *   GitHub Actions (schedule), AWS EventBridge, or any scheduler that can fire HTTP POST.
 *
 * ## Idempotency
 * - Atomic `updateMany` claim prevents duplicate status transitions (only one runner wins)
 * - `completionEmailSent === true` → skip email (never double-send)
 * - `status !== 'generating'` → skip processing (already handled)
 * - Also picks up ready-but-email-unsent packages (email retry on failure)
 * - Tombstone errors → log + retry on next cycle (no permanent failure for transient issues)
 * - Missing workflowId → auto-reject after 2h grace period
 */
export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('authorization') || '';
  const apiKey = authHeader.replace('Bearer ', '') || req.nextUrl.searchParams.get('key') || '';
  const expectedKey = process.env.ABACUSAI_API_KEY;
  if (!expectedKey || apiKey !== expectedKey) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const runId = Date.now().toString(36);
  console.log(`[completion-check][${runId}] Starting sweep`);

  try {
    // Find all packages needing attention:
    // 1. Still generating (need Tombstone status check)
    // 2. Ready but email not sent (retry failed email sends)
    const packages = await prisma.postPackage.findMany({
      where: {
        OR: [
          { status: 'generating' },
          { status: 'ready', completionEmailSent: false },
        ],
      },
      include: {
        business: { select: { businessName: true } },
        user: { select: { email: true } },
      },
    });

    console.log(`[completion-check][${runId}] Found ${packages.length} packages needing attention`);

    if (packages.length === 0) {
      return NextResponse.json({ checked: 0, results: [], runId });
    }

    const results: { id: string; status: string; emailSent?: boolean; detail?: string }[] = [];
    const appUrl = process.env.NEXTAUTH_URL || 'https://connect.launchmarketing.com';

    for (const pkg of packages) {

      // ── Branch A: Ready but email not sent (retry path) ──
      if (pkg.status === 'ready') {
        const emailResult = await trySendCompletionEmail(pkg, appUrl, runId);
        results.push(emailResult);
        continue;
      }

      // ── Branch B: Generating — needs Tombstone check ──

      // Guard: missing workflowId
      if (!pkg.workflowId) {
        const ageMs = Date.now() - pkg.createdAt.getTime();
        if (ageMs > 2 * 60 * 60 * 1000) {
          await prisma.postPackage.update({ where: { id: pkg.id }, data: { status: 'rejected' } });
          console.warn(`[completion-check][${runId}] Package ${pkg.id} biz=${pkg.businessId}: no workflowId after 2h — marked rejected`);
          results.push({ id: pkg.id, status: 'timed_out_no_workflow', detail: `Age: ${Math.round(ageMs / 60000)}min` });
        } else {
          console.log(`[completion-check][${runId}] Package ${pkg.id}: no workflowId yet, age ${Math.round(ageMs / 60000)}min — will retry`);
          results.push({ id: pkg.id, status: 'waiting_for_workflow' });
        }
        continue;
      }

      // Query Tombstone
      let wfResult;
      try {
        wfResult = await getSocialWorkflowResults([pkg.workflowId]);
      } catch (err: any) {
        console.error(`[completion-check][${runId}] Package ${pkg.id} wf=${pkg.workflowId}: Tombstone query failed — ${err?.message || 'unknown'}. Will retry.`);
        results.push({ id: pkg.id, status: 'tombstone_unavailable', detail: err?.message });
        continue;
      }

      // Handle: completed with output
      if (wfResult.status === 'completed' && wfResult.posts.length > 0) {
        const post = wfResult.posts[0];

        // ATOMIC CLAIM: Only one runner can transition generating → ready.
        // If another runner already claimed this package, updateMany returns count=0.
        const claimed = await prisma.postPackage.updateMany({
          where: { id: pkg.id, status: 'generating' },
          data: {
            status: 'ready',
            postCopy: post.caption || '',
            headline: post.newsAngle || '',
            cta: '',
            hashtags: post.hashtags || [],
            imageUrl: post.imageUrl || '',
            completedAt: new Date(),
          },
        });

        if (claimed.count === 0) {
          console.log(`[completion-check][${runId}] Package ${pkg.id}: lost atomic claim — another runner handled it`);
          results.push({ id: pkg.id, status: 'claimed_by_other', detail: 'lost_race' });
          continue;
        }

        console.log(`[completion-check][${runId}] Package ${pkg.id} wf=${pkg.workflowId} biz=${pkg.businessId}: workflow completed, status → ready`);

        // Charge credits (idempotent — safe on re-runs)
        try {
          const chargeResult = await chargeForPostPackage(pkg.businessId, pkg.id, pkg.userId, 'image_post_charge');
          if (chargeResult.success) {
            console.log(`[completion-check][${runId}] Package ${pkg.id}: charged 1 credit (balance=${chargeResult.balanceAfter}, alreadyCharged=${chargeResult.alreadyCharged})`);
          } else {
            console.warn(`[completion-check][${runId}] Package ${pkg.id}: credit charge failed — ${chargeResult.error}. Package still ready.`);
          }
        } catch (chargeErr: any) {
          console.error(`[completion-check][${runId}] Package ${pkg.id}: credit charge exception — ${chargeErr.message}`);
        }

        // Log estimated internal costs (non-blocking)
        try {
          await logCosts(estimateImagePostCosts({
            businessId: pkg.businessId,
            userId: pkg.userId,
            postPackageId: pkg.id,
            workflowId: pkg.workflowId || undefined,
          }));
        } catch (costErr: any) {
          console.error(`[completion-check][${runId}] Package ${pkg.id}: cost logging failed — ${costErr.message}`);
        }

        // Reload with fresh data for email
        const freshPkg = await prisma.postPackage.findUnique({
          where: { id: pkg.id },
          include: {
            business: { select: { businessName: true } },
            user: { select: { email: true } },
          },
        });
        if (freshPkg) {
          const emailResult = await trySendCompletionEmail(freshPkg, appUrl, runId);
          results.push(emailResult);
        } else {
          results.push({ id: pkg.id, status: 'completed', emailSent: false, detail: 'package_vanished' });
        }

      } else if (wfResult.status === 'error') {
        const ageMs = Date.now() - pkg.createdAt.getTime();
        if (ageMs > 4 * 60 * 60 * 1000) {
          await prisma.postPackage.update({ where: { id: pkg.id }, data: { status: 'rejected' } });
          console.error(`[completion-check][${runId}] Package ${pkg.id} wf=${pkg.workflowId}: Tombstone error after 4h — marked rejected`);
          results.push({ id: pkg.id, status: 'error_rejected', detail: `Age: ${Math.round(ageMs / 60000)}min` });
        } else {
          console.warn(`[completion-check][${runId}] Package ${pkg.id} wf=${pkg.workflowId}: Tombstone error, age ${Math.round(ageMs / 60000)}min — will retry`);
          results.push({ id: pkg.id, status: 'error_retrying' });
        }
      } else if (wfResult.status === 'completed' && wfResult.posts.length === 0) {
        console.warn(`[completion-check][${runId}] Package ${pkg.id} wf=${pkg.workflowId}: workflow completed but 0 posts — will retry`);
        results.push({ id: pkg.id, status: 'completed_no_output' });
      } else {
        const ageMs = Date.now() - pkg.createdAt.getTime();
        console.log(`[completion-check][${runId}] Package ${pkg.id} wf=${pkg.workflowId}: still generating (age ${Math.round(ageMs / 60000)}min)`);
        results.push({ id: pkg.id, status: 'still_generating' });
      }
    }

    console.log(`[completion-check][${runId}] Sweep complete: ${JSON.stringify(results.map(r => `${r.id.slice(0,8)}:${r.status}`))}`);
    return NextResponse.json({ checked: packages.length, results, runId });
  } catch (err: any) {
    console.error(`[completion-check][${runId}] Fatal error:`, err);
    return NextResponse.json({ error: err.message, runId }, { status: 500 });
  }
}

/**
 * Attempt to send a completion email for a ready package.
 * Uses atomic `updateMany` to claim the email-send right — prevents duplicates.
 */
async function trySendCompletionEmail(
  pkg: {
    id: string;
    completionEmailSent: boolean;
    postCopy: string | null;
    headline: string | null;
    imageUrl: string | null;
    storyTitle: string;
    storySource: string;
    businessId: string;
    business?: { businessName: string | null } | null;
    user?: { email: string } | null;
  },
  appUrl: string,
  runId: string,
): Promise<{ id: string; status: string; emailSent?: boolean; detail?: string }> {
  // Already sent guard
  if (pkg.completionEmailSent) {
    return { id: pkg.id, status: 'completed', emailSent: false, detail: 'already_sent' };
  }

  if (!pkg.user?.email) {
    console.warn(`[completion-check][${runId}] Package ${pkg.id}: no user email — skipping notification`);
    return { id: pkg.id, status: 'completed', emailSent: false, detail: 'no_email' };
  }

  // ATOMIC CLAIM: only one runner can claim the email-send right.
  // We set completionEmailSent=true FIRST to prevent any other runner from also sending.
  const emailClaimed = await prisma.postPackage.updateMany({
    where: { id: pkg.id, completionEmailSent: false },
    data: { completionEmailSent: true },
  });
  if (emailClaimed.count === 0) {
    console.log(`[completion-check][${runId}] Package ${pkg.id}: email claim lost — another runner sending`);
    return { id: pkg.id, status: 'completed', emailSent: false, detail: 'email_claimed_by_other' };
  }

  const reviewUrl = `${appUrl}/post/${pkg.id}`;
  const downloadUrl = `${appUrl}/api/post-package/${pkg.id}/download`;

  const html = buildCompletionEmailHtml({
    businessName: pkg.business?.businessName || 'Your Business',
    storyTitle: pkg.storyTitle,
    storySource: pkg.storySource,
    postCopy: pkg.postCopy || '',
    headline: pkg.headline || '',
    imageUrl: pkg.imageUrl || '',
    reviewUrl,
    downloadUrl,
  });

  const emailSent = await sendNotificationEmailHelper({
    to: pkg.user.email,
    subject: 'Your Ad Launch post is ready',
    html,
    notificationId: process.env.NOTIF_ID_POST_READY || '',
  });

  if (emailSent) {
    console.log(`[completion-check][${runId}] Package ${pkg.id} biz=${pkg.businessId}: completion email sent to ${pkg.user.email}`);
    return { id: pkg.id, status: 'completed', emailSent: true };
  } else {
    // Email failed — roll back the claim so next cycle can retry
    await prisma.postPackage.update({
      where: { id: pkg.id },
      data: { completionEmailSent: false },
    });
    console.error(`[completion-check][${runId}] Package ${pkg.id}: email send failed — rolled back claim, will retry next cycle`);
    return { id: pkg.id, status: 'completed', emailSent: false, detail: 'send_failed_will_retry' };
  }
}
