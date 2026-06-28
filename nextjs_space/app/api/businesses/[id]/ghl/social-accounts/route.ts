export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';
import { listGhlSocialAccounts } from '@/lib/ghl-social-planner';
import { resolveBusinessChannels } from '@/lib/ghl-channel-filter';

type RouteContext = { params: { id: string } };

/**
 * GET /api/businesses/[id]/ghl/social-accounts
 *
 * Fetch social accounts connected in Launch CRM (GHL Social Planner)
 * for a given business. Filters to only business-linked channels when
 * ghlLinkedAccountIds is non-empty.
 */
export async function GET(
  request: NextRequest,
  { params }: RouteContext
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const userId = (session.user as any).id;
    const businessId = params.id;

    const business = await prisma.business.findFirst({
      where: { id: businessId, userId },
      select: {
        id: true,
        ghlLocationId: true,
        ghlApiToken: true,
        ghlProvisioningStatus: true,
        ghlLinkedAccountIds: true,
        defaultGhlSocialAccountId: true,
        defaultGhlSocialAccountName: true,
        defaultGhlSocialPlatform: true,
        defaultGhlSocialOriginId: true,
      },
    });

    if (!business) {
      return NextResponse.json({ error: 'Business not found' }, { status: 404 });
    }

    // Check if business has Launch CRM credentials
    if (!business.ghlLocationId || !business.ghlApiToken) {
      return NextResponse.json({
        connected: false,
        reason: 'no_crm_credentials',
        message: 'This business is not linked to Launch CRM.',
        accounts: [],
      });
    }

    // Fetch accounts from GHL Social Planner API
    const result = await listGhlSocialAccounts(
      business.ghlLocationId,
      business.ghlApiToken
    );

    if (!result.success) {
      return NextResponse.json({
        connected: true,
        reason: 'lookup_failed',
        message: 'Could not load social accounts from Launch CRM. Verify the Launch CRM connection and try again.',
        accounts: [],
        error: result.error,
      });
    }

    // Filter out deleted accounts
    const activeAccounts = result.accounts.filter(a => !a.deleted);

    // ── Business-scope filtering ──────────────────────────────────
    // Business isolation is enforced by ghlLocationId: every account returned
    // here belongs to THIS business's Launch CRM location.
    //
    // If ghlLinkedAccountIds is populated, the owner has explicitly scoped the
    // publishing channels for this business → show only those.
    // Otherwise show ALL connected channels for the location so the owner can
    // publish to any combination (e.g. Google + Facebook).
    //
    // IMPORTANT: We intentionally do NOT collapse the list to the single cached
    // defaultGhlSocialAccountId. Doing so previously hid every channel except
    // the default once a business had published once, making multi-channel
    // publishing (e.g. adding Facebook alongside Google) impossible — the
    // picker only ever showed the one default channel.
    const linked = business.ghlLinkedAccountIds || [];
    const defaultId = business.defaultGhlSocialAccountId;
    const { channels: filtered, filterMode } = resolveBusinessChannels(activeAccounts, linked);

    // Map to a safe response shape
    const accounts = filtered.map(a => ({
      id: a.id,
      name: a.name,
      platform: a.platform,
      type: a.type,
      originId: a.originId,
      avatar: a.avatar,
      isExpired: a.isExpired,
      isDefault: a.id === defaultId,
    }));

    // Also return the full unfiltered list for the management UI
    const allAccounts = activeAccounts.map(a => ({
      id: a.id,
      name: a.name,
      platform: a.platform,
      type: a.type,
      originId: a.originId,
      avatar: a.avatar,
      isExpired: a.isExpired,
      isLinked: linked.length > 0 ? linked.includes(a.id) : (defaultId ? a.id === defaultId : true),
    }));

    return NextResponse.json({
      connected: true,
      reason: accounts.length > 0 ? 'accounts_found' : 'no_accounts',
      message: accounts.length > 0
        ? `Found ${accounts.length} publishing channel${accounts.length !== 1 ? 's' : ''} for this business.`
        : filterMode === 'unfiltered'
          ? 'No social accounts are connected inside Launch CRM Social Planner. Connect your social accounts in Launch CRM, then refresh here.'
          : 'No linked publishing channels for this business. Go to Publish Options to link channels.',
      accounts,
      allAccounts,
      filterMode,
      linkedAccountIds: linked,
      defaultAccount: defaultId
        ? {
            id: defaultId,
            name: business.defaultGhlSocialAccountName,
            platform: business.defaultGhlSocialPlatform,
          }
        : null,
    });
  } catch (err: any) {
    console.error('[ghl-social-accounts GET]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * PUT /api/businesses/[id]/ghl/social-accounts
 *
 * Link or unlink GHL social accounts for this business.
 * Body: { accountIds: string[] }
 * Sets ghlLinkedAccountIds to the provided list.
 */
export async function PUT(
  request: NextRequest,
  { params }: RouteContext
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const userId = (session.user as any).id;
    const businessId = params.id;

    const business = await prisma.business.findFirst({
      where: { id: businessId, userId },
      select: { id: true },
    });
    if (!business) {
      return NextResponse.json({ error: 'Business not found' }, { status: 404 });
    }

    const body = await request.json();
    const accountIds = Array.isArray(body.accountIds) ? body.accountIds.filter((id: any) => typeof id === 'string' && id.trim()) : [];

    await prisma.business.update({
      where: { id: businessId },
      data: { ghlLinkedAccountIds: accountIds },
    });

    console.log(`[ghl-social-accounts PUT] Business ${businessId}: linked ${accountIds.length} account(s):`, accountIds);

    return NextResponse.json({ success: true, linkedAccountIds: accountIds });
  } catch (err: any) {
    console.error('[ghl-social-accounts PUT]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}