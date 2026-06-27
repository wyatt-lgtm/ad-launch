/**
 * Tombstone Asset Bridge — unit tests
 * Tests the bridge between Launch OS asset permission layer and Tombstone generation workflows.
 */
import type { AgentAllowedAsset, GetAgentAssetsResult, AgentType } from '../lib/agent-assets';

// ── Mock setup ───────────────────────────────────────────────────────────────

const mockGetAgentAssets = jest.fn<Promise<GetAgentAssetsResult>, any[]>();

jest.mock('../lib/agent-assets', () => {
  const actual = jest.requireActual('../lib/agent-assets');
  return {
    ...actual,
    getAgentAssets: (...args: any[]) => mockGetAgentAssets(...args),
  };
});

import {
  buildAssetContextForMission,
  buildWebsiteAssetContext,
  buildSeoAssetContext,
  buildSocialAssetContext,
  buildVideoAssetContext,
  buildCommunityEngagementAssetContext,
  type TombstoneAssetPayload,
  type AssetBridgeResult,
} from '../lib/tombstone-asset-bridge';

// ── Helpers ──────────────────────────────────────────────────────────────────

function buildMockAsset(overrides: Partial<AgentAllowedAsset> = {}): AgentAllowedAsset {
  return {
    id: 'asset-1',
    source: 'business',
    title: 'Test Logo',
    assetType: 'logo',
    category: 'brand',
    tags: [],
    intendedUses: ['website', 'social', 'ai'],
    allowedAgents: [],
    qualityWarnings: [],
    restrictions: [],
    _rankScore: 10,
    ...overrides,
  };
}

function buildMockResult(overrides: Partial<GetAgentAssetsResult> = {}): GetAgentAssetsResult {
  return {
    assets: [buildMockAsset()],
    skipped: [],
    totalRetrieved: 1,
    totalSkipped: 0,
    logId: 'log-123',
    ...overrides,
  };
}

beforeEach(() => {
  mockGetAgentAssets.mockReset();
});

// ── Core function tests ─────────────────────────────────────────────────────

describe('buildAssetContextForMission', () => {
  test('returns correct shape with assets', async () => {
    mockGetAgentAssets.mockResolvedValue(buildMockResult());

    const result = await buildAssetContextForMission('biz-1', 'social');

    expect(result).toHaveProperty('context');
    expect(result).toHaveProperty('promptBlock');
    expect(result).toHaveProperty('hasAssets');
    expect(result.hasAssets).toBe(true);
    expect(result.context.businessId).toBe('biz-1');
    expect(result.context.agentType).toBe('social');
    expect(result.context.intendedUse).toBe('social');
    expect(result.context.assets).toHaveLength(1);
    expect(result.context.logId).toBe('log-123');
  });

  test('returns empty context when no assets exist', async () => {
    mockGetAgentAssets.mockResolvedValue(buildMockResult({
      assets: [],
      totalRetrieved: 0,
    }));

    const result = await buildAssetContextForMission('biz-1', 'website');

    expect(result.hasAssets).toBe(false);
    expect(result.context.assets).toHaveLength(0);
  });

  test('returns empty context gracefully on fetch error', async () => {
    mockGetAgentAssets.mockRejectedValue(new Error('DB down'));

    const result = await buildAssetContextForMission('biz-1', 'social');

    expect(result.hasAssets).toBe(false);
    expect(result.context.assets).toHaveLength(0);
    expect(result.context.logId).toBe('');
    expect(result.promptBlock).toContain('No approved assets');
  });

  test('passes correct agentType and intendedUse mapping', async () => {
    mockGetAgentAssets.mockResolvedValue(buildMockResult());

    await buildAssetContextForMission('biz-1', 'seo');

    expect(mockGetAgentAssets).toHaveBeenCalledWith(
      expect.objectContaining({
        businessId: 'biz-1',
        agentType: 'seo',
        intendedUse: 'website',  // seo maps to 'website' use
      }),
    );
  });

  test('forwards optional opts (workflowId, runId, topic)', async () => {
    mockGetAgentAssets.mockResolvedValue(buildMockResult());

    await buildAssetContextForMission('biz-1', 'social', {
      workflowId: 'wf-1',
      runId: 'run-1',
      topic: 'summer sale',
    });

    expect(mockGetAgentAssets).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowId: 'wf-1',
        runId: 'run-1',
        topic: 'summer sale',
      }),
    );
  });

  test('defaults maxAssets to 20', async () => {
    mockGetAgentAssets.mockResolvedValue(buildMockResult());

    await buildAssetContextForMission('biz-1', 'social');

    expect(mockGetAgentAssets).toHaveBeenCalledWith(
      expect.objectContaining({ maxAssets: 20 }),
    );
  });
});

// ── Compact asset tests ─────────────────────────────────────────────────────

describe('asset compaction', () => {
  test('strips empty optional fields', async () => {
    const sparse = buildMockAsset({
      description: '',
      fileUrl: undefined,
      previewUrl: undefined,
      tags: [],
      notesForAI: undefined,
    });
    mockGetAgentAssets.mockResolvedValue(buildMockResult({ assets: [sparse] }));

    const result = await buildAssetContextForMission('biz-1', 'social');
    const compacted = result.context.assets[0];

    expect(compacted.id).toBe('asset-1');
    expect(compacted.source).toBe('business');
    expect(compacted.title).toBe('Test Logo');
    expect(compacted.assetType).toBe('logo');
    // Empty/falsy fields should NOT be present
    expect(compacted).not.toHaveProperty('description');
    expect(compacted).not.toHaveProperty('fileUrl');
    expect(compacted).not.toHaveProperty('previewUrl');
    expect(compacted).not.toHaveProperty('notesForAI');
  });

  test('preserves populated optional fields', async () => {
    const full = buildMockAsset({
      description: 'Main brand logo',
      fileUrl: 'file://test/logo.png',
      notesForAI: 'Always use on white bg',
      relatedServiceTopic: 'bbq',
      attributionText: 'Photo by John',
      restrictions: ['no-crop'],
      rightsHolder: 'Blazin Hog LLC',
      width: 800,
      height: 600,
    });
    mockGetAgentAssets.mockResolvedValue(buildMockResult({ assets: [full] }));

    const result = await buildAssetContextForMission('biz-1', 'social');
    const compacted = result.context.assets[0];

    expect(compacted.description).toBe('Main brand logo');
    expect(compacted.fileUrl).toBe('file://test/logo.png');
    expect(compacted.notesForAI).toBe('Always use on white bg');
    expect(compacted.relatedServiceTopic).toBe('bbq');
    expect(compacted.attributionText).toBe('Photo by John');
    expect(compacted.restrictions).toEqual(['no-crop']);
    expect(compacted.rightsHolder).toBe('Blazin Hog LLC');
    expect(compacted.width).toBe(800);
    expect(compacted.height).toBe(600);
  });
});

// ── Prompt block tests ──────────────────────────────────────────────────────

describe('promptBlock', () => {
  test('includes guardrails text when assets present', async () => {
    mockGetAgentAssets.mockResolvedValue(buildMockResult());

    const result = await buildAssetContextForMission('biz-1', 'social');

    expect(result.promptBlock).toContain('=== APPROVED ASSET CONTEXT ===');
    expect(result.promptBlock).toContain('=== END APPROVED ASSET CONTEXT ===');
    expect(result.promptBlock).toContain('Do NOT invent');
    expect(result.promptBlock).toContain('Respect attribution text');
    expect(result.promptBlock).toContain('Prefer business-owned assets over shared assets');
  });

  test('shows no-assets message when empty', async () => {
    mockGetAgentAssets.mockResolvedValue(buildMockResult({ assets: [], totalRetrieved: 0 }));

    const result = await buildAssetContextForMission('biz-1', 'social');

    expect(result.promptBlock).toContain('No approved assets are available');
    expect(result.promptBlock).toContain('Generate text-only output');
  });

  test('groups assets by type in prompt block', async () => {
    const assets = [
      buildMockAsset({ id: 'a1', assetType: 'logo', title: 'Brand Logo' }),
      buildMockAsset({ id: 'a2', assetType: 'product_photo', title: 'BBQ Photo' }),
      buildMockAsset({ id: 'a3', assetType: 'video', title: 'Intro Clip' }),
    ];
    mockGetAgentAssets.mockResolvedValue(buildMockResult({ assets, totalRetrieved: 3 }));

    const result = await buildAssetContextForMission('biz-1', 'social');

    expect(result.promptBlock).toContain('--- Logos ---');
    expect(result.promptBlock).toContain('--- Photos ---');
    expect(result.promptBlock).toContain('--- Videos ---');
    expect(result.promptBlock).toContain('Brand Logo');
    expect(result.promptBlock).toContain('BBQ Photo');
    expect(result.promptBlock).toContain('Intro Clip');
  });

  test('includes blocked/skipped assets section', async () => {
    mockGetAgentAssets.mockResolvedValue(buildMockResult({
      skipped: [
        { assetId: 'skip-1', title: 'Private Logo', reason: 'not_approved_for_ai' },
        { assetId: 'skip-2', title: 'Expired Cert', reason: 'license_expired' },
      ],
      totalSkipped: 2,
    }));

    const result = await buildAssetContextForMission('biz-1', 'social');

    expect(result.promptBlock).toContain('BLOCKED / SKIPPED ASSETS');
    expect(result.promptBlock).toContain('Private Logo');
    expect(result.promptBlock).toContain('not_approved_for_ai');
    expect(result.promptBlock).toContain('Expired Cert');
    expect(result.promptBlock).toContain('license_expired');
  });

  test('includes attribution and restrictions in asset lines', async () => {
    const asset = buildMockAsset({
      attributionText: 'Photo credit: Jane Smith',
      restrictions: ['no-crop', 'no-overlay'],
      rightsHolder: 'Jane Smith Photography',
    });
    mockGetAgentAssets.mockResolvedValue(buildMockResult({ assets: [asset] }));

    const result = await buildAssetContextForMission('biz-1', 'social');

    expect(result.promptBlock).toContain('Attribution required: Photo credit: Jane Smith');
    expect(result.promptBlock).toContain('Restrictions: no-crop; no-overlay');
    expect(result.promptBlock).toContain('Rights: Jane Smith Photography');
  });
});

// ── Convenience wrapper tests ───────────────────────────────────────────────

describe('convenience wrappers', () => {
  beforeEach(() => {
    mockGetAgentAssets.mockResolvedValue(buildMockResult());
  });

  test('buildWebsiteAssetContext calls with website agent', async () => {
    await buildWebsiteAssetContext('biz-1');
    expect(mockGetAgentAssets).toHaveBeenCalledWith(
      expect.objectContaining({ agentType: 'website', intendedUse: 'website' }),
    );
  });

  test('buildSeoAssetContext calls with seo agent', async () => {
    await buildSeoAssetContext('biz-1');
    expect(mockGetAgentAssets).toHaveBeenCalledWith(
      expect.objectContaining({ agentType: 'seo', intendedUse: 'website' }),
    );
  });

  test('buildSocialAssetContext calls with social agent', async () => {
    await buildSocialAssetContext('biz-1');
    expect(mockGetAgentAssets).toHaveBeenCalledWith(
      expect.objectContaining({ agentType: 'social', intendedUse: 'social' }),
    );
  });

  test('buildVideoAssetContext calls with video agent', async () => {
    await buildVideoAssetContext('biz-1');
    expect(mockGetAgentAssets).toHaveBeenCalledWith(
      expect.objectContaining({ agentType: 'video', intendedUse: 'video' }),
    );
  });

  test('buildCommunityEngagementAssetContext calls with community_engagement agent', async () => {
    await buildCommunityEngagementAssetContext('biz-1');
    expect(mockGetAgentAssets).toHaveBeenCalledWith(
      expect.objectContaining({ agentType: 'community_engagement', intendedUse: 'website' }),
    );
  });

  test('passes workflowId through wrapper', async () => {
    await buildSocialAssetContext('biz-1', { workflowId: 'wf-99' });
    expect(mockGetAgentAssets).toHaveBeenCalledWith(
      expect.objectContaining({ workflowId: 'wf-99' }),
    );
  });
});

// ── Skipped asset context tests ─────────────────────────────────────────────

describe('skipped assets in context', () => {
  test('maps skipped assets correctly', async () => {
    mockGetAgentAssets.mockResolvedValue(buildMockResult({
      skipped: [
        { assetId: 'skip-1', title: 'Blocked Image', reason: 'channel_restricted' },
      ],
      totalSkipped: 1,
    }));

    const result = await buildAssetContextForMission('biz-1', 'social');

    expect(result.context.skippedAssets).toHaveLength(1);
    expect(result.context.skippedAssets[0]).toEqual({
      id: 'skip-1',
      title: 'Blocked Image',
      reason: 'channel_restricted',
    });
    expect(result.context.totalSkipped).toBe(1);
  });
});