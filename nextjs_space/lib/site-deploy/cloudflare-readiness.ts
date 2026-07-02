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
  buildCommand?: string | null;
  outputDirectory?: string | null;
  customDomain?: string | null;
  domain?: string | null;
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
  mode: CustomDomainMode;
  /** Requirements the operator must satisfy manually (no DNS changes here). */
  requirements: string[];
  notes: string[];
}

export type CloudflareReadinessStatus = 'ready' | 'incomplete' | 'blocked';

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
    expectedPublicEnvVars: string[];
    configuredEnvVarNames: string[];
  };
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
  const mode = classifyCustomDomain(customDomain, t?.dnsMode);
  const requirements: string[] = [];
  const notes: string[] = [];

  if (!customDomain || mode === 'none') {
    notes.push('No custom domain configured. Deploy to the Cloudflare Pages preview URL first.');
    return { customDomain: customDomain || null, mode: 'none', requirements, notes };
  }

  if (mode === 'subdomain') {
    requirements.push('The parent zone exists in Cloudflare (or DNS for it is configurable).');
    requirements.push('A CNAME record for the subdomain can point to the Cloudflare Pages project.');
    requirements.push('The Cloudflare Pages project is created and connected to the GitHub repo.');
    notes.push('Subdomain custom domains are added in the Pages project only AFTER the preview deploy passes. No DNS changes are made in this milestone.');
  } else {
    requirements.push('The apex domain is a zone in the SAME Cloudflare account as the Pages project.');
    requirements.push('The apex zone is active in Cloudflare (nameservers delegated).');
    requirements.push('The Cloudflare Pages project is created and connected to the GitHub repo.');
    notes.push('Apex custom domains require the root domain to be a Cloudflare zone in the same account. No DNS changes are made in this milestone.');
  }

  return { customDomain, mode, requirements, notes };
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

  // 3) Cloudflare account id present.
  const accountIdPresent = present(t?.cloudflareAccountId);
  if (!accountIdPresent) {
    missingFields.push('cloudflareAccountId');
    blocking.push({ code: 'account_id_missing', message: 'Cloudflare account id is required.' });
  }

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

  // 9) Credential reference present.
  const credentialRefPresent = present(t?.credentialsRef);
  if (!credentialRefPresent) {
    missingFields.push('credentialsRef');
    blocking.push({ code: 'credential_ref_missing', message: 'A Cloudflare credential REFERENCE name is required (never the token value).' });
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
  const env = ctx.envReadiness || null;
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
      expectedPublicEnvVars: [...EXPECTED_PUBLIC_ENV_VARS],
      configuredEnvVarNames,
    },
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
  };
}

// ── Dry-run plan ────────────────────────────────────────────────────────

export interface CloudflarePagesDryRunPlan {
  targetType: 'cloudflare_pages';
  mode: 'dry_run';
  liveDeployEnabled: false;
  projectName: string | null;
  accountIdConfigured: boolean;
  repoUrl: string | null;
  branch: string | null;
  buildCommand: string | null;
  outputDirectory: string | null;
  customDomain: string | null;
  dnsMode: CustomDomainMode;
  wouldCreateProject: boolean;
  wouldConnectRepo: boolean;
  wouldSetEnvVars: string[];
  wouldAddCustomDomain: boolean;
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
    projectName: t?.cloudflareProjectName || null,
    accountIdConfigured: present(t?.cloudflareAccountId),
    repoUrl: resolveRepoUrl(t),
    branch: resolveBranch(t) || DEFAULT_PRODUCTION_BRANCH,
    buildCommand: resolveBuildCommand(t) || DEFAULT_BUILD_COMMAND,
    outputDirectory: resolveOutputDirectory(t) || REQUIRED_OUTPUT_DIRECTORY,
    customDomain: customDomain || null,
    dnsMode,
    wouldCreateProject: true,
    wouldConnectRepo: true,
    wouldSetEnvVars,
    wouldAddCustomDomain: Boolean(customDomain) && dnsMode !== 'none',
    warnings,
    blockingReasons,
    note: 'Dry run only. No Cloudflare API call, no project created, no repo connected, no DNS change, no deployment. liveDeployEnabled is false.',
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
    { step: 11, title: 'Deploy to the Cloudflare Pages preview URL first', detail: 'Trigger a preview build and verify the site on the Cloudflare Pages preview URL.' },
    { step: 12, title: 'Add a custom test subdomain only after preview passes', detail: 'Only after the preview deploy passes, add a custom test subdomain to the Pages project.' },
  ];
}
