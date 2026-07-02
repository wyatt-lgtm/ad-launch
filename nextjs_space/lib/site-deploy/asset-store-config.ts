/**
 * Phase 4 — R2 asset-store + Cloudflare Pages readiness (config REFERENCES).
 *
 * Tombstone already owns two Cloudflare R2 buckets that are the SOURCE asset
 * stores for generated sites:
 *   - tombstoner2               → Tombstone-created/generated assets
 *   - tombstoner2customerassets → customer-provided uploaded assets
 *
 * This module surfaces ONLY presence booleans + safe display values (the
 * bucket NAMES, which are not secrets). It NEVER returns an access key, secret
 * key, API token, account-scoped credential, signed URL, or any token value.
 *
 * Static build flow (enforced elsewhere, documented here for clarity):
 *   R2 key / asset record
 *     → materialize into the static package (fresh bytes, never a signed URL)
 *     → public/images or public/assets
 *     → generated static site
 * Manifests may record the R2 source bucket/key, but never a signed-URL query
 * string or any credential. No new R2 bucket or token is created here.
 */

/** Canonical existing buckets — used as display fallbacks only. */
export const TOMBSTONE_R2_GENERATED_BUCKET_DEFAULT = 'tombstoner2';
export const TOMBSTONE_R2_CUSTOMER_ASSETS_BUCKET_DEFAULT = 'tombstoner2customerassets';

function present(v: string | undefined | null): boolean {
  return Boolean(v && String(v).trim().length > 0);
}

/** First env var (by NAME) that is present, else null. Never returns a value. */
function firstPresent(...keys: string[]): boolean {
  return keys.some((k) => present(process.env[k]));
}

/** Strip a URL down to a safe host (no protocol, path, query, or credentials). */
function safeHost(raw: string | undefined | null): string | null {
  if (!present(raw)) return null;
  const v = String(raw).trim();
  try {
    const u = new URL(v.includes('://') ? v : `https://${v}`);
    return u.hostname || null;
  } catch {
    // Fall back to the part before any slash/query; never expose a query string.
    return v.split('?')[0].split('/')[0] || null;
  }
}

export interface AssetStoreReadiness {
  /** Generated-asset bucket (Tombstone-created assets). Name is safe to show. */
  generatedBucket: { name: string; configured: boolean };
  /** Customer-uploaded asset bucket. Name is safe to show. */
  customerAssetsBucket: { name: string; configured: boolean };
  /** R2 S3-compatible endpoint host (no credentials). */
  r2Endpoint: { configured: boolean; host: string | null };
  /** R2 / Cloudflare account reference. Presence only. */
  r2Account: { configured: boolean };
  /** R2 credential path (key/secret or profile). Presence only — NEVER a value. */
  r2Credential: { configured: boolean };
}

/**
 * Resolve the R2 asset-store readiness from config references. Bucket names are
 * safe to display; everything credential-bearing is reduced to a boolean.
 */
export function getAssetStoreReadiness(): AssetStoreReadiness {
  const generatedName =
    (process.env.TOMBSTONE_R2_GENERATED_BUCKET || '').trim() ||
    TOMBSTONE_R2_GENERATED_BUCKET_DEFAULT;
  const customerName =
    (process.env.TOMBSTONE_R2_CUSTOMER_ASSETS_BUCKET || '').trim() ||
    TOMBSTONE_R2_CUSTOMER_ASSETS_BUCKET_DEFAULT;

  return {
    generatedBucket: {
      name: generatedName,
      configured: present(process.env.TOMBSTONE_R2_GENERATED_BUCKET),
    },
    customerAssetsBucket: {
      name: customerName,
      configured: present(process.env.TOMBSTONE_R2_CUSTOMER_ASSETS_BUCKET),
    },
    r2Endpoint: {
      configured: firstPresent('TOMBSTONE_R2_ENDPOINT', 'R2_ENDPOINT', 'AWS_ENDPOINT', 'S3_ENDPOINT'),
      host: safeHost(
        process.env.TOMBSTONE_R2_ENDPOINT ||
          process.env.R2_ENDPOINT ||
          process.env.AWS_ENDPOINT ||
          process.env.S3_ENDPOINT,
      ),
    },
    r2Account: {
      configured: firstPresent(
        'TOMBSTONE_R2_ACCOUNT_ID',
        'R2_ACCOUNT_ID',
        'CLOUDFLARE_ACCOUNT_ID',
      ),
    },
    r2Credential: {
      // The existing static-build credential path: explicit R2/AWS keys or a
      // shared profile. Presence only — the secret itself is never read here.
      configured: firstPresent(
        'R2_ACCESS_KEY_ID',
        'R2_SECRET_ACCESS_KEY',
        'AWS_ACCESS_KEY_ID',
        'AWS_SECRET_ACCESS_KEY',
        'AWS_PROFILE',
        'AWS_BUCKET_NAME',
      ),
    },
  };
}

export interface CloudflareReadiness {
  /** Cloudflare account id reference. Presence only. */
  accountId: { configured: boolean };
  /** Cloudflare Pages API token. Presence only — NEVER a value. */
  pagesApiToken: { configured: boolean };
  /** Cloudflare DNS API token. Presence only — NEVER a value. */
  dnsApiToken: { configured: boolean };
  /**
   * Optional zone id reference (presence only). Detected from either
   * CLOUDFLARE_ZONE_ID or the legacy CLOUDFLARE_DEFAULT_ZONE_ID.
   */
  defaultZoneId: { configured: boolean };
  /** True only when the minimum Pages-readiness refs are present. */
  ready: boolean;
  /** Human-friendly list of the config refs still missing. */
  missing: string[];
}

/**
 * Resolve Cloudflare Pages readiness from config references. Tokens are reduced
 * to presence booleans; no token value is ever returned.
 */
export function getCloudflareReadiness(): CloudflareReadiness {
  const accountId = present(process.env.CLOUDFLARE_ACCOUNT_ID);
  const pagesApiToken = present(process.env.CLOUDFLARE_PAGES_API_TOKEN);
  const dnsApiToken = present(process.env.CLOUDFLARE_DNS_API_TOKEN);
  // Support both the current CLOUDFLARE_ZONE_ID and the legacy
  // CLOUDFLARE_DEFAULT_ZONE_ID name.
  const defaultZoneId = firstPresent('CLOUDFLARE_ZONE_ID', 'CLOUDFLARE_DEFAULT_ZONE_ID');

  const missing: string[] = [];
  if (!accountId) missing.push('CLOUDFLARE_ACCOUNT_ID');
  if (!pagesApiToken) missing.push('CLOUDFLARE_PAGES_API_TOKEN');
  if (!dnsApiToken) missing.push('CLOUDFLARE_DNS_API_TOKEN');

  return {
    accountId: { configured: accountId },
    pagesApiToken: { configured: pagesApiToken },
    dnsApiToken: { configured: dnsApiToken },
    defaultZoneId: { configured: defaultZoneId },
    // Minimum readiness for Cloudflare Pages = account id + pages token.
    ready: accountId && pagesApiToken,
    missing,
  };
}

/** Combined readiness payload safe to serialize to the UI. */
export function getDeploymentAssetReadiness() {
  return {
    liveDeployEnabled: false as const,
    assetStores: getAssetStoreReadiness(),
    cloudflare: getCloudflareReadiness(),
  };
}
