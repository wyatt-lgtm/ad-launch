/**
 * Phase 3 — TypeScript deploy dry-run planner.
 *
 * Mirrors the backend HostGator dry-run (integrations/site_publishers/
 * static_deploy_adapters.py) so the inspection UI can render a deploy plan
 * directly from a persisted artifact manifest + a SiteDeploymentTarget row,
 * without a backend round-trip.
 *
 * HARD RULES (identical to the backend boundary):
 *  - Pure + side-effect free: never uploads, deletes, or touches a host.
 *  - liveDeployEnabled is ALWAYS false in this phase.
 *  - Never reads or emits secret values. credentialsRef is referenced by NAME
 *    only; its stored value is never read here.
 *  - The remote path is derived ONLY from the configured deployBasePath — no
 *    hardcoded cPanel/home directories are ever invented.
 */

import type { ArtifactManifest } from '@/lib/site-builder/artifact-manifest';

/** Live deploy is globally disabled this phase (matches the backend flag). */
export const LIVE_DEPLOY_ENABLED = false;

export interface DeployTargetConfig {
  targetType: string;
  domain?: string | null;
  siteUrl?: string | null;
  deployBasePath?: string | null;
  /** Reference NAME only — never the secret value. */
  credentialsRef?: string | null;
}

export interface DryRunFile {
  path: string;
  remotePath: string;
  size: number;
}

export interface DryRunPlan {
  targetType: string;
  mode: 'dry_run';
  liveDeployEnabled: false;
  remotePath: string;
  fileCount: number;
  totalSize: number;
  wouldUpload: DryRunFile[];
  wouldDelete: DryRunFile[];
  warnings: string[];
  note: string;
}

function joinRemote(base: string, rel: string): string {
  const hasBase = Boolean(base) && !base.startsWith('<');
  if (!hasBase) return rel;
  return `${base.replace(/\/+$/, '')}/${rel.replace(/^\/+/, '')}`;
}

/**
 * Flatten an artifact manifest into the set of files a deploy WOULD upload,
 * keyed by package-relative path. Only structural, non-secret fields are read
 * (routes + copied asset local paths). Missing/failed assets are excluded.
 */
function manifestFiles(
  manifest: ArtifactManifest | null | undefined,
  remotePath: string,
): Map<string, DryRunFile> {
  const files = new Map<string, DryRunFile>();
  if (!manifest) return files;

  const add = (rawRel: string | null | undefined, size = 0) => {
    if (!rawRel) return;
    const rel = String(rawRel).replace(/^\/+/, '');
    if (!rel || files.has(rel)) return;
    files.set(rel, { path: rel, remotePath: joinRemote(remotePath, rel), size: size || 0 });
  };

  // Routes -> emitted static HTML files (index.html under the route dir).
  for (const route of manifest.routes || []) {
    const clean = String(route).replace(/^\/+/, '');
    const outputFile = clean === '' ? 'index.html' : `${clean.replace(/\/+$/, '')}/index.html`;
    add(outputFile);
  }
  // Copied assets -> local files under the package.
  for (const a of manifest.assets?.copied || []) {
    add(a.localPath, a.bytes);
  }
  return files;
}

/**
 * Compute a side-effect-free deploy plan from a persisted artifact manifest and
 * a deployment-target config. Optionally diffs against a previous manifest to
 * surface files that WOULD be deleted (never actually deleted).
 */
export function computeDryRunPlan(args: {
  target: DeployTargetConfig;
  manifest: ArtifactManifest | null | undefined;
  previousManifest?: ArtifactManifest | null;
}): DryRunPlan {
  const { target, manifest, previousManifest } = args;
  const remotePath = target.deployBasePath || '<configured deploy directory>';

  const warnings: string[] = [];
  if (!target.domain) warnings.push('No domain configured for this deployment target.');
  if (!target.deployBasePath)
    warnings.push('No deployBasePath configured; remote path is a placeholder.');
  if (!target.credentialsRef)
    warnings.push('No credentialsRef configured (a live deploy would require it).');

  const current = manifestFiles(manifest, remotePath);
  if (manifest && current.size === 0)
    warnings.push('Artifact manifest lists no build output files.');
  if (!manifest) warnings.push('No artifact manifest available; plan describes intent only.');

  const previous = manifestFiles(previousManifest, remotePath);

  const wouldUpload = Array.from(current.values()).sort((a, b) => a.path.localeCompare(b.path));
  const wouldDelete = Array.from(previous.entries())
    .filter(([rel]) => !current.has(rel))
    .map(([, f]) => f)
    .sort((a, b) => a.path.localeCompare(b.path));

  const totalSize = wouldUpload.reduce((sum, f) => sum + (f.size || 0), 0);

  return {
    targetType: target.targetType,
    mode: 'dry_run',
    liveDeployEnabled: false,
    remotePath,
    fileCount: current.size,
    totalSize,
    wouldUpload,
    wouldDelete,
    warnings,
    note: 'Dry-run only. Deployment is disabled in this phase. No files were uploaded or deleted.',
  };
}
