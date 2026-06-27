/**
 * Agent Asset Layer — unified, permission-safe asset retrieval for all creative/content agents.
 *
 * ALL agent asset access must go through getAgentAssets() or getAllowedAssetsForBusiness().
 * No agent should query BusinessAsset, SharedAsset, SharedAssetApproval,
 * or SharedAssetPackGrant directly.
 */
import { prisma } from '@/lib/db';
import { getAllowedAssetsForBusiness, type UseChannel, CHANNEL_FIELD_MAP } from '@/lib/shared-assets';

// ── Agent types ─────────────────────────────────────────────────────────────
export const AGENT_TYPES = [
  'website', 'seo', 'social', 'video', 'community_engagement',
] as const;
export type AgentType = (typeof AGENT_TYPES)[number];

// ── Intended use channels for agents ────────────────────────────────────────
export const AGENT_USE_MAP: Record<AgentType, UseChannel> = {
  website: 'website',
  seo: 'website', // SEO uses website channel permission
  social: 'social',
  video: 'video',
  community_engagement: 'website', // CE uses public-facing content
};

// ── Normalized agent asset type ─────────────────────────────────────────────
export interface AgentAllowedAsset {
  id: string;
  source: 'business' | 'shared' | 'shared_pack';
  title: string;
  description?: string;
  assetType: string;
  category?: string;
  fileUrl?: string;
  previewUrl?: string;
  thumbnailUrl?: string;
  mimeType?: string;
  width?: number;
  height?: number;
  duration?: number;
  orientation?: string;
  tags: string[];
  intendedUses: string[];
  allowedAgents: string[];
  licenseStatus?: string;
  usageNotes?: string;
  notesForAI?: string;
  qualityStatus?: string;
  qualityWarnings: string[];
  restrictions: string[];
  // Extended context fields
  textContent?: string;
  extractedTextPreview?: string;
  wordCount?: number;
  hasAudio?: boolean;
  relatedServiceTopic?: string;
  scope?: string;              // shared asset scope (global, industry, brand_oem, etc.)
  rightsHolder?: string;       // shared asset rights holder
  attributionText?: string;    // shared asset attribution text
  maxResolution?: string;      // shared asset max resolution
  // Enriched context (from AssetContext model)
  enrichedContext?: {
    agentDescription: string | null;
    humanDescription: string | null;
    suggestedUses: string[];
    restrictedUses: string[];
    visibleElements: string[];
    dominantColors: string[];
    mood: string | null;
    style: string | null;
    documentSummary: string | null;
    keyPoints: string[];
    restrictedClaims: string[];
    requiredDisclosures: string[];
    transcriptSummary: string | null;
    qualityNotes: string[];
    confidenceScore: number | null;
    contextStatus: string;
    humanReviewed: boolean;
  };
  // Ranking metadata
  _rankScore: number;
  _skipReason?: string;
}

// ── getAgentAssets input ────────────────────────────────────────────────────
export interface GetAgentAssetsInput {
  businessId: string;
  agentType: AgentType;
  intendedUse: UseChannel;
  topic?: string;
  preferredAssetTypes?: string[];
  maxAssets?: number;
  workflowId?: string;
  runId?: string;
}

// ── Skip reasons ────────────────────────────────────────────────────────────
interface SkippedAsset {
  assetId: string;
  title: string;
  reason: string;
}

// ── Result ──────────────────────────────────────────────────────────────────
export interface GetAgentAssetsResult {
  assets: AgentAllowedAsset[];
  skipped: SkippedAsset[];
  logId: string;
  totalRetrieved: number;
  totalUsed: number;
  totalSkipped: number;
}

// ── Agent-specific rules ────────────────────────────────────────────────────
interface AgentRuleSet {
  /** Asset types this agent can use */
  allowedAssetTypes?: string[];
  /** Require publicUseAllowed for output */
  requirePublicUse: boolean;
  /** Require aiUseAllowed */
  requireAIApproval: boolean;
  /** Block customer/person assets without permission */
  blockUnconfirmedPeople: boolean;
  /** Block private/internal documents from public output */
  blockPrivateForPublic: boolean;
  /** Require video-capable assets */
  requireVideoCapable: boolean;
}

const AGENT_RULES: Record<AgentType, AgentRuleSet> = {
  website: {
    allowedAssetTypes: ['logo', 'photo', 'icon', 'graphic', 'document', 'color_palette', 'font'],
    requirePublicUse: true,
    requireAIApproval: true,
    blockUnconfirmedPeople: true,
    blockPrivateForPublic: true,
    requireVideoCapable: false,
  },
  seo: {
    allowedAssetTypes: ['document', 'photo', 'logo', 'graphic', 'icon'],
    requirePublicUse: true,
    requireAIApproval: true,
    blockUnconfirmedPeople: true,
    blockPrivateForPublic: true,
    requireVideoCapable: false,
  },
  social: {
    allowedAssetTypes: ['photo', 'logo', 'video', 'graphic', 'icon', 'template'],
    requirePublicUse: true,
    requireAIApproval: true,
    blockUnconfirmedPeople: true,
    blockPrivateForPublic: true,
    requireVideoCapable: false,
  },
  video: {
    allowedAssetTypes: ['video', 'photo', 'logo', 'audio', 'graphic'],
    requirePublicUse: false, // internal video may be acceptable
    requireAIApproval: true,
    blockUnconfirmedPeople: true,
    blockPrivateForPublic: false,
    requireVideoCapable: true,
  },
  community_engagement: {
    allowedAssetTypes: ['document', 'video', 'photo', 'logo', 'graphic'],
    requirePublicUse: true,
    requireAIApproval: false, // CE uses assets as references, not AI generation
    blockUnconfirmedPeople: true,
    blockPrivateForPublic: true,
    requireVideoCapable: false,
  },
};

// ── Enriched context mapper (shared between normalizers) ─────────────────────
function mapEnrichedContext(ctx: any): AgentAllowedAsset['enrichedContext'] | undefined {
  if (!ctx) return undefined;
  // Don't expose rejected context to agents
  if (ctx.contextStatus === 'rejected') return undefined;
  return {
    agentDescription: ctx.agentDescription || null,
    humanDescription: ctx.humanDescription || null,
    suggestedUses: ctx.suggestedUses || [],
    restrictedUses: ctx.restrictedUses || [],
    visibleElements: ctx.visibleElements || [],
    dominantColors: ctx.dominantColors || [],
    mood: ctx.mood || null,
    style: ctx.style || null,
    documentSummary: ctx.documentSummary || null,
    keyPoints: ctx.keyPoints || [],
    restrictedClaims: ctx.restrictedClaims || [],
    requiredDisclosures: ctx.requiredDisclosures || [],
    transcriptSummary: ctx.transcriptSummary || null,
    qualityNotes: ctx.qualityNotes || [],
    confidenceScore: ctx.confidenceScore ?? null,
    contextStatus: ctx.contextStatus,
    humanReviewed: ctx.humanReviewedContext || false,
  };
}

// ── BusinessAsset → AgentAllowedAsset normalizer ────────────────────────────
function normalizeBusinessAsset(asset: any): AgentAllowedAsset {
  const restrictions: string[] = [];
  if (asset.disallowedChannels?.length) {
    restrictions.push(`Not allowed for: ${asset.disallowedChannels.join(', ')}`);
  }
  if (asset.expiresAt && new Date(asset.expiresAt) < new Date()) {
    restrictions.push('Asset expired');
  }
  if (asset.usageRights === 'unknown') {
    restrictions.push('Usage rights unknown');
  }
  if (!asset.publicUseAllowed) {
    restrictions.push('Not approved for public use');
  }
  if (asset.peopleOrCustomerContent && !asset.customerPermissionConfirmed) {
    restrictions.push('Customer/person permission not confirmed');
  }

  return {
    id: asset.id,
    source: 'business',
    title: asset.title || asset.originalFilename || 'Untitled',
    description: asset.description || undefined,
    assetType: asset.assetType,
    category: asset.category,
    fileUrl: asset.publicUrl || undefined,
    previewUrl: asset.publicUrl || undefined,
    thumbnailUrl: asset.thumbnailUrl || undefined,
    mimeType: asset.mimeType,
    width: asset.width || undefined,
    height: asset.height || undefined,
    duration: asset.duration || undefined,
    orientation: asset.orientation || undefined,
    tags: asset.tags || [],
    intendedUses: asset.intendedUses || [],
    allowedAgents: [], // BusinessAssets don't have explicit agent list
    licenseStatus: asset.usageRights || undefined,
    usageNotes: undefined,
    notesForAI: asset.notesForAI || undefined,
    qualityStatus: asset.qualityStatus || undefined,
    qualityWarnings: asset.qualityWarnings || [],
    restrictions,
    // Extended context fields
    textContent: asset.textContent || undefined,
    extractedTextPreview: asset.extractedTextPreview || undefined,
    wordCount: asset.wordCount || undefined,
    hasAudio: asset.hasAudio ?? undefined,
    relatedServiceTopic: asset.relatedServiceTopic || undefined,
    enrichedContext: mapEnrichedContext(asset.assetContext),
    _rankScore: 0,
  };
}

// ── SharedAsset → AgentAllowedAsset normalizer ──────────────────────────────
function normalizeSharedAsset(asset: any, source: 'shared' | 'shared_pack'): AgentAllowedAsset {
  const restrictions: string[] = [];
  if (asset.noDerivatives) restrictions.push('No derivatives allowed');
  if (asset.noCommercial) restrictions.push('No commercial use');
  if (asset.geographicRestriction) restrictions.push(`Geographic: ${asset.geographicRestriction}`);
  if (asset.attributionRequired) restrictions.push(`Attribution required: ${asset.attributionText || 'see license'}`);
  if (asset.industryRestriction?.length) restrictions.push(`Industry restricted: ${asset.industryRestriction.join(', ')}`);

  // Build allowed uses from channel booleans
  const intendedUses: string[] = [];
  if (asset.allowWebsite) intendedUses.push('website');
  if (asset.allowSocial) intendedUses.push('social');
  if (asset.allowAds) intendedUses.push('ads');
  if (asset.allowEmail) intendedUses.push('email');
  if (asset.allowPrint) intendedUses.push('print');
  if (asset.allowVideo) intendedUses.push('video');
  if (asset.allowInternal) intendedUses.push('internal');
  if (asset.allowAI) intendedUses.push('ai');

  return {
    id: asset.id,
    source,
    title: asset.title,
    description: asset.description || undefined,
    assetType: asset.assetType,
    category: asset.category,
    fileUrl: asset.publicUrl || undefined,
    previewUrl: asset.publicUrl || undefined,
    thumbnailUrl: asset.thumbnailUrl || undefined,
    mimeType: asset.mimeType,
    width: asset.width || undefined,
    height: asset.height || undefined,
    duration: asset.duration || undefined,
    orientation: undefined,
    tags: asset.tags || [],
    intendedUses,
    allowedAgents: [],
    licenseStatus: asset.licenseStatus || undefined,
    usageNotes: asset.licenseNotes || undefined,
    notesForAI: undefined,
    qualityStatus: undefined,
    qualityWarnings: [],
    restrictions,
    // Extended context fields
    scope: asset.scope || undefined,
    rightsHolder: asset.rightsHolder || undefined,
    attributionText: asset.attributionText || undefined,
    maxResolution: asset.maxResolution || undefined,
    enrichedContext: mapEnrichedContext(asset.assetContext),
    _rankScore: 0,
  };
}

// ── Fetch approved BusinessAssets for a business ────────────────────────────
async function getApprovedBusinessAssets(
  businessId: string,
  intendedUse: UseChannel,
): Promise<any[]> {
  const now = new Date();

  // Build channel filter for business assets
  const channelFilter: any = {};
  // BusinessAsset uses allowedChannels/disallowedChannels arrays, not booleans
  // We filter in-app after fetch

  const assets = await prisma.businessAsset.findMany({
    where: {
      businessId,
      approvalStatus: 'approved',
      archivedAt: null,
      // Don't return expired assets
      OR: [
        { expiresAt: null },
        { expiresAt: { gt: now } },
      ],
    },
    include: { assetContext: true },
    orderBy: [{ priorityScore: 'desc' }, { createdAt: 'desc' }],
  });

  // Filter by channel
  return assets.filter(a => {
    // If disallowedChannels contains the intended use, skip
    if (a.disallowedChannels?.includes(intendedUse)) return false;
    // If allowedChannels is set and doesn't include the intended use, skip
    if (a.allowedChannels?.length > 0 && !a.allowedChannels.includes(intendedUse)) return false;
    // Check expiration date for certifications/licenses
    if (a.expirationDate && a.expirationDate < now) return false;
    return true;
  });
}

// ── Apply agent-specific guardrails ─────────────────────────────────────────
function applyGuardrails(
  asset: AgentAllowedAsset,
  rules: AgentRuleSet,
  intendedUse: UseChannel,
): { allowed: boolean; reason?: string } {
  // 1. Asset type filter
  if (rules.allowedAssetTypes && !rules.allowedAssetTypes.includes(asset.assetType)) {
    return { allowed: false, reason: `Asset type '${asset.assetType}' not allowed for this agent` };
  }

  // 2. Public use check
  if (rules.requirePublicUse && asset.source === 'business') {
    // Business assets: check publicUseAllowed restriction
    if (asset.restrictions.includes('Not approved for public use')) {
      return { allowed: false, reason: 'Not approved for public use' };
    }
  }

  // 3. AI use check
  if (rules.requireAIApproval && asset.source === 'business') {
    // We need the raw business asset to check approvedForAI — it's encoded in restrictions or intendedUses
    if (!asset.intendedUses.includes('ai') && asset.source === 'business') {
      // Business assets without explicit AI approval — allow if no restriction marker
      // The asset was fetched as approved, so we allow unless explicitly blocked
    }
  }

  // 4. Shared assets: check AI permission
  if (rules.requireAIApproval && (asset.source === 'shared' || asset.source === 'shared_pack')) {
    if (!asset.intendedUses.includes('ai')) {
      return { allowed: false, reason: 'Shared asset not approved for AI use' };
    }
  }

  // 5. Customer/person content without permission
  if (rules.blockUnconfirmedPeople) {
    if (asset.restrictions.includes('Customer/person permission not confirmed')) {
      return { allowed: false, reason: 'Customer/person permission not confirmed' };
    }
  }

  // 6. Private/internal documents for public output
  if (rules.blockPrivateForPublic && asset.source === 'business') {
    // Internal-only categories that shouldn't be published
    const privateCategories = ['compliance', 'creative_examples'];
    const privateTypes = ['disclaimer', 'forbidden_claim', 'usage_rights_doc', 'font_notes'];
    if (
      (asset.category && privateCategories.includes(asset.category) && asset.assetType === 'document') ||
      privateTypes.includes(asset.assetType)
    ) {
      // These inform strategy but should not be published verbatim
      // Still allow — but add a restriction note and lower rank
      asset.restrictions.push('Internal reference only — do not publish verbatim');
    }
  }

  // 7. No derivatives check for shared assets
  if (asset.restrictions.some(r => r.includes('No derivatives')) && rules.requireAIApproval) {
    return { allowed: false, reason: 'No derivatives allowed and AI modification required' };
  }

  // 8. No commercial use check
  if (asset.restrictions.some(r => r.includes('No commercial'))) {
    if (intendedUse === 'ads') {
      return { allowed: false, reason: 'No commercial use — cannot use for ads' };
    }
  }

  // 9. Unknown/restricted license
  if (asset.licenseStatus === 'unknown' || asset.licenseStatus === 'expired' || asset.licenseStatus === 'revoked') {
    return { allowed: false, reason: `License status: ${asset.licenseStatus}` };
  }

  // 10. Video-capable check
  if (rules.requireVideoCapable && intendedUse === 'video') {
    // Allow video, photo, logo, audio, graphic types for video agents
    const videoCapableTypes = ['video', 'photo', 'logo', 'audio', 'graphic'];
    if (!videoCapableTypes.includes(asset.assetType)) {
      return { allowed: false, reason: 'Asset not suitable for video production' };
    }
  }

  // 11. Paid ads check — business assets
  if (intendedUse === 'ads' && asset.source === 'business') {
    // approvedForAds is tracked via the intendedUses or restrictions
    // Since we normalized it, check if 'ads' is in disallowed
    // Already handled by channel filtering, but double-check
  }

  return { allowed: true };
}

// ── Ranking ─────────────────────────────────────────────────────────────────
function rankAsset(
  asset: AgentAllowedAsset,
  topic?: string,
  preferredAssetTypes?: string[],
): number {
  let score = 0;

  // 1. Source priority: business > shared_pack > shared
  switch (asset.source) {
    case 'business': score += 100; break;
    case 'shared_pack': score += 60; break;
    case 'shared': score += 30; break;
  }

  // 2. Scope-based ranking for shared assets (from project instructions):
  //    brand_oem (approved) > industry > global/template
  if (asset.source !== 'business' && asset.category) {
    if (asset.category === 'brand_oem' || asset.category === 'franchise') score += 25;
    else if (asset.category === 'industry_generic') score += 15;
    else if (asset.category === 'templates' || asset.category === 'icons_graphics') score += 10;
    else score += 5;
  }

  // 3. Topic/tag match
  if (topic) {
    const topicLower = topic.toLowerCase();
    const matchesTags = asset.tags.some(t => t.toLowerCase().includes(topicLower));
    const matchesTitle = asset.title.toLowerCase().includes(topicLower);
    const matchesDesc = asset.description?.toLowerCase().includes(topicLower);
    const matchesTopic = asset.category?.toLowerCase().includes(topicLower);
    if (matchesTags || matchesTitle) score += 30;
    if (matchesDesc || matchesTopic) score += 15;
  }

  // 4. Preferred asset type match
  if (preferredAssetTypes?.includes(asset.assetType)) {
    score += 20;
  }

  // 5. Quality score
  if (asset.qualityStatus === 'good') score += 10;
  else if (asset.qualityStatus === 'warning' || asset.qualityStatus === 'needs_review') score -= 10;
  else if (asset.qualityStatus === 'low_quality') score -= 25;

  // 6. Quality warnings penalty
  if (asset.qualityWarnings.length > 0) score -= asset.qualityWarnings.length * 5;

  // 7. Restrictions penalty
  if (asset.restrictions.length > 0) score -= asset.restrictions.length * 3;

  // 8. Logo bonus (logos are frequently needed)
  if (asset.assetType === 'logo') score += 15;

  return score;
}

// ── Main entry point: getAgentAssets ────────────────────────────────────────
export async function getAgentAssets(input: GetAgentAssetsInput): Promise<GetAgentAssetsResult> {
  const {
    businessId,
    agentType,
    intendedUse,
    topic,
    preferredAssetTypes,
    maxAssets = 20,
    workflowId,
    runId,
  } = input;

  const rules = AGENT_RULES[agentType];
  if (!rules) {
    throw new Error(`Unknown agent type: ${agentType}`);
  }

  const allAssets: AgentAllowedAsset[] = [];
  const skipped: SkippedAsset[] = [];

  // ── 1. Fetch approved BusinessAssets ───────────────────────────────────
  try {
    const businessAssets = await getApprovedBusinessAssets(businessId, intendedUse);
    for (const raw of businessAssets) {
      const normalized = normalizeBusinessAsset(raw);

      // Apply business-asset-specific AI check
      if (rules.requireAIApproval && !raw.approvedForAI) {
        // For documents/text assets informing strategy, allow but mark as reference-only
        if (['document', 'approved_claim', 'disclaimer', 'font_notes', 'color_palette'].includes(raw.assetType)) {
          normalized.restrictions.push('Not AI-approved — reference only, do not reproduce');
        } else {
          skipped.push({ assetId: raw.id, title: raw.title, reason: 'Not approved for AI use' });
          continue;
        }
      }

      // Apply public use check
      if (rules.requirePublicUse && !raw.publicUseAllowed) {
        // Allow documents as internal reference even if not public
        if (['document', 'approved_claim', 'font_notes', 'color_palette'].includes(raw.assetType)) {
          normalized.restrictions.push('Internal reference only — do not publish');
        } else {
          skipped.push({ assetId: raw.id, title: raw.title, reason: 'Not approved for public use' });
          continue;
        }
      }

      const guardrail = applyGuardrails(normalized, rules, intendedUse);
      if (!guardrail.allowed) {
        skipped.push({ assetId: raw.id, title: raw.title, reason: guardrail.reason! });
        continue;
      }

      normalized._rankScore = rankAsset(normalized, topic, preferredAssetTypes);
      allAssets.push(normalized);
    }
  } catch (err) {
    console.error('[AgentAssets] Error fetching business assets:', err);
  }

  // ── 2. Fetch approved SharedAssets ─────────────────────────────────────
  try {
    const sharedAssets = await getAllowedAssetsForBusiness(businessId, intendedUse, agentType);
    for (const raw of sharedAssets) {
      // Determine source: check if this asset came from a pack grant
      const source: 'shared' | 'shared_pack' = 'shared'; // getAllowedAssetsForBusiness merges both
      const normalized = normalizeSharedAsset(raw, source);

      const guardrail = applyGuardrails(normalized, rules, intendedUse);
      if (!guardrail.allowed) {
        skipped.push({ assetId: raw.id, title: raw.title, reason: guardrail.reason! });
        continue;
      }

      normalized._rankScore = rankAsset(normalized, topic, preferredAssetTypes);
      allAssets.push(normalized);
    }
  } catch (err) {
    console.error('[AgentAssets] Error fetching shared assets:', err);
  }

  // ── 3. Sort by rank (descending) ──────────────────────────────────────
  allAssets.sort((a, b) => b._rankScore - a._rankScore);

  // ── 4. Limit results ──────────────────────────────────────────────────
  const usedAssets = allAssets.slice(0, maxAssets);
  const extraSkipped = allAssets.slice(maxAssets).map(a => ({
    assetId: a.id,
    title: a.title,
    reason: 'Exceeded maxAssets limit',
  }));
  skipped.push(...extraSkipped);

  // ── 5. Log usage ──────────────────────────────────────────────────────
  let logId = '';
  try {
    const log = await prisma.agentAssetUsageLog.create({
      data: {
        businessId,
        agentType,
        intendedUse,
        workflowId: workflowId || null,
        runId: runId || null,
        retrievedAssetIds: allAssets.map(a => a.id),
        usedAssetIds: usedAssets.map(a => a.id),
        skippedAssetsJson: skipped.length > 0 ? (skipped as any) : undefined,
        totalRetrieved: allAssets.length + skipped.length,
        totalUsed: usedAssets.length,
        totalSkipped: skipped.length,
      },
    });
    logId = log.id;
  } catch (err) {
    console.error('[AgentAssets] Failed to write usage log:', err);
    logId = 'log-failed';
  }

  return {
    assets: usedAssets,
    skipped,
    logId,
    totalRetrieved: allAssets.length + skipped.length,
    totalUsed: usedAssets.length,
    totalSkipped: skipped.length,
  };
}

// ── Convenience wrappers per agent type ──────────────────────────────────────

export async function getWebsiteAssets(businessId: string, opts?: Partial<GetAgentAssetsInput>) {
  return getAgentAssets({
    businessId,
    agentType: 'website',
    intendedUse: 'website',
    preferredAssetTypes: ['logo', 'photo', 'document', 'color_palette'],
    ...opts,
  });
}

export async function getSeoAssets(businessId: string, opts?: Partial<GetAgentAssetsInput>) {
  return getAgentAssets({
    businessId,
    agentType: 'seo',
    intendedUse: 'website',
    preferredAssetTypes: ['document', 'photo', 'logo'],
    ...opts,
  });
}

export async function getSocialAssets(businessId: string, opts?: Partial<GetAgentAssetsInput>) {
  return getAgentAssets({
    businessId,
    agentType: 'social',
    intendedUse: 'social',
    preferredAssetTypes: ['photo', 'logo', 'video', 'graphic'],
    ...opts,
  });
}

export async function getVideoAssets(businessId: string, opts?: Partial<GetAgentAssetsInput>) {
  return getAgentAssets({
    businessId,
    agentType: 'video',
    intendedUse: 'video',
    preferredAssetTypes: ['video', 'photo', 'logo', 'audio'],
    ...opts,
  });
}

export async function getCommunityEngagementAssets(businessId: string, opts?: Partial<GetAgentAssetsInput>) {
  return getAgentAssets({
    businessId,
    agentType: 'community_engagement',
    intendedUse: 'website',
    preferredAssetTypes: ['document', 'video', 'photo'],
    ...opts,
  });
}

// ── Usage log queries ───────────────────────────────────────────────────────

export async function getAssetUsageLogs(params: {
  businessId?: string;
  agentType?: string;
  assetId?: string;
  limit?: number;
}) {
  const { businessId, agentType, assetId, limit = 50 } = params;
  const where: any = {};
  if (businessId) where.businessId = businessId;
  if (agentType) where.agentType = agentType;
  if (assetId) {
    where.OR = [
      { retrievedAssetIds: { has: assetId } },
      { usedAssetIds: { has: assetId } },
    ];
  }

  return prisma.agentAssetUsageLog.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
}

/**
 * Get agent usage summary for a specific asset — used by the UI
 * to show "Used by agents" on asset detail pages.
 */
export async function getAssetAgentUsageSummary(assetId: string) {
  const logs = await prisma.agentAssetUsageLog.findMany({
    where: {
      usedAssetIds: { has: assetId },
    },
    orderBy: { createdAt: 'desc' },
    take: 20,
    select: {
      id: true,
      agentType: true,
      intendedUse: true,
      workflowId: true,
      createdAt: true,
    },
  });

  // Aggregate
  const agentTypes = [...new Set(logs.map(l => l.agentType))];
  const lastUsed = logs.length > 0 ? logs[0].createdAt : null;
  const totalUses = logs.length;

  return {
    agentTypes,
    lastUsed,
    totalUses,
    recentLogs: logs.slice(0, 5),
  };
}
