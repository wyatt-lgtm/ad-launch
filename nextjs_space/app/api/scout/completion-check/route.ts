export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSocialWorkflowResults } from '@/lib/tombstone';
import { sendNotificationEmailHelper, buildCompletionEmailHtml } from '@/lib/scout-email';

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
 * - `completionEmailSent === true` → skip email (never double-send)
 * - `status !== 'generating'` → skip processing (already handled)
 * - Tombstone errors → log + retry on next cycle (no permanent failure marking for transient issues)
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
    // Find all generating packages
    const packages = await prisma.postPackage.findMany({
      where: { status: 'generating' },
      include: {
        business: { select: { businessName: true } },
        user: { select: { email: true } },
      },
    });

    console.log(`[completion-check][${runId}] Found ${packages.length} generating packages`);

    if (packages.length === 0) {
      return NextResponse.json({ checked: 0, results: [], runId });
    }

    const results: { id: string; status: string; emailSent?: boolean; detail?: string }[] = [];

    for (const pkg of packages) {
      // --- Guard: missing workflowId ---
      if (!pkg.workflowId) {
        const ageMs = Date.now() - pkg.createdAt.getTime();
        if (ageMs > 2 * 60 * 60 * 1000) {
          // 2h grace period expired — mark failed
          await prisma.postPackage.update({ where: { id: pkg.id }, data: { status: 'rejected' } });
          console.warn(`[completion-check][${runId}] Package ${pkg.id}: no workflowId after 2h — marked rejected`);
          results.push({ id: pkg.id, status: 'timed_out_no_workflow', detail: `Age: ${Math.round(ageMs / 60000)}min` });
        } else {
          console.log(`[completion-check][${runId}] Package ${pkg.id}: no workflowId yet, age ${Math.round(ageMs / 60000)}min — will retry`);
          results.push({ id: pkg.id, status: 'waiting_for_workflow' });
        }
        continue;
      }

      // --- Query Tombstone ---
      let wfResult;
      try {
        wfResult = await getSocialWorkflowResults([pkg.workflowId]);
      } catch (err: any) {
        // Tombstone unavailable — log and retry next cycle
        console.error(`[completion-check][${runId}] Package ${pkg.id}: Tombstone query failed — ${err?.message || 'unknown error'}. Will retry.`);
        results.push({ id: pkg.id, status: 'tombstone_unavailable', detail: err?.message });
        continue;
      }

      // --- Handle completion ---
      if (wfResult.status === 'completed' && wfResult.posts.length > 0) {
        const post = wfResult.posts[0]; // Single story = single post
        const appUrl = process.env.NEXTAUTH_URL || 'https://connect.launchmarketing.com';

        await prisma.postPackage.update({
          where: { id: pkg.id },
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

        console.log(`[completion-check][${runId}] Package ${pkg.id}: workflow completed, status → ready`);

        // --- Send completion email (idempotent: skip if already sent) ---
        if (pkg.completionEmailSent) {
          console.log(`[completion-check][${runId}] Package ${pkg.id}: completion email already sent — skipping`);
          results.push({ id: pkg.id, status: 'completed', emailSent: false, detail: 'already_sent' });
          continue;
        }

        if (!pkg.user?.email) {
          console.warn(`[completion-check][${runId}] Package ${pkg.id}: no user email — skipping notification`);
          results.push({ id: pkg.id, status: 'completed', emailSent: false, detail: 'no_email' });
          continue;
        }

        const reviewUrl = `${appUrl}/post/${pkg.id}`;
        const downloadUrl = `${appUrl}/api/post-package/${pkg.id}/download`;

        const html = buildCompletionEmailHtml({
          businessName: pkg.business?.businessName || 'Your Business',
          storyTitle: pkg.storyTitle,
          storySource: pkg.storySource,
          postCopy: post.caption || '',
          headline: post.newsAngle || '',
          imageUrl: post.imageUrl || '',
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
          await prisma.postPackage.update({
            where: { id: pkg.id },
            data: { completionEmailSent: true },
          });
          console.log(`[completion-check][${runId}] Package ${pkg.id}: completion email sent to ${pkg.user.email}`);
        } else {
          console.error(`[completion-check][${runId}] Package ${pkg.id}: email send failed — will retry next cycle`);
        }

        results.push({ id: pkg.id, status: 'completed', emailSent });

      } else if (wfResult.status === 'error') {
        // Permanent failure from Tombstone
        const ageMs = Date.now() - pkg.createdAt.getTime();
        if (ageMs > 4 * 60 * 60 * 1000) {
          // Only mark rejected after 4h of error state (in case Tombstone recovers)
          await prisma.postPackage.update({ where: { id: pkg.id }, data: { status: 'rejected' } });
          console.error(`[completion-check][${runId}] Package ${pkg.id}: Tombstone error after 4h — marked rejected`);
          results.push({ id: pkg.id, status: 'error_rejected', detail: `Age: ${Math.round(ageMs / 60000)}min` });
        } else {
          console.warn(`[completion-check][${runId}] Package ${pkg.id}: Tombstone error, age ${Math.round(ageMs / 60000)}min — will retry`);
          results.push({ id: pkg.id, status: 'error_retrying' });
        }
      } else if (wfResult.status === 'completed' && wfResult.posts.length === 0) {
        // Completed but no output
        console.warn(`[completion-check][${runId}] Package ${pkg.id}: workflow completed but 0 posts returned — will retry`);
        results.push({ id: pkg.id, status: 'completed_no_output' });
      } else {
        // Still processing
        const ageMs = Date.now() - pkg.createdAt.getTime();
        console.log(`[completion-check][${runId}] Package ${pkg.id}: still generating (age ${Math.round(ageMs / 60000)}min)`);
        results.push({ id: pkg.id, status: 'still_generating' });
      }
    }

    console.log(`[completion-check][${runId}] Sweep complete: ${JSON.stringify(results.map(r => r.status))}`);
    return NextResponse.json({ checked: packages.length, results, runId });
  } catch (err: any) {
    console.error(`[completion-check][${runId}] Fatal error:`, err);
    return NextResponse.json({ error: err.message, runId }, { status: 500 });
  }
}
