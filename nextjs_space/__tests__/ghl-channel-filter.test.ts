import {
  resolveBusinessChannels,
  validateRequestedChannels,
  type ChannelLike,
} from '@/lib/ghl-channel-filter';

// ── Fixtures: a Launch CRM location with 5 connected channels ──────────────
const GMB = 'gmb_blazinghog';
const FB_WIRELESS = 'fb_wireless_internet';
const FB_HOME5G = 'fb_home5g';
const FB_IMPERIAL = 'fb_imperial';
const TIKTOK = 'tiktok_blazinghog';

const ALL: ChannelLike[] = [
  { id: GMB, name: 'Blazing Hog', platform: 'google' },
  { id: FB_WIRELESS, name: 'Blazing Hog Wireless Internet', platform: 'facebook' },
  { id: FB_HOME5G, name: 'Home5GInternet', platform: 'facebook' },
  { id: FB_IMPERIAL, name: 'Imperial Internet Down', platform: 'facebook' },
  { id: TIKTOK, name: 'BlazingHogInternet', platform: 'tiktok' },
];
const ALL_IDS = ALL.map(a => a.id);

describe('resolveBusinessChannels — picker data source', () => {
  it('shows ALL connected channels when no linked ids and no collapse to default (the bug)', () => {
    // Regression: previously, once a default was cached the picker collapsed to
    // just that one channel, hiding Facebook so it could never be selected.
    const { channels, filterMode } = resolveBusinessChannels(ALL, []);
    expect(filterMode).toBe('unfiltered');
    expect(channels.map(c => c.id).sort()).toEqual([...ALL_IDS].sort());
    // Both Google AND Facebook are present and selectable.
    expect(channels.some(c => c.platform === 'google')).toBe(true);
    expect(channels.some(c => c.platform === 'facebook')).toBe(true);
  });

  it('scopes to linked channels only when ghlLinkedAccountIds is populated', () => {
    const { channels, filterMode } = resolveBusinessChannels(ALL, [GMB, FB_WIRELESS]);
    expect(filterMode).toBe('linked');
    expect(channels.map(c => c.id).sort()).toEqual([FB_WIRELESS, GMB].sort());
  });

  it('filters out deleted channels', () => {
    const withDeleted: ChannelLike[] = [...ALL, { id: 'dead', platform: 'facebook', deleted: true }];
    const { channels } = resolveBusinessChannels(withDeleted, []);
    expect(channels.find(c => c.id === 'dead')).toBeUndefined();
  });
});

describe('validateRequestedChannels — per-channel selection', () => {
  // Case 1: GMB only → one publish attempt
  it('GMB only resolves to a single attempt', () => {
    const r = validateRequestedChannels([GMB], ALL_IDS, []);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.resolvedIds).toEqual([GMB]);
  });

  // Case 2: Facebook only → one publish attempt
  it('Facebook only resolves to a single attempt', () => {
    const r = validateRequestedChannels([FB_WIRELESS], ALL_IDS, []);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.resolvedIds).toEqual([FB_WIRELESS]);
  });

  // Case 3: GMB + Facebook → TWO independent attempts (the headline fix)
  it('GMB + Facebook resolves to two independent attempts in order', () => {
    const r = validateRequestedChannels([GMB, FB_WIRELESS], ALL_IDS, []);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.resolvedIds).toHaveLength(2);
      expect(r.resolvedIds).toEqual([GMB, FB_WIRELESS]);
    }
  });

  // Case: only selected channels publish — an unselected channel never appears
  it('never includes an unselected channel', () => {
    const r = validateRequestedChannels([GMB], ALL_IDS, []);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.resolvedIds).not.toContain(FB_WIRELESS);
  });

  // Case: selecting one Facebook page does NOT pull in the other FB pages
  it('selecting one Facebook page does not auto-select other Facebook pages', () => {
    const r = validateRequestedChannels([FB_WIRELESS], ALL_IDS, []);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.resolvedIds).toEqual([FB_WIRELESS]);
      expect(r.resolvedIds).not.toContain(FB_HOME5G);
      expect(r.resolvedIds).not.toContain(FB_IMPERIAL);
    }
  });

  // Case: payload keyed by unique channel id, not by platform → 2 FB pages = 2 attempts
  it('two distinct Facebook pages create two attempts (keyed by id, not platform)', () => {
    const r = validateRequestedChannels([FB_WIRELESS, FB_HOME5G], ALL_IDS, []);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.resolvedIds).toEqual([FB_WIRELESS, FB_HOME5G]);
  });

  // Case: repeated/duplicate selection collapses → no accidental duplicate post
  it('de-duplicates a repeated channel selection to a single attempt', () => {
    const r = validateRequestedChannels([GMB, GMB, FB_WIRELESS, FB_WIRELESS], ALL_IDS, []);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.resolvedIds).toEqual([GMB, FB_WIRELESS]);
  });

  // Case: reject a channel that belongs to another business / location
  it('rejects a channel not connected to this location (cross-business)', () => {
    const r = validateRequestedChannels(['fb_some_other_business'], ALL_IDS, []);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe(403);
      expect(r.channelId).toBe('fb_some_other_business');
    }
  });

  // Case: with explicit linked scoping, reject an unlinked (but same-location) channel
  it('rejects a same-location channel that is not in the linked set', () => {
    const r = validateRequestedChannels([TIKTOK], ALL_IDS, [GMB, FB_WIRELESS]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe(403);
  });

  // Case: empty selection is reported (caller falls back to legacy path)
  it('reports empty selection', () => {
    const r = validateRequestedChannels([], ALL_IDS, []);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe(422);
  });

  // Case: linked set allows the linked channels through
  it('allows linked channels when scoping is active', () => {
    const r = validateRequestedChannels([GMB, FB_WIRELESS], ALL_IDS, [GMB, FB_WIRELESS]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.resolvedIds).toEqual([GMB, FB_WIRELESS]);
  });
});
