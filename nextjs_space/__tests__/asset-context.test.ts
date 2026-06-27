/**
 * asset-context.test.ts
 *
 * Tests for AssetContext parent validation, normalizer behavior,
 * and enriched context integration with agent payloads and bridge.
 */

import {
  validateAssetContextParent,
  normalizeAssetContextResult,
  buildAssetContextPrompt,
} from '@/lib/asset-context';

// ── 1. Parent validation tests ───────────────────────────────────────────────

describe('validateAssetContextParent', () => {
  test('accepts businessAssetId only', () => {
    expect(() => validateAssetContextParent('biz_123', null)).not.toThrow();
    expect(() => validateAssetContextParent('biz_123', undefined)).not.toThrow();
  });

  test('accepts sharedAssetId only', () => {
    expect(() => validateAssetContextParent(null, 'shared_456')).not.toThrow();
    expect(() => validateAssetContextParent(undefined, 'shared_456')).not.toThrow();
  });

  test('rejects both parents set', () => {
    expect(() => validateAssetContextParent('biz_123', 'shared_456')).toThrow(
      'both businessAssetId and sharedAssetId were provided'
    );
  });

  test('rejects neither parent set', () => {
    expect(() => validateAssetContextParent(null, null)).toThrow(
      'neither businessAssetId nor sharedAssetId was provided'
    );
    expect(() => validateAssetContextParent(undefined, undefined)).toThrow(
      'neither businessAssetId nor sharedAssetId was provided'
    );
    expect(() => validateAssetContextParent('', '')).toThrow(
      'neither businessAssetId nor sharedAssetId was provided'
    );
  });
});

// ── 2. normalizeAssetContextResult tests ─────────────────────────────────────

describe('normalizeAssetContextResult', () => {
  test('normalizes a full valid result', () => {
    const raw = {
      agentDescription: 'A storefront photo showing the entrance',
      suggestedUses: ['hero_image', 'social_post'],
      restrictedUses: ['not_for_ads'],
      visibleElements: ['storefront', 'signage', 'parking_lot'],
      dominantColors: ['#2563EB', '#F8FAFC'],
      mood: 'professional',
      style: 'exterior_shot',
      documentSummary: null,
      keyPoints: [],
      restrictedClaims: [],
      requiredDisclosures: [],
      transcript: null,
      transcriptSummary: null,
      confidenceScore: 0.85,
      qualityNotes: ['good_lighting'],
    };
    const result = normalizeAssetContextResult(raw);
    expect(result.agentDescription).toBe('A storefront photo showing the entrance');
    expect(result.suggestedUses).toEqual(['hero_image', 'social_post']);
    expect(result.confidenceScore).toBe(0.85);
    expect(result.mood).toBe('professional');
  });

  test('handles missing/invalid fields gracefully', () => {
    const result = normalizeAssetContextResult({});
    expect(result.agentDescription).toBeNull();
    expect(result.suggestedUses).toEqual([]);
    expect(result.restrictedUses).toEqual([]);
    expect(result.visibleElements).toEqual([]);
    expect(result.dominantColors).toEqual([]);
    expect(result.mood).toBeNull();
    expect(result.style).toBeNull();
    expect(result.documentSummary).toBeNull();
    expect(result.keyPoints).toEqual([]);
    expect(result.restrictedClaims).toEqual([]);
    expect(result.requiredDisclosures).toEqual([]);
    expect(result.transcript).toBeNull();
    expect(result.transcriptSummary).toBeNull();
    expect(result.confidenceScore).toBeNull();
    expect(result.qualityNotes).toEqual([]);
  });

  test('clamps confidence score to 0-1', () => {
    expect(normalizeAssetContextResult({ confidenceScore: 1.5 }).confidenceScore).toBe(1);
    expect(normalizeAssetContextResult({ confidenceScore: -0.3 }).confidenceScore).toBe(0);
    expect(normalizeAssetContextResult({ confidenceScore: 0.7 }).confidenceScore).toBe(0.7);
  });

  test('filters non-string values from arrays', () => {
    const result = normalizeAssetContextResult({
      suggestedUses: ['hero_image', 42, null, 'social_post'],
      visibleElements: [true, 'storefront'],
    });
    expect(result.suggestedUses).toEqual(['hero_image', 'social_post']);
    expect(result.visibleElements).toEqual(['storefront']);
  });
});

// ── 3. buildAssetContextPrompt tests ─────────────────────────────────────────

describe('buildAssetContextPrompt', () => {
  const baseAsset = {
    id: 'test_1',
    title: 'Test Asset',
    description: '',
    assetType: 'photo',
    category: 'products_services',
    mimeType: 'image/jpeg',
    tags: [],
    publicUrl: 'https://digi-texx.com/wp-content/uploads/2026/03/product-photo-editing-services-thumbnail.jpg',
    textContent: null,
    extractedTextPreview: null,
    width: 1920,
    height: 1080,
    duration: null,
    notesForAI: null,
    relatedServiceTopic: null,
  };

  test('image asset uses vision', () => {
    const { useVision, systemPrompt } = buildAssetContextPrompt(baseAsset);
    expect(useVision).toBe(true);
    expect(systemPrompt).toContain('asset analysis assistant');
  });

  test('image without publicUrl does not use vision', () => {
    const { useVision } = buildAssetContextPrompt({ ...baseAsset, publicUrl: null });
    expect(useVision).toBe(false);
  });

  test('document asset does not use vision', () => {
    const { useVision, userPrompt } = buildAssetContextPrompt({
      ...baseAsset,
      mimeType: 'application/pdf',
      assetType: 'document',
    });
    expect(useVision).toBe(false);
    expect(userPrompt).toContain('document');
  });

  test('compliance asset prompt mentions restricted claims', () => {
    const { userPrompt } = buildAssetContextPrompt({
      ...baseAsset,
      assetType: 'forbidden_claim',
      category: 'compliance',
      mimeType: 'text/plain',
      textContent: 'Do not claim FDA approval',
    });
    expect(userPrompt).toContain('COMPLIANCE');
    expect(userPrompt).toContain('restrictedClaims');
  });

  test('video asset does not use vision', () => {
    const { useVision } = buildAssetContextPrompt({
      ...baseAsset,
      mimeType: 'video/mp4',
      assetType: 'video',
    });
    expect(useVision).toBe(false);
  });

  test('text asset content is included in prompt', () => {
    const { userPrompt } = buildAssetContextPrompt({
      ...baseAsset,
      mimeType: 'text/plain',
      assetType: 'approved_claim',
      textContent: 'We are the #1 rated BBQ in Texas',
    });
    expect(userPrompt).toContain('#1 rated BBQ');
  });
});

// ── 4. Enriched context mapper tests (via agent-assets) ──────────────────────

describe('enrichedContext in agent pipeline', () => {
  // Test the mapEnrichedContext behavior by importing the normalizer indirectly
  // Since mapEnrichedContext is not exported, we test via the AgentAllowedAsset type
  
  test('AgentAllowedAsset type includes enrichedContext field', () => {
    // Type-level test — this compiles only if enrichedContext exists
    const asset: import('@/lib/agent-assets').AgentAllowedAsset = {
      id: 'test',
      source: 'business',
      title: 'Test',
      assetType: 'photo',
      tags: [],
      intendedUses: [],
      allowedAgents: [],
      qualityWarnings: [],
      restrictions: [],
      _rankScore: 0,
      enrichedContext: {
        agentDescription: 'A photo',
        humanDescription: null,
        suggestedUses: ['hero_image'],
        restrictedUses: [],
        visibleElements: ['storefront'],
        dominantColors: ['#fff'],
        mood: 'warm',
        style: 'lifestyle',
        documentSummary: null,
        keyPoints: [],
        restrictedClaims: [],
        requiredDisclosures: [],
        transcriptSummary: null,
        qualityNotes: [],
        confidenceScore: 0.9,
        contextStatus: 'approved',
        humanReviewed: true,
      },
    };
    expect(asset.enrichedContext?.contextStatus).toBe('approved');
    expect(asset.enrichedContext?.humanReviewed).toBe(true);
  });
});

// ── 5. TombstoneAssetPayload enriched fields ─────────────────────────────────

describe('TombstoneAssetPayload enriched fields', () => {
  test('payload type includes enriched context fields', () => {
    const payload: import('@/lib/tombstone-asset-bridge').TombstoneAssetPayload = {
      id: 'test',
      source: 'business',
      title: 'Test',
      assetType: 'photo',
      enrichedDescription: 'AI-generated description',
      enrichedSuggestedUses: ['hero_image'],
      enrichedRestrictedUses: ['not_for_ads'],
      enrichedVisibleElements: ['storefront'],
      enrichedMood: 'warm',
      enrichedStyle: 'lifestyle',
      enrichedDocumentSummary: 'Summary of doc',
      enrichedKeyPoints: ['key1'],
      enrichedRestrictedClaims: ['no FDA claims'],
      enrichedRequiredDisclosures: ['must include disclaimer'],
      enrichedTranscriptSummary: 'Transcript summary',
      enrichedQualityNotes: ['low_resolution'],
      enrichedConfidence: 0.45,
      enrichedHumanReviewed: true,
    };
    expect(payload.enrichedDescription).toBe('AI-generated description');
    expect(payload.enrichedRestrictedClaims).toContain('no FDA claims');
    expect(payload.enrichedConfidence).toBe(0.45);
  });
});
