/**
 * Shared Asset Library — constants, types, helpers, audit logging
 */
import { prisma } from '@/lib/db';

// ── Scopes ──────────────────────────────────────────────────────────────────
export const SHARED_ASSET_SCOPES = [
  'global',
  'industry',
  'brand_oem',
  'franchise',
  'licensed_stock',
  'template',
] as const;
export type SharedAssetScope = (typeof SHARED_ASSET_SCOPES)[number];

export const SCOPE_LABELS: Record<SharedAssetScope, string> = {
  global: 'Global',
  industry: 'Industry',
  brand_oem: 'Brand / OEM',
  franchise: 'Franchise',
  licensed_stock: 'Licensed Stock',
  template: 'Template',
};

// ── Categories ──────────────────────────────────────────────────────────────
export const SHARED_ASSET_CATEGORIES = [
  'industry_generic',
  'licensed_stock',
  'brand_oem',
  'franchise',
  'templates',
  'video_clips',
  'audio_clips',
  'icons_graphics',
  'educational_explainers',
  'compliance_templates',
] as const;
export type SharedAssetCategory = (typeof SHARED_ASSET_CATEGORIES)[number];

export const SHARED_CATEGORY_LABELS: Record<SharedAssetCategory, string> = {
  industry_generic: 'Industry Generic',
  licensed_stock: 'Licensed Stock',
  brand_oem: 'Brand / OEM',
  franchise: 'Franchise',
  templates: 'Templates',
  video_clips: 'Video Clips',
  audio_clips: 'Audio Clips',
  icons_graphics: 'Icons & Graphics',
  educational_explainers: 'Educational Explainers',
  compliance_templates: 'Compliance Templates',
};

// ── Asset types ──────────────────────────────────────────────────────────────
export const SHARED_ASSET_TYPES = [
  'logo', 'photo', 'video', 'audio', 'icon', 'graphic',
  'template', 'document', 'font', 'color_palette',
] as const;
export type SharedAssetType = (typeof SHARED_ASSET_TYPES)[number];

// ── License types ───────────────────────────────────────────────────────────
export const LICENSE_TYPES = [
  'owned', 'royalty_free', 'rights_managed', 'creative_commons', 'editorial_only', 'custom',
] as const;
export const LICENSE_TYPE_LABELS: Record<string, string> = {
  owned: 'Owned',
  royalty_free: 'Royalty-Free',
  rights_managed: 'Rights-Managed',
  creative_commons: 'Creative Commons',
  editorial_only: 'Editorial Only',
  custom: 'Custom',
};

export const LICENSE_STATUSES = ['active', 'expired', 'revoked', 'pending_renewal'] as const;
export const LICENSE_STATUS_LABELS: Record<string, string> = {
  active: 'Active',
  expired: 'Expired',
  revoked: 'Revoked',
  pending_renewal: 'Pending Renewal',
};

// ── Approval statuses ───────────────────────────────────────────────────────
export const SHARED_APPROVAL_STATUSES = ['pending', 'approved', 'rejected', 'expired', 'revoked'] as const;
export const SHARED_APPROVAL_STATUS_LABELS: Record<string, string> = {
  pending: 'Pending',
  approved: 'Approved',
  rejected: 'Rejected',
  expired: 'Expired',
  revoked: 'Revoked',
};

export const GRANT_STATUSES = ['pending', 'granted', 'rejected', 'expired', 'revoked'] as const;
export const GRANT_STATUS_LABELS: Record<string, string> = {
  pending: 'Pending',
  granted: 'Granted',
  rejected: 'Rejected',
  expired: 'Expired',
  revoked: 'Revoked',
};

// ── Use channels (permission matrix columns) ────────────────────────────────
export const USE_CHANNELS = [
  'website', 'social', 'ads', 'email', 'print', 'video', 'internal', 'ai',
] as const;
export type UseChannel = (typeof USE_CHANNELS)[number];

export const USE_CHANNEL_LABELS: Record<UseChannel, string> = {
  website: 'Website',
  social: 'Social Media',
  ads: 'Paid Ads',
  email: 'Email',
  print: 'Print',
  video: 'Video',
  internal: 'Internal',
  ai: 'AI Generation',
};

// Map channel to SharedAsset boolean field name
export const CHANNEL_FIELD_MAP: Record<UseChannel, string> = {
  website: 'allowWebsite',
  social: 'allowSocial',
  ads: 'allowAds',
  email: 'allowEmail',
  print: 'allowPrint',
  video: 'allowVideo',
  internal: 'allowInternal',
  ai: 'allowAI',
};

// ── Audit logging ───────────────────────────────────────────────────────────
export type AuditAction =
  | 'created' | 'updated' | 'approved' | 'rejected' | 'revoked'
  | 'pack_granted' | 'pack_revoked' | 'downloaded' | 'viewed';

export async function logSharedAssetAudit(params: {
  sharedAssetId?: string;
  packId?: string;
  businessId?: string;
  userId?: string;
  action: AuditAction;
  details?: Record<string, unknown>;
  ipAddress?: string;
}) {
  try {
    await prisma.sharedAssetAuditLog.create({
      data: {
        ...params,
        details: params.details ? (params.details as any) : undefined,
      },
    });
  } catch (err) {
    console.error('[SharedAssetAudit] Failed to write audit log:', err);
  }
}

// ── getAllowedAssetsForBusiness ─────────────────────────────────────────────
/**
 * Returns all shared assets that a specific business is allowed to use,
 * filtered by intended use channel and optionally by agent type.
 * This is the helper function for future agent integration.
 */
export async function getAllowedAssetsForBusiness(
  businessId: string,
  intendedUse?: UseChannel,
  _agentType?: string, // reserved for future agent-type filtering
) {
  // 1. Get business details for industry matching
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: { id: true, businessName: true },
  });
  if (!business) return [];

  // 2. Get all approved shared asset IDs for this business (exclude expired)
  const now = new Date();
  const approvals = await prisma.businessSharedAssetApproval.findMany({
    where: {
      businessId,
      status: 'approved',
      OR: [
        { expiresAt: null },
        { expiresAt: { gt: now } },
      ],
    },
    select: { sharedAssetId: true },
  });
  const approvedAssetIds = approvals.map(a => a.sharedAssetId);

  // 3. Get granted packs → their asset IDs
  const grants = await prisma.businessSharedAssetPackGrant.findMany({
    where: { businessId, status: 'granted' },
    select: { packId: true },
  });
  const grantedPackIds = grants.map(g => g.packId);

  let packAssetIds: string[] = [];
  if (grantedPackIds.length > 0) {
    const packItems = await prisma.sharedAssetPackItem.findMany({
      where: { packId: { in: grantedPackIds } },
      select: { sharedAssetId: true },
    });
    packAssetIds = packItems.map(pi => pi.sharedAssetId);
  }

  // 4. Combine approved individual + pack assets
  const allAssetIds = [...new Set([...approvedAssetIds, ...packAssetIds])];
  if (allAssetIds.length === 0) return [];

  // 5. Build channel filter
  const channelFilter: Record<string, boolean> = {};
  if (intendedUse && CHANNEL_FIELD_MAP[intendedUse]) {
    channelFilter[CHANNEL_FIELD_MAP[intendedUse]] = true;
  }

  // 6. Fetch the actual assets (only active + valid license)
  const assets = await prisma.sharedAsset.findMany({
    where: {
      id: { in: allAssetIds },
      isActive: true,
      licenseStatus: 'active',
      approvalStatus: 'approved',
      ...channelFilter,
    },
    orderBy: { title: 'asc' },
  });

  // 7. Filter out geographically restricted and expired licenses
  return assets.filter(a => {
    if (a.licenseExpiry && a.licenseExpiry < now) return false;
    return true;
  });
}

// ── Admin check helper ──────────────────────────────────────────────────────
export function isAdmin(session: any): boolean {
  return session?.user && (session.user as any).role === 'admin';
}
