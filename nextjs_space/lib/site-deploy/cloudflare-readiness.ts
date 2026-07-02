/**
 * Milestone 9 — Cloudflare Pages readiness gate + dry-run planner (PURE).
 *
 * Evaluates whether a Tombstone-generated static site is READY to be deployed to
 * Cloudflare Pages via a FUTURE, separately-approved milestone. This module is
 * pure / side-effect-free: it NEVER calls the Cloudflare API, NEVER creates or
 * connects a Pages project, NEVER mutates DNS, NEVER uploads / publishes /
 * deploys, and NEVER returns or embeds secret token values or signed URLs.
 *
 * Cloudflare Pages is the STRATEGIC deployment target for generated client
 * sites. The static pipeline is: Tombstone -> GitHub repo -> static Next.js
 * export (`output: 'export'`, `images.unoptimized`) -> Cloudflare Pages
 * (build command `npm run build`, output directory `out`, production branch
 * `main`).
 *
 * Credentials are handled as REFERENCES ONLY. The gate surfaces presence
 * booleans (account id present, credential ref present, Pages token configured
 * in env, ...) but never a token value.
 *
 * liveDeployEnabled is ALWAYS false in this milestone.
 */

import type { RenderedFile } from '@/lib/site-renderer';
import type { ArtifactManifest } from '@/lib/site-builder/artifact-manifest';
import { containsSignedUrl, containsSecret } from '@/lib/site-qa/mobile-qa';

export const CLOUDFLARE_TARGET_TYPE = 'cloudflare_pages';
export const REQUIRED_OUTPUT_DIRECTORY = 'out';
export const DEFAULT_BUILD_COMMAND = 'npm run build';
export const DEFAULT_PRODUCTION_BRANCH = 'main';

/** Public env vars a Cloudflare Pages project should have configured. */
export const EXPECTED_PUBLIC_ENV_VARS = [
  'NEXT_PUBLIC_SITE_URL',
  'NEXT_PUBLIC_GHL_FORM_ID',
  'NEXT_PUBLIC_GHL_LOCATION_ID',
  'NEXT_PUBLIC_GA_MEASUREMENT_ID',
] as const;

// ── Types ───────────────────────────────────────────────────────────────

/** Cloudflare-pages-relevant view of a SiteDeploymentTarget row. */
export interface CloudflareTargetConfig {
  targetType: string;
  status?: string | null;
  cloudflareAccountId?: string | null;
  cloudflareZoneId?: string | null;
  cloudflareProjectName?: string | null;
  cloudflareProjectRef?: string | null;
  /** Preferred GitHub fields; falls back to the generic git* columns. */
  githubRepoUrl?: string | null;
  githubBranch?: string | null;
  gitRepoUrl?: string | null;
  gitBranch?: string | null;
  productionBranch?: string | null;
  previewBranch?: string | null;
  previewSubdomain?: string | null;
  buildCommand?: string | null;
  outputDirectory?: string | null;
  customDomain?: string | null;
  domain?: string | null;
  cnameName?: string | null;
  cnameTarget?: string | null;
  customDomainStatus?: string | null;
  dnsRecordStatus?: string | null;
  dnsMode?: string | null;
  credentialsRef?: string | null;
}

/** Env-token presence booleans (from asset-store-config.getCloudflareReadiness). */
export interface CloudflareEnvReadiness {
  accountId: { configured: boolean };
  pagesApiToken: { configured: boolean };
  dnsApiToken: { configured: boolean };
  defaultZoneId: { configured: boolean };
  ready: boolean;
  missing: string[];
}

export interface CloudflareReadinessContext {
  businessId: string;
  businessExists: boolean;
  target: CloudflareTargetConfig | null;
  /** Re-rendered static package files (may be empty when render failed). */
  files: RenderedFile[];
  manifest: ArtifactManifest | null;
  /** Env-token presence booleans (never values). */
  envReadiness?: CloudflareEnvReadiness | null;
  /** Names of NEXT_PUBLIC_* env vars configured for the project (names only). */
  configuredEnvVarNames?: string[];
  /** Caller must pass true ONLY if a live deploy/publish was requested. */
  deployRequested?: boolean;
}

export type CloudflareReadinessCode =
  | 'business_missing'
  | 'not_cloudflare_target'
  | 'account_id_missing'
  | 'project_name_missing'
  | 'repo_url_missing'
  | 'branch_missing'
  | 'build_command_missing'
  | 'output_directory_invalid'
  | 'credential_ref_missing'
  | 'env_vars_missing'
  | 'package_next_config_missing'
  | 'package_not_static_export'
  | 'package_json_missing'
  | 'package_cannot_build_out'
  | 'signed_url_embedded'
  | 'secret_embedded'
  | 'images_not_local'
  | 'live_deploy_not_disabled'
  | 'deploy_requested';

export interface CloudflareReadinessIssue {
  code: CloudflareReadinessCode;
  message: string;
}

export interface CloudflareReadinessChecks {
  isCloudflareTarget: boolean;
  accountIdPresent: boolean;
  projectNamePresent: boolean;
  repoUrlPresent: boolean;
  branchPresent: boolean;
  buildCommandPresent: boolean;
  outputDirectoryValid: boolean;
  credentialRefPresent: boolean;
  envVarsConfigured: boolean;
  packageHasNextConfig: boolean;
  packageIsStaticExport: boolean;
  packageHasPackageJson: boolean;
  packageBuildsToOut: boolean;
  noSignedUrls: boolean;
  noSecretsEmbedded: boolean;
  imagesLocal: boolean;
  dryRunPlanAvailable: boolean;
  liveDeployDisabled: boolean;
}

export type CustomDomainMode = 'subdomain' | 'apex' | 'none';

export interface CustomDomainReadiness {
  customDomain: string | null;
  previewSubdomain: string | null;
  mode: CustomDomainMode;
  /** The default early-preview URL host (`<project>.pages.dev`). */
  pagesDevHost: string | null;
  /** CNAME record that WOULD be created/verified for a branded subdomain. */
  cnameName: string | null;
  cnameTarget: string | null;
  customDomainStatus: string | null;
  dnsRecordStatus: string | null;
  /** Requirements the operator must satisfy manually (no DNS changes here). */
  requirements: string[];
  notes: string[];
  /** DNS mutation is NEVER performed in this milestone. */
  liveDnsMutationEnabled: false;
}

export type CloudflareReadinessStatus = 'ready' | 'incomplete' | 'blocked';

/**
 * Where a piece of Cloudflare config was resolved from. `target` = a
 * deployment-target-row override; `environment` = an inherited (master) env var;
 * `credential_ref` = a stored credential reference NAME (never a value);
 * `missing` = neither present.
 */
export type CloudflareConfigSource = 'target' | 'environment' | 'credential_ref' | 'missing';

export interface CloudflareConfigResolution {
  present: boolean;
  source: CloudflareConfigSource;
}

/** Resolved config with its source (no secret values — presence + source only). */
export interface CloudflareConfigSources {
  accountId: CloudflareConfigResolution;
  zoneId: CloudflareConfigResolution;
  pagesToken: CloudflareConfigResolution;
  dnsToken: CloudflareConfigResolution;
}

export interface CloudflareReadinessResult {
  status: CloudflareReadinessStatus;
  /** Recommended targetStatus (never deploys): configured | verified | draft. */
  recommendedTargetStatus: 'draft' | 'configured' | 'verified';
  ready: boolean;
  checks: CloudflareReadinessChecks;
  missingFields: string[];
  blockingReasons: CloudflareReadinessIssue[];
  warnings: string[];
  customDomain: CustomDomainReadiness;
  env: {
    accountTokenConfigured: boolean;
    pagesTokenConfigured: boolean;
    dnsTokenConfigured: boolean;
    zoneIdConfigured: boolean;
    expectedPublicEnvVars: string[];
    configuredEnvVarNames: string[];
  };
  /** Resolved config + source (target row / environment / credential_ref). */
  configSources: CloudflareConfigSources;
  refs: {
    businessId: string;
    targetType: string | null;
    projectName: string | null;
    repoUrl: string | null;
    branch: string | null;
    buildCommand: string | null;
    outputDirectory: string | null;
    routeCount: number;
    materializedImageCount: number;
  };
  liveDeployEnabled: false;
  liveDnsMutationEnabled: false;
}

// ── Helpers ─────────────────────────────────────────────────────────────

function present(v: unknown): boolean {
  return typeof v === 'string' && v.trim().length > 0;
}

export function resolveRepoUrl(t: CloudflareTargetConfig | null): string | null {
  if (!t) return null;
  return (t.githubRepoUrl && t.githubRepoUrl.trim()) || (t.gitRepoUrl && t.gitRepoUrl.trim()) || null;
}

export function resolveBranch(t: CloudflareTargetConfig | null): string | null {
  if (!t) return null;
  return (
    (t.githubBranch && t.githubBranch.trim()) ||
    (t.productionBranch && t.productionBranch.trim()) ||
    (t.gitBranch && t.gitBranch.trim()) ||
    null
  );
}

export function resolveBuildCommand(t: CloudflareTargetConfig | null): string | null {
  if (!t) return null;
  return (t.buildCommand && t.buildCommand.trim()) || null;
}

export function resolveOutputDirectory(t: CloudflareTargetConfig | null): string | null {
  if (!t) return null;
  return (t.outputDirectory && t.outputDirectory.trim()) || null;
}

export function resolveCustomDomain(t: CloudflareTargetConfig | null): string | null {
  if (!t) return null;
  return (t.customDomain && t.customDomain.trim()) || (t.domain && t.domain.trim()) || null;
}

export function resolvePreviewSubdomain(t: CloudflareTargetConfig | null): string | null {
  if (!t) return null;
  return (t.previewSubdomain && t.previewSubdomain.trim()) || null;
}

/** The default early-preview URL host on Cloudflare Pages (`<project>.pages.dev`). */
export function resolvePagesDevHost(t: CloudflareTargetConfig | null): string | null {
  const project = (t?.cloudflareProjectName && t.cloudflareProjectName.trim()) || null;
  return project ? `${project}.pages.dev` : null;
}

/**
 * The CNAME record NAME for a branded preview subdomain. Prefers an explicit
 * cnameName, else the custom domain / preview subdomain host.
 */
export function resolveCnameName(t: CloudflareTargetConfig | null): string | null {
  if (!t) return null;
  return (
    (t.cnameName && t.cnameName.trim()) ||
    resolveCustomDomain(t) ||
    resolvePreviewSubdomain(t) ||
    null
  );
}

/**
 * The CNAME record TARGET for a branded preview subdomain. Prefers an explicit
 * cnameTarget, else the Cloudflare Pages project target (`<project>.pages.dev`).
 */
export function resolveCnameTarget(t: CloudflareTargetConfig | null): string | null {
  if (!t) return null;
  return (t.cnameTarget && t.cnameTarget.trim()) || resolvePagesDevHost(t) || null;
}

/**
 * Classify a custom domain as apex vs subdomain. Heuristic only (no network):
 * a bare `example.com` (or a public-suffix style `example.co.uk`) is apex;
 * anything with an extra leading label (`test.example.com`) is a subdomain.
 */
export function classifyCustomDomain(
  domain: string | null,
  dnsMode?: string | null,
): CustomDomainMode {
  const explicit = (dnsMode || '').trim().toLowerCase();
  if (explicit === 'none') return 'none';
  if (explicit === 'apex' || explicit === 'subdomain') return explicit as CustomDomainMode;
  if (!domain) return 'none';
  const host = domain.replace(/^\*\./, '').trim().toLowerCase();
  const labels = host.split('.').filter(Boolean);
  const twoLevelTlds = new Set(['co.uk', 'com.au', 'co.nz', 'co.in', 'com.br']);
  const lastTwo = labels.slice(-2).join('.');
  const apexLabelCount = twoLevelTlds.has(lastTwo) ? 3 : 2;
  return labels.length <= apexLabelCount ? 'apex' : 'subdomain';
}

function buildCustomDomainReadiness(
  t: CloudflareTargetConfig | null,
): CustomDomainReadiness {
  const customDomain = resolveCustomDomain(t);
  const previewSubdomain = resolvePreviewSubdomain(t);
  const mode = classifyCustomDomain(customDomain, t?.dnsMode);
  const pagesDevHost = resolvePagesDevHost(t);
  const customDomainStatus = (t?.customDomainStatus && t.customDomainStatus.trim()) || null;
  const dnsRecordStatus = (t?.dnsRecordStatus && t.dnsRecordStatus.trim()) || null;
  const requirements: string[] = [];
  const notes: string[] = [];

  if (!customDomain || mode === 'none') {
    notes.push(
      `Default early preview uses the Cloudflare Pages URL${pagesDevHost ? ` (${pagesDevHost})` : ' (<project>.pages.dev)'}. No custom CNAME is required.`,
    );
    notes.push('No wildcard DNS / Pages routing is used. Each branded preview would be its own subdomain when configured later.');
    return {
      customDomain: customDomain || null,
      previewSubdomain: previewSubdomain || null,
      mode: 'none',
      pagesDevHost,
      cnameName: null,
      cnameTarget: null,
      customDomainStatus,
      dnsRecordStatus,
      requirements,
      notes,
      liveDnsMutationEnabled: false,
    };
  }

  const cnameName = resolveCnameName(t);
  const cnameTarget = resolveCnameTarget(t);

  if (mode === 'subdomain') {
    // The 5 explicit branded-subdomain readiness expectations.
    requirements.push('1) A Cloudflare Pages project exists (or would be created) for this site.');
    requirements.push(`2) The custom domain (${customDomain}) would be added to the Pages project.`);
    requirements.push(`3) A DNS CNAME record (${cnameName || customDomain}) would be created or verified.`);
    requirements.push(`4) The CNAME target points to the Pages project target (${cnameTarget || '<project>.pages.dev'}).`);
    requirements.push('5) No DNS mutation occurs during this milestone unless separately approved.');
    notes.push('Each branded preview subdomain is treated as its own Cloudflare Pages custom domain and its own DNS CNAME record.');
    notes.push('No wildcard DNS / Pages routing. No testsite.launchmarketing.com/customer-slug path routing.');
  } else {
    requirements.push('1) A Cloudflare Pages project exists (or would be created) for this site.');
    requirements.push('2) The apex domain is a zone in the SAME Cloudflare account as the Pages project.');
    requirements.push('3) The apex zone is active in Cloudflare (nameservers delegated).');
    requirements.push(`4) The apex domain (${customDomain}) would be added to the Pages project as a custom domain.`);
    requirements.push('5) No DNS mutation occurs during this milestone unless separately approved.');
    notes.push('Apex custom domains require the root domain to be a Cloudflare zone in the same account.');
  }

  return {
    customDomain,
    previewSubdomain: previewSubdomain || null,
    mode,
    pagesDevHost,
    cnameName,
    cnameTarget,
    customDomainStatus,
    dnsRecordStatus,
    requirements,
    notes,
    liveDnsMutationEnabled: false,
  };
}

function findNextConfig(files: RenderedFile[]): RenderedFile | undefined {
  return files.find((f) => f.path === 'next.config.js' || f.path.endsWith('/next.config.js'));
}

function isStaticExportConfig(content: string): boolean {
  const noComments = content.replace(/\/\/.*$/gm, '');
  const hasExport = /output\s*:\s*['"]export['"]/.test(noComments);
  return hasExport;
}

// ── Gate ────────────────────────────────────────────────────────────────

export function evaluateCloudflareReadiness(
  ctx: CloudflareReadinessContext,
): CloudflareReadinessResult {
  const blocking: CloudflareReadinessIssue[] = [];
  const warnings: string[] = [];
  const missingFields: string[] = [];
  const t = ctx.target;

  // 0) A live deploy / publish is NEVER allowed here.
  if (ctx.deployRequested) {
    blocking.push({
      code: 'deploy_requested',
      message:
        'Deploy/publish is disabled. Cloudflare Pages readiness is a dry-run gate only — it never deploys, publishes, or changes DNS.',
    });
  }

  // 1) Business must exist + be accessible.
  if (!ctx.businessExists) {
    blocking.push({ code: 'business_missing', message: `Business ${ctx.businessId} not found or not accessible.` });
  }

  // 2) Target type must be cloudflare_pages.
  const isCloudflareTarget = Boolean(t && t.targetType === CLOUDFLARE_TARGET_TYPE);
  if (!isCloudflareTarget) {
    blocking.push({
      code: 'not_cloudflare_target',
      message: `Target type must be "${CLOUDFLARE_TARGET_TYPE}" for Cloudflare Pages readiness.`,
    });
  }

  // 3) Cloudflare account id present. Resolve from the target-row override
  //    first, then fall back to the inherited (master) environment. Do NOT
  //    block on a null target row when the environment provides the value.
  const env = ctx.envReadiness || null;
  const accountIdFromTarget = present(t?.cloudflareAccountId);
  const accountIdFromEnv = Boolean(env?.accountId.configured);
  const accountId: CloudflareConfigResolution = accountIdFromTarget
    ? { present: true, source: 'target' }
    : accountIdFromEnv
      ? { present: true, source: 'environment' }
      : { present: false, source: 'missing' };
  const accountIdPresent = accountId.present;
  if (!accountIdPresent) {
    missingFields.push('cloudflareAccountId');
    blocking.push({
      code: 'account_id_missing',
      message:
        'Cloudflare account id is required (set a target override or the CLOUDFLARE_ACCOUNT_ID environment variable).',
    });
  }

  // 3b) Cloudflare zone id (optional). Resolve target override, then env
  //     (CLOUDFLARE_ZONE_ID or legacy CLOUDFLARE_DEFAULT_ZONE_ID). Non-blocking.
  const zoneIdFromTarget = present(t?.cloudflareZoneId);
  const zoneIdFromEnv = Boolean(env?.defaultZoneId.configured);
  const zoneId: CloudflareConfigResolution = zoneIdFromTarget
    ? { present: true, source: 'target' }
    : zoneIdFromEnv
      ? { present: true, source: 'environment' }
      : { present: false, source: 'missing' };

  // 4) Cloudflare Pages project name present.
  const projectNamePresent = present(t?.cloudflareProjectName);
  if (!projectNamePresent) {
    missingFields.push('cloudflareProjectName');
    blocking.push({ code: 'project_name_missing', message: 'Cloudflare Pages project name is required.' });
  }

  // 5) GitHub repo URL present.
  const repoUrl = resolveRepoUrl(t);
  const repoUrlPresent = present(repoUrl);
  if (!repoUrlPresent) {
    missingFields.push('githubRepoUrl');
    blocking.push({ code: 'repo_url_missing', message: 'GitHub repository URL is required.' });
  }

  // 6) Branch present.
  const branch = resolveBranch(t);
  const branchPresent = present(branch);
  if (!branchPresent) {
    missingFields.push('githubBranch');
    blocking.push({ code: 'branch_missing', message: 'A GitHub branch (production branch) is required.' });
  }

  // 7) Build command present.
  const buildCommand = resolveBuildCommand(t);
  const buildCommandPresent = present(buildCommand);
  if (!buildCommandPresent) {
    missingFields.push('buildCommand');
    blocking.push({ code: 'build_command_missing', message: `Build command is required (recommended: "${DEFAULT_BUILD_COMMAND}").` });
  }

  // 8) Output directory must be `out`.
  const outputDirectory = resolveOutputDirectory(t);
  const outputDirectoryValid = outputDirectory === REQUIRED_OUTPUT_DIRECTORY;
  if (!outputDirectoryValid) {
    missingFields.push('outputDirectory');
    blocking.push({
      code: 'output_directory_invalid',
      message: `Output directory must be "${REQUIRED_OUTPUT_DIRECTORY}" for a static Next.js export (got ${outputDirectory ? `"${outputDirectory}"` : 'none'}).`,
    });
  }

  // 9) Credential reference present. A stored credentialsRef (name only) OR an
  //    inherited environment token satisfies token readiness. Tokens are never
  //    read as values — presence + source only.
  const credentialRefPresent = present(t?.credentialsRef);
  const pagesTokenFromEnv = Boolean(env?.pagesApiToken.configured);
  const dnsTokenFromEnv = Boolean(env?.dnsApiToken.configured);
  const pagesToken: CloudflareConfigResolution = credentialRefPresent
    ? { present: true, source: 'credential_ref' }
    : pagesTokenFromEnv
      ? { present: true, source: 'environment' }
      : { present: false, source: 'missing' };
  const dnsToken: CloudflareConfigResolution = credentialRefPresent
    ? { present: true, source: 'credential_ref' }
    : dnsTokenFromEnv
      ? { present: true, source: 'environment' }
      : { present: false, source: 'missing' };
  if (!credentialRefPresent && !pagesTokenFromEnv) {
    missingFields.push('credentialsRef');
    blocking.push({
      code: 'credential_ref_missing',
      message:
        'A Cloudflare credential is required: set a credential REFERENCE name on the target, or the CLOUDFLARE_PAGES_API_TOKEN environment variable (never the token value).',
    });
  }

  // 10) Env vars configured or placeholders present in the package.
  const configuredEnvVarNames = (ctx.configuredEnvVarNames || []).filter(Boolean);
  const envExampleFile = ctx.files.find((f) => f.path === '.env.example' || f.path.endsWith('/.env.example'));
  const placeholdersPresent = Boolean(
    envExampleFile && EXPECTED_PUBLIC_ENV_VARS.every((k) => envExampleFile.content.includes(k)),
  );
  const envVarsConfigured = placeholdersPresent || configuredEnvVarNames.length > 0;
  if (!envVarsConfigured) {
    blocking.push({
      code: 'env_vars_missing',
      message: 'Public env vars are not configured and no .env.example placeholders were found in the package.',
    });
  }

  // 11) Package must contain next.config.js.
  const nextConfigFile = findNextConfig(ctx.files);
  const packageHasNextConfig = Boolean(nextConfigFile);
  if (ctx.files.length > 0 && !packageHasNextConfig) {
    blocking.push({ code: 'package_next_config_missing', message: 'The static package has no next.config.js.' });
  }

  // 12) Package must use static export.
  const packageIsStaticExport = Boolean(nextConfigFile && isStaticExportConfig(nextConfigFile.content));
  if (nextConfigFile && !packageIsStaticExport) {
    blocking.push({ code: 'package_not_static_export', message: "next.config.js does not declare output: 'export'." });
  }

  // 13) Package must contain package.json.
  const pkgJsonFile = ctx.files.find((f) => f.path === 'package.json' || f.path.endsWith('/package.json'));
  const packageHasPackageJson = Boolean(pkgJsonFile);
  if (ctx.files.length > 0 && !packageHasPackageJson) {
    blocking.push({ code: 'package_json_missing', message: 'The static package has no package.json.' });
  }

  // 14) Package can build to `out` (static export -> `out/` by default in Next 14).
  const packageBuildsToOut = packageIsStaticExport && outputDirectoryValid;
  if (ctx.files.length > 0 && packageHasNextConfig && !packageBuildsToOut) {
    blocking.push({
      code: 'package_cannot_build_out',
      message: `The package must statically export to "${REQUIRED_OUTPUT_DIRECTORY}" (needs output: 'export' + outputDirectory "${REQUIRED_OUTPUT_DIRECTORY}").`,
    });
  }

  // 15) No signed URLs embedded in the package.
  const signedFile = ctx.files.find((f) => containsSignedUrl(f.content));
  const manifestAssets = [
    ...(ctx.manifest?.assets?.copied || []),
    ...(ctx.manifest?.assets?.missing || []),
    ...(ctx.manifest?.assets?.failed || []),
  ];
  const signedInManifest = manifestAssets.some((a: any) => a.sourceKind === 'r2_signed');
  const noSignedUrls = !signedFile && !signedInManifest;
  if (signedFile) {
    blocking.push({ code: 'signed_url_embedded', message: `A signed URL is embedded in ${signedFile.path}.` });
  }
  if (signedInManifest) {
    blocking.push({ code: 'signed_url_embedded', message: 'An image asset stored a signed URL source instead of a durable key.' });
  }

  // 16) No secrets embedded in the package.
  const secretFile = ctx.files.find((f) => containsSecret(f.content));
  const noSecretsEmbedded = !secretFile;
  if (secretFile) {
    blocking.push({ code: 'secret_embedded', message: `A secret-like value is embedded in ${secretFile.path}.` });
  }

  // 17) Images must be local (materialized, not signed R2 URLs).
  const missingAssets = ctx.manifest?.assets?.missing || [];
  const copiedCount = ctx.manifest?.assets?.copied?.length || ctx.manifest?.assets?.totals?.copied || 0;
  const imagesLocal = !signedInManifest && missingAssets.length === 0;
  if (ctx.manifest && missingAssets.length > 0) {
    blocking.push({
      code: 'images_not_local',
      message: `${missingAssets.length} image asset(s) are not materialized locally in the package.`,
    });
  }

  // 18) Env-token presence (references only) — informational warnings.
  //     (`env` is resolved once near the top of this function.)
  if (env && !env.accountId.configured) {
    warnings.push('CLOUDFLARE_ACCOUNT_ID is not configured in the server environment (needed for a future deploy).');
  }
  if (env && !env.pagesApiToken.configured) {
    warnings.push('CLOUDFLARE_PAGES_API_TOKEN is not configured in the server environment (needed for a future deploy).');
  }

  // 19) Live deploy must be disabled (always, this milestone).
  const liveDeployDisabled = true;

  const checks: CloudflareReadinessChecks = {
    isCloudflareTarget,
    accountIdPresent,
    projectNamePresent,
    repoUrlPresent,
    branchPresent,
    buildCommandPresent,
    outputDirectoryValid,
    credentialRefPresent,
    envVarsConfigured,
    packageHasNextConfig,
    packageIsStaticExport,
    packageHasPackageJson,
    packageBuildsToOut,
    noSignedUrls,
    noSecretsEmbedded,
    imagesLocal,
    dryRunPlanAvailable: true,
    liveDeployDisabled,
  };

  // A signed-url / secret / deploy-request issue is a hard BLOCK (security).
  const hardBlockCodes = new Set<CloudflareReadinessCode>([
    'deploy_requested',
    'signed_url_embedded',
    'secret_embedded',
    'business_missing',
    'not_cloudflare_target',
  ]);
  const hasHardBlock = blocking.some((b) => hardBlockCodes.has(b.code));

  let status: CloudflareReadinessStatus;
  if (hasHardBlock) {
    status = 'blocked';
  } else if (blocking.length > 0) {
    status = 'incomplete';
  } else {
    status = 'ready';
  }

  const ready = status === 'ready';
  const recommendedTargetStatus: 'draft' | 'configured' | 'verified' = ready
    ? 'verified'
    : status === 'incomplete'
      ? 'draft'
      : 'draft';

  const routeCount = ctx.manifest?.routes?.length || ctx.manifest?.pages?.length || 0;

  return {
    status,
    recommendedTargetStatus,
    ready,
    checks,
    missingFields,
    blockingReasons: blocking,
    warnings,
    customDomain: buildCustomDomainReadiness(t),
    env: {
      accountTokenConfigured: Boolean(env?.accountId.configured),
      pagesTokenConfigured: Boolean(env?.pagesApiToken.configured),
      dnsTokenConfigured: Boolean(env?.dnsApiToken.configured),
      zoneIdConfigured: Boolean(env?.defaultZoneId.configured),
      expectedPublicEnvVars: [...EXPECTED_PUBLIC_ENV_VARS],
      configuredEnvVarNames,
    },
    configSources: { accountId, zoneId, pagesToken, dnsToken },
    refs: {
      businessId: ctx.businessId,
      targetType: t?.targetType || null,
      projectName: t?.cloudflareProjectName || null,
      repoUrl,
      branch,
      buildCommand,
      outputDirectory,
      routeCount,
      materializedImageCount: copiedCount,
    },
    liveDeployEnabled: false,
    liveDnsMutationEnabled: false,
  };
}

// ── Dry-run plan ────────────────────────────────────────────────────────

export interface CloudflarePagesDryRunPlan {
  targetType: 'cloudflare_pages';
  mode: 'dry_run';
  liveDeployEnabled: false;
  liveDnsMutationEnabled: false;
  projectName: string | null;
  cloudflarePagesProjectName: string | null;
  cloudflarePagesProjectRef: string | null;
  accountIdConfigured: boolean;
  repoUrl: string | null;
  branch: string | null;
  buildCommand: string | null;
  outputDirectory: string | null;
  previewSubdomain: string | null;
  customDomain: string | null;
  dnsMode: CustomDomainMode;
  pagesDevHost: string | null;
  cnameName: string | null;
  cnameTarget: string | null;
  /** Preferred field names (clarification contract). */
  wouldCreatePagesProject: boolean;
  wouldConnectGitRepo: boolean;
  wouldAddCustomDomain: boolean;
  wouldCreateCnameRecord: boolean;
  /** Back-compat aliases. */
  wouldCreateProject: boolean;
  wouldConnectRepo: boolean;
  wouldSetEnvVars: string[];
  warnings: string[];
  blockingReasons: string[];
  note: string;
}

/**
 * Compute a side-effect-free Cloudflare Pages dry-run plan. NEVER calls the
 * Cloudflare API, NEVER creates a project, NEVER connects a repo, NEVER mutates
 * DNS. Describes only what a FUTURE, separately-approved deploy WOULD do.
 */
export function computeCloudflarePagesDryRun(args: {
  target: CloudflareTargetConfig | null;
  readiness?: CloudflareReadinessResult | null;
  configuredEnvVarNames?: string[];
}): CloudflarePagesDryRunPlan {
  const t = args.target;
  const readiness = args.readiness || null;
  const customDomain = resolveCustomDomain(t);
  const dnsMode = classifyCustomDomain(customDomain, t?.dnsMode);
  const hasCustomDomain = Boolean(customDomain) && dnsMode !== 'none';
  const cnameName = hasCustomDomain ? resolveCnameName(t) : null;
  const cnameTarget = hasCustomDomain ? resolveCnameTarget(t) : null;

  const wouldSetEnvVars =
    args.configuredEnvVarNames && args.configuredEnvVarNames.length > 0
      ? args.configuredEnvVarNames.filter(Boolean)
      : [...EXPECTED_PUBLIC_ENV_VARS];

  const blockingReasons = (readiness?.blockingReasons || []).map((b) => b.message);
  const warnings = (readiness?.warnings || []).slice();

  return {
    targetType: 'cloudflare_pages',
    mode: 'dry_run',
    liveDeployEnabled: false,
    liveDnsMutationEnabled: false,
    projectName: t?.cloudflareProjectName || null,
    cloudflarePagesProjectName: t?.cloudflareProjectName || null,
    cloudflarePagesProjectRef: t?.cloudflareProjectRef || null,
    accountIdConfigured:
      Boolean(readiness?.configSources?.accountId?.present) || present(t?.cloudflareAccountId),
    repoUrl: resolveRepoUrl(t),
    branch: resolveBranch(t) || DEFAULT_PRODUCTION_BRANCH,
    buildCommand: resolveBuildCommand(t) || DEFAULT_BUILD_COMMAND,
    outputDirectory: resolveOutputDirectory(t) || REQUIRED_OUTPUT_DIRECTORY,
    previewSubdomain: resolvePreviewSubdomain(t),
    customDomain: customDomain || null,
    dnsMode,
    pagesDevHost: resolvePagesDevHost(t),
    cnameName,
    cnameTarget,
    wouldCreatePagesProject: true,
    wouldConnectGitRepo: true,
    wouldAddCustomDomain: hasCustomDomain,
    wouldCreateCnameRecord: hasCustomDomain && dnsMode === 'subdomain',
    wouldCreateProject: true,
    wouldConnectRepo: true,
    wouldSetEnvVars,
    warnings,
    blockingReasons,
    note: 'Dry run only. No Cloudflare API call, no project created, no repo connected, no custom domain added, no CNAME record created, no DNS change, no deployment. liveDeployEnabled and liveDnsMutationEnabled are false.',
  };
}

// ── Manual first-project setup checklist ────────────────────────────────

export interface ChecklistStep {
  step: number;
  title: string;
  detail: string;
}

/** The 12-step manual first-project setup checklist for Cloudflare Pages. */
export function getManualSetupChecklist(): ChecklistStep[] {
  return [
    { step: 1, title: 'Create or select a GitHub repository', detail: 'Create (or pick) a GitHub repo that will hold this generated static site.' },
    { step: 2, title: 'Commit the generated static package to the repo', detail: 'Push the generated static Next.js package (from Tombstone) to the repo\'s production branch.' },
    { step: 3, title: 'Open the Cloudflare dashboard → Workers & Pages', detail: 'In the Cloudflare dashboard, go to Workers & Pages.' },
    { step: 4, title: 'Create a Pages project', detail: 'Create a new Cloudflare Pages project for this site.' },
    { step: 5, title: 'Connect the GitHub repository', detail: 'Connect the Pages project to the GitHub repo you prepared.' },
    { step: 6, title: 'Set the build command', detail: `Set the build command to "${DEFAULT_BUILD_COMMAND}".` },
    { step: 7, title: 'Set the output directory', detail: `Set the build output directory to "${REQUIRED_OUTPUT_DIRECTORY}".` },
    { step: 8, title: 'Set the production branch', detail: `Set the production branch to "${DEFAULT_PRODUCTION_BRANCH}".` },
    { step: 9, title: 'Add public environment variables', detail: `Add the public env vars: ${EXPECTED_PUBLIC_ENV_VARS.join(', ')}.` },
    { step: 10, title: 'Never add secrets as NEXT_PUBLIC_* vars', detail: 'NEXT_PUBLIC_* values are embedded in the public client bundle — never put secrets there.' },
    { step: 11, title: 'Deploy to the Cloudflare Pages .pages.dev URL first', detail: 'The default early preview uses the Cloudflare Pages URL (<project>.pages.dev). No custom CNAME is required for this step.' },
    { step: 12, title: 'Add ONE branded subdomain per test site (only after preview passes)', detail: 'For a branded preview, add one subdomain per site (e.g. preview-rjs-auto.launchmarketing.com) as its own Pages custom domain. Do NOT use path routing (testsite.launchmarketing.com/customer-slug) and do NOT rely on wildcard DNS.' },
    { step: 13, title: 'Add the branded subdomain as a Pages custom domain', detail: 'In the Pages project, add the branded subdomain as a custom domain so Cloudflare can issue a certificate for it.' },
    { step: 14, title: 'Create/verify a DNS CNAME for the branded subdomain', detail: 'Create or verify a CNAME record: name = the branded subdomain, target = the Pages project target (<project>.pages.dev). No DNS mutation is performed by this milestone.' },
  ];
}
