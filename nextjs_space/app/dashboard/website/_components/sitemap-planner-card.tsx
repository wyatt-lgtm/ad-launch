'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Map as MapIcon, RefreshCw, CheckCircle2, XCircle, AlertTriangle,
  Plus, Trash2, Lock, ListTree, ShieldCheck, FileText, Sparkles,
  ChevronDown, ChevronRight, Image as ImageIcon,
  Palette, Crop, Eye, ThumbsUp, ThumbsDown, Ban, Shield,
  Wand2, Gauge, FlaskConical, CheckSquare, Square,
} from 'lucide-react';
import { useSession } from 'next-auth/react';
import { useActiveBusiness } from '@/hooks/use-active-business';

/**
 * Sitemap-first planner (Milestone 2).
 *
 * Three tabs:
 *   1. Service Discovery — review + confirm/reject detected services.
 *   2. Sitemap Review    — review + revise the page tree, then approve.
 *   3. Copy Gate         — display-only status of the copy generation gate.
 *
 * This component NEVER generates copy, generates images, or publishes/deploys.
 * The "Generate Copy" affordance is intentionally disabled in this milestone.
 */

type ConfirmationStatus = 'confirmed' | 'likely' | 'needs_user_confirmation' | 'rejected';

interface DiscoveredService {
  serviceName: string;
  slug: string;
  confirmationStatus: ConfirmationStatus;
  source: string;
  evidence: string;
  confidence: number;
}

interface SitemapPage {
  title: string;
  slug: string;
  pageType: string;
  h1: string;
  sections: string[];
  parentSlug?: string;
  serviceName?: string;
  confirmationStatus?: ConfirmationStatus;
  source?: string;
  status?: string;
  approvalStatus: string;
  sortOrder: number;
}

interface SitemapArtifact {
  businessName: string;
  industry: string;
  primaryServiceArea: { city?: string; state?: string };
  websiteGoal: string;
  serviceAreaMode: string;
  serviceDiscovery: DiscoveredService[];
  pages: SitemapPage[];
  userRequestedPages: any[];
  approvalStatus: string;
  approvedAt: string | null;
  approvedBy: string | null;
}

interface SitemapIssue {
  kind: string;
  reason: string;
  slug?: string;
  pageType?: string;
}

interface CopyGate {
  status: string;
  allowed: boolean;
  code: string;
  reason: string;
  h1Issues?: any[];
  copyGenerationAvailable?: boolean;
}

interface CopyPage {
  slug: string;
  pageType: string;
  h1: string;
  metaTitle: string;
  metaDescription: string;
  heroHeadline: string;
  heroSubheadline?: string;
  primaryCta: string;
  secondaryCta?: string;
  sections: { name: string; heading?: string; body: string }[];
  faqs: { question: string; answer: string }[];
  internalLinks: { slug: string; label: string }[];
  imageNeeds: { section: string; note: string }[];
  seoBriefId?: string;
  seoBriefStatus?: string;
  stage: string;
}

interface CopyArtifact {
  sitemapId?: string;
  generatedAt: string | null;
  pageCount: number;
  pages: CopyPage[];
  stage: string;
}

const CONFIRM_BADGE: Record<ConfirmationStatus, string> = {
  confirmed: 'bg-green-100 text-green-700 border-green-200',
  likely: 'bg-blue-100 text-blue-700 border-blue-200',
  needs_user_confirmation: 'bg-amber-100 text-amber-700 border-amber-200',
  rejected: 'bg-gray-100 text-gray-500 border-gray-200',
};

const CONFIRM_LABEL: Record<ConfirmationStatus, string> = {
  confirmed: 'Confirmed',
  likely: 'Likely',
  needs_user_confirmation: 'Needs confirmation',
  rejected: 'Rejected',
};

const GATE_BADGE: Record<string, string> = {
  allowed_after_sitemap_approval: 'bg-green-100 text-green-700 border-green-200',
  blocked_missing_sitemap: 'bg-gray-100 text-gray-600 border-gray-200',
  blocked_sitemap_not_approved: 'bg-amber-100 text-amber-700 border-amber-200',
  blocked_invalid_sitemap: 'bg-red-100 text-red-700 border-red-200',
};

const GATE_LABEL: Record<string, string> = {
  allowed_after_sitemap_approval: 'Allowed — sitemap approved',
  blocked_missing_sitemap: 'Blocked — no sitemap yet',
  blocked_sitemap_not_approved: 'Blocked — sitemap not approved',
  blocked_invalid_sitemap: 'Blocked — sitemap has issues',
};

// ── Image brief (Milestone 4) shapes ──────────────────────────────────────
interface ImageBriefGate {
  allowed: boolean;
  code: string;
  reason: string;
}

interface ImageBriefItem {
  briefId: string;
  sectionName: string;
  sectionType: 'hero' | 'section';
  visualObjective: string;
  messageSupported: string;
  businessSpecificDirection: string;
  industryDetails: string[];
  localDetails: string[];
  forbiddenVisuals: string[];
  textSafeZone: string;
  mobileCropNotes: string;
  aspectRatio: string;
  assetSourcePreference: string;
  allowTextInImage: boolean;
  donContractReady: boolean;
  andyRenderReady: boolean;
}

interface PageImageBriefsItem {
  slug: string;
  pageType: string;
  h1: string;
  briefs: ImageBriefItem[];
}

interface ImageBriefArtifact {
  sitemapId: string | null;
  copyArtifactId: string | null;
  status: string;
  pages: PageImageBriefsItem[];
  summary: { pageCount: number; briefCount: number; heroBriefCount: number; generatedAt: string };
}

interface ImageBriefSet {
  id: string;
  status: string;
  sitemapId: string;
  copyArtifactId: string;
  pageCount: number;
  briefCount: number;
  createdAt: string;
  updatedAt: string;
  artifact: ImageBriefArtifact;
}

const BRIEF_STATUS_BADGE: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-600 border-gray-200',
  ready_for_review: 'bg-blue-100 text-blue-700 border-blue-200',
  approved: 'bg-green-100 text-green-700 border-green-200',
  revision_requested: 'bg-amber-100 text-amber-700 border-amber-200',
  failed: 'bg-red-100 text-red-700 border-red-200',
  archived: 'bg-gray-100 text-gray-400 border-gray-200',
};

interface ImageGenGate {
  allowed: boolean;
  code: string;
  reason: string;
  blockingBriefIds?: string[];
}

interface DryRunValidatedItem {
  briefId: string;
  pageSlug: string;
  sectionName: string;
  sectionType: string;
  assetRole: string;
  status: string;
  expectedR2Key: string;
  r2Bucket: string;
  promptSummary?: string | null;
  error?: string;
}

interface GeneratedImageAsset {
  id: string;
  imageBriefSetId: string;
  imageBriefId: string;
  pageSlug: string;
  sectionName: string;
  sectionType: string;
  assetRole: string;
  status: string;
  provider: string | null;
  model: string | null;
  r2Bucket: string | null;
  r2Key: string | null;
  mimeType: string | null;
  width: number | null;
  height: number | null;
  altText: string | null;
  promptSummary: string | null;
  visualRationale: string | null;
  qualityScore: number | null;
  brandFitScore: number | null;
  mobileSafeScore: number | null;
  textReadabilityScore: number | null;
  focalPointScore: number | null;
  qaStatus: string | null;
  requiredFixes: string[];
  createdAt: string;
}

const ASSET_STATUS_BADGE: Record<string, string> = {
  queued: 'bg-gray-100 text-gray-600 border-gray-200',
  generating: 'bg-blue-100 text-blue-700 border-blue-200',
  generated: 'bg-blue-100 text-blue-700 border-blue-200',
  ready_for_review: 'bg-indigo-100 text-indigo-700 border-indigo-200',
  qa_failed: 'bg-red-100 text-red-700 border-red-200',
  approved: 'bg-green-100 text-green-700 border-green-200',
  rejected: 'bg-amber-100 text-amber-700 border-amber-200',
  failed: 'bg-red-100 text-red-700 border-red-200',
  archived: 'bg-gray-100 text-gray-400 border-gray-200',
};

type TabKey = 'services' | 'sitemap' | 'copy' | 'imageBriefs' | 'generatedImages';

export default function SitemapPlannerCard() {
  const bizCtx = useActiveBusiness();
  const businessId = bizCtx.activeBusiness?.id || null;
  const { data: session } = useSession() || {};
  const isAdmin = ((session?.user as any)?.role || '') === 'admin';

  const [tab, setTab] = useState<TabKey>('services');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const [services, setServices] = useState<DiscoveredService[]>([]);
  const [sitemapId, setSitemapId] = useState<string | null>(null);
  const [sitemap, setSitemap] = useState<SitemapArtifact | null>(null);
  const [issues, setIssues] = useState<SitemapIssue[]>([]);
  const [gate, setGate] = useState<CopyGate | null>(null);
  const [revisions, setRevisions] = useState<any[]>([]);
  const [copy, setCopy] = useState<CopyArtifact | null>(null);
  const [copyLoading, setCopyLoading] = useState(false);
  const [pageIssues, setPageIssues] = useState<any[]>([]);
  const [uniquenessIssues, setUniquenessIssues] = useState<any[]>([]);
  const [openSlug, setOpenSlug] = useState<string | null>(null);

  // Image briefs (Milestone 4)
  const [briefGate, setBriefGate] = useState<ImageBriefGate | null>(null);
  const [briefSet, setBriefSet] = useState<ImageBriefSet | null>(null);
  const [copyPresent, setCopyPresent] = useState(false);
  const [briefLlmConfigured, setBriefLlmConfigured] = useState(true);
  const [briefLoading, setBriefLoading] = useState(false);
  const [briefIssues, setBriefIssues] = useState<any[]>([]);
  const [openBriefSlug, setOpenBriefSlug] = useState<string | null>(null);

  // ── Generated images (Milestone 5) ──
  const [imageGate, setImageGate] = useState<ImageGenGate | null>(null);
  const [genAssets, setGenAssets] = useState<GeneratedImageAsset[]>([]);
  const [genBriefSetId, setGenBriefSetId] = useState<string | null>(null);
  const [genBriefSetStatus, setGenBriefSetStatus] = useState<string | null>(null);
  const [providerConfigured, setProviderConfigured] = useState(true);
  const [genLoading, setGenLoading] = useState(false);
  const [assetUrls, setAssetUrls] = useState<Record<string, string>>({});
  // Cost-control: explicit brief selection + dry-run preview. The UI never
  // defaults to generating the whole batch.
  const [selectedBriefIds, setSelectedBriefIds] = useState<string[]>([]);
  const [dryRunResult, setDryRunResult] = useState<DryRunValidatedItem[] | null>(null);

  const [newServiceName, setNewServiceName] = useState('');
  const [newPageTitle, setNewPageTitle] = useState('');

  const notify = (m: string) => { setMsg(m); window.setTimeout(() => setMsg(null), 4000); };

  // ── Loaders ──────────────────────────────────────────────────────────────
  const loadServices = useCallback(async () => {
    if (!businessId) return;
    const res = await fetch(`/api/businesses/${businessId}/website/service-discovery`);
    if (res.ok) {
      const data = await res.json();
      setServices(data.services || []);
    }
  }, [businessId]);

  const loadSitemap = useCallback(async () => {
    if (!businessId) return;
    const res = await fetch(`/api/businesses/${businessId}/website/sitemap`);
    if (res.ok) {
      const data = await res.json();
      setSitemapId(data.sitemapId || null);
      setSitemap(data.sitemap || null);
      setIssues(data.issues || []);
    }
  }, [businessId]);

  const loadGate = useCallback(async () => {
    if (!businessId) return;
    const res = await fetch(`/api/businesses/${businessId}/website/copy-gate`);
    if (res.ok) setGate(await res.json());
  }, [businessId]);

  const loadRevisions = useCallback(async () => {
    if (!businessId || !sitemapId) { setRevisions([]); return; }
    const res = await fetch(`/api/businesses/${businessId}/website/sitemap/${sitemapId}/revisions`);
    if (res.ok) setRevisions((await res.json()).revisions || []);
  }, [businessId, sitemapId]);

  const loadCopy = useCallback(async () => {
    if (!businessId) return;
    const res = await fetch(`/api/businesses/${businessId}/website/copy`);
    if (res.ok) {
      const data = await res.json();
      if (data.copyGate) setGate(data.copyGate);
      setCopy(data.copy || null);
    }
  }, [businessId]);

  const loadImageBriefs = useCallback(async () => {
    if (!businessId) return;
    const res = await fetch(`/api/businesses/${businessId}/website/image-briefs`);
    if (res.ok) {
      const data = await res.json();
      setBriefGate(data.briefGate || null);
      setBriefSet(data.latest || null);
      setCopyPresent(Boolean(data.copyPresent));
      setBriefLlmConfigured(data.llmConfigured !== false);
    }
  }, [businessId]);

  const resolveAssetUrls = useCallback(async (assets: GeneratedImageAsset[]) => {
    const pending = assets.filter((a) => a.r2Key && !assetUrls[a.id]);
    if (!pending.length) return;
    const entries = await Promise.all(pending.map(async (a) => {
      try {
        const r = await fetch(`/api/resolve-image?key=${encodeURIComponent(a.r2Key as string)}`);
        if (!r.ok) return null;
        const d = await r.json();
        return d?.url ? ([a.id, d.url] as [string, string]) : null;
      } catch { return null; }
    }));
    const next: Record<string, string> = {};
    for (const e of entries) { if (e) next[e[0]] = e[1]; }
    if (Object.keys(next).length) setAssetUrls((prev) => ({ ...prev, ...next }));
  }, [assetUrls]);

  const loadGeneratedImages = useCallback(async () => {
    if (!businessId) return;
    const res = await fetch(`/api/businesses/${businessId}/website/generated-images`);
    if (res.ok) {
      const data = await res.json();
      setImageGate(data.imageGate || null);
      setGenAssets(data.assets || []);
      setGenBriefSetId(data.briefSetId || null);
      setGenBriefSetStatus(data.briefSetStatus || null);
      setProviderConfigured(data.providerConfigured !== false);
      resolveAssetUrls(data.assets || []);
    }
  }, [businessId, resolveAssetUrls]);

  useEffect(() => { loadServices(); loadSitemap(); loadGate(); loadCopy(); loadImageBriefs(); loadGeneratedImages(); }, [loadServices, loadSitemap, loadGate, loadCopy, loadImageBriefs, loadGeneratedImages]);
  useEffect(() => { loadRevisions(); }, [loadRevisions]);

  // ── Generated image actions (Milestone 5C) ──
  // Flat list of briefs from the approved brief set for explicit selection.
  const allBriefs = (briefSet?.artifact.pages || []).flatMap((p) =>
    (p.briefs || []).map((b) => ({
      briefId: b.briefId,
      sectionName: b.sectionName,
      sectionType: b.sectionType,
      pageSlug: p.slug,
      isHero: b.sectionType === 'hero',
    })),
  );
  const firstHeroBriefId = allBriefs.find((b) => b.isHero)?.briefId || allBriefs[0]?.briefId || null;

  const toggleBriefSelected = (briefId: string) => {
    setSelectedBriefIds((prev) =>
      prev.includes(briefId) ? prev.filter((x) => x !== briefId) : [...prev, briefId],
    );
  };

  /**
   * Cost-controlled generate. Always sends the dedicated /generate route with an
   * explicit, bounded payload. Never triggers a full unbounded batch.
   */
  const runGenerate = async (opts: { briefIds: string[]; maxImages: number; dryRun: boolean }) => {
    if (!businessId) return;
    if (!opts.briefIds.length) { notify('Select at least one image brief first.'); return; }
    setGenLoading(true);
    if (opts.dryRun) setDryRunResult(null);
    try {
      const res = await fetch(`/api/businesses/${businessId}/website/generated-images/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageBriefSetId: genBriefSetId,
          imageBriefIds: opts.briefIds,
          maxImages: opts.maxImages,
          dryRun: opts.dryRun,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.dryRun) {
        setDryRunResult(data.validated || []);
        const okCount = (data.validated || []).filter((v: DryRunValidatedItem) => !v.error).length;
        notify(`Dry-run validated ${okCount} contract${okCount === 1 ? '' : 's'}. No image was generated and nothing was stored.`);
      } else if (res.ok) {
        setDryRunResult(null);
        await loadGeneratedImages();
        const n = (data.assets || []).length;
        const f = (data.failedBriefIds || []).length;
        notify(`Generated ${n} image${n === 1 ? '' : 's'}${f ? ` (${f} failed QA/render)` : ''}. No static build, publish, or deploy was run.`);
      } else if (res.status === 422 && data.imageGate) {
        setImageGate(data.imageGate);
        notify(data.error || 'Image generation is blocked until the image briefs are approved.');
      } else if (res.status === 503) {
        notify(data.error || 'Image generation is not configured.');
      } else {
        notify(data.error || 'Could not generate images.');
      }
    } finally { setGenLoading(false); }
  };

  const generateOneTest = () => {
    if (!firstHeroBriefId) { notify('No image briefs available to generate.'); return; }
    runGenerate({ briefIds: [firstHeroBriefId], maxImages: 1, dryRun: false });
  };
  const generateSelected = () => {
    runGenerate({ briefIds: selectedBriefIds, maxImages: Math.max(1, selectedBriefIds.length), dryRun: false });
  };
  const dryRunSelected = () => {
    const ids = selectedBriefIds.length ? selectedBriefIds : (firstHeroBriefId ? [firstHeroBriefId] : []);
    runGenerate({ briefIds: ids, maxImages: Math.max(1, ids.length), dryRun: true });
  };
  const generateFullBatch = () => {
    if (!isAdmin) return;
    const ids = allBriefs.map((b) => b.briefId);
    if (!ids.length) { notify('No image briefs available.'); return; }
    if (!window.confirm(`Generate ALL ${ids.length} images? This runs a full live render batch and consumes generation budget. This is an admin-only action.`)) return;
    runGenerate({ briefIds: ids, maxImages: ids.length, dryRun: false });
  };

  const approveAsset = async (assetId: string) => {
    if (!businessId) return;
    setGenLoading(true);
    try {
      const res = await fetch(`/api/businesses/${businessId}/website/generated-images/${assetId}/approve`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (res.ok) { await loadGeneratedImages(); notify('Asset approved.'); }
      else notify(data.error || 'Could not approve asset.');
    } finally { setGenLoading(false); }
  };

  const rejectAsset = async (assetId: string) => {
    if (!businessId) return;
    setGenLoading(true);
    try {
      const res = await fetch(`/api/businesses/${businessId}/website/generated-images/${assetId}/reject`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: 'Revision requested from review.' }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) { await loadGeneratedImages(); notify('Asset rejected / revision requested.'); }
      else notify(data.error || 'Could not reject asset.');
    } finally { setGenLoading(false); }
  };

  // ── Copy actions ─────────────────────────────────────────────────────────
  const generateCopy = async () => {
    if (!businessId) return;
    setCopyLoading(true);
    setPageIssues([]); setUniquenessIssues([]);
    try {
      const res = await fetch(`/api/businesses/${businessId}/website/copy`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        const pages = data.copy?.pages || [];
        setCopy({
          sitemapId: data.sitemapId,
          generatedAt: data.copy?.generatedAt || new Date().toISOString(),
          pageCount: pages.length,
          pages,
          stage: data.stage || 'draft',
        });
        setPageIssues(data.pageIssues || []);
        setUniquenessIssues(data.uniquenessIssues || []);
        notify(`Draft copy generated for ${pages.length} page${pages.length === 1 ? '' : 's'}. Review before the next milestone.`);
      } else if (res.status === 422 && data.copyGate) {
        setGate(data.copyGate);
        notify(data.error || 'Copy generation is blocked until the sitemap is approved.');
      } else {
        notify(data.error || 'Could not generate copy.');
      }
    } finally { setCopyLoading(false); }
  };

  // ── Image brief actions (Milestone 4) ────────────────────────────────────
  const generateImageBriefs = async () => {
    if (!businessId) return;
    setBriefLoading(true);
    setBriefIssues([]);
    try {
      const res = await fetch(`/api/businesses/${businessId}/website/image-briefs`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setBriefSet(data.briefSet || null);
        setBriefIssues(data.issues || []);
        const bc = data.briefSet?.briefCount ?? 0;
        notify(`Draft image briefs generated (${bc} brief${bc === 1 ? '' : 's'}). No images were generated.`);
      } else if (res.status === 422 && data.briefGate) {
        setBriefGate(data.briefGate);
        notify(data.error || 'Image briefs are blocked until an approved sitemap and website copy exist.');
      } else if (res.status === 503) {
        notify(data.error || 'Image brief generation is not configured.');
      } else {
        notify(data.error || 'Could not generate image briefs.');
      }
    } finally { setBriefLoading(false); }
  };

  const approveBriefs = async () => {
    if (!businessId || !briefSet) return;
    setBriefLoading(true);
    try {
      const res = await fetch(`/api/businesses/${businessId}/website/image-briefs/${briefSet.id}/approve`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (res.ok) { setBriefSet(data.briefSet || briefSet); notify('Image briefs approved. No images were generated.'); }
      else notify(data.error || 'Could not approve image briefs.');
    } finally { setBriefLoading(false); }
  };

  const requestBriefRevision = async () => {
    if (!businessId || !briefSet) return;
    setBriefLoading(true);
    try {
      const res = await fetch(`/api/businesses/${businessId}/website/image-briefs/${briefSet.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'revision_requested' }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) { setBriefSet(data.briefSet || briefSet); notify('Revision requested for the image briefs.'); }
      else notify(data.error || 'Could not request revision.');
    } finally { setBriefLoading(false); }
  };

  // ── Service actions ──────────────────────────────────────────────────────
  const seedServices = async () => {
    if (!businessId) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/businesses/${businessId}/website/service-discovery`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seed: true }),
      });
      if (res.ok) { setServices((await res.json()).services || []); notify('Service ideas refreshed from your business profile.'); }
      else notify('Could not load service ideas.');
    } finally { setBusy(false); }
  };

  const saveServices = async (next: DiscoveredService[]) => {
    if (!businessId) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/businesses/${businessId}/website/service-discovery`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ services: next }),
      });
      if (res.ok) { setServices((await res.json()).services || next); notify('Services saved.'); }
      else notify('Could not save services.');
    } finally { setBusy(false); }
  };

  const setServiceStatus = (name: string, status: ConfirmationStatus) => {
    const next = services.map((s) => s.serviceName === name ? { ...s, confirmationStatus: status } : s);
    setServices(next);
    saveServices(next);
  };

  const addService = () => {
    const name = newServiceName.trim();
    if (!name) return;
    const slug = `/services/${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')}`;
    const next: DiscoveredService[] = [
      ...services,
      { serviceName: name, slug, confirmationStatus: 'confirmed', source: 'user', evidence: 'Added by user', confidence: 1 },
    ];
    setNewServiceName('');
    setServices(next);
    saveServices(next);
  };

  const removeService = (name: string) => {
    const next = services.filter((s) => s.serviceName !== name);
    setServices(next);
    saveServices(next);
  };

  // ── Sitemap actions ──────────────────────────────────────────────────────
  const generateSitemap = async () => {
    if (!businessId) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/businesses/${businessId}/website/sitemap`, { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        setSitemapId(data.sitemapId); setSitemap(data.sitemap); setIssues(data.issues || []);
        notify('Sitemap generated from confirmed services.');
        loadGate();
      } else notify('Could not generate the sitemap.');
    } finally { setBusy(false); }
  };

  const applyEdit = async (payload: any, okMsg: string) => {
    if (!businessId || !sitemapId) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/businesses/${businessId}/website/sitemap/${sitemapId}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        const data = await res.json();
        setSitemap(data.sitemap); setIssues(data.issues || []);
        notify(okMsg); loadGate(); loadRevisions();
      } else {
        const err = await res.json().catch(() => ({}));
        notify(err.error || 'Edit failed.');
      }
    } finally { setBusy(false); }
  };

  const addUserPage = async () => {
    const title = newPageTitle.trim();
    if (!businessId || !sitemapId || !title) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/businesses/${businessId}/website/sitemap/${sitemapId}/revisions`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title }),
      });
      if (res.ok) {
        const data = await res.json();
        setSitemap(data.sitemap); setIssues(data.issues || []); setNewPageTitle('');
        notify(`Added “${title}”. The sitemap now needs re-review.`);
        loadGate(); loadRevisions();
      } else notify('Could not add the page.');
    } finally { setBusy(false); }
  };

  const approveSitemap = async () => {
    if (!businessId || !sitemapId) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/businesses/${businessId}/website/sitemap/${sitemapId}/approve`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setSitemap(data.sitemap); setIssues([]);
        notify('Sitemap approved. You can now generate draft copy from the Copy Review tab.');
        loadGate(); loadCopy();
      } else {
        setIssues(data.issues || []);
        notify(data.error || 'Sitemap cannot be approved yet.');
      }
    } finally { setBusy(false); }
  };

  // ── Render helpers ───────────────────────────────────────────────────────
  if (!businessId) {
    return (
      <div className="rounded-2xl border border-gray-200 bg-white shadow-sm p-6">
        <div className="flex items-center gap-2 text-gray-900">
          <MapIcon className="h-5 w-5 text-indigo-600" />
          <h2 className="text-base font-semibold">Sitemap planner</h2>
        </div>
        <p className="mt-2 text-sm text-gray-500">Select a business to plan its sitemap.</p>
      </div>
    );
  }

  const confirmedCount = services.filter((s) => s.confirmationStatus === 'confirmed').length;
  const approved = sitemap?.approvalStatus === 'approved';
  const canApprove = !!sitemap && issues.length === 0;

  return (
    <div className="rounded-2xl border border-gray-200 bg-white shadow-sm">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 border-b border-gray-100 p-5">
        <div className="flex items-center gap-2">
          <div className="rounded-lg bg-indigo-50 p-2"><MapIcon className="h-5 w-5 text-indigo-600" /></div>
          <div>
            <h2 className="text-base font-semibold text-gray-900">Sitemap-first planner</h2>
            <p className="text-xs text-gray-500">Confirm services, review the page plan, and approve the sitemap before copy.</p>
          </div>
        </div>
        <span className="inline-flex items-center gap-1 rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-[11px] font-medium text-indigo-700">
          <ListTree className="h-3 w-3" /> Plan &amp; approve
        </span>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-100 px-3">
        {([
          ['services', 'Service Discovery'],
          ['sitemap', 'Sitemap Review'],
          ['copy', 'Copy Review'],
          ['imageBriefs', 'Image Briefs'],
          ['generatedImages', 'Generated Images'],
        ] as [TabKey, string][]).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === key ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {msg && (
        <div className="mx-5 mt-4 rounded-lg border border-indigo-100 bg-indigo-50 px-3 py-2 text-sm text-indigo-700">{msg}</div>
      )}

      {/* ── Service Discovery tab ── */}
      {tab === 'services' && (
        <div className="p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-gray-600">
              {services.length} detected · <span className="font-medium text-green-700">{confirmedCount} confirmed</span>. Only confirmed services become service pages.
            </p>
            <button onClick={seedServices} disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">
              <Sparkles className="h-4 w-4" /> Request more service ideas
            </button>
          </div>

          {services.length === 0 ? (
            <div className="rounded-lg border border-dashed border-gray-200 p-6 text-center text-sm text-gray-500">
              No services detected yet. Use “Request more service ideas” to pull from your business profile, or add one below.
            </div>
          ) : (
            <div className="divide-y divide-gray-100 rounded-lg border border-gray-100">
              {services.map((s) => (
                <div key={s.serviceName} className="flex flex-wrap items-center justify-between gap-3 p-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-gray-900">{s.serviceName}</span>
                      <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${CONFIRM_BADGE[s.confirmationStatus]}`}>
                        {CONFIRM_LABEL[s.confirmationStatus]}
                      </span>
                      <span className={`text-[11px] font-medium ${s.confirmationStatus === 'confirmed' ? 'text-green-600' : 'text-gray-400'}`}>
                        {s.confirmationStatus === 'confirmed' ? 'In sitemap' : 'Not in sitemap'}
                      </span>
                    </div>
                    <p className="truncate text-xs text-gray-500">
                      {s.slug} · source: {s.source} · confidence: {Math.round((s.confidence || 0) * 100)}%
                      {s.evidence ? ` · ${s.evidence}` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button onClick={() => setServiceStatus(s.serviceName, 'confirmed')} disabled={busy}
                      className="inline-flex items-center gap-1 rounded-md border border-green-200 bg-green-50 px-2 py-1 text-xs font-medium text-green-700 hover:bg-green-100 disabled:opacity-50">
                      <CheckCircle2 className="h-3.5 w-3.5" /> Offered
                    </button>
                    <button onClick={() => setServiceStatus(s.serviceName, 'rejected')} disabled={busy}
                      className="inline-flex items-center gap-1 rounded-md border border-gray-200 px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-100 disabled:opacity-50">
                      <XCircle className="h-3.5 w-3.5" /> Not offered
                    </button>
                    <button onClick={() => removeService(s.serviceName)} disabled={busy}
                      className="inline-flex items-center rounded-md border border-gray-200 px-2 py-1 text-xs text-gray-400 hover:bg-gray-100 hover:text-red-600 disabled:opacity-50" title="Remove">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="flex items-center gap-2">
            <input value={newServiceName} onChange={(e) => setNewServiceName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') addService(); }}
              placeholder="Add a service you offer…"
              className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none" />
            <button onClick={addService} disabled={busy || !newServiceName.trim()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
              <Plus className="h-4 w-4" /> Add service
            </button>
          </div>
        </div>
      )}

      {/* ── Sitemap Review tab ── */}
      {tab === 'sitemap' && (
        <div className="p-5 space-y-4">
          {!sitemap ? (
            <div className="rounded-lg border border-dashed border-gray-200 p-6 text-center">
              <p className="text-sm text-gray-500">No sitemap yet. Confirm your services, then generate the sitemap plan.</p>
              <button onClick={generateSitemap} disabled={busy || confirmedCount === 0}
                className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
                <RefreshCw className="h-4 w-4" /> Generate sitemap
              </button>
              {confirmedCount === 0 && <p className="mt-2 text-xs text-amber-600">Confirm at least one service first.</p>}
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="text-sm text-gray-600">
                  <span className="font-medium text-gray-900">{sitemap.pages.length} pages</span> · {sitemap.businessName} · {sitemap.primaryServiceArea?.city}{sitemap.primaryServiceArea?.state ? `, ${sitemap.primaryServiceArea.state}` : ''}
                  <span className={`ml-2 rounded-full border px-2 py-0.5 text-[11px] font-medium ${approved ? 'bg-green-100 text-green-700 border-green-200' : 'bg-amber-100 text-amber-700 border-amber-200'}`}>
                    {approved ? 'Approved' : 'Pending review'}
                  </span>
                </div>
                <button onClick={generateSitemap} disabled={busy}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">
                  <RefreshCw className="h-4 w-4" /> Regenerate
                </button>
              </div>

              {/* Validation issues */}
              {issues.length > 0 && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3">
                  <div className="flex items-center gap-1.5 text-sm font-medium text-red-700">
                    <AlertTriangle className="h-4 w-4" /> {issues.length} issue{issues.length > 1 ? 's' : ''} must be fixed before approval
                  </div>
                  <ul className="mt-1.5 space-y-1 text-xs text-red-600">
                    {issues.map((iss, i) => (<li key={i}>• {iss.reason}</li>))}
                  </ul>
                </div>
              )}

              {/* Page tree */}
              <div className="divide-y divide-gray-100 rounded-lg border border-gray-100">
                {sitemap.pages.slice().sort((a, b) => a.sortOrder - b.sortOrder).map((p) => (
                  <div key={p.slug} className={`p-3 ${p.parentSlug ? 'pl-8' : ''}`}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-gray-900">{p.title}</span>
                          <span className="rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-[11px] text-gray-600">{p.pageType}</span>
                          {p.source === 'user_requested' && (
                            <span className="rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[11px] text-violet-700">User requested</span>
                          )}
                        </div>
                        <p className="truncate text-xs text-gray-500">{p.slug} · H1: {p.h1}</p>
                        <p className="truncate text-[11px] text-gray-400">Sections: {p.sections.join(', ')}</p>
                      </div>
                      <div className="flex items-center gap-1.5">
                        {p.pageType !== 'home' && (
                          <button onClick={() => applyEdit({ action: 'remove_page', slug: p.slug }, 'Page removed. Re-review required.')} disabled={busy}
                            className="inline-flex items-center rounded-md border border-gray-200 px-2 py-1 text-xs text-gray-400 hover:bg-gray-100 hover:text-red-600 disabled:opacity-50" title="Remove page">
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Add user-requested page */}
              <div className="flex items-center gap-2">
                <input value={newPageTitle} onChange={(e) => setNewPageTitle(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') addUserPage(); }}
                  placeholder='Request a page (e.g. “Tombstone vs Tabloo”)…'
                  className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none" />
                <button onClick={addUserPage} disabled={busy || !newPageTitle.trim()}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">
                  <Plus className="h-4 w-4" /> Request page
                </button>
              </div>

              {/* Approve */}
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gray-100 bg-gray-50 p-3">
                <div className="text-sm text-gray-600">
                  {approved
                    ? <span className="inline-flex items-center gap-1 text-green-700"><ShieldCheck className="h-4 w-4" /> Approved{sitemap.approvedAt ? ` on ${new Date(sitemap.approvedAt).toLocaleDateString('en-US')}` : ''}.</span>
                    : 'Approving locks in the page plan so copy can be generated in the next milestone.'}
                </div>
                <button onClick={approveSitemap} disabled={busy || !canApprove || approved}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50">
                  <CheckCircle2 className="h-4 w-4" /> {approved ? 'Approved' : 'Approve & continue'}
                </button>
              </div>

              {/* Revision history */}
              {revisions.length > 0 && (
                <details className="rounded-lg border border-gray-100 p-3">
                  <summary className="cursor-pointer text-sm font-medium text-gray-700">Revision history ({revisions.length})</summary>
                  <ul className="mt-2 space-y-1 text-xs text-gray-500">
                    {revisions.map((r) => (
                      <li key={r.id}>{new Date(r.createdAt).toLocaleString('en-US')} — {r.action}{r.pageTitle ? `: ${r.pageTitle}` : ''}</li>
                    ))}
                  </ul>
                </details>
              )}
            </>
          )}
        </div>
      )}

      {/* ── Copy Review tab ── */}
      {tab === 'copy' && (
        <div className="p-5 space-y-4">
          {/* Gate status */}
          <div className="rounded-lg border border-gray-100 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <FileText className="h-5 w-5 text-gray-500" />
              <span className="text-sm font-medium text-gray-900">Copy generation gate</span>
              {gate && (
                <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${GATE_BADGE[gate.status] || 'bg-gray-100 text-gray-600 border-gray-200'}`}>
                  {GATE_LABEL[gate.status] || gate.status}
                </span>
              )}
            </div>
            <p className="mt-2 text-sm text-gray-600">{gate?.reason || 'Loading gate status…'}</p>
            {gate?.h1Issues && gate.h1Issues.length > 0 && (
              <ul className="mt-2 space-y-1 text-xs text-red-600">
                {gate.h1Issues.map((h: any, i: number) => (<li key={i}>• {h.message || h.reason || JSON.stringify(h)}</li>))}
              </ul>
            )}
          </div>

          {/* Generate action */}
          <div className="flex flex-col gap-3 rounded-lg border border-gray-100 bg-gray-50 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-sm text-gray-600">
              {gate?.allowed
                ? 'Generate page-by-page draft copy from your approved sitemap. Copy is a draft for your review — nothing is published or deployed.'
                : 'Approve your sitemap first. Copy generation stays locked until the sitemap is approved and all H1s are valid.'}
            </div>
            {gate?.allowed ? (
              <button
                onClick={generateCopy}
                disabled={copyLoading}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-indigo-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
              >
                {copyLoading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                {copyLoading ? 'Generating copy…' : copy ? 'Regenerate copy' : 'Generate copy from approved sitemap'}
              </button>
            ) : (
              <button disabled title="Blocked until sitemap approval"
                className="inline-flex shrink-0 cursor-not-allowed items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3.5 py-2 text-sm font-medium text-gray-400">
                <Lock className="h-4 w-4" /> Generate Copy — blocked until sitemap approval
              </button>
            )}
          </div>

          {/* Validation issues */}
          {(pageIssues.length > 0 || uniquenessIssues.length > 0) && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
              <div className="flex items-center gap-2 text-sm font-medium text-amber-800">
                <AlertTriangle className="h-4 w-4" /> Copy validation issues
              </div>
              <ul className="mt-2 space-y-1 text-xs text-amber-700">
                {uniquenessIssues.map((u: any, i: number) => (
                  <li key={`u${i}`}>• Duplicate copy between {u.slugA} and {u.slugB}: {u.reason}</li>
                ))}
                {pageIssues.map((p: any, i: number) => (
                  <li key={`p${i}`}>• {p.slug}: {p.reason}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Copy artifact */}
          {copy && copy.pages.length > 0 ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm font-medium text-gray-900">
                  Draft copy · {copy.pageCount} page{copy.pageCount === 1 ? '' : 's'}
                  <span className="ml-2 rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-700">draft</span>
                </div>
                {copy.generatedAt && (
                  <span className="text-xs text-gray-400">Generated {new Date(copy.generatedAt).toLocaleString('en-US')}</span>
                )}
              </div>

              <div className="space-y-2">
                {copy.pages.map((p) => {
                  const open = openSlug === p.slug;
                  const hasIssues = pageIssues.some((pi: any) => pi.slug === p.slug);
                  return (
                    <div key={p.slug} className="rounded-lg border border-gray-100">
                      <button
                        onClick={() => setOpenSlug(open ? null : p.slug)}
                        className="flex w-full items-start justify-between gap-3 p-3 text-left"
                      >
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-gray-500">{p.pageType}</span>
                            <span className="truncate text-sm font-medium text-gray-900">{p.h1}</span>
                          </div>
                          <div className="mt-1 truncate text-xs text-gray-500">{p.slug}</div>
                          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-gray-500">
                            <span>{p.sections.length} sections</span>
                            <span>{p.faqs.length} FAQs</span>
                            <span className="inline-flex items-center gap-1"><ImageIcon className="h-3 w-3" /> {p.imageNeeds.length} image needs</span>
                            {p.seoBriefStatus === 'approved' && <span className="text-indigo-600">SEO brief linked</span>}
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          {hasIssues
                            ? <span className="inline-flex items-center gap-1 text-[11px] text-amber-600"><AlertTriangle className="h-3.5 w-3.5" /> needs review</span>
                            : <span className="inline-flex items-center gap-1 text-[11px] text-green-600"><CheckCircle2 className="h-3.5 w-3.5" /> valid</span>}
                          {open ? <ChevronDown className="h-4 w-4 text-gray-400" /> : <ChevronRight className="h-4 w-4 text-gray-400" />}
                        </div>
                      </button>
                      {open && (
                        <div className="space-y-3 border-t border-gray-100 p-3 text-sm">
                          <div>
                            <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Meta title</div>
                            <div className="text-gray-700">{p.metaTitle}</div>
                          </div>
                          <div>
                            <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Meta description</div>
                            <div className="text-gray-700">{p.metaDescription}</div>
                          </div>
                          <div>
                            <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Hero</div>
                            <div className="font-medium text-gray-800">{p.heroHeadline}</div>
                            {p.heroSubheadline && <div className="text-gray-600">{p.heroSubheadline}</div>}
                            <div className="mt-1 flex flex-wrap gap-2 text-[11px]">
                              <span className="rounded bg-indigo-50 px-2 py-0.5 text-indigo-700">{p.primaryCta}</span>
                              {p.secondaryCta && <span className="rounded bg-gray-100 px-2 py-0.5 text-gray-600">{p.secondaryCta}</span>}
                            </div>
                          </div>
                          {p.sections.map((s, i) => (
                            <div key={i}>
                              <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">{s.heading || s.name}</div>
                              <div className="whitespace-pre-line text-gray-700">{s.body}</div>
                            </div>
                          ))}
                          {p.faqs.length > 0 && (
                            <div>
                              <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">FAQs</div>
                              <ul className="mt-1 space-y-1">
                                {p.faqs.map((f, i) => (
                                  <li key={i}><span className="font-medium text-gray-800">{f.question}</span> <span className="text-gray-600">{f.answer}</span></li>
                                ))}
                              </ul>
                            </div>
                          )}
                          {p.internalLinks.length > 0 && (
                            <div className="text-[11px] text-gray-500">Internal links: {p.internalLinks.map((l) => l.label).join(', ')}</div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 p-3 text-xs text-gray-500">
                Image briefs and website build are available in a later milestone. No images were generated and nothing was published or deployed.
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-gray-200 p-6 text-center text-sm text-gray-400">
              No copy generated yet.{gate?.allowed ? ' Use the button above to generate draft copy.' : ''}
            </div>
          )}
        </div>
      )}

      {/* ── Image Briefs tab (Milestone 4) ── */}
      {tab === 'imageBriefs' && (
        <div className="p-5 space-y-4">
          {/* Gate status */}
          <div className="rounded-lg border border-gray-100 bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm font-medium text-gray-900">
                <Palette className="h-4 w-4 text-indigo-600" /> Image brief gate
              </div>
              <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium ${
                briefGate?.allowed ? 'bg-green-100 text-green-700 border-green-200'
                  : copyPresent ? 'bg-amber-100 text-amber-700 border-amber-200'
                  : 'bg-gray-100 text-gray-600 border-gray-200'
              }`}>
                {briefGate?.allowed ? <ShieldCheck className="h-3 w-3" /> : <Lock className="h-3 w-3" />}
                {briefGate?.allowed ? 'Allowed — sitemap + copy ready' : copyPresent ? 'Blocked — review requirements' : 'Blocked — website copy required'}
              </span>
            </div>
            <p className="mt-2 text-sm text-gray-600">{briefGate?.reason || 'Loading gate status…'}</p>
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-gray-500">
              <span className="inline-flex items-center gap-1">
                {sitemapId ? <CheckCircle2 className="h-3.5 w-3.5 text-green-600" /> : <XCircle className="h-3.5 w-3.5 text-gray-400" />}
                Approved sitemap {sitemapId ? 'present' : 'missing'}
              </span>
              <span className="inline-flex items-center gap-1">
                {copyPresent ? <CheckCircle2 className="h-3.5 w-3.5 text-green-600" /> : <XCircle className="h-3.5 w-3.5 text-gray-400" />}
                Website copy {copyPresent ? 'present' : 'missing'}
              </span>
            </div>
          </div>

          {/* Generate action */}
          <div className="flex flex-col gap-3 rounded-lg border border-gray-100 bg-gray-50 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-sm text-gray-600">
              {briefGate?.allowed
                ? 'Generate durable image briefs from your approved copy. These are written specifications for review only — no images are generated, uploaded, built, or published.'
                : copyPresent
                  ? 'Resolve the gate requirements above before generating image briefs.'
                  : 'Generate website copy first. Image briefs stay locked until website copy exists.'}
            </div>
            {briefGate?.allowed && briefLlmConfigured ? (
              <button
                onClick={generateImageBriefs}
                disabled={briefLoading}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-indigo-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
              >
                {briefLoading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Palette className="h-4 w-4" />}
                {briefLoading ? 'Generating briefs…' : briefSet ? 'Regenerate image briefs' : 'Generate from Copy'}
              </button>
            ) : (
              <button disabled title="Blocked until website copy exists"
                className="inline-flex shrink-0 cursor-not-allowed items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3.5 py-2 text-sm font-medium text-gray-400">
                <Lock className="h-4 w-4" /> Generate Image Briefs — blocked until website copy exists
              </button>
            )}
          </div>

          {/* Brief set summary + review actions */}
          {briefSet ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm font-medium text-gray-900">
                  Image briefs · {briefSet.pageCount} page{briefSet.pageCount === 1 ? '' : 's'} · {briefSet.briefCount} brief{briefSet.briefCount === 1 ? '' : 's'}
                  <span className={`ml-2 rounded-full border px-2 py-0.5 text-[11px] font-medium ${BRIEF_STATUS_BADGE[briefSet.status] || BRIEF_STATUS_BADGE.draft}`}>
                    {briefSet.status.replace(/_/g, ' ')}
                  </span>
                </div>
                <span className="text-xs text-gray-400">Generated {new Date(briefSet.artifact?.summary?.generatedAt || briefSet.createdAt).toLocaleString('en-US')}</span>
              </div>

              {/* Review actions (low-risk only) */}
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={approveBriefs}
                  disabled={briefLoading || briefSet.status === 'approved'}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
                >
                  <ThumbsUp className="h-4 w-4" /> {briefSet.status === 'approved' ? 'Approved' : 'Approve'}
                </button>
                <button
                  onClick={requestBriefRevision}
                  disabled={briefLoading || briefSet.status === 'revision_requested'}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-sm font-medium text-amber-700 hover:bg-amber-100 disabled:opacity-50"
                >
                  <RefreshCw className="h-4 w-4" /> Request revision
                </button>
              </div>

              {briefIssues.length > 0 && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
                  <div className="flex items-center gap-2 text-sm font-medium text-amber-800">
                    <AlertTriangle className="h-4 w-4" /> Image brief validation issues
                  </div>
                  <ul className="mt-2 space-y-1 text-xs text-amber-700">
                    {briefIssues.map((b: any, i: number) => (<li key={i}>• {b.slug}: {b.reason}</li>))}
                  </ul>
                </div>
              )}

              {/* Per-page briefs */}
              <div className="space-y-2">
                {(briefSet.artifact?.pages || []).map((p) => {
                  const open = openBriefSlug === p.slug;
                  const heroCount = p.briefs.filter((b) => b.sectionType === 'hero').length;
                  return (
                    <div key={p.slug} className="rounded-lg border border-gray-100">
                      <button
                        onClick={() => setOpenBriefSlug(open ? null : p.slug)}
                        className="flex w-full items-start justify-between gap-3 p-3 text-left"
                      >
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-gray-500">{p.pageType}</span>
                            <span className="truncate text-sm font-medium text-gray-900">{p.h1}</span>
                          </div>
                          <div className="mt-1 truncate text-xs text-gray-500">{p.slug}</div>
                          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-gray-500">
                            <span className="inline-flex items-center gap-1"><Palette className="h-3 w-3" /> {p.briefs.length} brief{p.briefs.length === 1 ? '' : 's'}</span>
                            <span className={`inline-flex items-center gap-1 ${heroCount ? 'text-green-600' : 'text-red-600'}`}>
                              {heroCount ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />} hero {heroCount ? 'present' : 'missing'}
                            </span>
                          </div>
                        </div>
                        {open ? <ChevronDown className="h-4 w-4 text-gray-400" /> : <ChevronRight className="h-4 w-4 text-gray-400" />}
                      </button>
                      {open && (
                        <div className="space-y-3 border-t border-gray-100 p-3">
                          {p.briefs.map((b) => (
                            <div key={b.briefId} className="rounded-lg border border-gray-100 bg-gray-50/60 p-3 text-sm">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${b.sectionType === 'hero' ? 'bg-indigo-100 text-indigo-700' : 'bg-gray-100 text-gray-600'}`}>{b.sectionType}</span>
                                <span className="font-medium text-gray-800">{b.sectionName}</span>
                                <span className="ml-auto rounded bg-white px-1.5 py-0.5 text-[10px] text-gray-500 border border-gray-200">{b.aspectRatio}</span>
                              </div>
                              <div className="mt-2 text-gray-700">{b.visualObjective}</div>
                              {b.messageSupported && <div className="mt-1 text-xs text-gray-500">Supports: {b.messageSupported}</div>}
                              {b.businessSpecificDirection && <div className="mt-1 text-xs text-gray-600">{b.businessSpecificDirection}</div>}
                              {b.industryDetails.length > 0 && (
                                <div className="mt-1 text-[11px] text-gray-500">Industry: {b.industryDetails.join(', ')}</div>
                              )}
                              {b.localDetails.length > 0 && (
                                <div className="mt-1 text-[11px] text-gray-500">Local: {b.localDetails.join(', ')}</div>
                              )}
                              <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
                                <span className="inline-flex items-center gap-1 rounded bg-white px-2 py-0.5 text-gray-600 border border-gray-200"><Crop className="h-3 w-3" /> {b.mobileCropNotes}</span>
                                <span className="inline-flex items-center gap-1 rounded bg-white px-2 py-0.5 text-gray-600 border border-gray-200"><Shield className="h-3 w-3" /> text-safe: {b.textSafeZone}</span>
                                <span className="inline-flex items-center gap-1 rounded bg-white px-2 py-0.5 text-gray-600 border border-gray-200"><Eye className="h-3 w-3" /> {b.assetSourcePreference}</span>
                              </div>
                              {b.forbiddenVisuals.length > 0 && (
                                <div className="mt-2 rounded border border-red-100 bg-red-50 p-2">
                                  <div className="flex items-center gap-1 text-[11px] font-medium text-red-700"><Ban className="h-3 w-3" /> Forbidden visuals</div>
                                  <ul className="mt-1 space-y-0.5 text-[11px] text-red-600">
                                    {b.forbiddenVisuals.map((f, i) => (<li key={i}>• {f}</li>))}
                                  </ul>
                                </div>
                              )}
                              <div className="mt-2 flex flex-wrap gap-3 text-[11px]">
                                <span className={`inline-flex items-center gap-1 ${b.donContractReady ? 'text-green-600' : 'text-gray-400'}`}>
                                  {b.donContractReady ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />} Don contract ready
                                </span>
                                <span className={`inline-flex items-center gap-1 ${b.andyRenderReady ? 'text-green-600' : 'text-gray-400'}`}>
                                  {b.andyRenderReady ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />} Andy render ready
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 p-3 text-xs text-gray-500">
                These are written image briefs only. No images were generated, uploaded, built, or published. Image generation is available in a later milestone.
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-gray-200 p-6 text-center text-sm text-gray-400">
              No image briefs yet.{briefGate?.allowed ? ' Use “Generate from Copy” above to create draft briefs.' : ' Generate website copy first.'}
            </div>
          )}
        </div>
      )}

      {tab === 'generatedImages' && (
        <div className="p-5 space-y-4">
          {/* Gate status */}
          <div className="rounded-lg border border-gray-100 bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm font-medium text-gray-900">
                <ImageIcon className="h-4 w-4 text-indigo-600" /> Image generation gate
              </div>
              <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium ${
                imageGate?.allowed ? 'bg-green-100 text-green-700 border-green-200' : 'bg-gray-100 text-gray-600 border-gray-200'
              }`}>
                {imageGate?.allowed ? <ShieldCheck className="h-3 w-3" /> : <Lock className="h-3 w-3" />}
                {imageGate?.allowed ? 'Allowed - approved briefs present' : 'Blocked - approve image briefs first'}
              </span>
            </div>
            <p className="mt-2 text-sm text-gray-600">{imageGate?.reason || 'Loading gate status...'}</p>
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-gray-500">
              <span className="inline-flex items-center gap-1">
                {sitemapId ? <CheckCircle2 className="h-3.5 w-3.5 text-green-600" /> : <XCircle className="h-3.5 w-3.5 text-gray-400" />}
                Approved sitemap {sitemapId ? 'present' : 'missing'}
              </span>
              <span className="inline-flex items-center gap-1">
                {genBriefSetId ? <CheckCircle2 className="h-3.5 w-3.5 text-green-600" /> : <XCircle className="h-3.5 w-3.5 text-gray-400" />}
                Image brief set {genBriefSetId ? `present (${(genBriefSetStatus || '').replace(/_/g, ' ') || 'draft'})` : 'missing'}
              </span>
            </div>
          </div>

          {/* Generate action — cost-controlled (never defaults to full batch) */}
          {imageGate?.allowed && providerConfigured ? (
            <div className="space-y-3 rounded-lg border border-gray-100 bg-gray-50 p-4">
              <div className="text-sm text-gray-600">
                Generate website image assets one at a time from your approved briefs. Each render is validated by Don, produced or selected by Andy, stored durably, and hero images pass QA before approval. Start with a single test image to control cost.
              </div>

              {/* Brief selection */}
              {allBriefs.length > 0 && (
                <div className="rounded-md border border-gray-200 bg-white p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-xs font-medium text-gray-700">Select image(s) to generate ({selectedBriefIds.length} selected)</span>
                    {selectedBriefIds.length > 0 && (
                      <button onClick={() => setSelectedBriefIds([])} className="text-[11px] text-gray-400 hover:text-gray-600">Clear</button>
                    )}
                  </div>
                  <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                    {allBriefs.map((b) => {
                      const checked = selectedBriefIds.includes(b.briefId);
                      return (
                        <button
                          key={b.briefId}
                          onClick={() => toggleBriefSelected(b.briefId)}
                          className={`flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-left text-xs ${checked ? 'border-indigo-300 bg-indigo-50' : 'border-gray-200 bg-white hover:bg-gray-50'}`}
                        >
                          {checked ? <CheckSquare className="h-3.5 w-3.5 shrink-0 text-indigo-600" /> : <Square className="h-3.5 w-3.5 shrink-0 text-gray-300" />}
                          <span className={`rounded px-1 py-0.5 text-[9px] font-semibold uppercase ${b.isHero ? 'bg-indigo-100 text-indigo-700' : 'bg-gray-100 text-gray-600'}`}>{b.sectionType}</span>
                          <span className="truncate font-medium text-gray-800">{b.sectionName}</span>
                          <span className="ml-auto shrink-0 text-[10px] text-gray-400">{b.pageSlug}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Action buttons */}
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={generateOneTest}
                  disabled={genLoading || !firstHeroBriefId}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
                >
                  {genLoading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
                  Generate 1 test image
                </button>
                <button
                  onClick={generateSelected}
                  disabled={genLoading || selectedBriefIds.length === 0}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-white px-3.5 py-2 text-sm font-medium text-indigo-700 hover:bg-indigo-50 disabled:opacity-50"
                >
                  <Wand2 className="h-4 w-4" /> Generate selected image{selectedBriefIds.length > 1 ? `s (${selectedBriefIds.length})` : ''}
                </button>
                <button
                  onClick={dryRunSelected}
                  disabled={genLoading}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3.5 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                >
                  <FlaskConical className="h-4 w-4" /> Dry-run check
                </button>
                {isAdmin && (
                  <button
                    onClick={generateFullBatch}
                    disabled={genLoading || allBriefs.length === 0}
                    title="Admin only — runs a full live render batch"
                    className="inline-flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2 text-sm font-medium text-amber-700 hover:bg-amber-100 disabled:opacity-50"
                  >
                    <Shield className="h-4 w-4" /> Generate all ({allBriefs.length}) — admin
                  </button>
                )}
              </div>
              <p className="text-[11px] text-gray-400">A dry-run check validates the render contract and shows the durable storage key without generating an image or storing anything.</p>
            </div>
          ) : (
            <div className="flex flex-col gap-3 rounded-lg border border-gray-100 bg-gray-50 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-sm text-gray-600">Approve your image briefs first. Image generation stays locked until the briefs are approved.</div>
              <button disabled title="Blocked until image briefs are approved"
                className="inline-flex shrink-0 cursor-not-allowed items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3.5 py-2 text-sm font-medium text-gray-400">
                <Lock className="h-4 w-4" /> Generate — blocked until image briefs are approved
              </button>
            </div>
          )}

          {/* Dry-run validated preview */}
          {dryRunResult && (
            <div className="rounded-lg border border-gray-200 bg-white p-4">
              <div className="mb-2 flex items-center gap-2 text-sm font-medium text-gray-800">
                <FlaskConical className="h-4 w-4 text-gray-500" /> Dry-run validation — no image generated, nothing stored
              </div>
              <div className="space-y-2">
                {dryRunResult.map((v) => (
                  <div key={v.briefId} className={`rounded-md border p-2.5 text-xs ${v.error ? 'border-red-200 bg-red-50' : 'border-green-200 bg-green-50'}`}>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${v.sectionType === 'hero' ? 'bg-indigo-100 text-indigo-700' : 'bg-gray-100 text-gray-600'}`}>{v.assetRole.replace(/_/g, ' ')}</span>
                      <span className="font-medium text-gray-800">{v.sectionName}</span>
                      <span className="text-gray-500">{v.pageSlug}</span>
                      <span className={`ml-auto rounded-full border px-2 py-0.5 text-[10px] font-medium ${v.error ? 'border-red-200 bg-white text-red-600' : 'border-green-200 bg-white text-green-700'}`}>{v.error ? 'invalid' : 'validated'}</span>
                    </div>
                    {v.error ? (
                      <div className="mt-1 text-red-600">{v.error}</div>
                    ) : (
                      <div className="mt-1 font-mono text-[10px] text-gray-500">expected key: {v.r2Bucket}/{v.expectedR2Key}</div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Assets */}
          {genAssets.length ? (
            <div className="space-y-3">
              {genAssets.map((a) => {
                const url = assetUrls[a.id];
                const isHero = a.assetRole === 'hero_image';
                const failed = a.status === 'failed' || a.status === 'qa_failed' || a.qaStatus === 'failed';
                // Allow-list: approval is ONLY possible for a successfully generated
                // asset awaiting review whose QA did not fail. Failed / qa_failed /
                // queued / generating / already-approved assets are NOT approvable.
                const canApprove =
                  (a.status === 'generated' || a.status === 'ready_for_review') &&
                  a.qaStatus !== 'failed';
                return (
                  <div key={a.id} className="rounded-lg border border-gray-100 bg-white p-3">
                    <div className="flex flex-col gap-3 sm:flex-row">
                      <div className="relative h-32 w-full shrink-0 overflow-hidden rounded-md bg-gray-100 sm:w-48">
                        {url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={url} alt={a.altText || `${a.sectionName} image`} className="h-full w-full object-cover" />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-[11px] text-gray-400">
                            {failed ? 'No asset (failed)' : 'Preview unavailable'}
                          </div>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${isHero ? 'bg-indigo-100 text-indigo-700' : 'bg-gray-100 text-gray-600'}`}>{a.assetRole.replace(/_/g, ' ')}</span>
                          <span className="font-medium text-gray-800">{a.sectionName}</span>
                          <span className="text-xs text-gray-500">{a.pageSlug}</span>
                          <span className={`ml-auto rounded-full border px-2 py-0.5 text-[11px] font-medium ${ASSET_STATUS_BADGE[a.status] || ASSET_STATUS_BADGE.queued}`}>{a.status.replace(/_/g, ' ')}</span>
                        </div>
                        {a.visualRationale && <div className="mt-1 text-xs text-gray-600">{a.visualRationale}</div>}
                        <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
                          {isHero && a.qualityScore != null && (
                            <span className="inline-flex items-center gap-1 rounded bg-gray-50 px-2 py-0.5 text-gray-600 border border-gray-200"><Gauge className="h-3 w-3" /> hero {a.qualityScore}</span>
                          )}
                          {a.mobileSafeScore != null && <span className="rounded bg-gray-50 px-2 py-0.5 text-gray-600 border border-gray-200">mobile {a.mobileSafeScore}</span>}
                          {a.brandFitScore != null && <span className="rounded bg-gray-50 px-2 py-0.5 text-gray-600 border border-gray-200">brand {a.brandFitScore}</span>}
                          {a.textReadabilityScore != null && <span className="rounded bg-gray-50 px-2 py-0.5 text-gray-600 border border-gray-200">text {a.textReadabilityScore}</span>}
                          {a.focalPointScore != null && <span className="rounded bg-gray-50 px-2 py-0.5 text-gray-600 border border-gray-200">focal {a.focalPointScore}</span>}
                          {a.qaStatus && <span className={`rounded px-2 py-0.5 border ${a.qaStatus === 'passed' ? 'bg-green-50 text-green-700 border-green-200' : 'bg-red-50 text-red-700 border-red-200'}`}>QA {a.qaStatus}</span>}
                        </div>
                        {a.requiredFixes.length > 0 && (
                          <div className="mt-2 rounded border border-amber-100 bg-amber-50 p-2">
                            <div className="flex items-center gap-1 text-[11px] font-medium text-amber-700"><AlertTriangle className="h-3 w-3" /> Required fixes</div>
                            <ul className="mt-1 space-y-0.5 text-[11px] text-amber-700">{a.requiredFixes.map((f, i) => (<li key={i}>- {f}</li>))}</ul>
                          </div>
                        )}
                        {isAdmin && (a.r2Key || a.provider) && (
                          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-gray-400">
                            {a.r2Key && <span>key: {a.r2Bucket}/{a.r2Key}</span>}
                            {a.provider && <span>provider: {a.provider}{a.model ? ` - ${a.model}` : ''}</span>}
                          </div>
                        )}
                        <div className="mt-2 flex flex-wrap gap-2">
                          {failed ? (
                            // Failed / qa_failed: NO Approve action. Offer Retry + Reject only.
                            <button onClick={() => runGenerate({ briefIds: [a.imageBriefId], maxImages: 1, dryRun: false })} disabled={genLoading}
                              className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-medium text-indigo-700 hover:bg-indigo-100 disabled:opacity-50">
                              <RefreshCw className="h-3.5 w-3.5" /> Retry
                            </button>
                          ) : (
                            <button onClick={() => approveAsset(a.id)} disabled={genLoading || !canApprove}
                              className="inline-flex items-center gap-1.5 rounded-lg bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50">
                              <ThumbsUp className="h-3.5 w-3.5" /> {a.status === 'approved' ? 'Approved' : 'Approve'}
                            </button>
                          )}
                          <button onClick={() => rejectAsset(a.id)} disabled={genLoading || a.status === 'rejected'}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-700 hover:bg-amber-100 disabled:opacity-50">
                            <ThumbsDown className="h-3.5 w-3.5" /> {failed ? 'Request revision / reject' : 'Reject / revise'}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
              <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 p-3 text-xs text-gray-500">
                Generated assets link back to their source brief, page, and section. Static build and mobile QA are available in a later milestone - no build, publish, or deploy is run here.
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-gray-200 p-6 text-center text-sm text-gray-400">
              No generated images yet.{imageGate?.allowed ? ' Use "Generate 1 test image" above once your briefs are approved.' : ' Approve your image briefs first.'}
            </div>
          )}
        </div>
      )}

    </div>
  );
}
