/**
 * Phase 4 — generated-site environment variable helpers.
 *
 * Public (NEXT_PUBLIC_*) values may be stored inline. Secret values must NOT be
 * stored here — only a REFERENCE name. Serialization never returns a secret
 * value.
 */

import {
  validateEnvVars,
  looksLikeSecretValue,
  SECRET_KEY_HINTS,
  type EnvValidationIssue,
} from '@/lib/site-builder/env-validation';

export const ENV_ENVIRONMENTS = ['production', 'preview', 'development', 'all'] as const;
export type EnvEnvironment = (typeof ENV_ENVIRONMENTS)[number];

export interface EnvWriteInput {
  key?: string;
  /** Inline value (public vars) OR a reference name (secret vars). */
  value?: string | null;
  valueRef?: string | null;
  environment?: string;
}

export interface EnvWriteResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  data?: {
    key: string;
    valueRef: string | null;
    isPublic: boolean;
    isSecret: boolean;
    environment: string;
  };
}

const KEY_RE = /^[A-Z_][A-Z0-9_]*$/i;

/**
 * Validate an env-var write. For public keys the value is stored inline; for
 * non-public keys only a reference name may be stored — a raw secret value is
 * rejected.
 */
export function validateEnvWrite(input: EnvWriteInput): EnvWriteResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const key = (input.key || '').trim();
  if (!key) return { ok: false, errors: ['key is required'], warnings };
  if (!KEY_RE.test(key)) {
    return { ok: false, errors: ['key must contain only letters, digits and underscores'], warnings };
  }

  const isPublic = key.startsWith('NEXT_PUBLIC_');
  const isSecret = !isPublic;
  const environment = (input.environment || 'production').trim();
  if (!(ENV_ENVIRONMENTS as readonly string[]).includes(environment)) {
    errors.push(`Unsupported environment "${environment}".`);
  }

  const rawValue = input.value ?? null;
  const rawRef = input.valueRef ?? null;

  // Reuse the shared validator for the public/secret separation rules.
  const v = validateEnvVars([{ key, value: rawValue ?? undefined, isSecret }]);
  for (const issue of v.issues as EnvValidationIssue[]) {
    if (issue.level === 'error') errors.push(issue.message);
    else warnings.push(issue.message);
  }

  let valueRef: string | null = null;
  if (isPublic) {
    // Public value stored inline (prefer explicit value, else provided ref).
    valueRef = (rawValue ?? rawRef ?? '').toString().trim() || null;
    if (valueRef && looksLikeSecretValue(valueRef)) {
      errors.push('Public variable value looks like a secret and must not be exposed.');
    }
  } else {
    // Secret: store ONLY a reference name. A raw secret value is rejected.
    if (rawValue && looksLikeSecretValue(rawValue)) {
      errors.push(
        'Secret value detected. Store the secret in your vault and provide a reference name (valueRef) instead of the raw value.',
      );
    }
    valueRef = (rawRef ?? rawValue ?? '').toString().trim() || null;
    if (valueRef && looksLikeSecretValue(valueRef)) {
      errors.push('valueRef must be a reference name, not a raw secret value.');
    }
    if (SECRET_KEY_HINTS.test(key) && valueRef === null) {
      warnings.push('Secret-like key has no reference configured yet.');
    }
  }

  if (errors.length > 0) return { ok: false, errors, warnings };
  return {
    ok: true,
    errors,
    warnings,
    data: { key, valueRef, isPublic, isSecret, environment },
  };
}

export interface EnvRow {
  id: string;
  key: string;
  valueRef: string | null;
  isPublic: boolean;
  isSecret: boolean;
  environment: string;
  deploymentTargetId: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
}

/**
 * Serialize an env var for API/UI. Public values are returned inline; secret
 * vars return only the reference NAME (never the secret value).
 */
export function serializeEnvVar(e: EnvRow) {
  return {
    id: e.id,
    key: e.key,
    isPublic: e.isPublic,
    isSecret: e.isSecret,
    environment: e.environment,
    deploymentTargetId: e.deploymentTargetId,
    // For public keys this is the public value; for secrets it is a reference
    // name only — never a secret value (raw secrets are rejected on write).
    value: e.isPublic ? e.valueRef : null,
    valueRef: e.isSecret ? e.valueRef : null,
    hasValue: Boolean(e.valueRef),
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
  };
}
