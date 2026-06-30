'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Server, Lock, Save, RefreshCw, KeyRound, Globe, GitBranch,
  Plus, ShieldCheck, AlertTriangle, CheckCircle2, Variable,
  Cloud, Database, XCircle,
} from 'lucide-react';
import { useActiveBusiness } from '@/hooks/use-active-business';

/**
 * Phase 4 — Deployment Target settings + environment variable configuration.
 *
 * Lets an owner/admin configure a deployment target (type, domain, paths, git,
 * build, credential REFERENCES) and generated-site env vars. Everything stays
 * DRY-RUN ONLY: there is no live deploy action and the deploy button is a
 * disabled, labelled placeholder. Credentials are stored/shown as references
 * only — never secret values.
 */

// Ordered by product priority: HostGator (default) -> Cloudflare (strategic)
// -> WordPress export (optional) -> Manual export (fallback) -> Vercel (future,
// de-emphasized; kept in the model but not a focus this phase).
const TARGET_TYPES = [
  { value: 'hostgator_static', label: 'HostGator Static (default)' },
  { value: 'cloudflare_pages', label: 'Cloudflare Pages (strategic)' },
  { value: 'wordpress_export', label: 'WordPress Export (optional)' },
  { value: 'manual_export', label: 'Manual Export (fallback)' },
  { value: 'vercel', label: 'Vercel (future)' },
];
const STATUSES = ['draft', 'configured', 'disabled', 'archived'];
const ENVIRONMENTS = ['production', 'preview', 'development', 'all'];

interface DeployTarget {
  id: string;
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
  credentialConfigured: boolean;
  lastVerifiedAt: string | null;
  liveDeployEnabled: boolean;
}
interface EnvVar {
  id: string;
  key: string;
  isPublic: boolean;
  isSecret: boolean;
  environment: string;
  value: string | null;
  valueRef: string | null;
  hasValue: boolean;
}
interface AssetStores {
  generatedBucket: { name: string; configured: boolean };
  customerAssetsBucket: { name: string; configured: boolean };
  r2Endpoint: { configured: boolean; host: string | null };
  r2Account: { configured: boolean };
  r2Credential: { configured: boolean };
}
interface CloudflareReadiness {
  accountId: { configured: boolean };
  pagesApiToken: { configured: boolean };
  dnsApiToken: { configured: boolean };
  defaultZoneId: { configured: boolean };
  ready: boolean;
  missing: string[];
}

/** A single yes/no readiness row. Shows presence only — never a secret value. */
function ReadyRow({ label, ok, hint }: { label: string; ok: boolean; hint?: string }) {
  return (
    <div className="flex items-center justify-between gap-2 py-1 text-xs">
      <span className="text-gray-600">
        {label}
        {hint && <span className="ml-1 text-[10px] text-gray-400">({hint})</span>}
      </span>
      {ok ? (
        <span className="inline-flex items-center gap-1 font-medium text-green-600"><CheckCircle2 className="h-3.5 w-3.5" /> Yes</span>
      ) : (
        <span className="inline-flex items-center gap-1 font-medium text-gray-400"><XCircle className="h-3.5 w-3.5" /> No</span>
      )}
    </div>
  );
}

const PUBLIC_EXAMPLES = [
  'NEXT_PUBLIC_SITE_URL',
  'NEXT_PUBLIC_GHL_FORM_ID',
  'NEXT_PUBLIC_GHL_LOCATION_ID',
  'NEXT_PUBLIC_GA_MEASUREMENT_ID',
];

function Field({
  label, value, onChange, placeholder, mono,
}: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; mono?: boolean;
}) {
  return (
    <label className="block">
      <span className="text-[11px] font-medium uppercase tracking-wide text-gray-400">{label}</span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-800 focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-200 ${mono ? 'font-mono text-xs' : ''}`}
      />
    </label>
  );
}

export default function DeploymentSettingsCard() {
  const bizCtx = useActiveBusiness();
  const businessId = bizCtx.activeBusiness?.id || null;

  const [target, setTarget] = useState<DeployTarget | null>(null);
  const [form, setForm] = useState<Partial<DeployTarget>>({});
  const [envVars, setEnvVars] = useState<EnvVar[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [assetStores, setAssetStores] = useState<AssetStores | null>(null);
  const [cloudflare, setCloudflare] = useState<CloudflareReadiness | null>(null);

  // New env var inputs
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');
  const [newEnv, setNewEnv] = useState('production');
  const [envMsg, setEnvMsg] = useState<string | null>(null);

  const newKeyIsPublic = newKey.startsWith('NEXT_PUBLIC_');

  const load = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    setMsg(null);
    try {
      const [tRes, eRes] = await Promise.all([
        fetch(`/api/businesses/${encodeURIComponent(businessId)}/site-deployment-targets`),
        fetch(`/api/businesses/${encodeURIComponent(businessId)}/site-environment-variables`),
      ]);
      if (tRes.ok) {
        const data = await tRes.json();
        const first: DeployTarget | null = data.targets?.[0] || null;
        setTarget(first);
        setForm(first ? { ...first } : { targetType: 'hostgator_static', status: 'draft' });
        setAssetStores(data.assetStores || null);
        setCloudflare(data.cloudflare || null);
      }
      if (eRes.ok) {
        const data = await eRes.json();
        setEnvVars(data.variables || []);
      }
    } catch {
      setMsg('Failed to load deployment settings.');
    } finally {
      setLoading(false);
    }
  }, [businessId]);

  useEffect(() => { load(); }, [load]);

  const set = (k: keyof DeployTarget, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const saveTarget = async () => {
    if (!businessId) return;
    setSaving(true);
    setMsg(null);
    setWarnings([]);
    try {
      const payload = {
        targetType: form.targetType,
        status: form.status,
        name: form.name ?? null,
        domain: form.domain ?? null,
        siteUrl: form.siteUrl ?? null,
        deployBasePath: form.deployBasePath ?? null,
        gitRepoUrl: form.gitRepoUrl ?? null,
        gitBranch: form.gitBranch ?? null,
        buildCommand: form.buildCommand ?? null,
        outputDirectory: form.outputDirectory ?? null,
        cloudflareZoneId: form.cloudflareZoneId ?? null,
        hostgatorHostRef: form.hostgatorHostRef ?? null,
        vercelProjectId: form.vercelProjectId ?? null,
        wordpressSiteUrl: form.wordpressSiteUrl ?? null,
        credentialsRef: form.credentialsRef ?? null,
      };
      const url = target
        ? `/api/businesses/${encodeURIComponent(businessId)}/site-deployment-targets/${target.id}`
        : `/api/businesses/${encodeURIComponent(businessId)}/site-deployment-targets`;
      const res = await fetch(url, {
        method: target ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setTarget(data.target);
        setForm({ ...data.target });
        setWarnings(data.warnings || []);
        setMsg('Saved (dry-run only — no deployment).');
      } else {
        setWarnings(data.issues || []);
        setMsg(data.error || 'Could not save target.');
      }
    } catch {
      setMsg('Could not save target.');
    } finally {
      setSaving(false);
    }
  };

  const addEnvVar = async () => {
    if (!businessId || !newKey.trim()) return;
    setEnvMsg(null);
    try {
      const res = await fetch(
        `/api/businesses/${encodeURIComponent(businessId)}/site-environment-variables`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            key: newKey.trim(),
            value: newKeyIsPublic ? newValue : undefined,
            valueRef: newKeyIsPublic ? undefined : (newValue || undefined),
            environment: newEnv,
            deploymentTargetId: target?.id || undefined,
          }),
        },
      );
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setNewKey('');
        setNewValue('');
        setEnvMsg(
          (data.warnings && data.warnings.length)
            ? `Saved with warning: ${data.warnings.join(' ')}`
            : 'Variable saved.',
        );
        load();
      } else {
        setEnvMsg((data.issues && data.issues.join(' ')) || data.error || 'Could not save variable.');
      }
    } catch {
      setEnvMsg('Could not save variable.');
    }
  };

  const showCloudflare = form.targetType === 'cloudflare_pages';
  const showVercel = form.targetType === 'vercel';
  const showWordpress = form.targetType === 'wordpress_export';
  const showHostgator = form.targetType === 'hostgator_static' || !form.targetType;

  const secretLikePublicWarn = useMemo(
    () => newKeyIsPublic && /(secret|password|token|api[_-]?key|private|credential)/i.test(
      newKey.replace(/^NEXT_PUBLIC_/, ''),
    ),
    [newKey, newKeyIsPublic],
  );

  return (
    <div className="rounded-2xl border border-gray-200 bg-white shadow-sm">
      <div className="flex items-start justify-between gap-3 border-b border-gray-100 p-5">
        <div className="flex items-center gap-2">
          <div className="rounded-lg bg-indigo-50 p-2"><Server className="h-5 w-5 text-indigo-600" /></div>
          <div>
            <h2 className="text-base font-semibold text-gray-900">Website deployment settings</h2>
            <p className="text-xs text-gray-500">
              Configure a deployment target and generated-site environment variables. Credentials are stored by reference only. Live deployment is disabled in this phase.
            </p>
          </div>
        </div>
        <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-700">
          <Lock className="h-3 w-3" /> Dry run only
        </span>
      </div>

      <div className="space-y-6 p-5">
        {!businessId && (
          <p className="text-sm text-gray-500">Select a business to configure its deployment target.</p>
        )}

        {businessId && (
          <>
            {/* Target configuration */}
            <div className="grid gap-4 lg:grid-cols-2">
              <label className="block">
                <span className="text-[11px] font-medium uppercase tracking-wide text-gray-400">Target type</span>
                <select
                  value={form.targetType || 'hostgator_static'}
                  onChange={(e) => set('targetType', e.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-800 focus:border-indigo-400 focus:outline-none"
                >
                  {TARGET_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="text-[11px] font-medium uppercase tracking-wide text-gray-400">Status</span>
                <select
                  value={form.status || 'draft'}
                  onChange={(e) => set('status', e.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-800 focus:border-indigo-400 focus:outline-none"
                >
                  {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </label>
              <Field label="Target name" value={form.name || ''} onChange={(v) => set('name', v)} placeholder="Production static site" />
              <Field label="Domain" value={form.domain || ''} onChange={(v) => set('domain', v)} placeholder="www.example.com" />
              <Field label="Site URL" value={form.siteUrl || ''} onChange={(v) => set('siteUrl', v)} placeholder="https://www.example.com" />
              <Field label="Deploy base path" value={form.deployBasePath || ''} onChange={(v) => set('deployBasePath', v)} placeholder="(configured remote directory)" mono />
              <Field label="Git repo URL" value={form.gitRepoUrl || ''} onChange={(v) => set('gitRepoUrl', v)} placeholder="https://github.com/..." mono />
              <Field label="Git branch" value={form.gitBranch || ''} onChange={(v) => set('gitBranch', v)} placeholder="main" />
              <Field label="Build command" value={form.buildCommand || ''} onChange={(v) => set('buildCommand', v)} placeholder="npm run build" mono />
              <Field label="Output directory" value={form.outputDirectory || ''} onChange={(v) => set('outputDirectory', v)} placeholder="out" mono />
              {showCloudflare && (
                <div className="lg:col-span-2 space-y-1">
                  <Field label="Cloudflare zone id" value={form.cloudflareZoneId || ''} onChange={(v) => set('cloudflareZoneId', v)} placeholder="cf-zone-reference" mono />
                  <p className="text-[11px] text-gray-400">Cloudflare Pages is the strategic long-term target. Capture the project/zone reference and build settings now; deployment stays dry-run only this phase.</p>
                </div>
              )}
              {showHostgator && (
                <Field label="HostGator host ref" value={form.hostgatorHostRef || ''} onChange={(v) => set('hostgatorHostRef', v)} placeholder="vault://hostgator/host" mono />
              )}
              {showVercel && (
                <div className="lg:col-span-2 space-y-1">
                  <Field label="Vercel project id (optional reference)" value={form.vercelProjectId || ''} onChange={(v) => set('vercelProjectId', v)} mono />
                  <p className="text-[11px] text-gray-400">Vercel is a future, low-priority target. It is kept for forward compatibility only — no Vercel deployment is wired up in this phase.</p>
                </div>
              )}
              {showWordpress && (
                <Field label="WordPress URL" value={form.wordpressSiteUrl || ''} onChange={(v) => set('wordpressSiteUrl', v)} placeholder="https://blog.example.com" />
              )}
              <Field label="Credential reference (name only)" value={form.credentialsRef || ''} onChange={(v) => set('credentialsRef', v)} placeholder="vault://hostgator/deploy-key" mono />
            </div>

            {/* Credential status */}
            <div className="flex flex-wrap items-center gap-3 rounded-xl border border-gray-100 bg-gray-50 p-3 text-xs">
              <span className="inline-flex items-center gap-1.5 font-medium text-gray-700"><KeyRound className="h-3.5 w-3.5" /> Credential configured: {target?.credentialConfigured ? 'Yes' : 'No'}</span>
              {target?.credentialsRef && (
                <span className="inline-flex items-center gap-1.5 text-gray-500"><ShieldCheck className="h-3.5 w-3.5 text-green-500" /> Reference: <code className="text-[11px]">{target.credentialsRef}</code></span>
              )}
              {target?.lastVerifiedAt && (
                <span className="text-gray-400">Last verified: {new Date(target.lastVerifiedAt).toLocaleString('en-US')}</span>
              )}
              <span className="text-gray-400">Secret values are never stored or shown.</span>
            </div>

            {/* R2 asset stores + Cloudflare Pages readiness (references only) */}
            <div className="grid gap-4 lg:grid-cols-2">
              {/* R2 source asset stores */}
              <div className="rounded-xl border border-gray-100 p-4">
                <div className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-gray-800">
                  <Database className="h-4 w-4 text-indigo-500" /> Asset stores (Cloudflare R2)
                </div>
                <p className="mb-2 text-[11px] text-gray-500">
                  Existing source buckets. Generated assets are materialized into the static package
                  (<code>public/images</code>/<code>public/assets</code>) — no signed R2 URLs are embedded. Bucket names are safe to show; credentials are never displayed.
                </p>
                {assetStores ? (
                  <div className="divide-y divide-gray-50">
                    <ReadyRow
                      label="Generated asset bucket configured"
                      ok={assetStores.generatedBucket.configured}
                      hint={assetStores.generatedBucket.name}
                    />
                    <ReadyRow
                      label="Customer asset bucket configured"
                      ok={assetStores.customerAssetsBucket.configured}
                      hint={assetStores.customerAssetsBucket.name}
                    />
                    <ReadyRow
                      label="R2 endpoint configured"
                      ok={assetStores.r2Endpoint.configured}
                      hint={assetStores.r2Endpoint.host || undefined}
                    />
                    <ReadyRow label="R2 account reference configured" ok={assetStores.r2Account.configured} />
                    <ReadyRow label="R2 credential reference configured" ok={assetStores.r2Credential.configured} />
                  </div>
                ) : (
                  <p className="text-[11px] text-gray-400">Loading asset-store configuration…</p>
                )}
              </div>

              {/* Cloudflare Pages readiness (strategic target) */}
              <div className="rounded-xl border border-gray-100 p-4">
                <div className="mb-1 flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-sm font-semibold text-gray-800">
                    <Cloud className="h-4 w-4 text-orange-500" /> Cloudflare Pages readiness
                  </div>
                  {cloudflare && (
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${cloudflare.ready ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'}`}>
                      {cloudflare.ready ? 'Ready' : 'Not ready'}
                    </span>
                  )}
                </div>
                <p className="mb-2 text-[11px] text-gray-500">
                  Strategic long-term target. These are credential <em>references</em> — token values are never read or displayed. No Cloudflare deploy runs in this phase.
                </p>
                {cloudflare ? (
                  <div className="divide-y divide-gray-50">
                    <ReadyRow label="CLOUDFLARE_ACCOUNT_ID" ok={cloudflare.accountId.configured} />
                    <ReadyRow label="CLOUDFLARE_PAGES_API_TOKEN" ok={cloudflare.pagesApiToken.configured} />
                    <ReadyRow label="CLOUDFLARE_DNS_API_TOKEN" ok={cloudflare.dnsApiToken.configured} />
                    <ReadyRow label="CLOUDFLARE_DEFAULT_ZONE_ID" ok={cloudflare.defaultZoneId.configured} hint="optional" />
                  </div>
                ) : (
                  <p className="text-[11px] text-gray-400">Loading Cloudflare readiness…</p>
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={saveTarget}
                disabled={saving}
                className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
              >
                <Save className={`h-4 w-4 ${saving ? 'animate-pulse' : ''}`} /> Save target
              </button>
              <button
                onClick={load}
                className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50"
              >
                <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Reload
              </button>
              <button
                disabled
                title="Deployment is disabled in this phase"
                className="inline-flex cursor-not-allowed items-center gap-1.5 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-400"
              >
                <Lock className="h-4 w-4" /> Deployment disabled — dry run only
              </button>
              {msg && <span className="text-xs text-gray-500">{msg}</span>}
            </div>

            {warnings.length > 0 && (
              <ul className="space-y-1">
                {warnings.map((w, i) => (
                  <li key={i} className="flex items-start gap-1.5 text-[11px] text-amber-700"><AlertTriangle className="mt-0.5 h-3 w-3 flex-shrink-0" />{w}</li>
                ))}
              </ul>
            )}

            {/* Environment variables */}
            <div className="rounded-xl border border-gray-100 p-4">
              <div className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-gray-800">
                <Variable className="h-4 w-4 text-indigo-500" /> Generated-site environment variables
              </div>
              <p className="mb-3 text-xs text-gray-500">
                <code>NEXT_PUBLIC_*</code> keys may be public. Secret-like keys must NOT use the public prefix and store a reference only. Examples: {PUBLIC_EXAMPLES.map((e) => <code key={e} className="mx-0.5 rounded bg-gray-100 px-1 text-[10px]">{e}</code>)}
              </p>

              {envVars.length > 0 ? (
                <ul className="mb-3 space-y-1">
                  {envVars.map((v) => (
                    <li key={v.id} className="flex flex-wrap items-center gap-2 rounded-md border border-gray-100 px-2.5 py-1.5 text-xs">
                      <code className="font-medium text-gray-800">{v.key}</code>
                      <span className={`rounded px-1.5 py-0.5 text-[10px] ${v.isPublic ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-600'}`}>{v.isPublic ? 'public' : 'secret ref'}</span>
                      <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] text-indigo-600">{v.environment}</span>
                      {v.isPublic
                        ? <span className="text-gray-500">= <code className="text-[11px]">{v.value || '(empty)'}</code></span>
                        : <span className="text-gray-400">ref: <code className="text-[11px]">{v.valueRef || '(none)'}</code></span>}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mb-3 text-xs text-gray-400">No environment variables configured yet.</p>
              )}

              <div className="grid gap-2 sm:grid-cols-[1.4fr_1.4fr_0.8fr_auto]">
                <input
                  type="text"
                  value={newKey}
                  onChange={(e) => setNewKey(e.target.value)}
                  placeholder="KEY (e.g. NEXT_PUBLIC_SITE_URL)"
                  className="rounded-lg border border-gray-200 px-3 py-2 font-mono text-xs focus:border-indigo-400 focus:outline-none"
                />
                <input
                  type="text"
                  value={newValue}
                  onChange={(e) => setNewValue(e.target.value)}
                  placeholder={newKeyIsPublic ? 'public value' : 'reference name (vault://...)'}
                  className="rounded-lg border border-gray-200 px-3 py-2 font-mono text-xs focus:border-indigo-400 focus:outline-none"
                />
                <select
                  value={newEnv}
                  onChange={(e) => setNewEnv(e.target.value)}
                  className="rounded-lg border border-gray-200 px-2 py-2 text-xs text-gray-700 focus:border-indigo-400 focus:outline-none"
                >
                  {ENVIRONMENTS.map((e) => <option key={e} value={e}>{e}</option>)}
                </select>
                <button
                  onClick={addEnvVar}
                  disabled={!newKey.trim()}
                  className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs font-medium text-indigo-700 hover:bg-indigo-100 disabled:opacity-50"
                >
                  <Plus className="h-3.5 w-3.5" /> Add
                </button>
              </div>
              <div className="mt-1.5 flex items-center gap-1.5 text-[11px]">
                {newKey && (
                  <span className={`inline-flex items-center gap-1 ${newKeyIsPublic ? 'text-green-600' : 'text-gray-500'}`}>
                    {newKeyIsPublic ? <CheckCircle2 className="h-3 w-3" /> : <KeyRound className="h-3 w-3" />}
                    {newKeyIsPublic ? 'Public variable (value stored inline)' : 'Secret variable (reference name only)'}
                  </span>
                )}
                {secretLikePublicWarn && (
                  <span className="inline-flex items-center gap-1 text-amber-600"><AlertTriangle className="h-3 w-3" /> Key looks secret-like but is marked public.</span>
                )}
              </div>
              {envMsg && <p className="mt-1.5 text-[11px] text-gray-500">{envMsg}</p>}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
