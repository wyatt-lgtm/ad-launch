export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { getAssetUsageLogs, getAssetAgentUsageSummary } from '@/lib/agent-assets';

/**
 * GET /api/agent-assets/usage?businessId=xxx
 * GET /api/agent-assets/usage?assetId=xxx
 * GET /api/agent-assets/usage?assetId=xxx&summary=true
 *
 * Returns agent asset usage logs for monitoring and UI display.
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const businessId = searchParams.get('businessId') || undefined;
    const agentType = searchParams.get('agentType') || undefined;
    const assetId = searchParams.get('assetId') || undefined;
    const summary = searchParams.get('summary') === 'true';
    const limit = parseInt(searchParams.get('limit') || '50', 10);

    // Summary mode for asset detail pages
    if (assetId && summary) {
      const result = await getAssetAgentUsageSummary(assetId);
      return NextResponse.json(result);
    }

    const logs = await getAssetUsageLogs({
      businessId,
      agentType,
      assetId,
      limit: Math.min(limit, 200),
    });

    return NextResponse.json({ logs, count: logs.length });
  } catch (err: any) {
    console.error('[agent-assets/usage GET]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
