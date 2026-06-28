/**
 * Pure, side-effect-free helpers for resolving which Launch CRM (GHL Social
 * Planner) publishing channels a business may use, and for validating a
 * user's per-channel selection before publishing.
 *
 * These functions are the single source of truth for multi-channel Post Now
 * behaviour and are unit-tested in __tests__/ghl-channel-filter.test.ts.
 *
 * Business isolation rule: every account passed in already belongs to THIS
 * business's ghlLocationId (the caller fetches them from that location). On
 * top of that, if the business owner has explicitly scoped channels via
 * ghlLinkedAccountIds, only those are allowed.
 */

export interface ChannelLike {
  id: string;
  name?: string;
  platform?: string;
  deleted?: boolean;
}

export type ChannelFilterMode = 'linked' | 'unfiltered';

export interface ResolveChannelsResult<T extends ChannelLike> {
  /** Channels the picker should display for this business. */
  channels: T[];
  filterMode: ChannelFilterMode;
}

/**
 * Decide which channels to surface in the Post Now / schedule picker.
 *
 * - If `linkedAccountIds` is non-empty → the owner has explicitly scoped the
 *   business to those channels, so show only those.
 * - Otherwise show ALL active channels for the location so the owner can
 *   publish to any combination (e.g. Google + Facebook).
 *
 * IMPORTANT: We intentionally NEVER collapse the list down to a single cached
 * default channel. Doing that previously hid every channel except the default
 * once a business had published once, which silently made multi-channel
 * publishing impossible.
 */
export function resolveBusinessChannels<T extends ChannelLike>(
  activeAccounts: T[],
  linkedAccountIds: string[] | null | undefined,
): ResolveChannelsResult<T> {
  const active = (activeAccounts || []).filter(a => !a.deleted);
  const linked = linkedAccountIds || [];

  if (linked.length > 0) {
    const linkedSet = new Set(linked);
    return {
      channels: active.filter(a => linkedSet.has(a.id)),
      filterMode: 'linked',
    };
  }

  return { channels: active, filterMode: 'unfiltered' };
}

export interface ValidateOk {
  ok: true;
  /** De-duplicated, order-preserving list of channel IDs to publish to. */
  resolvedIds: string[];
}

export interface ValidateError {
  ok: false;
  /** HTTP-ish status to return to the caller. */
  code: number;
  error: string;
  /** The offending channel id, when applicable. */
  channelId?: string;
}

export type ValidateResult = ValidateOk | ValidateError;

/**
 * Validate a user's per-channel selection for Post Now.
 *
 * Rules:
 * - Every requested id must belong to this business's location
 *   (`allLocationAccountIds`), else 403 (rejects cross-business channels).
 * - If the business has explicit `linkedAccountIds`, every requested id must be
 *   in that set, else 403.
 * - Duplicate selections collapse to a single publish attempt (no accidental
 *   duplicate posts).
 * - Empty selection is reported so the caller can fall back to legacy
 *   platform-based selection.
 */
export function validateRequestedChannels(
  requestedIds: string[] | null | undefined,
  allLocationAccountIds: string[],
  linkedAccountIds: string[] | null | undefined,
): ValidateResult {
  const requested = (requestedIds || []).filter(Boolean);
  if (requested.length === 0) {
    return { ok: false, code: 422, error: 'No channels selected.' };
  }

  const allSet = new Set(allLocationAccountIds);
  const linked = linkedAccountIds || [];
  const linkedSet = new Set(linked);

  for (const id of requested) {
    if (!allSet.has(id)) {
      return {
        ok: false,
        code: 403,
        channelId: id,
        error: `Channel ${id} is not connected to this business's Launch CRM location.`,
      };
    }
    if (linkedSet.size > 0 && !linkedSet.has(id)) {
      return {
        ok: false,
        code: 403,
        channelId: id,
        error: `Channel ${id} is not linked to this business. Cross-business publishing is not allowed.`,
      };
    }
  }

  // De-duplicate while preserving selection order → one attempt per channel.
  const seen = new Set<string>();
  const resolvedIds: string[] = [];
  for (const id of requested) {
    if (!seen.has(id)) {
      seen.add(id);
      resolvedIds.push(id);
    }
  }

  return { ok: true, resolvedIds };
}
