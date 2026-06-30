/**
 * Phase 4 — deployment-target settings, env-var config, and dry-run plan.
 *
 * These tests exercise the PURE lib layer that the business-scoped API routes
 * delegate to (target-config, env-config, dry-run). They assert every Phase 4
 * hard invariant:
 *  - hostgator_static is the default target type; unknown types rejected.
 *  - WordPress export is optional and never the default.
 *  - Credentials are stored/returned as REFERENCE NAMES only; raw secret
 *    values are rejected and never serialized.
 *  - Public env vars allowed inline; secret-like public keys warned; secret
 *    values rejected (reference only).
 *  - Dry-run plan is pure/side-effect-free and never uploads or deletes.
 *  - Live deploy is disabled everywhere.
 *  - No hardcoded host/cPanel paths are injected.
 */

import {
  validateTargetInput,
  serializeTarget,
  TARGET_STATUSES,
  type TargetRow,
} from '@/lib/site-deploy/target-config';
import { validateEnvWrite, serializeEnvVar, type EnvRow } from '@/lib/site-deploy/env-config';
import { computeDryRunPlan, LIVE_DEPLOY_ENABLED } from '@/lib/site-deploy/dry-run';
import { DEFAULT_DEPLOYMENT_TARGET } from '@/lib/site-deploy/targets';
import type { ArtifactManifest } from '@/lib/site-builder/artifact-manifest';

// ── Fixtures ────────────────────────────────────────────────────────

// Assemble secret-looking values from fragments so the URL/secret auto-rewriter
// never substitutes a real credential into the source.
const FAKE_STRIPE_SECRET = 'sk_' + 'live_' + 'abc123def456ghi789';
const FAKE_GH_TOKEN = 'ghp_' + 'A'.repeat(36);
const FAKE_AWS_KEY = 'AKIA' + 'ABCDEFGHIJKLMNOP';

function baseTargetRow(over: Partial<TargetRow> = {}): TargetRow {
  return {
    id: 'tgt_1',
    businessId: 'biz_1',
    websiteProjectId: 'proj_1',
    targetType: 'hostgator_static',
    name: 'Primary',
    status: 'configured',
    domain: 'example.com',
    siteUrl: 'https://example.com',
    deployBasePath: 'public_html/example',
    gitRepoUrl: null,
    gitBranch: null,
    buildCommand: null,
    outputDirectory: 'out',
    cloudflareZoneId: null,
    hostgatorHostRef: 'hg-host-ref',
    vercelProjectId: null,
    wordpressSiteUrl: null,
    credentialsRef: 'vault/hostgator/example',
    configJson: { lastVerifiedAt: '2026-06-01T00:00:00.000Z' },
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    ...over,
  };
}

function baseManifest(over: Partial<ArtifactManifest> = {}): ArtifactManifest {
  return {
    manifestVersion: 1,
    generatedAt: '2026-06-01T00:00:00.000Z',
    businessSlug: 'example',
    productionId: 'prod_1',
    websiteProjectId: 'proj_1',
    blueprintVersion: 1,
    pages: [{ path: '/', pageType: 'home', title: 'Home' }],
    routes: ['/', '/about'],
    assets: {
      copied: [
        { assetId: 'a1', assetType: 'image', webPath: '/img/logo.png', localPath: 'img/logo.png', status: 'copied' as any, bytes: 1024, sourceKind: 'generated' as any },
      ],
      missing: [],
      failed: [],
      totals: { total: 1, copied: 1, missing: 0, failed: 0, totalBytes: 1024 },
    },
    env: { publicKeys: ['NEXT_PUBLIC_SITE_URL'], secretRefs: ['vault/api'] },
    seo: { sitemapPath: 'sitemap.xml', robotsPath: 'robots.txt', schemaFiles: [] },
    package: { sourceRef: 'src_1', outputRef: 'out_1', fileCount: 3 },
    build: { command: 'next build', executed: false, result: 'artifact_only' },
    warnings: [],
    ...over,
  };
}

// ── Target type / defaults ──────────────────────────────────────────

describe('deployment target — type & defaults', () => {
  it('defaults to hostgator_static on create when no type given', () => {
    const r = validateTargetInput({}, { isCreate: true });
    expect(r.ok).toBe(true);
    expect(r.data.targetType).toBe('hostgator_static');
    expect(DEFAULT_DEPLOYMENT_TARGET).toBe('hostgator_static');
  });

  it('accepts a HostGator static target without any hardcoded host path', () => {
    const r = validateTargetInput(
      { targetType: 'hostgator_static', name: 'HG', domain: 'shop.example.com' },
      { isCreate: true },
    );
    expect(r.ok).toBe(true);
    // No cPanel/home path is ever invented by our code.
    expect(r.data.deployBasePath ?? null).toBeNull();
    expect(JSON.stringify(r.data)).not.toMatch(/\/home\/|public_html\/(?!example)|cpanel/i);
  });

  it('rejects an unsupported target type', () => {
    const r = validateTargetInput({ targetType: 'ftp_yolo' }, { isCreate: true });
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/unsupported target type/i);
  });

  it('treats wordpress_export as optional and never the default', () => {
    expect(DEFAULT_DEPLOYMENT_TARGET).not.toBe('wordpress_export');
    const r = validateTargetInput({ targetType: 'wordpress_export', wordpressSiteUrl: 'https://wp.example.com' }, { isCreate: true });
    expect(r.ok).toBe(true);
    expect(r.data.targetType).toBe('wordpress_export');
  });

  it('rejects an unsupported status and never enables live deploy', () => {
    const r = validateTargetInput({ status: 'deploying_live' }, { isCreate: false });
    expect(r.ok).toBe(false);
    expect(TARGET_STATUSES).not.toContain('deploying_live' as any);
  });
});

// ── Credential reference safety ─────────────────────────────────────

describe('deployment target — credential reference safety', () => {
  it('rejects a raw secret value placed in credentialsRef (reference required)', () => {
    const r = validateTargetInput({ credentialsRef: FAKE_STRIPE_SECRET }, { isCreate: true });
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/reference/i);
  });

  it('rejects a raw token in hostgatorHostRef', () => {
    const r = validateTargetInput({ hostgatorHostRef: FAKE_GH_TOKEN }, { isCreate: true });
    expect(r.ok).toBe(false);
  });

  it('accepts a credential REFERENCE NAME', () => {
    const r = validateTargetInput({ credentialsRef: 'vault/hostgator/main' }, { isCreate: true });
    expect(r.ok).toBe(true);
    expect(r.data.credentialsRef).toBe('vault/hostgator/main');
  });

  it('serializeTarget returns the reference NAME + configured flag, never a secret', () => {
    const out = serializeTarget(baseTargetRow());
    expect(out.credentialsRef).toBe('vault/hostgator/example');
    expect(out.credentialConfigured).toBe(true);
    expect(out.lastVerifiedAt).toBe('2026-06-01T00:00:00.000Z');
    expect(out.liveDeployEnabled).toBe(false);
    // Never leaks an actual secret value.
    const blob = JSON.stringify(out);
    expect(blob).not.toContain('sk_live');
    expect(blob).not.toMatch(/ghp_|AKIA|BEGIN [A-Z ]*PRIVATE KEY/);
  });

  it('serializeTarget reports credentialConfigured=false when no ref', () => {
    const out = serializeTarget(baseTargetRow({ credentialsRef: null }));
    expect(out.credentialConfigured).toBe(false);
    expect(out.credentialsRef).toBeNull();
  });
});

// ── Environment variables ───────────────────────────────────────────

describe('site environment variables', () => {
  it('allows a public NEXT_PUBLIC_* variable inline', () => {
    const r = validateEnvWrite({ key: 'NEXT_PUBLIC_SITE_URL', value: 'https://example.com' });
    expect(r.ok).toBe(true);
    expect(r.data!.isPublic).toBe(true);
    expect(r.data!.isSecret).toBe(false);
    expect(r.data!.valueRef).toBe('https://example.com');
  });

  it('warns when a public key name looks secret-like', () => {
    const r = validateEnvWrite({ key: 'NEXT_PUBLIC_API_KEY', value: 'pk_public_123' });
    expect(r.warnings.join(' ')).toMatch(/secret/i);
  });

  it('rejects a secret VALUE under a public key', () => {
    const r = validateEnvWrite({ key: 'NEXT_PUBLIC_TODO', value: FAKE_STRIPE_SECRET });
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/secret/i);
  });

  it('stores a secret variable by reference only', () => {
    const r = validateEnvWrite({ key: 'STRIPE_SECRET_KEY', valueRef: 'vault/stripe/secret' });
    expect(r.ok).toBe(true);
    expect(r.data!.isSecret).toBe(true);
    expect(r.data!.valueRef).toBe('vault/stripe/secret');
  });

  it('rejects a raw secret value for a secret variable', () => {
    const r = validateEnvWrite({ key: 'STRIPE_SECRET_KEY', value: FAKE_STRIPE_SECRET });
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/vault|reference/i);
  });

  it('rejects an invalid key', () => {
    const r = validateEnvWrite({ key: 'bad key!' });
    expect(r.ok).toBe(false);
  });

  it('serializeEnvVar returns inline value for public, ref-only for secret, never a secret value', () => {
    const pub: EnvRow = { id: 'e1', key: 'NEXT_PUBLIC_SITE_URL', valueRef: 'https://example.com', isPublic: true, isSecret: false, environment: 'production', deploymentTargetId: null, createdAt: 't', updatedAt: 't' };
    const sec: EnvRow = { id: 'e2', key: 'STRIPE_SECRET_KEY', valueRef: 'vault/stripe/secret', isPublic: false, isSecret: true, environment: 'production', deploymentTargetId: null, createdAt: 't', updatedAt: 't' };
    const po = serializeEnvVar(pub);
    const so = serializeEnvVar(sec);
    expect(po.value).toBe('https://example.com');
    expect(po.valueRef).toBeNull();
    expect(so.value).toBeNull();
    expect(so.valueRef).toBe('vault/stripe/secret');
    expect(JSON.stringify(so)).not.toMatch(/sk_live|ghp_|AKIA/);
  });
});

// ── Dry-run plan ────────────────────────────────────────────────────

describe('dry-run deployment plan', () => {
  it('computes a plan for a configured target with a manifest', () => {
    const plan = computeDryRunPlan({
      target: { targetType: 'hostgator_static', domain: 'example.com', deployBasePath: 'public_html/example', credentialsRef: 'vault/hg' },
      manifest: baseManifest(),
    });
    expect(plan.mode).toBe('dry_run');
    expect(plan.liveDeployEnabled).toBe(false);
    expect(plan.fileCount).toBeGreaterThan(0);
    // Routes -> index.html + copied asset.
    const paths = plan.wouldUpload.map((f) => f.path);
    expect(paths).toContain('index.html');
    expect(paths).toContain('about/index.html');
    expect(paths).toContain('img/logo.png');
    // Remote path derives only from configured base — no invented host path.
    expect(plan.remotePath).toBe('public_html/example');
    expect(plan.wouldDelete).toEqual([]);
  });

  it('diffs against a previous manifest to list wouldDelete (without deleting)', () => {
    const previous = baseManifest({ routes: ['/', '/about', '/old'] });
    const current = baseManifest({ routes: ['/', '/about'] });
    const plan = computeDryRunPlan({
      target: { targetType: 'hostgator_static', domain: 'example.com', deployBasePath: 'public_html/example', credentialsRef: 'vault/hg' },
      manifest: current,
      previousManifest: previous,
    });
    const del = plan.wouldDelete.map((f) => f.path);
    expect(del).toContain('old/index.html');
  });

  it('warns (does not throw) when target config is incomplete', () => {
    const plan = computeDryRunPlan({
      target: { targetType: 'hostgator_static' },
      manifest: baseManifest(),
    });
    expect(plan.warnings.join(' ')).toMatch(/domain|deployBasePath|credentialsRef/i);
    // Placeholder remote path; never a hardcoded host directory.
    expect(plan.remotePath).not.toMatch(/\/home\/|cpanel/i);
  });

  it('LIVE_DEPLOY_ENABLED is false and the note states no upload happened', () => {
    expect(LIVE_DEPLOY_ENABLED).toBe(false);
    const plan = computeDryRunPlan({ target: { targetType: 'hostgator_static' }, manifest: baseManifest() });
    expect(plan.note).toMatch(/no files were uploaded or deleted/i);
  });
});
