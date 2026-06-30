/**
 * Phase 3 — portable asset materialization.
 *
 * Turns the blueprint asset manifest (which only *describes* each image) into
 * real local files under `public/images/` inside the generated static package,
 * so the shipped site references stable local paths (`/images/...`) instead of
 * expiring signed URLs.
 *
 * Hard rules honoured here:
 *  - Never embed signed/expiring URLs in the generated package.
 *  - Prefer fetching by stable R2 key (fresh bytes) over a stored URL.
 *  - If an asset cannot be fetched, record it (missing | failed_download) and
 *    keep going — failures are surfaced, never swallowed.
 *  - Sanitize file names; preserve alt text + dimensions.
 *  - Never log or persist secrets / signed-URL query strings.
 */

import fs from 'fs';
import path from 'path';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { createS3Client, getBucketConfig } from '@/lib/aws-config';
import type { BlueprintAssetManifestEntry } from '@/lib/site-blueprint';

export type MaterializationStatus =
  | 'copied'
  | 'missing'
  | 'failed_download'
  | 'skipped_non_portable';

export interface MaterializedAsset {
  assetId: string;
  assetType: string;
  /** Web path referenced by the site, e.g. /images/hero-abc.jpg */
  webPath: string;
  /** Package-relative file path, e.g. public/images/hero-abc.jpg */
  localPath: string;
  status: MaterializationStatus;
  bytes: number;
  alt?: string;
  width?: number;
  height?: number;
  /** Source kind only — never the signed URL itself. */
  sourceKind: BlueprintAssetManifestEntry['sourceKind'];
  note?: string;
}

export interface MaterializationResult {
  assets: MaterializedAsset[];
  copied: number;
  missing: number;
  failed: number;
  totalBytes: number;
  warnings: string[];
}

/** A fetched asset payload. */
export interface FetchedBytes {
  buffer: Buffer;
  contentType?: string;
}

/**
 * Pluggable asset fetcher (injectable for tests). Given a manifest entry,
 * returns the raw bytes, or null when the asset cannot be retrieved.
 */
export type AssetFetcher = (
  entry: BlueprintAssetManifestEntry,
) => Promise<FetchedBytes | null>;

/** Strip a directory + sanitize a candidate file name to a safe basename. */
export function sanitizeFileName(name: string): string {
  const base = (name || '').split('?')[0].split('#')[0];
  const justName = base.substring(base.lastIndexOf('/') + 1);
  const cleaned = justName
    .replace(/[^a-zA-Z0-9._-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '');
  return cleaned || 'asset';
}

/** Compute the safe, stable local file path for an asset. */
export function localFileForAsset(entry: BlueprintAssetManifestEntry): {
  localPath: string;
  webPath: string;
} {
  // intendedLocalPath was already shaped as public/images/<type>-<id>.<ext>.
  // Re-sanitize defensively so nothing odd ever lands on disk.
  const rel = entry.intendedLocalPath.replace(/^\/+/, '');
  const dir = rel.substring(0, rel.lastIndexOf('/')) || 'public/images';
  const file = sanitizeFileName(rel);
  const localPath = `${dir}/${file}`;
  const webPath = localPath.replace(/^public/, '');
  return { localPath, webPath };
}

/**
 * Default fetcher: prefer the stable R2 key (fresh bytes via S3 GetObject) so
 * we never depend on an expiring signed URL. Falls back to a plain HTTP(S)
 * fetch of a public URL. Signed URLs are only used as a last resort and are
 * never written anywhere.
 */
export function createDefaultAssetFetcher(opts?: {
  r2KeyByAssetId?: Map<string, string | null>;
}): AssetFetcher {
  const r2KeyByAssetId = opts?.r2KeyByAssetId;
  return async (entry) => {
    const r2Key = r2KeyByAssetId?.get(entry.assetId) || null;
    // 1) Preferred: fetch by R2 key (stable, fresh bytes).
    if (r2Key) {
      try {
        const s3 = createS3Client();
        const { bucketName } = getBucketConfig();
        const out = await s3.send(
          new GetObjectCommand({ Bucket: bucketName, Key: r2Key }),
        );
        const body = out.Body as any;
        const buffer = await streamToBuffer(body);
        if (buffer && buffer.length > 0) {
          return { buffer, contentType: out.ContentType };
        }
      } catch {
        // fall through to URL fetch
      }
    }
    // 2) Fallback: HTTP(S) fetch (works for public and not-yet-expired URLs).
    if (entry.source && /^https?:\/\//i.test(entry.source)) {
      try {
        const res = await fetch(entry.source);
        if (res.ok) {
          const ab = await res.arrayBuffer();
          const buffer = Buffer.from(ab);
          if (buffer.length > 0) {
            return { buffer, contentType: res.headers.get('content-type') || undefined };
          }
        }
      } catch {
        // give up; caller records the failure
      }
    }
    return null;
  };
}

async function streamToBuffer(stream: any): Promise<Buffer> {
  if (!stream) return Buffer.alloc(0);
  if (Buffer.isBuffer(stream)) return stream;
  if (typeof stream.transformToByteArray === 'function') {
    return Buffer.from(await stream.transformToByteArray());
  }
  return await new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', (c: Buffer) => chunks.push(Buffer.from(c)));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

/**
 * Materialize all manifest assets into `<outputDir>/public/images`.
 *
 * @param manifest   blueprint asset manifest entries
 * @param outputDir  absolute package directory (client-sites/{slug})
 * @param fetcher    asset byte fetcher (defaults to R2/HTTP fetcher)
 * @param writeFiles when false, performs a dry inspection without writing bytes
 */
export async function materializeAssets(
  manifest: BlueprintAssetManifestEntry[],
  outputDir: string,
  fetcher: AssetFetcher,
  opts?: { writeFiles?: boolean },
): Promise<MaterializationResult> {
  const writeFiles = opts?.writeFiles !== false;
  const assets: MaterializedAsset[] = [];
  const warnings: string[] = [];
  let copied = 0;
  let missing = 0;
  let failed = 0;
  let totalBytes = 0;

  for (const entry of manifest) {
    const { localPath, webPath } = localFileForAsset(entry);
    const baseRecord = {
      assetId: entry.assetId,
      assetType: entry.assetType,
      webPath,
      localPath,
      alt: entry.alt,
      width: entry.width,
      height: entry.height,
      sourceKind: entry.sourceKind,
    };

    // No source at all -> missing (cannot be made portable).
    if (!entry.source) {
      missing += 1;
      warnings.push(`Asset ${entry.assetId} (${entry.assetType}) has no source; recorded as missing.`);
      assets.push({ ...baseRecord, status: 'missing', bytes: 0, note: 'No source URL or key.' });
      continue;
    }

    let fetched: FetchedBytes | null = null;
    try {
      fetched = await fetcher(entry);
    } catch {
      fetched = null;
    }

    if (!fetched || fetched.buffer.length === 0) {
      failed += 1;
      warnings.push(
        `Asset ${entry.assetId} (${entry.assetType}) could not be downloaded; recorded as failed_download.`,
      );
      assets.push({
        ...baseRecord,
        status: 'failed_download',
        bytes: 0,
        note: 'Source could not be retrieved at build time.',
      });
      continue;
    }

    if (writeFiles) {
      const dest = path.join(outputDir, localPath);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, fetched.buffer);
    }
    copied += 1;
    totalBytes += fetched.buffer.length;
    assets.push({ ...baseRecord, status: 'copied', bytes: fetched.buffer.length });
  }

  return { assets, copied, missing, failed, totalBytes, warnings };
}
