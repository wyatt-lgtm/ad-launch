/**
 * GHL Social Planner Client
 *
 * Handles account lookup and post creation via the GHL Social Media Posting API.
 * Architecture: Launch OS → GHL Social Planner → Connected Facebook/TikTok Pages → Platform
 *
 * This client reads GHL credentials (locationId + PIT token) from the Launch OS
 * Business record — NOT from Tombstone.
 */

const GHL_BASE_URL = 'https://services.leadconnectorhq.com';
const GHL_API_VERSION = '2021-07-28';
const GHL_TIMEOUT_MS = 15_000;

// ── Types ────────────────────────────────────────────────────────────

export interface GhlSocialAccount {
  id: string;            // Full GHL account ID
  oauthId: string;
  profileId: string;
  name: string;          // Display name (e.g. "Blazing Hog Wireless Internet")
  avatar: string;
  platform: string;      // facebook | tiktok | instagram | linkedin | google_business
  type: string;          // page | business | profile
  expire: string;        // ISO date
  isExpired: boolean;
  originId: string;      // Platform-specific ID (e.g. FB page ID)
  deleted: boolean;
  updatedAt: string;
  hasStatisticsPermissions: boolean;
  meta?: Record<string, any>;
}

export interface GhlAccountsResult {
  success: boolean;
  accounts: GhlSocialAccount[];
  groups: any[];
  error?: string;
  statusCode?: number;
}

export interface GhlMediaItem {
  url: string;                   // Full public URL of the media file
  type: string;                  // MIME type (e.g. 'image/png', 'image/jpeg', 'video/mp4')
}

export interface GhlCreatePostPayload {
  accountIds: string[];          // GHL Social Planner account IDs to post to
  userId: string;                // GHL user ID (required by API)
  summary?: string;              // Post caption/body text
  media?: GhlMediaItem[];        // Array of media objects with url + type
  type: 'post';                  // Post type
  status?: 'draft' | 'scheduled' | 'in_review';
  scheduleDate?: string;         // ISO date for scheduling
}

export interface GhlCreatePostResult {
  success: boolean;
  postId?: string;
  status?: string;
  data?: any;
  error?: string;
  statusCode?: number;
}

export interface GhlTraceStep {
  step: string;
  timestamp: string;
  detail?: string;
}

// ── Helpers ──────────────────────────────────────────────────────────

function ghlHeaders(apiToken: string): Record<string, string> {
  return {
    'Authorization': `Bearer ${apiToken}`,
    'Version': GHL_API_VERSION,
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  };
}

async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs = GHL_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Sanitize error messages — strip tokens, keys, auth headers.
 */
function sanitizeError(raw: string): string {
  return raw
    .replace(/Bearer\s+[\w\-.]+/gi, 'Bearer ***')
    .replace(/pit-[\w-]+/gi, 'pit-***')
    .replace(/Authorization[^,}]*/gi, 'Authorization: ***')
    .slice(0, 500);
}

// ── Account Lookup ───────────────────────────────────────────────────

/**
 * GET /users/?locationId=:locationId
 *
 * Returns the first admin user for the given GHL location.
 * GHL requires a userId in post payloads.
 */
export async function lookupGhlUserId(
  locationId: string,
  apiToken: string
): Promise<{ userId: string | null; userName: string | null; error?: string }> {
  try {
    const res = await fetchWithTimeout(
      `${GHL_BASE_URL}/users/?locationId=${encodeURIComponent(locationId)}`,
      { method: 'GET', headers: ghlHeaders(apiToken) }
    );
    if (!res.ok) {
      return { userId: null, userName: null, error: `GHL users API returned ${res.status}` };
    }
    const data = await res.json().catch(() => ({ users: [] }));
    const users = data?.users || [];
    // Prefer admin users
    const admin = users.find((u: any) => u.roles?.role === 'admin' && !u.deleted);
    const fallback = users.find((u: any) => !u.deleted);
    const pick = admin || fallback;
    if (!pick) return { userId: null, userName: null, error: 'No users found in GHL location' };
    return { userId: pick.id, userName: pick.name };
  } catch (err: any) {
    return { userId: null, userName: null, error: err.message };
  }
}

/**
 * GET /social-media-posting/:locationId/accounts
 *
 * Returns all connected social accounts for the given GHL location.
 * Uses the PIT token from the Launch OS Business record.
 */
export async function listGhlSocialAccounts(
  locationId: string,
  apiToken: string
): Promise<GhlAccountsResult> {
  const url = `${GHL_BASE_URL}/social-media-posting/${locationId}/accounts`;

  try {
    const res = await fetchWithTimeout(url, {
      method: 'GET',
      headers: ghlHeaders(apiToken),
    });

    if (res.status === 401) {
      return { success: false, accounts: [], groups: [], error: 'GHL API token is unauthorized or expired.', statusCode: 401 };
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return {
        success: false,
        accounts: [],
        groups: [],
        error: sanitizeError(`GHL returned ${res.status}: ${text}`),
        statusCode: res.status,
      };
    }

    const data = await res.json();
    const results = data.results || data;
    return {
      success: true,
      accounts: results.accounts || [],
      groups: results.groups || [],
    };
  } catch (err: any) {
    if (err.name === 'AbortError') {
      return { success: false, accounts: [], groups: [], error: 'GHL API timeout.' };
    }
    return { success: false, accounts: [], groups: [], error: sanitizeError(err.message || 'Network error') };
  }
}

// ── Account Selection ────────────────────────────────────────────────

export interface AccountSelectionResult {
  selected: GhlSocialAccount | null;
  error?: string;
  allAccounts: GhlSocialAccount[];
}

/**
 * Select the correct GHL Social Planner account for a business.
 *
 * Priority:
 * 1. Use saved defaultGhlSocialAccountId if it matches a live account
 * 2. For Facebook: match by originId, then by exact name
 * 3. If exactly 1 Facebook page exists, use it
 * 4. If multiple exist with no deterministic match, fail
 */
export function selectGhlAccount(
  accounts: GhlSocialAccount[],
  options: {
    platform?: string;
    savedAccountId?: string | null;
    savedOriginId?: string | null;
    savedAccountName?: string | null;
  } = {}
): AccountSelectionResult {
  const platform = options.platform || 'facebook';

  // Filter to the target platform, exclude expired and deleted
  const candidates = accounts.filter(
    a => a.platform === platform && !a.isExpired && !a.deleted
  );

  if (candidates.length === 0) {
    return {
      selected: null,
      error: `No connected ${platform} account/page found in Launch CRM Social Planner.`,
      allAccounts: accounts,
    };
  }

  // 1. Saved account ID match
  if (options.savedAccountId) {
    const match = candidates.find(a => a.id === options.savedAccountId);
    if (match) return { selected: match, allAccounts: accounts };
  }

  // 2. Origin ID match
  if (options.savedOriginId) {
    const match = candidates.find(a => a.originId === options.savedOriginId);
    if (match) return { selected: match, allAccounts: accounts };
  }

  // 3. Name match
  if (options.savedAccountName) {
    const match = candidates.find(
      a => a.name.toLowerCase() === options.savedAccountName!.toLowerCase()
    );
    if (match) return { selected: match, allAccounts: accounts };
  }

  // 4. Single candidate — use it
  if (candidates.length === 1) {
    return { selected: candidates[0], allAccounts: accounts };
  }

  // 5. Multiple candidates, no deterministic selection
  const names = candidates.map(a => `"${a.name}" (${a.originId})`).join(', ');
  return {
    selected: null,
    error: `Multiple ${platform} pages are connected; please select the correct publishing page. Found: ${names}`,
    allAccounts: accounts,
  };
}

// ── Create Post ──────────────────────────────────────────────────────

/**
 * POST /social-media-posting/:locationId/posts
 *
 * Creates a post in GHL Social Planner.
 * For immediate publishing, use status='in_review' (GHL publishes immediately
 * or puts in review depending on location settings).
 */
export async function createGhlSocialPost(
  locationId: string,
  apiToken: string,
  payload: GhlCreatePostPayload
): Promise<GhlCreatePostResult> {
  const url = `${GHL_BASE_URL}/social-media-posting/${locationId}/posts`;

  const body: Record<string, any> = {
    accountIds: payload.accountIds,
    userId: payload.userId,
    type: payload.type || 'post',
  };

  if (payload.summary) {
    body.summary = payload.summary;
  }

  // GHL expects `media` as an array of { url, type } objects — NOT `mediaUrls`
  if (payload.media && payload.media.length > 0) {
    body.media = payload.media;
  } else {
    body.media = []; // GHL requires media to be present (even if empty)
  }

  // For immediate post, omit scheduleDate and set no status (GHL defaults to immediate)
  // For scheduled posts, include scheduleDate
  if (payload.scheduleDate) {
    body.scheduleDate = payload.scheduleDate;
  }

  if (payload.status) {
    body.status = payload.status;
  }

  try {
    const res = await fetchWithTimeout(url, {
      method: 'POST',
      headers: ghlHeaders(apiToken),
      body: JSON.stringify(body),
    });

    const responseText = await res.text().catch(() => '');
    let responseData: any = {};
    try {
      responseData = JSON.parse(responseText);
    } catch {
      responseData = { raw: responseText.slice(0, 500) };
    }

    if (!res.ok) {
      return {
        success: false,
        error: sanitizeError(`GHL rejected the post payload: ${responseText}`),
        statusCode: res.status,
        data: responseData,
      };
    }

    // Extract post ID from response
    const postId = responseData?.postId || responseData?.id || responseData?.data?.id || null;
    const status = responseData?.status || responseData?.data?.status || 'unknown';

    return {
      success: true,
      postId,
      status,
      data: responseData,
      statusCode: res.status,
    };
  } catch (err: any) {
    if (err.name === 'AbortError') {
      return { success: false, error: 'GHL API timeout.' };
    }
    return { success: false, error: sanitizeError(err.message || 'Network error') };
  }
}

// ── Trace Logger ─────────────────────────────────────────────────────

export function createTraceId(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `pn-${ts}-${rand}`;
}

export function traceStep(step: string, detail?: string): GhlTraceStep {
  return {
    step,
    timestamp: new Date().toISOString(),
    ...(detail ? { detail } : {}),
  };
}
