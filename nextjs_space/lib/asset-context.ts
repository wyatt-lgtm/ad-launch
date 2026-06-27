/**
 * asset-context.ts
 *
 * Context generation service for enriching BusinessAsset and SharedAsset records
 * with AI-generated descriptions, suggested uses, visible elements, document summaries,
 * transcript summaries, and quality notes.
 *
 * Uses the Abacus AI LLM API (OpenAI-compatible) with vision support for images
 * and text analysis for documents.
 *
 * Key constraints:
 *  - Context generation failure MUST NOT break uploads.
 *  - Rejected context MUST NOT be exposed to agents.
 *  - Compliance docs must produce restrictedClaims / requiredDisclosures.
 */

import { prisma } from '@/lib/db';

// ── Constants ────────────────────────────────────────────────────────────────

const LLM_API_URL = 'https://api.abacus.ai/api/v1/chat/completions';
const DEFAULT_MODEL = 'claude-sonnet-4-20250514';

const IMAGE_MIME_PREFIXES = ['image/'];
const VIDEO_MIME_PREFIXES = ['video/'];
const AUDIO_MIME_PREFIXES = ['audio/'];
const DOCUMENT_MIME_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
  'text/csv',
  'text/markdown',
];

const COMPLIANCE_ASSET_TYPES = [
  'approved_claim', 'forbidden_claim', 'disclaimer',
  'usage_rights_doc', 'negative_example',
];

const COMPLIANCE_CATEGORIES = ['compliance', 'compliance_templates'];

// ── Types ────────────────────────────────────────────────────────────────────

export interface AssetContextResult {
  agentDescription: string | null;
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
  transcript: string | null;
  transcriptSummary: string | null;
  confidenceScore: number | null;
  qualityNotes: string[];
}

interface AssetInfo {
  id: string;
  title: string;
  description: string;
  assetType: string;
  category: string;
  mimeType: string;
  tags: string[];
  publicUrl: string | null;
  textContent: string | null;
  extractedTextPreview: string | null;
  width: number | null;
  height: number | null;
  duration: number | null;
  notesForAI: string | null;
  relatedServiceTopic: string | null;
}

// ── Core generation functions ────────────────────────────────────────────────

/**
 * Generate context for a business asset. Non-fatal — returns null on failure
 * and logs the error on the AssetContext record.
 */
export async function generateAssetContextForBusinessAsset(
  assetId: string,
): Promise<AssetContextResult | null> {
  try {
    const asset = await prisma.businessAsset.findUnique({
      where: { id: assetId },
    });
    if (!asset) {
      console.error(`[asset-context] BusinessAsset not found: ${assetId}`);
      return null;
    }

    const info: AssetInfo = {
      id: asset.id,
      title: asset.title,
      description: asset.description || '',
      assetType: asset.assetType,
      category: asset.category,
      mimeType: asset.mimeType,
      tags: asset.tags || [],
      publicUrl: asset.publicUrl,
      textContent: asset.textContent || null,
      extractedTextPreview: asset.extractedTextPreview || null,
      width: asset.width,
      height: asset.height,
      duration: asset.duration,
      notesForAI: asset.notesForAI || null,
      relatedServiceTopic: asset.relatedServiceTopic || null,
    };

    const result = await generateContextForAsset(info);
    const normalized = normalizeAssetContextResult(result);

    // Upsert context record
    await prisma.assetContext.upsert({
      where: { businessAssetId: assetId },
      create: {
        businessAssetId: assetId,
        ...normalized,
        contextStatus: 'needs_review',
        aiGeneratedContext: true,
        humanReviewedContext: false,
        generationModel: DEFAULT_MODEL,
      },
      update: {
        ...normalized,
        contextStatus: 'needs_review',
        aiGeneratedContext: true,
        humanReviewedContext: false,
        generationModel: DEFAULT_MODEL,
        generationError: null,
      },
    });

    return normalized;
  } catch (err: any) {
    console.error(`[asset-context] Failed to generate context for business asset ${assetId}:`, err?.message);
    // Record the error but don't break the upload
    try {
      await prisma.assetContext.upsert({
        where: { businessAssetId: assetId },
        create: {
          businessAssetId: assetId,
          contextStatus: 'needs_review',
          aiGeneratedContext: true,
          generationError: err?.message || 'Unknown error',
          generationModel: DEFAULT_MODEL,
        },
        update: {
          generationError: err?.message || 'Unknown error',
        },
      });
    } catch { /* suppress double-error */ }
    return null;
  }
}

/**
 * Generate context for a shared asset. Non-fatal — same pattern.
 */
export async function generateAssetContextForSharedAsset(
  assetId: string,
): Promise<AssetContextResult | null> {
  try {
    const asset = await prisma.sharedAsset.findUnique({
      where: { id: assetId },
    });
    if (!asset) {
      console.error(`[asset-context] SharedAsset not found: ${assetId}`);
      return null;
    }

    const info: AssetInfo = {
      id: asset.id,
      title: asset.title,
      description: asset.description || '',
      assetType: asset.assetType,
      category: asset.category,
      mimeType: asset.mimeType,
      tags: asset.tags || [],
      publicUrl: asset.publicUrl,
      textContent: null,
      extractedTextPreview: null,
      width: asset.width,
      height: asset.height,
      duration: asset.duration,
      notesForAI: null,
      relatedServiceTopic: null,
    };

    const result = await generateContextForAsset(info);
    const normalized = normalizeAssetContextResult(result);

    await prisma.assetContext.upsert({
      where: { sharedAssetId: assetId },
      create: {
        sharedAssetId: assetId,
        ...normalized,
        contextStatus: 'needs_review',
        aiGeneratedContext: true,
        humanReviewedContext: false,
        generationModel: DEFAULT_MODEL,
      },
      update: {
        ...normalized,
        contextStatus: 'needs_review',
        aiGeneratedContext: true,
        humanReviewedContext: false,
        generationModel: DEFAULT_MODEL,
        generationError: null,
      },
    });

    return normalized;
  } catch (err: any) {
    console.error(`[asset-context] Failed to generate context for shared asset ${assetId}:`, err?.message);
    try {
      await prisma.assetContext.upsert({
        where: { sharedAssetId: assetId },
        create: {
          sharedAssetId: assetId,
          contextStatus: 'needs_review',
          aiGeneratedContext: true,
          generationError: err?.message || 'Unknown error',
          generationModel: DEFAULT_MODEL,
        },
        update: {
          generationError: err?.message || 'Unknown error',
        },
      });
    } catch { /* suppress */ }
    return null;
  }
}

// ── Prompt builder ───────────────────────────────────────────────────────────

export function buildAssetContextPrompt(asset: AssetInfo): {
  systemPrompt: string;
  userPrompt: string;
  useVision: boolean;
} {
  const isImage = IMAGE_MIME_PREFIXES.some(p => asset.mimeType.startsWith(p));
  const isVideo = VIDEO_MIME_PREFIXES.some(p => asset.mimeType.startsWith(p));
  const isAudio = AUDIO_MIME_PREFIXES.some(p => asset.mimeType.startsWith(p));
  const isDocument = DOCUMENT_MIME_TYPES.includes(asset.mimeType);
  const isCompliance = COMPLIANCE_ASSET_TYPES.includes(asset.assetType) ||
    COMPLIANCE_CATEGORIES.includes(asset.category);
  const isTextAsset = !!asset.textContent;

  const systemPrompt = `You are an asset analysis assistant for a marketing platform called Launch OS. Your job is to analyze creative assets (images, videos, audio, documents) and produce structured metadata that AI agents will use to decide how and when to use each asset in marketing workflows.

You MUST respond with valid JSON matching the schema below. No markdown, no code blocks, no extra text.

JSON schema:
{
  "agentDescription": "string — 1-2 sentence description for AI agents. What is this asset and what does it show/contain?",
  "suggestedUses": ["string — marketing use cases like hero_image, social_post, ad_background, email_header, testimonial, logo_placement, background_texture, product_showcase"],
  "restrictedUses": ["string — uses this asset should NOT be used for, if any"],
  "visibleElements": ["string — key objects, people, text, logos visible in the asset (images/video only)"],
  "dominantColors": ["string — hex codes or color names visible (images only)"],
  "mood": "string or null — emotional tone: warm, professional, casual, energetic, luxurious, rustic, etc.",
  "style": "string or null — visual style: lifestyle, product_shot, aerial, close_up, flat_lay, candid, studio, etc.",
  "documentSummary": "string or null — for documents/text: brief summary of contents",
  "keyPoints": ["string — key facts or claims from the document"],
  "restrictedClaims": ["string — for compliance docs: claims that must NOT be made"],
  "requiredDisclosures": ["string — for compliance docs: required disclaimers or disclosures"],
  "transcript": "string or null — for audio/video with speech: text transcript",
  "transcriptSummary": "string or null — brief summary of what was said",
  "confidenceScore": 0.0-1.0,
  "qualityNotes": ["string — quality observations: low_resolution, blurry, watermark_detected, poor_lighting, etc."]
}`;

  let userPrompt = `Analyze this ${asset.assetType} asset:\n`;
  userPrompt += `Title: ${asset.title}\n`;
  if (asset.description) userPrompt += `Description: ${asset.description}\n`;
  userPrompt += `Category: ${asset.category}\n`;
  userPrompt += `Type: ${asset.assetType}\n`;
  userPrompt += `MIME: ${asset.mimeType}\n`;
  if (asset.tags.length) userPrompt += `Tags: ${asset.tags.join(', ')}\n`;
  if (asset.notesForAI) userPrompt += `AI Notes: ${asset.notesForAI}\n`;
  if (asset.relatedServiceTopic) userPrompt += `Related topic: ${asset.relatedServiceTopic}\n`;
  if (asset.width && asset.height) userPrompt += `Dimensions: ${asset.width}×${asset.height}\n`;
  if (asset.duration) userPrompt += `Duration: ${asset.duration}s\n`;

  if (isCompliance) {
    userPrompt += `\nIMPORTANT: This is a COMPLIANCE asset. Focus on extracting:\n`;
    userPrompt += `- restrictedClaims: claims that must NOT be made in marketing\n`;
    userPrompt += `- requiredDisclosures: disclaimers that MUST be included\n`;
    userPrompt += `- Set restrictedUses appropriately\n`;
  }

  if (isTextAsset && asset.textContent) {
    userPrompt += `\nText content:\n${asset.textContent.slice(0, 3000)}\n`;
  } else if (asset.extractedTextPreview) {
    userPrompt += `\nExtracted text preview:\n${asset.extractedTextPreview}\n`;
  }

  if (isImage && asset.publicUrl) {
    userPrompt += `\nAnalyze the image at the provided URL. Describe visible elements, colors, mood, style, and quality.`;
  } else if (isVideo) {
    userPrompt += `\nThis is a video asset. Based on the metadata, describe likely content, mood, and suitable uses. If a thumbnail or preview is available, analyze it.`;
  } else if (isAudio) {
    userPrompt += `\nThis is an audio asset. Based on metadata, describe likely content and suitable uses.`;
  } else if (isDocument) {
    userPrompt += `\nThis is a document. Summarize its contents, extract key points, and identify any compliance restrictions.`;
  }

  return { systemPrompt, userPrompt, useVision: isImage && !!asset.publicUrl };
}

// ── Result normalizer ────────────────────────────────────────────────────────

export function normalizeAssetContextResult(raw: any): AssetContextResult {
  return {
    agentDescription: typeof raw.agentDescription === 'string' ? raw.agentDescription : null,
    suggestedUses: Array.isArray(raw.suggestedUses) ? raw.suggestedUses.filter((s: any) => typeof s === 'string') : [],
    restrictedUses: Array.isArray(raw.restrictedUses) ? raw.restrictedUses.filter((s: any) => typeof s === 'string') : [],
    visibleElements: Array.isArray(raw.visibleElements) ? raw.visibleElements.filter((s: any) => typeof s === 'string') : [],
    dominantColors: Array.isArray(raw.dominantColors) ? raw.dominantColors.filter((s: any) => typeof s === 'string') : [],
    mood: typeof raw.mood === 'string' ? raw.mood : null,
    style: typeof raw.style === 'string' ? raw.style : null,
    documentSummary: typeof raw.documentSummary === 'string' ? raw.documentSummary : null,
    keyPoints: Array.isArray(raw.keyPoints) ? raw.keyPoints.filter((s: any) => typeof s === 'string') : [],
    restrictedClaims: Array.isArray(raw.restrictedClaims) ? raw.restrictedClaims.filter((s: any) => typeof s === 'string') : [],
    requiredDisclosures: Array.isArray(raw.requiredDisclosures) ? raw.requiredDisclosures.filter((s: any) => typeof s === 'string') : [],
    transcript: typeof raw.transcript === 'string' ? raw.transcript : null,
    transcriptSummary: typeof raw.transcriptSummary === 'string' ? raw.transcriptSummary : null,
    confidenceScore: typeof raw.confidenceScore === 'number' ? Math.max(0, Math.min(1, raw.confidenceScore)) : null,
    qualityNotes: Array.isArray(raw.qualityNotes) ? raw.qualityNotes.filter((s: any) => typeof s === 'string') : [],
  };
}

// ── Internal: call LLM ──────────────────────────────────────────────────────

async function generateContextForAsset(asset: AssetInfo): Promise<any> {
  const apiKey = process.env.ABACUSAI_API_KEY;
  if (!apiKey) {
    throw new Error('ABACUSAI_API_KEY not configured');
  }

  const { systemPrompt, userPrompt, useVision } = buildAssetContextPrompt(asset);

  // Build messages array
  const messages: any[] = [
    { role: 'system', content: systemPrompt },
  ];

  if (useVision && asset.publicUrl) {
    messages.push({
      role: 'user',
      content: [
        { type: 'text', text: userPrompt },
        { type: 'image_url', image_url: { url: asset.publicUrl } },
      ],
    });
  } else {
    messages.push({ role: 'user', content: userPrompt });
  }

  const res = await fetch(LLM_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: DEFAULT_MODEL,
      messages,
      temperature: 0.3,
      max_tokens: 2000,
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => 'unknown');
    throw new Error(`LLM API error ${res.status}: ${errText}`);
  }

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error('Empty LLM response');
  }

  // Parse JSON from response (handle markdown code blocks)
  let cleaned = content.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  }

  try {
    return JSON.parse(cleaned);
  } catch {
    throw new Error(`Failed to parse LLM JSON: ${cleaned.slice(0, 200)}`);
  }
}

// ── Helper: get enriched context for an asset (for agent payload) ────────────

export interface EnrichedAssetContext {
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
}

/**
 * Get enriched context for a business asset if it exists and is not rejected.
 * Returns null if no context, context is rejected, or on error.
 */
export async function getBusinessAssetEnrichedContext(
  assetId: string,
): Promise<EnrichedAssetContext | null> {
  try {
    const ctx = await prisma.assetContext.findUnique({
      where: { businessAssetId: assetId },
    });
    if (!ctx || ctx.contextStatus === 'rejected') return null;
    return mapContextToEnriched(ctx);
  } catch {
    return null;
  }
}

/**
 * Get enriched context for a shared asset if it exists and is not rejected.
 */
export async function getSharedAssetEnrichedContext(
  assetId: string,
): Promise<EnrichedAssetContext | null> {
  try {
    const ctx = await prisma.assetContext.findUnique({
      where: { sharedAssetId: assetId },
    });
    if (!ctx || ctx.contextStatus === 'rejected') return null;
    return mapContextToEnriched(ctx);
  } catch {
    return null;
  }
}

function mapContextToEnriched(ctx: any): EnrichedAssetContext {
  return {
    agentDescription: ctx.agentDescription,
    humanDescription: ctx.humanDescription,
    suggestedUses: ctx.suggestedUses || [],
    restrictedUses: ctx.restrictedUses || [],
    visibleElements: ctx.visibleElements || [],
    dominantColors: ctx.dominantColors || [],
    mood: ctx.mood,
    style: ctx.style,
    documentSummary: ctx.documentSummary,
    keyPoints: ctx.keyPoints || [],
    restrictedClaims: ctx.restrictedClaims || [],
    requiredDisclosures: ctx.requiredDisclosures || [],
    transcriptSummary: ctx.transcriptSummary,
    qualityNotes: ctx.qualityNotes || [],
    confidenceScore: ctx.confidenceScore,
    contextStatus: ctx.contextStatus,
    humanReviewed: ctx.humanReviewedContext || false,
  };
}
