export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSocialWorkflowResults } from '@/lib/tombstone';
import { sendNotificationEmailHelper, buildCompletionEmailHtml } from '@/lib/scout-email';

/**
 * POST /api/scout/completion-check
 *
 * Checks all generating PostPackages for completion.
 * When a workflow completes, updates the package and sends a completion email.
 * Auth: admin API key (called by scheduled task or webhook).
 */
export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('authorization') || '';
  const apiKey = authHeader.replace('Bearer ', '') || req.nextUrl.searchParams.get('key') || '';
  const expectedKey = process.env.ABACUSAI_API_KEY;
  if (!expectedKey || apiKey !== expectedKey) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Find all generating packages
    const packages = await prisma.postPackage.findMany({
      where: { status: 'generating' },
      include: {
        business: { select: { businessName: true } },
        user: { select: { email: true } },
      },
    });

    console.log(`[completion-check] Checking ${packages.length} generating packages`);
    const results: { id: string; status: string; emailSent?: boolean }[] = [];

    for (const pkg of packages) {
      if (!pkg.workflowId) {
        // No workflow — mark as failed after 2 hours
        if (Date.now() - pkg.createdAt.getTime() > 2 * 60 * 60 * 1000) {
          await prisma.postPackage.update({ where: { id: pkg.id }, data: { status: 'rejected' } });
          results.push({ id: pkg.id, status: 'timed_out' });
        }
        continue;
      }

      const wfResult = await getSocialWorkflowResults([pkg.workflowId]);

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

        // Send completion email
        if (!pkg.completionEmailSent && pkg.user?.email) {
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
            console.log(`[completion-check] Completion email sent for package ${pkg.id}`);
          }

          results.push({ id: pkg.id, status: 'completed', emailSent });
        } else {
          results.push({ id: pkg.id, status: 'completed', emailSent: false });
        }
      } else if (wfResult.status === 'error') {
        await prisma.postPackage.update({
          where: { id: pkg.id },
          data: { status: 'rejected' },
        });
        results.push({ id: pkg.id, status: 'error' });
      } else {
        // Still processing
        results.push({ id: pkg.id, status: 'still_generating' });
      }
    }

    return NextResponse.json({ checked: packages.length, results });
  } catch (err: any) {
    console.error('[completion-check] Error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
