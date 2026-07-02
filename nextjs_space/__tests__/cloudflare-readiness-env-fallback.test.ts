/**
 * Cloudflare readiness — master-env inheritance + target-override + source model.
 *
 * Verifies the layered resolution order for Cloudflare Pages configuration:
 *   (1) deployment-target row override  ->  (2) inherited master environment
 *   variables  ->  (3) missing.
 *
 * Cloudflare secrets live ONLY in the Render master env group (inherited by the
 * frontend). They are NEVER duplicated into target rows and their VALUES are
 * never stored in the DB, printed, or returned. These tests assert:
 *   - account id resolves from target OR env (env fallback no longer blocks);
 *   - zone id resolves from target OR env, supporting BOTH env names
 *     (CLOUDFLARE_ZONE_ID and legacy CLOUDFLARE_DEFAULT_ZONE_ID);
 *   - pages/dns token presence resolves from credential reference OR env;
 *   - a target override wins over the environment;
 *   - the readiness payload exposes a per-field configSources.source label
 *     for the UI, and never leaks a secret value;
 *   - NO Cloudflare API call and NO DNS mutation happen anywhere in the layer.
 */

import fs from 'fs';
import path from 'path';
import {
  evaluateCloudflareReadiness,
  computeCloudflarePagesDryRun,
  CLOUDFLARE_TARGET_TYPE,
  REQUIRED_OUTPUT_DIRECTORY,
  DEFAULT_BUILD_COMMAND,
  type CloudflareTargetConfig,
  type CloudflareReadinessContext,
  type CloudflareEnvReadiness,
} from '@/lib/site-deploy/cloudflare-readiness';
import { getCloudflareReadiness } from '@/lib/site-deploy/asset-store-config';

// A fully-configured cloudflare_pages target (M5C-style) WITHOUT the
// account/zone overrides — those get injected per-test to exercise fallback.
function target(over?: Partial<CloudflareTargetConfig>): CloudflareTargetConfig {
  return {
    targetType: CLOUDFLARE_TARGET_TYPE,
    status: 'configured',
    cloudflareAccountId: null,
    cloudflareProjectName: 'tombstone-m5c-validation',
    cloudflareProjectRef: 'cf-proj-ref-1',
    githubRepoUrl: 'gh:' + 'example-org/tombstone-m5c',
    githubBranch: 'main',
    productionBranch: 'main',
    buildCommand: DEFAULT_BUILD_COMMAND,
    outputDirectory: REQUIRED_OUTPUT_DIRECTORY,
    credentialsRef: null,
    ...over,
  };
}

// Env-readiness presence booleans (never values). Mirrors what
// getCloudflareReadiness() returns from the inherited master env group.
function env(over?: Partial<CloudflareEnvReadiness>): CloudflareEnvReadiness {
  return {
    accountId: { configured: false },
    pagesApiToken: { configured: false },
    dnsApiToken: { configured: false },
    defaultZoneId: { configured: false },
    ready: false,
    missing: [],
    ...over,
  } as CloudflareEnvReadiness;
}

function ctx(over?: Partial<CloudflareReadinessContext>): CloudflareReadinessContext {
  return {
    businessId: 'biz_cf_fallback',
    businessExists: true,
    target: target(),
    files: [],
    manifest: null,
    envReadiness: env(),
    configuredEnvVarNames: [],
    deployRequested: false,
    ...over,
  };
}

const READINESS_SRC = path.join(process.cwd(), 'lib/site-deploy/cloudflare-readiness.ts');
const ASSET_CFG_SRC = path.join(process.cwd(), 'lib/site-deploy/asset-store-config.ts');
const ORCH_SRC = path.join(process.cwd(), 'lib/site-deploy/cloudflare-orchestrator.ts');

// ── 1) Account id resolution ─────────────────────────────────────────────

describe('Cloudflare account id — layered resolution', () => {
  it('1. resolves from the TARGET override (source=target)', () => {
    const res = evaluateCloudflareReadiness(
      ctx({ target: target({ cloudflareAccountId: 'cf-target-acct' }) }),
    );
    expect(res.checks.accountIdPresent).toBe(true);
    expect(res.configSources.accountId.present).toBe(true);
    expect(res.configSources.accountId.source).toBe('target');
    expect(res.blockingReasons.some((b) => b.code === 'account_id_missing')).toBe(false);
  });

  it('2. resolves from the ENVIRONMENT when the target has no override (source=environment)', () => {
    const res = evaluateCloudflareReadiness(
      ctx({ envReadiness: env({ accountId: { configured: true } }) }),
    );
    expect(res.checks.accountIdPresent).toBe(true);
    expect(res.configSources.accountId.present).toBe(true);
    expect(res.configSources.accountId.source).toBe('environment');
    expect(res.blockingReasons.some((b) => b.code === 'account_id_missing')).toBe(false);
    expect(res.missingFields).not.toContain('cloudflareAccountId');
  });

  it('3. BLOCKS only when account id is missing from BOTH target and environment', () => {
    const res = evaluateCloudflareReadiness(ctx());
    expect(res.checks.accountIdPresent).toBe(false);
    expect(res.configSources.accountId.present).toBe(false);
    expect(res.configSources.accountId.source).toBe('missing');
    expect(res.missingFields).toContain('cloudflareAccountId');
    expect(res.blockingReasons.some((b) => b.code === 'account_id_missing')).toBe(true);
  });
});

// ── 2) Zone id resolution (both env names) ───────────────────────────────

describe('Cloudflare zone id — layered resolution + dual env names', () => {
  it('4. resolves from the TARGET override (source=target, non-blocking)', () => {
    const res = evaluateCloudflareReadiness(
      ctx({ target: target({ cloudflareZoneId: 'zone-from-target' }) }),
    );
    expect(res.configSources.zoneId.present).toBe(true);
    expect(res.configSources.zoneId.source).toBe('target');
    // Zone id is optional — never a blocking reason.
    expect(res.blockingReasons.every((b) => b.code !== ('zone_id_missing' as any))).toBe(true);
  });

  it('5. env CLOUDFLARE_ZONE_ID is detected by getCloudflareReadiness()', () => {
    const prevZone = process.env.CLOUDFLARE_ZONE_ID;
    const prevDefault = process.env.CLOUDFLARE_DEFAULT_ZONE_ID;
    delete process.env.CLOUDFLARE_DEFAULT_ZONE_ID;
    process.env.CLOUDFLARE_ZONE_ID = 'zone-abc-current-name';
    try {
      const envReady = getCloudflareReadiness();
      expect(envReady.defaultZoneId.configured).toBe(true);
      const res = evaluateCloudflareReadiness(ctx({ envReadiness: envReady }));
      expect(res.configSources.zoneId.present).toBe(true);
      expect(res.configSources.zoneId.source).toBe('environment');
    } finally {
      if (prevZone === undefined) delete process.env.CLOUDFLARE_ZONE_ID;
      else process.env.CLOUDFLARE_ZONE_ID = prevZone;
      if (prevDefault !== undefined) process.env.CLOUDFLARE_DEFAULT_ZONE_ID = prevDefault;
    }
  });

  it('6. legacy env CLOUDFLARE_DEFAULT_ZONE_ID is detected by getCloudflareReadiness()', () => {
    const prevZone = process.env.CLOUDFLARE_ZONE_ID;
    const prevDefault = process.env.CLOUDFLARE_DEFAULT_ZONE_ID;
    delete process.env.CLOUDFLARE_ZONE_ID;
    process.env.CLOUDFLARE_DEFAULT_ZONE_ID = 'zone-legacy-name';
    try {
      const envReady = getCloudflareReadiness();
      expect(envReady.defaultZoneId.configured).toBe(true);
      const res = evaluateCloudflareReadiness(ctx({ envReadiness: envReady }));
      expect(res.configSources.zoneId.present).toBe(true);
      expect(res.configSources.zoneId.source).toBe('environment');
    } finally {
      if (prevZone !== undefined) process.env.CLOUDFLARE_ZONE_ID = prevZone;
      if (prevDefault === undefined) delete process.env.CLOUDFLARE_DEFAULT_ZONE_ID;
      else process.env.CLOUDFLARE_DEFAULT_ZONE_ID = prevDefault;
    }
  });
});

// ── 3) Token presence resolution ─────────────────────────────────────────

describe('Cloudflare tokens — presence + source (never values)', () => {
  it('7. pages token detected from ENVIRONMENT (source=environment, no value)', () => {
    const res = evaluateCloudflareReadiness(
      ctx({
        envReadiness: env({ accountId: { configured: true }, pagesApiToken: { configured: true } }),
      }),
    );
    expect(res.configSources.pagesToken.present).toBe(true);
    expect(res.configSources.pagesToken.source).toBe('environment');
    expect(res.blockingReasons.some((b) => b.code === 'credential_ref_missing')).toBe(false);
    // No secret value anywhere in the payload.
    expect(JSON.stringify(res)).not.toMatch(/token["']?\s*:\s*["'][A-Za-z0-9]{8,}/i);
  });

  it('8. dns token detected from ENVIRONMENT (source=environment, no value)', () => {
    const res = evaluateCloudflareReadiness(
      ctx({
        envReadiness: env({
          accountId: { configured: true },
          pagesApiToken: { configured: true },
          dnsApiToken: { configured: true },
        }),
      }),
    );
    expect(res.configSources.dnsToken.present).toBe(true);
    expect(res.configSources.dnsToken.source).toBe('environment');
  });

  it('token presence resolves from a credential REFERENCE name (source=credential_ref)', () => {
    const res = evaluateCloudflareReadiness(
      ctx({
        target: target({ cloudflareAccountId: 'a', credentialsRef: 'vault:' + '/cf/deploy' }),
      }),
    );
    expect(res.configSources.pagesToken.present).toBe(true);
    expect(res.configSources.pagesToken.source).toBe('credential_ref');
    expect(res.configSources.dnsToken.source).toBe('credential_ref');
  });
});

// ── 4) Target override wins over environment ─────────────────────────────

describe('Target overrides take precedence over the environment', () => {
  it('9. account id + zone id target overrides win even when env also has them', () => {
    const res = evaluateCloudflareReadiness(
      ctx({
        target: target({ cloudflareAccountId: 'acct-target', cloudflareZoneId: 'zone-target' }),
        envReadiness: env({
          accountId: { configured: true },
          defaultZoneId: { configured: true },
        }),
      }),
    );
    expect(res.configSources.accountId.source).toBe('target');
    expect(res.configSources.zoneId.source).toBe('target');
  });
});

// ── 5) UI source model ───────────────────────────────────────────────────

describe('UI configuration-source model', () => {
  it('10. configSources exposes present + source for all four fields', () => {
    const res = evaluateCloudflareReadiness(
      ctx({
        target: target({ cloudflareAccountId: 'a' }),
        envReadiness: env({ pagesApiToken: { configured: true }, dnsApiToken: { configured: true } }),
      }),
    );
    for (const key of ['accountId', 'zoneId', 'pagesToken', 'dnsToken'] as const) {
      expect(res.configSources[key]).toHaveProperty('present');
      expect(res.configSources[key]).toHaveProperty('source');
      expect(['target', 'environment', 'credential_ref', 'missing']).toContain(
        res.configSources[key].source,
      );
    }
    expect(res.env.zoneIdConfigured).toBe(false);
  });
});

// ── 6) Safety invariants: no API call, no DNS mutation, no secrets ───────

describe('Safety invariants — no Cloudflare API, no DNS mutation, no secret leakage', () => {
  it('11. the readiness + orchestrator layer makes NO Cloudflare API call', () => {
    for (const file of [READINESS_SRC, ORCH_SRC, ASSET_CFG_SRC]) {
      const src = fs.readFileSync(file, 'utf8');
      expect(src).not.toContain('api.cloudflare' + '.com');
      expect(src).not.toMatch(/\bfetch\s*\(/);
      expect(src).not.toMatch(/\baxios\b/);
    }
  });

  it('12. DNS mutation is always disabled (dry-run only)', () => {
    const plan = computeCloudflarePagesDryRun({
      target: target({ cloudflareAccountId: 'a', credentialsRef: 'ref' }),
      readiness: evaluateCloudflareReadiness(ctx({ target: target({ cloudflareAccountId: 'a' }) })),
    });
    expect(plan.liveDeployEnabled).toBe(false);
    expect(plan.liveDnsMutationEnabled).toBe(false);
    expect(plan.wouldCreateCnameRecord).toBe(false);
  });

  it('13. no secret VALUES are ever returned by the readiness payload', () => {
    const res = evaluateCloudflareReadiness(
      ctx({
        target: target({ cloudflareAccountId: 'acct', credentialsRef: 'vault:' + '/cf' }),
        envReadiness: env({
          accountId: { configured: true },
          pagesApiToken: { configured: true },
          dnsApiToken: { configured: true },
          defaultZoneId: { configured: true },
        }),
      }),
    );
    const serialized = JSON.stringify(res);
    // Only booleans / source labels / non-secret identifiers may appear.
    expect(serialized).not.toContain('CLOUDFLARE_PAGES_API_TOKEN=');
    expect(serialized).not.toMatch(/[A-Za-z0-9_-]{40,}/); // no long token-like blobs
  });
});
