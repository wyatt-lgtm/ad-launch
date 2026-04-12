export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';
import { getSocialWorkflowResults } from '@/lib/tombstone';

/**
 * POST /api/social/missions/poll
 * Finds analyses that have a socialMissionId but no corresponding SocialPost records,
 * polls Tombstone for completed results, and writes them to the SocialPost table.
 *
 * Returns: { polled: number, imported: number, pending: number, status: string }
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const userId = (session.user as any).id;

    // Find analyses that have a socialMissionId
    const analysesWithMissions = await prisma.analysis.findMany({
      where: {
        userId,
        socialMissionId: { not: null },
      },
      select: {
        id: true,
        socialMissionId: true,
        websiteUrl: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    if (analysesWithMissions.length === 0) {
      return NextResponse.json({ polled: 0, imported: 0, pending: 0, status: 'no_missions' });
    }

    // Check which analyses already have SocialPosts imported
    const analysisIds = analysesWithMissions.map(a => a.id);
    const existingPostCounts = await prisma.socialPost.groupBy({
      by: ['analysisId'],
      where: { analysisId: { in: analysisIds } },
      _count: true,
    });
    const importedAnalysisIds = new Set(
      existingPostCounts.filter(g => g._count > 0).map(g => g.analysisId)
    );

    // Filter to analyses that haven't been imported yet
    const pendingAnalyses = analysesWithMissions.filter(a => !importedAnalysisIds.has(a.id));

    if (pendingAnalyses.length === 0) {
      return NextResponse.json({
        polled: 0,
        imported: 0,
        pending: 0,
        status: 'all_imported',
        totalMissions: analysesWithMissions.length,
      });
    }

    // Collect all unique workflow IDs from pending analyses
    const allWorkflowIds: string[] = [];
    const workflowToAnalysis: Record<string, string> = {};
    for (const a of pendingAnalyses) {
      const wfIds = (a.socialMissionId || '').split(',').filter(Boolean);
      for (const wfId of wfIds) {
        allWorkflowIds.push(wfId);
        workflowToAnalysis[wfId] = a.id;
      }
    }

    console.log(`[missions/poll] Polling ${allWorkflowIds.length} workflow(s) for ${pendingAnalyses.length} pending analyses`);

    // Poll Tombstone for results
    const result = await getSocialWorkflowResults(allWorkflowIds);

    console.log(`[missions/poll] Tombstone status: ${result.status}, posts found: ${result.posts.length}`);

    if (result.status !== 'completed' || result.posts.length === 0) {
      return NextResponse.json({
        polled: allWorkflowIds.length,
        imported: 0,
        pending: pendingAnalyses.length,
        status: result.status,
        message: result.status === 'generating' || result.status === 'processing'
          ? 'Posts are still being generated. Check back in a minute or two.'
          : result.status === 'error'
            ? 'There was an error processing the workflow.'
            : `Workflow status: ${result.status}`,
      });
    }

    // Write completed posts to SocialPost table
    // Use the first pending analysis as the default analysisId
    const defaultAnalysisId = pendingAnalyses[0].id;
    const tradeAreaZip = pendingAnalyses[0].websiteUrl; // Will be used for context

    const createdPosts = await prisma.socialPost.createMany({
      data: result.posts.map((post: any) => ({
        userId,
        analysisId: defaultAnalysisId,
        caption: post.caption || '',
        hashtags: Array.isArray(post.hashtags) ? post.hashtags : [],
        imageUrl: post.imageUrl || null,
        imagePrompt: post.imagePrompt || null,
        postType: post.postType || 'general',
        sourceType: post.sourceType || null,
        newsAngle: post.newsAngle || null,
        patternType: post.patternType || null,
        rssItemTitle: post.rssItemTitle || null,
        rssItemLink: post.rssItemLink || null,
        platforms: Array.isArray(post.platforms) ? post.platforms : ['facebook', 'instagram'],
        status: 'pending_approval',
      })),
    });

    console.log(`[missions/poll] Imported ${createdPosts.count} social posts for analysis ${defaultAnalysisId}`);

    return NextResponse.json({
      polled: allWorkflowIds.length,
      imported: createdPosts.count,
      pending: 0,
      status: 'imported',
      message: `Successfully imported ${createdPosts.count} social posts!`,
    });
  } catch (error: any) {
    console.error('Social missions poll error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
