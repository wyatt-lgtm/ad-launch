/**
 * Phase 3 — environment variable validation for generated static sites.
 *
 * Generated packages must keep public config (NEXT_PUBLIC_*) separate from
 * secrets. This validator flags any secret-looking value placed under a
 * NEXT_PUBLIC_ key, and never echoes secret values.
 */

export interface EnvVarInput {
  key: string;
  /** Optional value used ONLY for shape validation; never persisted/logged. */
  value?: string | null;
  isSecret?: boolean;
}

export interface EnvValidationIssue {
  key: string;
  level: 'error' | 'warning';
  message: string;
}

export interface EnvValidationResult {
  ok: boolean;
  issues: EnvValidationIssue[];
  publicKeys: string[];
  secretKeys: string[];
}

const SECRET_VALUE_PATTERNS = [
  /sk_live_[a-z0-9]/i,
  /sk_test_[a-z0-9]/i,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /[?&]X-Amz-(Signature|Credential|Security-Token)=/i,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bghp_[A-Za-z0-9]{20,}\b/,
];

const SECRET_KEY_HINTS = /(secret|password|token|api[_-]?key|private[_-]?key|credential)/i;

export function validateEnvVars(vars: EnvVarInput[]): EnvValidationResult {
  const issues: EnvValidationIssue[] = [];
  const publicKeys: string[] = [];
  const secretKeys: string[] = [];

  for (const v of vars) {
    const isPublic = v.key.startsWith('NEXT_PUBLIC_');
    if (isPublic) {
      publicKeys.push(v.key);
      // A public key must NEVER carry a secret-looking value or name.
      if (v.isSecret) {
        issues.push({
          key: v.key,
          level: 'error',
          message: 'Secret marked variable uses the public NEXT_PUBLIC_ prefix.',
        });
      }
      if (SECRET_KEY_HINTS.test(v.key.replace(/^NEXT_PUBLIC_/, ''))) {
        issues.push({
          key: v.key,
          level: 'warning',
          message: 'Public key name looks secret-like; confirm it is safe to expose.',
        });
      }
      if (v.value && SECRET_VALUE_PATTERNS.some((re) => re.test(v.value!))) {
        issues.push({
          key: v.key,
          level: 'error',
          message: 'Public variable value looks like a secret/credential and must not be exposed.',
        });
      }
    } else {
      secretKeys.push(v.key);
    }
  }

  const ok = !issues.some((i) => i.level === 'error');
  return { ok, issues, publicKeys, secretKeys };
}
