export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';
import { validateGhlCredentials } from '@/lib/ghl';
import { listGhlSocialAccounts, selectGhlAccount } from '@/lib/ghl-social-planner';

const ADMIN_API_KEY = process.env.ADMIN_API_KEY ?? '';

/**
 * POST /api/businesses/[id]/ghl/link-existing
 *
 * Links an existing GHL Location to the given business.
 * Requires both a location/business ID and an API token.
 * Validates the credentials work together via the GHL API before saving.
 * Checks for duplicate linking across businesses.
 *
 * Auth: session user must own the business, OR valid ADMIN_API_KEY header.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const businessId = params.id;
    if (!businessId) {
      return NextResponse.json({ error: 'Missing businessId' }, { status: 400 });
    }

    // ── Auth: session OR admin key ──────────────────────────────────
    let userId: string | null = null;
    const apiKey = request.headers.get('x-api-key') || request.headers.get('authorization')?.replace('Bearer ', '');
    const isAdmin = ADMIN_API_KEY && apiKey === ADMIN_API_KEY;

    if (!isAdmin) {
      const session = await getServerSession(authOptions);
      userId = (session?.user as any)?.id ?? null;
      if (!userId) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
    }

    // ── Parse body ─────────────────────────────────────────────────
    const body = await request.json().catch(() => ({}));
    const { locationId, apiToken, notes } = body;

    // Validate required fields
    if (!locationId || typeof locationId !== 'string' || !locationId.trim()) {
      return NextResponse.json(
        { error: 'Launch CRM Location ID is required' },
        { status: 400 }
      );
    }
    if (!apiToken || typeof apiToken !== 'string' || !apiToken.trim()) {
      return NextResponse.json(
        { error: 'Launch CRM API Token is required' },
        { status: 400 }
      );
    }

    const trimmedLocationId = locationId.trim();
    const trimmedToken = apiToken.trim();

    // Reject email-like values for locationId
    if (trimmedLocationId.includes('@')) {
      return NextResponse.json(
        {
          error: 'invalid_launch_crm_location_id',
          message: 'The Launch CRM Location ID is not an email address. Copy the Location ID from Launch CRM Business Profile Settings.',
        },
        { status: 422 }
      );
    }

    // ── Fetch business ────────────────────────────────────────────
    const business = await prisma.business.findUnique({
      where: { id: businessId },
      select: {
        id: true,
        userId: true,
        businessName: true,
        ghlLocationId: true,
        ghlProvisioningStatus: true,
      },
    });

    if (!business) {
      return NextResponse.json({ error: 'Business not found' }, { status: 404 });
    }

    // Ownership check (skip for admin)
    if (!isAdmin && business.userId !== userId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // ── Idempotency: same location already linked to this business ──
    if (
      business.ghlLocationId === trimmedLocationId &&
      business.ghlProvisioningStatus === 'provisioned'
    ) {
      return NextResponse.json({
        alreadyLinked: true,
        ghlLocationId: business.ghlLocationId,
        ghlProvisioningStatus: 'provisioned',
        message: 'This Launch CRM account is already linked to this business.',
      });
    }

    // ── If already provisioned with a DIFFERENT location, block unless admin force ──
    if (
      business.ghlLocationId &&
      business.ghlProvisioningStatus === 'provisioned' &&
      business.ghlLocationId !== trimmedLocationId
    ) {
      const forceOverwrite = body.forceOverwrite === true;
      if (!isAdmin || !forceOverwrite) {
        return NextResponse.json(
          {
            error: 'business_already_connected',
            message: 'This business is already connected to a different Launch CRM account. Admin override required to change.',
          },
          { status: 409 }
        );
      }
    }

    // ── Duplicate check: is this GHL location linked to another business? ──
    const existingLink = await prisma.business.findFirst({
      where: {
        ghlLocationId: trimmedLocationId,
        ghlProvisioningStatus: 'provisioned',
        id: { not: businessId },
      },
      select: { id: true, businessName: true },
    });

    if (existingLink) {
      const forceOverwrite = body.forceOverwrite === true;
      if (!isAdmin || !forceOverwrite) {
        return NextResponse.json(
          {
            error: 'launch_crm_account_already_linked',
            message: 'This Launch CRM account is already linked to another business.',
            linkedBusinessId: existingLink.id,
            linkedBusinessName: existingLink.businessName,
          },
          { status: 409 }
        );
      }
    }

    // ── Validate credentials: token + location ID ─────────────────
    const validation = await validateGhlCredentials(trimmedLocationId, trimmedToken);
    if (!validation.exists) {
      return NextResponse.json(
        {
          error: 'invalid_launch_crm_credentials',
          message: 'The Launch CRM Business ID or API token could not be verified. Please check both values and try again.',
        },
        { status: 422 }
      );
    }

    // ── Verify GHL Social Planner accounts before saving ─────────────
    const resolvedLocationId = validation.locationId || trimmedLocationId;
    const accountsResult = await listGhlSocialAccounts(resolvedLocationId, trimmedToken);

    let selectedAccount: { id: string; name: string; platform: string; originId: string } | null = null;
    let socialAccountWarning: string | null = null;
    let allAccountNames: string[] = [];

    if (accountsResult.success && accountsResult.accounts.length > 0) {
      allAccountNames = accountsResult.accounts.map(a => `${a.name} (${a.platform})`);

      // Try auto-selection: if only one FB page, use it
      const selection = selectGhlAccount(accountsResult.accounts, {
        platform: 'facebook',
      });
      if (selection.selected) {
        selectedAccount = {
          id: selection.selected.id,
          name: selection.selected.name,
          platform: selection.selected.platform,
          originId: selection.selected.originId,
        };
      } else if (selection.error) {
        socialAccountWarning = selection.error;
      }
    } else if (!accountsResult.success) {
      // Token validates for location lookup but Social Planner returns error
      // Still save credentials but warn
      socialAccountWarning = `Social Planner account lookup failed: ${accountsResult.error || 'Unknown error'}. Credentials saved — you can select an account later.`;
    } else {
      socialAccountWarning = 'No social accounts found in this Launch CRM location. Connect a Facebook page in Launch CRM Social Planner first.';
    }

    // ── Save link (same canonical fields as new-account provisioning) ──
    const updateData: Record<string, any> = {
      ghlLocationId: resolvedLocationId,
      ghlSubtenantId: null,  // linked accounts don't have a separate subtenant
      ghlApiToken: trimmedToken,
      ghlProvisioningStatus: 'provisioned',
      ghlProvisionedAt: new Date(),
      ghlProvisioningError: null,
      ghlConnectionType: 'linked_existing',
      ghlLinkedAt: new Date(),
      ghlLinkNotes: notes?.trim() || null,
    };

    // Store selected social account if auto-selection succeeded
    if (selectedAccount) {
      updateData.defaultGhlSocialAccountId = selectedAccount.id;
      updateData.defaultGhlSocialAccountName = selectedAccount.name;
      updateData.defaultGhlSocialPlatform = selectedAccount.platform;
      updateData.defaultGhlSocialOriginId = selectedAccount.originId;
    }

    await prisma.business.update({
      where: { id: businessId },
      data: updateData,
    });

    // ── Readback verification ────────────────────────────────────────
    const saved = await prisma.business.findUnique({
      where: { id: businessId },
      select: {
        ghlLocationId: true,
        ghlApiToken: true,
        ghlProvisioningStatus: true,
        ghlConnectionType: true,
        defaultGhlSocialAccountId: true,
        defaultGhlSocialAccountName: true,
        defaultGhlSocialPlatform: true,
        defaultGhlSocialOriginId: true,
      },
    });

    if (!saved?.ghlLocationId || !saved?.ghlApiToken) {
      console.error(`[CRM link] READBACK FAILED for business ${businessId}: locationId=${saved?.ghlLocationId} tokenPresent=${!!saved?.ghlApiToken}`);
      return NextResponse.json(
        { error: 'Credentials were not persisted. Please try again.' },
        { status: 500 }
      );
    }

    // Log without exposing the token
    console.log(
      `[CRM link] Business ${businessId} linked to existing location ${resolvedLocationId}` +
      (validation.name ? ` (${validation.name})` : '') +
      ` [token: ${trimmedToken.slice(0, 6)}...${trimmedToken.slice(-4)}]` +
      (selectedAccount ? ` [account: ${selectedAccount.name} / ${selectedAccount.originId}]` : '')
    );

    // Return success WITHOUT the API token
    return NextResponse.json({
      ghlLocationId: resolvedLocationId,
      ghlLocationName: validation.name || null,
      ghlProvisioningStatus: 'provisioned',
      ghlConnectionType: 'linked_existing',
      ghlLinkedAt: new Date().toISOString(),
      alreadyLinked: false,
      hasGhlApiToken: true,
      // Social account verification results
      socialAccountVerified: !!selectedAccount,
      selectedAccount: selectedAccount ? {
        name: selectedAccount.name,
        platform: selectedAccount.platform,
        originId: selectedAccount.originId,
      } : null,
      socialAccountWarning,
      allAccounts: allAccountNames,
    });
  } catch (err: any) {
    console.error('[CRM link-existing] unexpected error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
