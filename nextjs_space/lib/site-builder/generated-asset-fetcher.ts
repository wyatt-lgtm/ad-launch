/**
 * Bucket-aware asset fetcher for sitemap-first static builds.
 *
 * Generated website images live in the Cloudflare R2 bucket `tombstoner2`,
 * which is owned by the Tombstone backend. Launch OS does NOT hold direct R2
 * credentials, so we resolve each durable R2 key into a fresh, short-lived
 * accessible URL through the Tombstone `/artifacts/resolve` endpoint and then
 * download the bytes over HTTPS.
 *
 * Guarantees:
 *  - We only ever persist the bare durable R2 key (never a signed URL).
 *  - The resolved URL is used transiently to download bytes and is discarded.
 *  - On any failure the fetcher returns `null` (never throws, never a signed
 *    URL) so the caller records a materialization warning/failure instead of
 *    silently dropping a required asset.
 */
import type { AssetFetcher, FetchedBytes } from '@/lib/site-renderer/assets';
import type { DurableAssetSource } from '@/lib/site-builder/sitemap-blueprint';

const TOMBSTONE_URL =
  process.env.TOMBSTONE_API_URL ?? 'https://tombstone-api-xjc4.onrender.com';

/**
 * Resolve a durable R2 key into an accessible URL via the Tombstone backend.
 * Returns null on any failure. The returned URL is transient and must never be
 * stored anywhere durable.
 */
async function resolveDurableKeyToUrl(key: string): Promise<string | null> {
  if (!key) return null;
  // Already a URL? (should not happen for durable keys, but be defensive)
  if (/^https?:\/\//i.test(key)) return key;

  // Strip an r2://bucket/ prefix if present, keeping only the object key.
  let cleanKey = key;
  if (cleanKey.startsWith('r2://')) {
    const withoutScheme = cleanKey.slice(5);
    const slashIdx = withoutScheme.indexOf('/');
    cleanKey = slashIdx >= 0 ? withoutScheme.slice(slashIdx + 1) : withoutScheme;
  }

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(
        `${TOMBSTONE_URL}/artifacts/resolve?artifact_path=${encodeURIComponent(
          cleanKey,
        )}`,
        { cache: 'no-store' },
      );
      if (!res.ok) {
        if (attempt < 2) {
          await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
          continue;
        }
        return null;
      }
      const data = await res.json().catch(() => ({} as any));
      return data?.artifact_url ?? null;
    } catch {
      if (attempt < 2) {
        await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
        continue;
      }
      return null;
    }
  }
  return null;
}

async function downloadBytes(url: string): Promise<FetchedBytes | null> {
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return null;
    const ab = await res.arrayBuffer();
    const buffer = Buffer.from(ab);
    if (buffer.length === 0) return null;
    return {
      buffer,
      contentType: res.headers.get('content-type') || undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Build an AssetFetcher that materializes generated images from their durable
 * R2 keys. `assetSources` maps blueprint asset ids to their {bucket, key}.
 */
export function createGeneratedAssetFetcher(
  assetSources: DurableAssetSource[],
): AssetFetcher {
  const byId = new Map<string, DurableAssetSource>();
  for (const s of assetSources) {
    if (s && s.assetId) byId.set(s.assetId, s);
  }

  return async (entry): Promise<FetchedBytes | null> => {
    const src = byId.get(entry.assetId);
    const durableKey = src?.key || null;

    // 1) Preferred: resolve the durable R2 key -> transient URL -> bytes.
    if (durableKey) {
      const url = await resolveDurableKeyToUrl(durableKey);
      if (url) {
        const bytes = await downloadBytes(url);
        if (bytes) return bytes;
      }
    }

    // 2) No fallback to stored signed URLs — required assets that cannot be
    //    resolved are reported as a materialization failure by the caller.
    return null;
  };
}
