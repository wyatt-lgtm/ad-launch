/**
 * Phase 4 — deployment-target configuration helpers.
 *
 * Centralizes the safe validation + serialization of SiteDeploymentTarget rows
 * so the API routes and UI share one source of truth.
 *
 * HARD RULES (enforced here):
 *  - Raw secrets are NEVER stored in normal columns. Credential fields hold
 *    REFERENCES only (e.g. a vault key name), validated to not look like an
 *    actual secret value.
 *  - Serialization NEVER returns a secret value. Reference NAMES + presence
 *    booleans are safe to surface.
 *  - No hardcoded HostGator/cPanel/home paths are ever injected. deployBasePath
 *    is taken verbatim from the operator's configuration (or left null).
 *  - Live deploy can NOT be toggled through here. status is limited to a safe
 *    enum that never enables deployment.
 */

import { DEPLOYMENT_TARGET_TYPES } from './targets';
import { looksLikeSecretValue } from '@/lib/site-builder/env-validation';

export const TARGET_STATUSES = ['draft', 'configured', 'verified', 'disabled', 'archived'] as const;
export type TargetStatus = (typeof TARGET_STATUSES)[number];

/** Plain text fields the operator may freely set (never secret VALUES). */
const TEXT_FIELDS = [
  'name',
  'domain',
  'siteUrl',
  'deployBasePath',
  'gitRepoUrl',
  'gitBranch',
  'buildCommand',
  'outputDirectory',
  'cloudflareZoneId',
  'hostgatorHostRef',
  'vercelProjectId',
  'wordpressSiteUrl',
  'credentialsRef',
  // Cloudflare Pages (Milestone 9) — references / plain config only.
  'cloudflareAccountId',
  'cloudflareProjectName',
  'cloudflareProjectRef',
  'githubRepoUrl',
  'githubBranch',
  'productionBranch',
  'previewBranch',
  'previewSubdomain',
  'customDomain',
  'cnameName',
  'cnameTarget',
  'customDomainStatus',
  'dnsRecordStatus',
  'dnsMode',
] as const;

type TextField = (typeof TEXT_FIELDS)[number];

/** Credential-reference fields. These hold REFERENCE NAMES only, never values. */
const CREDENTIAL_REF_FIELDS: TextField[] = [
  'credentialsRef',
  'hostgatorHostRef',
];

export interface TargetInput {
  targetType?: string;
  status?: string;
  name?: string | null;
  domain?: string | null;
  siteUrl?: string | null;
  deployBasePath?: string | null;
  gitRepoUrl?: string | null;
  gitBranch?: string | null;
  buildCommand?: string | null;
  outputDirectory?: string | null;
  cloudflareZoneId?: string | null;
  hostgatorHostRef?: string | null;
  vercelProjectId?: string | null;
  wordpressSiteUrl?: string | null;
  credentialsRef?: string | null;
  // Cloudflare Pages (Milestone 9).
  cloudflareAccountId?: string | null;
  cloudflareProjectName?: string | null;
  cloudflareProjectRef?: string | null;
  githubRepoUrl?: string | null;
  githubBranch?: string | null;
  productionBranch?: string | null;
  previewBranch?: string | null;
  previewSubdomain?: string | null;
  customDomain?: string | null;
  cnameName?: string | null;
  cnameTarget?: string | null;
  customDomainStatus?: string | null;
  dnsRecordStatus?: string | null;
  dnsMode?: string | null;
  /** Optional operator-recorded credential verification time (ISO string). */
  lastVerifiedAt?: string | null;
}

export interface TargetValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  /** Sanitized Prisma-writable data (only when ok). */
  data: Record<string, any>;
}

function clean(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

/**
 * Validate + sanitize a create/update payload. Returns the safe Prisma data on
 * success. Rejects (errors) anything that would store a raw secret or enable
 * live deployment.
 */
export function validateTargetInput(
  input: TargetInput,
  { isCreate }: { isCreate: boolean },
): TargetValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const data: Record<string, any> = {};

  // ── target type ──────────────────────────────────────────────────
  if (input.targetType !== undefined || isCreate) {
    const tt = clean(input.targetType) || (isCreate ? 'hostgator_static' : null);
    if (tt !== null) {
      if (!(DEPLOYMENT_TARGET_TYPES as readonly string[]).includes(tt)) {
        errors.push(`Unsupported target type "${tt}".`);
      } else {
        data.targetType = tt;
      }
    }
  }

  // ── status (never enables live deploy) ───────────────────────────
  if (input.status !== undefined) {
    const st = clean(input.status);
    if (st !== null) {
      if (!(TARGET_STATUSES as readonly string[]).includes(st)) {
        errors.push(`Unsupported status "${st}".`);
      } else {
        data.status = st;
      }
    }
  }

  // ── text fields ──────────────────────────────────────────────────
  for (const field of TEXT_FIELDS) {
    if (input[field] === undefined) continue;
    const val = clean(input[field]);
    // No normal column may hold an actual secret value (defense-in-depth).
    if (val && looksLikeSecretValue(val)) {
      if (CREDENTIAL_REF_FIELDS.includes(field)) {
        errors.push(
          `${field} must be a credential REFERENCE name, not a raw secret value. ` +
            `Store the secret in your vault and reference it by name.`,
        );
      } else {
        errors.push(`${field} looks like a secret value and cannot be stored here.`);
      }
      continue;
    }
    data[field] = val;
  }

  // ── safe config metadata (no secrets) ────────────────────────────
  if (input.lastVerifiedAt !== undefined) {
    const ts = clean(input.lastVerifiedAt);
    data.__lastVerifiedAt = ts; // merged into configJson by the route
  }

  return { ok: errors.length === 0, errors, warnings, data };
}

/** Row shape this serializer accepts (superset of selected columns). */
export interface TargetRow {
  id: string;
  businessId: string;
  websiteProjectId: string | null;
  targetType: string;
  name: string | null;
  status: string;
  domain: string | null;
  siteUrl: string | null;
  deployBasePath: string | null;
  gitRepoUrl: string | null;
  gitBranch: string | null;
  buildCommand: string | null;
  outputDirectory: string | null;
  cloudflareZoneId: string | null;
  hostgatorHostRef: string | null;
  vercelProjectId: string | null;
  wordpressSiteUrl: string | null;
  credentialsRef: string | null;
  cloudflareAccountId: string | null;
  cloudflareProjectName: string | null;
  cloudflareProjectRef: string | null;
  githubRepoUrl: string | null;
  githubBranch: string | null;
  productionBranch: string | null;
  previewBranch: string | null;
  previewSubdomain: string | null;
  customDomain: string | null;
  cnameName: string | null;
  cnameTarget: string | null;
  customDomainStatus: string | null;
  dnsRecordStatus: string | null;
  dnsMode: string | null;
  configJson: any;
  createdAt: Date | string;
  updatedAt: Date | string;
}

/**
 * Serialize a target for API/UI. Credential fields are surfaced as REFERENCE
 * NAMES + presence booleans only. NEVER returns a secret value.
 */
export function serializeTarget(t: TargetRow) {
  const cfg = (t.configJson && typeof t.configJson === 'object') ? t.configJson : {};
  return {
    id: t.id,
    businessId: t.businessId,
    websiteProjectId: t.websiteProjectId,
    targetType: t.targetType,
    name: t.name,
    status: t.status,
    domain: t.domain,
    siteUrl: t.siteUrl,
    deployBasePath: t.deployBasePath,
    gitRepoUrl: t.gitRepoUrl,
    gitBranch: t.gitBranch,
    buildCommand: t.buildCommand,
    outputDirectory: t.outputDirectory,
    cloudflareZoneId: t.cloudflareZoneId,
    hostgatorHostRef: t.hostgatorHostRef,
    vercelProjectId: t.vercelProjectId,
    wordpressSiteUrl: t.wordpressSiteUrl,
    // Cloudflare Pages (Milestone 9) — plain config / references only.
    cloudflareAccountId: t.cloudflareAccountId,
    cloudflareProjectName: t.cloudflareProjectName,
    cloudflareProjectRef: t.cloudflareProjectRef,
    githubRepoUrl: t.githubRepoUrl,
    githubBranch: t.githubBranch,
    productionBranch: t.productionBranch,
    previewBranch: t.previewBranch,
    previewSubdomain: t.previewSubdomain,
    customDomain: t.customDomain,
    cnameName: t.cnameName,
    cnameTarget: t.cnameTarget,
    customDomainStatus: t.customDomainStatus,
    dnsRecordStatus: t.dnsRecordStatus,
    dnsMode: t.dnsMode,
    // Alias names matching the Milestone 9 field contract.
    cloudflarePagesProjectName: t.cloudflareProjectName,
    cloudflarePagesProjectRef: t.cloudflareProjectRef,
    cloudflareAccountConfigured: Boolean(t.cloudflareAccountId),
    cloudflareProjectConfigured: Boolean(t.cloudflareProjectName),
    githubRepoConfigured: Boolean(t.githubRepoUrl),
    // DNS mutation is NEVER enabled in this milestone.
    liveDnsMutationEnabled: false,
    // Credential REFERENCE (name only) + presence flag. Never a secret value.
    credentialsRef: t.credentialsRef,
    credentialConfigured: Boolean(t.credentialsRef),
    lastVerifiedAt: (cfg as any).lastVerifiedAt || null,
    liveDeployEnabled: false,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  };
}

export const TARGET_SELECT = {
  id: true,
  businessId: true,
  websiteProjectId: true,
  targetType: true,
  name: true,
  status: true,
  domain: true,
  siteUrl: true,
  deployBasePath: true,
  gitRepoUrl: true,
  gitBranch: true,
  buildCommand: true,
  outputDirectory: true,
  cloudflareZoneId: true,
  hostgatorHostRef: true,
  vercelProjectId: true,
  wordpressSiteUrl: true,
  credentialsRef: true,
  cloudflareAccountId: true,
  cloudflareProjectName: true,
  cloudflareProjectRef: true,
  githubRepoUrl: true,
  githubBranch: true,
  productionBranch: true,
  previewBranch: true,
  previewSubdomain: true,
  customDomain: true,
  cnameName: true,
  cnameTarget: true,
  customDomainStatus: true,
  dnsRecordStatus: true,
  dnsMode: true,
  configJson: true,
  createdAt: true,
  updatedAt: true,
} as const;
