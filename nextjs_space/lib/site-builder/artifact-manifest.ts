/**
 * Phase 3 — durable, safe artifact manifest.
 *
 * The artifact manifest is the inspectable record of what a build produced. It
 * is stored on SiteBuild.artifactManifestJson and rendered in the admin
 * inspection view. It MUST never contain secret values, signed-URL query
 * strings, cookies, tokens, or private keys — only names/refs and safe stats.
 */

import type { SiteBlueprint } from '@/lib/site-blueprint';
import type { RenderManifest } from '@/lib/site-renderer';
import type { MaterializedAsset, MaterializationResult } from '@/lib/site-renderer/assets';

export const ARTIFACT_MANIFEST_VERSION = 1;

export interface ArtifactAssetRecord {
  assetId: string;
  assetType: string;
  webPath: string;
  localPath: string;
  status: MaterializedAsset['status'];
  bytes: number;
  alt?: string;
  width?: number;
  height?: number;
  /** Source KIND only — never the (possibly signed) source URL. */
  sourceKind: MaterializedAsset['sourceKind'];
  note?: string;
}

export interface ArtifactManifest {
  manifestVersion: number;
  generatedAt: string;
  businessSlug: string;
  productionId: string;
  websiteProjectId: string;
  blueprintVersion: number;

  pages: { path: string; pageType: string; title?: string }[];
  routes: string[];

  assets: {
    copied: ArtifactAssetRecord[];
    missing: ArtifactAssetRecord[];
    failed: ArtifactAssetRecord[];
    totals: { total: number; copied: number; missing: number; failed: number; totalBytes: number };
  };

  env: {
    /** Public NEXT_PUBLIC_* keys required (names only, never values). */
    publicKeys: string[];
    /** Secret env refs by NAME only — never values. */
    secretRefs: string[];
  };

  seo: {
    sitemapPath: string | null;
    robotsPath: string | null;
    schemaFiles: string[];
  };

  package: {
    sourceRef: string;
    outputRef: string | null;
    fileCount: number;
  };

  build: {
    command: string;
    executed: boolean;
    result: 'artifact_only' | 'success' | 'failed';
  };

  warnings: string[];
}

/** Redact any secret-bearing query string defensively (belt-and-suspenders). */
function safePath(p: string | null | undefined): string | null {
  if (!p) return null;
  const q = p.indexOf('?');
  return q === -1 ? p : p.slice(0, q);
}

export function buildArtifactManifest(args: {
  blueprint: SiteBlueprint;
  renderManifest: RenderManifest;
  materialization: MaterializationResult;
  sourceRef: string;
  outputRef: string | null;
  buildCommand: string;
  buildExecuted: boolean;
  buildResult: ArtifactManifest['build']['result'];
  extraWarnings?: string[];
}): ArtifactManifest {
  const { blueprint, renderManifest, materialization } = args;

  const toRecord = (a: MaterializedAsset): ArtifactAssetRecord => ({
    assetId: a.assetId,
    assetType: a.assetType,
    webPath: a.webPath,
    localPath: a.localPath,
    status: a.status,
    bytes: a.bytes,
    alt: a.alt,
    width: a.width,
    height: a.height,
    sourceKind: a.sourceKind,
    note: a.note,
  });

  const copied = materialization.assets.filter((a) => a.status === 'copied').map(toRecord);
  const missing = materialization.assets.filter((a) => a.status === 'missing').map(toRecord);
  const failed = materialization.assets
    .filter((a) => a.status === 'failed_download' || a.status === 'skipped_non_portable')
    .map(toRecord);

  // Required env keys come from the blueprint's declared env bindings (names
  // only). Public keys carry the NEXT_PUBLIC_ prefix; everything else is a
  // secret reference exposed by NAME only.
  const declared = [
    blueprint.seo.siteUrlEnv,
    blueprint.tracking.gaMeasurementIdEnv,
    blueprint.forms.formIdEnv,
    blueprint.forms.locationIdEnv,
  ].filter((k): k is string => Boolean(k));
  const publicKeys = Array.from(new Set(declared.filter((k) => k.startsWith('NEXT_PUBLIC_'))));
  const secretRefs = Array.from(new Set(declared.filter((k) => !k.startsWith('NEXT_PUBLIC_'))));

  const schemaFiles = blueprint.seo.schema ? ['app/layout.tsx (JSON-LD inline)'] : [];

  return {
    manifestVersion: ARTIFACT_MANIFEST_VERSION,
    generatedAt: new Date().toISOString(),
    businessSlug: blueprint.business.slug,
    productionId: blueprint.productionId,
    websiteProjectId: blueprint.websiteProjectId,
    blueprintVersion: blueprint.blueprintVersion,
    pages: blueprint.pages.map((p) => ({ path: p.path, pageType: p.pageType, title: p.title })),
    routes: renderManifest.pageRoutes.map((r) => r.path),
    assets: {
      copied,
      missing,
      failed,
      totals: {
        total: materialization.assets.length,
        copied: materialization.copied,
        missing: materialization.missing,
        failed: materialization.failed,
        totalBytes: materialization.totalBytes,
      },
    },
    env: { publicKeys, secretRefs },
    seo: {
      sitemapPath: blueprint.seo.sitemap ? 'app/sitemap.ts' : null,
      robotsPath: blueprint.seo.robotsTxt ? 'app/robots.ts' : 'app/robots.ts',
      schemaFiles,
    },
    package: {
      sourceRef: safePath(args.sourceRef) || args.sourceRef,
      outputRef: safePath(args.outputRef),
      fileCount: renderManifest.fileCount,
    },
    build: {
      command: args.buildCommand,
      executed: args.buildExecuted,
      result: args.buildResult,
    },
    warnings: [
      ...renderManifest.warnings,
      ...materialization.warnings,
      ...(args.extraWarnings || []),
    ],
  };
}
