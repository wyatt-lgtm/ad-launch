export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';

/**
 * GET /api/nav/alerts?businessId=...
 *
 * Returns actionable badge counts for the main nav.
 * Social counts are derived from real SocialPost data.
 * Other sections use placeholder/zero counts until real alert sources exist.
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({
        create: { count: 0, severity: 'none' },
        social: { count: 0, severity: 'none' },
        website: { count: 0, severity: 'none' },
        seo: { count: 0, severity: 'none' },
        insights: { count: 0, severity: 'none' },
        account: { count: 0, severity: 'none' },
      });
    }

    const userId = (session.user as any).id;
    const businessId = req.nextUrl.searchParams.get('businessId') || undefined;

    // ── Social: count pending_approval + failed posts ──
    let socialCount = 0;
    let socialSeverity: 'none' | 'blue' | 'amber' | 'red' = 'none';
    try {
      const where: any = { userId };
      if (businessId) where.businessId = businessId;

      const pendingCount = await prisma.socialPost.count({
        where: { ...where, status: 'pending_approval' },
      });
      const failedCount = await prisma.socialPost.count({
        where: {
          ...where,
          status: { in: ['failed_to_publish', 'generation_failed', 'generation_incomplete'] },
        },
      });

      socialCount = pendingCount + failedCount;
      if (failedCount > 0) socialSeverity = 'red';
      else if (pendingCount > 0) socialSeverity = 'amber';
    } catch (e) {
      console.warn('[nav/alerts] Social count error:', e);
    }

    // ── Create: count generation_failed + generation_incomplete ──
    let createCount = 0;
    let createSeverity: 'none' | 'blue' | 'amber' | 'red' = 'none';
    try {
      const where: any = { userId };
      if (businessId) where.businessId = businessId;
      createCount = await prisma.socialPost.count({
        where: { ...where, status: { in: ['generation_failed', 'generation_incomplete'] } },
      });
      if (createCount > 0) createSeverity = 'amber';
    } catch { /* silent */ }

    return NextResponse.json({
      create: { count: createCount, severity: createSeverity },
      social: { count: socialCount, severity: socialSeverity },
      website: { count: 0, severity: 'none' },
      seo: { count: 0, severity: 'none' },
      insights: { count: 0, severity: 'none' },
      account: { count: 0, severity: 'none' },
    });
  } catch (error: any) {
    console.error('[nav/alerts] Error:', error);
    return NextResponse.json({
      create: { count: 0, severity: 'none' },
      social: { count: 0, severity: 'none' },
      website: { count: 0, severity: 'none' },
      seo: { count: 0, severity: 'none' },
      insights: { count: 0, severity: 'none' },
      account: { count: 0, severity: 'none' },
    });
  }
}
