export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';
import { listGhlSocialAccounts } from '@/lib/ghl-social-planner';

/**
 * GET /api/businesses/[id]/ghl/social-accounts
 *
 * Fetch social accounts connected in Launch CRM (GHL Social Planner)
 * for a given business. Returns accounts from GHL's API, not from
 * Launch OS SocialConnection rows.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
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

    // Map to a safe response shape
    const accounts = activeAccounts.map(a => ({
      id: a.id,
      name: a.name,
      platform: a.platform,
      type: a.type,
      originId: a.originId,
      avatar: a.avatar,
      isExpired: a.isExpired,
      isDefault: a.id === business.defaultGhlSocialAccountId,
    }));

    return NextResponse.json({
      connected: true,
      reason: accounts.length > 0 ? 'accounts_found' : 'no_accounts',
      message: accounts.length > 0
        ? `Found ${accounts.length} social account${accounts.length !== 1 ? 's' : ''} connected through Launch CRM.`
        : 'No social accounts are connected inside Launch CRM Social Planner. Connect your social accounts in Launch CRM, then refresh here.',
      accounts,
      defaultAccount: business.defaultGhlSocialAccountId
        ? {
            id: business.defaultGhlSocialAccountId,
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
