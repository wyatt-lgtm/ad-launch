export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import {
  getAgentAssets,
  type AgentType,
  type GetAgentAssetsInput,
  AGENT_TYPES,
} from '@/lib/agent-assets';
import { type UseChannel, USE_CHANNELS } from '@/lib/shared-assets';

/**
 * GET /api/agent-assets?businessId=xxx&agentType=website&intendedUse=website
 *
 * Retrieves permission-safe, ranked assets for a specific agent workflow.
 * This is the ONLY endpoint agents should use to access assets.
 *
 * Query params:
 * - businessId (required)
 * - agentType (required): website | seo | social | video | community_engagement
 * - intendedUse (required): website | social | ads | email | print | video | internal | ai
 * - topic (optional): topic/keyword for relevance ranking
 * - preferredAssetTypes (optional): comma-separated asset types
 * - maxAssets (optional): max number of assets to return (default 20)
 * - workflowId (optional): workflow ID for logging
 * - runId (optional): run ID for logging
 */
export async function GET(req: NextRequest) {
  try {
    // Auth: session or ADMIN_API_KEY
    const apiKey = req.headers.get('x-api-key') || req.headers.get('authorization')?.replace('Bearer ', '');
    const validApiKey = process.env.ADMIN_API_KEY;
    let authenticated = false;

    if (apiKey && validApiKey && apiKey === validApiKey) {
      authenticated = true;
    } else {
      const session = await getServerSession(authOptions);
      if (session?.user?.email) {
        authenticated = true;
      }
    }

    if (!authenticated) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const businessId = searchParams.get('businessId');
    const agentType = searchParams.get('agentType') as AgentType | null;
    const intendedUse = searchParams.get('intendedUse') as UseChannel | null;
    const topic = searchParams.get('topic') || undefined;
    const preferredAssetTypesRaw = searchParams.get('preferredAssetTypes');
    const maxAssets = parseInt(searchParams.get('maxAssets') || '20', 10);
    const workflowId = searchParams.get('workflowId') || undefined;
    const runId = searchParams.get('runId') || undefined;

    if (!businessId) {
      return NextResponse.json({ error: 'businessId is required' }, { status: 400 });
    }
    if (!agentType || !AGENT_TYPES.includes(agentType)) {
      return NextResponse.json(
        { error: `agentType is required and must be one of: ${AGENT_TYPES.join(', ')}` },
        { status: 400 }
      );
    }
    if (!intendedUse || !USE_CHANNELS.includes(intendedUse)) {
      return NextResponse.json(
        { error: `intendedUse is required and must be one of: ${USE_CHANNELS.join(', ')}` },
        { status: 400 }
      );
    }

    const preferredAssetTypes = preferredAssetTypesRaw
      ? preferredAssetTypesRaw.split(',').map(s => s.trim())
      : undefined;

    const result = await getAgentAssets({
      businessId,
      agentType,
      intendedUse,
      topic,
      preferredAssetTypes,
      maxAssets: Math.min(maxAssets, 100),
      workflowId,
      runId,
    });

    return NextResponse.json(result);
  } catch (err: any) {
    console.error('[agent-assets GET]', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
