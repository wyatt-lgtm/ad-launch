/**
 * tombstone-asset-bridge.ts
 *
 * Centralized bridge between the Launch OS asset permission layer
 * and Tombstone generation workflows.
 *
 * ALL Tombstone mission dispatches should call `buildAssetContextForMission()`
 * to get:
 *   1. A compact `TombstoneAssetContext` payload (for structured API payloads)
 *   2. A prompt injection block (for text-command workflows)
 *
 * Tombstone agents MUST NOT query BusinessAsset, SharedAsset, or approval
 * tables directly. They receive pre-approved assets only through this bridge.
 */

import {
  getAgentAssets,
  type AgentType,
  type GetAgentAssetsResult,
  type AgentAllowedAsset,
} from '@/lib/agent-assets';

// ── Types ────────────────────────────────────────────────────────────────────

export interface TombstoneAssetPayload {
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
  hasAudio?: boolean;
  tags?: string[];
  notesForAI?: string;
  relatedServiceTopic?: string;
  textContent?: string;
  extractedTextPreview?: string;
  wordCount?: number;
  qualityStatus?: string;
  qualityWarnings?: string[];
  licenseStatus?: string;
  licenseNotes?: string;
  rightsHolder?: string;
  attributionText?: string;
  restrictions?: string[];
}

export interface TombstoneSkippedAsset {
  id: string;
  title?: string;
  reason: string;
}

export interface TombstoneAssetContext {
  businessId: string;
  agentType: AgentType;
  intendedUse: string;
  assets: TombstoneAssetPayload[];
  skippedAssets: TombstoneSkippedAsset[];
  logId: string;
  totalRetrieved: number;
  totalSkipped: number;
}

export interface AssetBridgeResult {
  context: TombstoneAssetContext;
  promptBlock: string;
  hasAssets: boolean;
}

// ── Use-channel mapping (matches agent-assets.ts) ───────────────────────────

const AGENT_USE_MAP: Record<AgentType, string> = {
  website: 'website',
  seo: 'website',
  social: 'social',
  video: 'video',
  community_engagement: 'website',
};

// ── Core bridge function ────────────────────────────────────────────────────

/**
 * Fetch approved assets for a Tombstone generation mission and produce
 * both a compact payload and a prompt injection block.
 *
 * @param businessId  Launch OS business ID (cuid)
 * @param agentType   Which agent is generating (website, seo, social, video, community_engagement)
 * @param opts        Optional overrides (workflowId, runId, topic, maxAssets)
 * @returns           AssetBridgeResult with context, promptBlock, and hasAssets flag
 */
export async function buildAssetContextForMission(
  businessId: string,
  agentType: AgentType,
  opts: {
    workflowId?: string;
    runId?: string;
    topic?: string;
    maxAssets?: number;
  } = {},
): Promise<AssetBridgeResult> {
  const intendedUse = AGENT_USE_MAP[agentType] || 'website';

  let result: GetAgentAssetsResult;
  try {
    result = await getAgentAssets({
      businessId,
      agentType,
      intendedUse: intendedUse as any,
      topic: opts.topic,
      maxAssets: opts.maxAssets ?? 20,
      workflowId: opts.workflowId,
      runId: opts.runId,
    });
  } catch (err: any) {
    console.error(`[asset-bridge] Failed to fetch assets for business=${businessId} agent=${agentType}:`, err?.message);
    // Return empty context — generation proceeds without assets
    return {
      context: {
        businessId,
        agentType,
        intendedUse,
        assets: [],
        skippedAssets: [],
        logId: '',
        totalRetrieved: 0,
        totalSkipped: 0,
      },
      promptBlock: buildPromptBlock([], []),
      hasAssets: false,
    };
  }

  const assets = result.assets.map(compactAsset);
  const skippedAssets = result.skipped.map(s => ({
    id: s.assetId,
    title: s.title,
    reason: s.reason,
  }));

  const context: TombstoneAssetContext = {
    businessId,
    agentType,
    intendedUse,
    assets,
    skippedAssets,
    logId: result.logId,
    totalRetrieved: result.totalRetrieved,
    totalSkipped: result.totalSkipped,
  };

  return {
    context,
    promptBlock: buildPromptBlock(assets, skippedAssets),
    hasAssets: assets.length > 0,
  };
}

// ── Compact asset for Tombstone payload ──────────────────────────────────────

function compactAsset(a: AgentAllowedAsset): TombstoneAssetPayload {
  const payload: TombstoneAssetPayload = {
    id: a.id,
    source: a.source,
    title: a.title,
    assetType: a.assetType,
  };
  // Only include non-empty optional fields to keep payload small
  if (a.description) payload.description = a.description;
  if (a.category) payload.category = a.category;
  if (a.fileUrl) payload.fileUrl = a.fileUrl;
  if (a.previewUrl) payload.previewUrl = a.previewUrl;
  if (a.thumbnailUrl) payload.thumbnailUrl = a.thumbnailUrl;
  if (a.mimeType) payload.mimeType = a.mimeType;
  if (a.width) payload.width = a.width;
  if (a.height) payload.height = a.height;
  if (a.duration) payload.duration = a.duration;
  if (a.orientation) payload.orientation = a.orientation;
  if (a.hasAudio != null) payload.hasAudio = a.hasAudio;
  if (a.tags?.length) payload.tags = a.tags;
  if (a.notesForAI) payload.notesForAI = a.notesForAI;
  if (a.relatedServiceTopic) payload.relatedServiceTopic = a.relatedServiceTopic;
  if (a.textContent) payload.textContent = a.textContent;
  if (a.extractedTextPreview) payload.extractedTextPreview = a.extractedTextPreview;
  if (a.wordCount) payload.wordCount = a.wordCount;
  if (a.qualityStatus) payload.qualityStatus = a.qualityStatus;
  if (a.qualityWarnings?.length) payload.qualityWarnings = a.qualityWarnings;
  if (a.licenseStatus) payload.licenseStatus = a.licenseStatus;
  if (a.usageNotes) payload.licenseNotes = a.usageNotes;
  if (a.rightsHolder) payload.rightsHolder = a.rightsHolder;
  if (a.attributionText) payload.attributionText = a.attributionText;
  if (a.restrictions?.length) payload.restrictions = a.restrictions;
  return payload;
}

// ── Prompt block builder ────────────────────────────────────────────────────

/**
 * Build a text block to inject into Tombstone agent commands.
 * Groups assets by type and includes guardrails.
 */
function buildPromptBlock(
  assets: TombstoneAssetPayload[],
  skipped: TombstoneSkippedAsset[],
): string {
  if (assets.length === 0 && skipped.length === 0) {
    return [
      '',
      '=== APPROVED ASSET CONTEXT ===',
      'No approved assets are available for this business.',
      'Generate text-only output. Do not invent or reference any images, logos, or brand materials.',
      '=== END APPROVED ASSET CONTEXT ===',
      '',
    ].join('\n');
  }

  const lines: string[] = [
    '',
    '=== APPROVED ASSET CONTEXT ===',
    'These assets have already passed business permissions, license checks, public-use checks,',
    'AI-use checks, and channel restrictions. Use ONLY these assets when recommending or',
    'generating visuals, links, video references, testimonials, logos, or brand materials.',
    '',
    'RULES:',
    '- Do NOT invent, reference, or use assets outside this list.',
    '- Do NOT use any skipped/blocked assets listed at the end.',
    '- Do NOT publish private/internal notes verbatim.',
    '- Treat compliance notes (disclaimers, forbidden claims) as RESTRICTIONS, not promotional claims.',
    '- Respect attribution text where present — include it in output.',
    '- Prefer business-owned assets over shared assets.',
    '- Use shared Brand/OEM assets ONLY if they appear in this approved list.',
    '- If no suitable asset exists for a visual, generate text-only or request missing assets.',
    '',
  ];

  // Group assets by type
  const groups = new Map<string, TombstoneAssetPayload[]>();
  for (const asset of assets) {
    const key = categorizeAssetType(asset.assetType);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(asset);
  }

  // Output groups in priority order
  const ORDER = ['Logos', 'Photos', 'Videos', 'Audio', 'Documents', 'Compliance / Restrictions', 'Shared Assets', 'Other'];
  for (const groupName of ORDER) {
    const items = groups.get(groupName);
    if (!items?.length) continue;
    lines.push(`--- ${groupName} ---`);
    for (const item of items) {
      lines.push(formatAssetLine(item));
    }
    lines.push('');
  }

  // Skipped assets warning
  if (skipped.length > 0) {
    lines.push('--- BLOCKED / SKIPPED ASSETS (DO NOT USE) ---');
    for (const s of skipped) {
      lines.push(`  ✗ ${s.title || s.id} — ${s.reason}`);
    }
    lines.push('');
  }

  lines.push('=== END APPROVED ASSET CONTEXT ===');
  lines.push('');

  return lines.join('\n');
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function categorizeAssetType(assetType: string): string {
  const t = assetType.toLowerCase();
  if (['logo', 'color_palette', 'font_notes', 'brand_guidelines'].includes(t)) return 'Logos';
  if (['product_photo', 'service_photo', 'storefront_photo', 'facility_photo', 'fleet_photo',
       'before_after_photo', 'owner_photo', 'staff_photo', 'landmark_photo', 'photo',
       'graphic', 'icon', 'template', 'service_area_map'].includes(t)) return 'Photos';
  if (['video', 'video_clip'].includes(t)) return 'Videos';
  if (['audio', 'audio_clip'].includes(t)) return 'Audio';
  if (['document', 'menu_list', 'price_sheet', 'offer_sheet', 'case_study',
       'press_mention', 'certification', 'license', 'award',
       'testimonial_screenshot', 'review_screenshot', 'website_screenshot'].includes(t)) return 'Documents';
  if (['approved_claim', 'forbidden_claim', 'disclaimer', 'usage_rights_doc',
       'negative_example'].includes(t)) return 'Compliance / Restrictions';
  if (t.startsWith('existing_ad') || t.startsWith('social_post') || t.startsWith('flyer')) return 'Other';
  return 'Other';
}

function formatAssetLine(a: TombstoneAssetPayload): string {
  const parts: string[] = [
    `  • [${a.source}] ${a.title} (${a.assetType})`,
  ];
  if (a.fileUrl) parts.push(`    URL: ${a.fileUrl}`);
  if (a.description) parts.push(`    Desc: ${a.description}`);
  if (a.notesForAI) parts.push(`    AI Notes: ${a.notesForAI}`);
  if (a.relatedServiceTopic) parts.push(`    Topic: ${a.relatedServiceTopic}`);
  if (a.textContent) parts.push(`    Content: ${a.textContent.slice(0, 200)}${a.textContent.length > 200 ? '…' : ''}`);
  if (a.attributionText) parts.push(`    ⚠ Attribution required: ${a.attributionText}`);
  if (a.restrictions?.length) parts.push(`    ⚠ Restrictions: ${a.restrictions.join('; ')}`);
  if (a.rightsHolder) parts.push(`    Rights: ${a.rightsHolder}`);
  if (a.width && a.height) parts.push(`    Dimensions: ${a.width}×${a.height}`);
  if (a.duration) parts.push(`    Duration: ${a.duration}s`);
  return parts.join('\n');
}

// ── Convenience wrappers per workflow ───────────────────────────────────────

export function buildWebsiteAssetContext(businessId: string, opts?: { workflowId?: string }) {
  return buildAssetContextForMission(businessId, 'website', opts);
}

export function buildSeoAssetContext(businessId: string, opts?: { workflowId?: string }) {
  return buildAssetContextForMission(businessId, 'seo', opts);
}

export function buildSocialAssetContext(businessId: string, opts?: { workflowId?: string }) {
  return buildAssetContextForMission(businessId, 'social', opts);
}

export function buildVideoAssetContext(businessId: string, opts?: { workflowId?: string }) {
  return buildAssetContextForMission(businessId, 'video', opts);
}

export function buildCommunityEngagementAssetContext(businessId: string, opts?: { workflowId?: string }) {
  return buildAssetContextForMission(businessId, 'community_engagement', opts);
}
