/**
 * WF3 (Website-SEO AI workflow) quality aggregation — READ ONLY.
 *
 * This module fetches the Tombstone task outputs for a dispatched WF3 workflow
 * and normalizes them into a single display contract used by the P10 quality
 * visibility UI. It never mutates anything and never triggers publishing.
 *
 * Architecture boundary: Launch OS calls Tombstone over HTTP. Tombstone never
 * queries the Launch OS database. The normalized object below is the *only*
 * contract the UI consumes — raw task JSON is never surfaced as the primary
 * payload (it may be exposed in admin/debug views only).
 *
 * WF3 step map (by step_order):
 *   1 SEO Audit         — Clara inventory
 *   2 Keyword Strategy  — Rand approved-brief intake / brief
 *   3 SEO Audit         — Clara prewrite gate
 *   4 Creative Strategy — Ogilvy draft
 *   5 Sales Coaching    — Tom Hopkins conversion review
 *   6 Creative Strategy — Ogilvy revision
 *   7 SEO Audit         — Clara final QA
 *   8 Site Publishing   — Gutenberg gated DRAFT
 *   9 SEO Audit         — Clara post-publish verification
 */

import { getTaskOutputs } from '@/lib/tombstone';

const TOMBSTONE_URL = process.env.TOMBSTONE_API_URL ?? 'https://tombstone-api-xjc4.onrender.com';

// ── Normalized display contract ──────────────────────────────────────────────

export interface Wf3RequiredFix {
  fixId: string | null;
  severity: string | null;
  responsibleAgent: string | null;
  section: string | null;
  issue: string | null;
  requiredChange: string | null;
  evidence: string | null;
  retryRecommended: boolean | null;
}

export interface Wf3ScoreCategory {
  category: string;
  points: number | null;
  maxPoints: number | null;
  explanation: string | null;
}

export interface Wf3QualityReport {
  // identity / scoping
  workflowId: string;
  businessId: number | null;

  // pipeline progress
  found: boolean;            // any tasks found for this workflow
  steps: Array<{ stepOrder: number | null; department: string | null; status: string; taskId: number | null }>;
  overallStatus: 'running' | 'completed' | 'failed' | 'blocked' | 'unknown';
  currentStep: { stepOrder: number | null; department: string | null; status: string } | null;
  totalSteps: number;
  completedSteps: number;

  // reached flags (which stages produced output)
  reached: {
    brief: boolean;
    draft: boolean;
    tom: boolean;
    revision: boolean;
    finalQa: boolean;
    gutenberg: boolean;
    postPublish: boolean;
  };

  // brief / target context
  approvedBriefUsed: boolean | null;
  approvedBriefId: string | null;
  targetKeyword: string | null;
  targetLocation: string | null;
  recommendedSlug: string | null;
  pageType: string | null;

  // final QA (Clara, step 7)
  finalQa: {
    available: boolean;
    seoScore: number | null;
    threshold: number | null;
    qaStatus: string | null;            // 'fail' | 'pass' | ...
    approvedForPublish: boolean | null;
    publishRecommendation: string | null;
    finalQaReportId: number | null;
    scoreBreakdown: Wf3ScoreCategory[];
    requiredFixes: Wf3RequiredFix[];
    failedChecklistItems: string[];
    missingRequiredSections: string[];
    missingRequiredFaqs: string[];
    missingConversionElements: string[];
    genericCopyFlags: string[];
    localRelevanceScore: number | null;
    proofTrustScore: number | null;
    conversionScore: number | null;
    briefAdherenceScore: number | null;
    contentDepthScore: number | null;
  };

  // conversion review (Ogilvy revision, step 6 + Tom, step 5)
  conversion: {
    available: boolean;
    tomReviewFound: boolean | null;
    tomFixesReceived: number | null;
    tomFixesApplied: number | null;
    tomFixesUnresolved: number | null;
    nonTomFixesApplied: number | null;
    tomConversionScore: number | null;     // from Tom step
    briefAdherenceSelfCheck: number | null;
    conversionAdherenceSelfCheck: number | null;
  };

  // publish gate (Gutenberg, step 8)
  publishGate: {
    available: boolean;
    draftStatus: string | null;
    publishReady: boolean | null;
    approvalGate: string | null;
    approvalStatus: string | null;
    publishStatus: string | null;
    publishedUrl: string | null;
    hasDraft: boolean;
    qaFailed: boolean | null;
    guardrailIssues: string[];
  };

  // post-publish verification (Clara, step 9)
  postPublish: {
    available: boolean;
    qaStatus: string | null;            // 'deferred' | ...
    reason: string | null;
    publishedUrl: string | null;
    allPassed: boolean | null;
  };

  // computed display fields
  display: {
    statusLabel: string;            // primary user-facing status
    secondaryLabels: string[];      // additional badges
    publishReady: boolean;          // safe computed publish-readiness
    blockedBy: string | null;       // human-readable blocker
    postPublishLabel: string;       // post-publish verification line
    topFixes: string[];             // short list of top required changes
  };
}

// ── helpers ─────────────────────────────────────────────────────────────────

function toStrArray(v: any): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => (typeof x === 'string' ? x : (x?.item ?? x?.label ?? JSON.stringify(x)))).filter(Boolean);
}

function num(v: any): number | null {
  return typeof v === 'number' && !Number.isNaN(v) ? v : null;
}

function bool(v: any): boolean | null {
  return typeof v === 'boolean' ? v : null;
}

function str(v: any): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

/** Parse the first output row's `output` field (JSON string or object). */
function parseOutput(rows: any[]): any | null {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const out = rows[0]?.output;
  if (out == null) return null;
  if (typeof out === 'object') return out;
  if (typeof out === 'string') {
    try { return JSON.parse(out); } catch { return null; }
  }
  return null;
}

async function fetchWorkflowTasks(workflowId: string): Promise<any[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  try {
    const res = await fetch(`${TOMBSTONE_URL}/tasks?workflow_id=${encodeURIComponent(workflowId)}`, {
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!res.ok) return [];
    const data = await res.json().catch(() => []);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

function normalizeStatus(raw: string): 'waiting' | 'active' | 'complete' | 'error' | 'blocked' {
  const s = (raw ?? '').toLowerCase();
  if (s === 'complete' || s === 'completed') return 'complete';
  if (s === 'failed' || s === 'error') return 'error';
  if (s === 'blocked') return 'blocked';
  if (['in progress', 'in_progress', 'running', 'claimed'].includes(s)) return 'active';
  return 'waiting';
}

// ── main aggregation ──────────────────────────────────────────────────────────

/** Parsed step outputs (network-free). Passed into the pure builder. */
export interface Wf3StepOutputs {
  brief: any | null;
  draftComplete: boolean;
  tom: any | null;
  revision: any | null;
  finalQa: any | null;
  gutenberg: any | null;
  postPublish: any | null;
}

function emptyOutputs(): Wf3StepOutputs {
  return { brief: null, draftComplete: false, tom: null, revision: null, finalQa: null, gutenberg: null, postPublish: null };
}

/**
 * Fetch and normalize WF3 quality for a workflow (network entrypoint).
 * Returns `found: false` (with empty sections) when no tasks exist — callers
 * should treat this as "workflow not started / unknown" and never crash.
 */
export async function fetchWf3Quality(workflowId: string): Promise<Wf3QualityReport> {
  const tasks = await fetchWorkflowTasks(workflowId);
  if (tasks.length === 0) return buildWf3Report(workflowId, [], emptyOutputs());

  const sorted = [...tasks].sort((a, b) => (a?.step_order ?? a?.id ?? 0) - (b?.step_order ?? b?.id ?? 0));
  const byStep = (n: number) => sorted.find((t) => t?.step_order === n) ?? null;
  const wantOutput = (t: any) => t && normalizeStatus(t.status) === 'complete';
  const draftTask = byStep(4);
  const briefTask = byStep(2);
  const tomTask = byStep(5);
  const revisionTask = byStep(6);
  const finalQaTask = byStep(7);
  const gutenbergTask = byStep(8);
  const postPublishTask = byStep(9);

  // Only fetch outputs for completed tasks (avoid noise from pending steps)
  const [brief, tom, revision, finalQa, gutenberg, postPublish] = await Promise.all([
    wantOutput(briefTask) ? getTaskOutputs(briefTask.id).then(parseOutput) : Promise.resolve(null),
    wantOutput(tomTask) ? getTaskOutputs(tomTask.id).then(parseOutput) : Promise.resolve(null),
    wantOutput(revisionTask) ? getTaskOutputs(revisionTask.id).then(parseOutput) : Promise.resolve(null),
    wantOutput(finalQaTask) ? getTaskOutputs(finalQaTask.id).then(parseOutput) : Promise.resolve(null),
    wantOutput(gutenbergTask) ? getTaskOutputs(gutenbergTask.id).then(parseOutput) : Promise.resolve(null),
    wantOutput(postPublishTask) ? getTaskOutputs(postPublishTask.id).then(parseOutput) : Promise.resolve(null),
  ]);

  return buildWf3Report(workflowId, tasks, {
    brief,
    draftComplete: !!(draftTask && wantOutput(draftTask)),
    tom, revision, finalQa, gutenberg, postPublish,
  });
}

/**
 * Pure normalization (NO network). Exported for unit testing. Maps the WF3 step
 * outputs into the normalized display contract and computes the safe,
 * user-facing status labels / publish-readiness.
 */
export function buildWf3Report(workflowId: string, tasks: any[], outputs: Wf3StepOutputs): Wf3QualityReport {
  const base: Wf3QualityReport = {
    workflowId,
    businessId: null,
    found: tasks.length > 0,
    steps: [],
    overallStatus: 'unknown',
    currentStep: null,
    totalSteps: 0,
    completedSteps: 0,
    reached: { brief: false, draft: false, tom: false, revision: false, finalQa: false, gutenberg: false, postPublish: false },
    approvedBriefUsed: null,
    approvedBriefId: null,
    targetKeyword: null,
    targetLocation: null,
    recommendedSlug: null,
    pageType: null,
    finalQa: {
      available: false, seoScore: null, threshold: null, qaStatus: null, approvedForPublish: null,
      publishRecommendation: null, finalQaReportId: null, scoreBreakdown: [], requiredFixes: [],
      failedChecklistItems: [], missingRequiredSections: [], missingRequiredFaqs: [],
      missingConversionElements: [], genericCopyFlags: [], localRelevanceScore: null,
      proofTrustScore: null, conversionScore: null, briefAdherenceScore: null, contentDepthScore: null,
    },
    conversion: {
      available: false, tomReviewFound: null, tomFixesReceived: null, tomFixesApplied: null,
      tomFixesUnresolved: null, nonTomFixesApplied: null, tomConversionScore: null,
      briefAdherenceSelfCheck: null, conversionAdherenceSelfCheck: null,
    },
    publishGate: {
      available: false, draftStatus: null, publishReady: null, approvalGate: null, approvalStatus: null,
      publishStatus: null, publishedUrl: null, hasDraft: false, qaFailed: null, guardrailIssues: [],
    },
    postPublish: { available: false, qaStatus: null, reason: null, publishedUrl: null, allPassed: null },
    display: {
      statusLabel: 'Not Started', secondaryLabels: [], publishReady: false, blockedBy: null,
      postPublishLabel: 'Post-publish verification: Deferred — draft not published', topFixes: [],
    },
  };

  if (tasks.length === 0) return base;

  // business id (scoping) — take the first non-null business_id
  const bizTask = tasks.find((t) => t?.business_id != null);
  base.businessId = bizTask?.business_id ?? null;

  // sort by step_order then id
  const sorted = [...tasks].sort((a, b) => (a?.step_order ?? a?.id ?? 0) - (b?.step_order ?? b?.id ?? 0));
  base.totalSteps = sorted.length;
  base.steps = sorted.map((t) => ({
    stepOrder: t?.step_order ?? null,
    department: t?.department ?? null,
    status: normalizeStatus(t?.status),
    taskId: t?.id ?? null,
  }));
  base.completedSteps = base.steps.filter((s) => s.status === 'complete').length;

  const anyError = base.steps.some((s) => s.status === 'error');
  const anyBlocked = base.steps.some((s) => s.status === 'blocked');
  const anyActive = base.steps.some((s) => s.status === 'active' || s.status === 'waiting');
  const allComplete = base.steps.length > 0 && base.steps.every((s) => s.status === 'complete');
  if (allComplete) base.overallStatus = 'completed';
  else if (anyError && !anyActive) base.overallStatus = 'failed';
  else if (anyBlocked) base.overallStatus = 'blocked';
  else if (anyActive) base.overallStatus = 'running';
  else base.overallStatus = 'unknown';

  // current step = first non-complete (or last)
  const firstPending = base.steps.find((s) => s.status !== 'complete');
  base.currentStep = firstPending
    ? { stepOrder: firstPending.stepOrder, department: firstPending.department, status: firstPending.status }
    : (base.steps.length ? { ...base.steps[base.steps.length - 1] } as any : null);
  // Step outputs were fetched by fetchWf3Quality and passed in via `outputs`.

  // ── brief (step 2) ──
  if (outputs.brief) {
    base.reached.brief = true;
    base.approvedBriefUsed = bool(outputs.brief.used_approved_brief);
    base.approvedBriefId = str(outputs.brief.approved_brief_id);
    base.targetKeyword = str(outputs.brief.primary_keyword) ?? str(outputs.brief.target_keyword);
    base.targetLocation = str(outputs.brief.target_location);
    base.recommendedSlug = str(outputs.brief.recommended_slug);
    base.pageType = str(outputs.brief.page_type) ?? str(outputs.brief.target_page_type);
  }

  // ── Ogilvy draft (step 4) reached? ──
  if (outputs.draftComplete) base.reached.draft = true;

  // ── Tom conversion (step 5) ──
  if (outputs.tom) {
    base.reached.tom = true;
    base.conversion.available = true;
    base.conversion.tomConversionScore = num(outputs.tom.conversion_score);
  }

  // ── Ogilvy revision (step 6) ──
  if (outputs.revision) {
    base.reached.revision = true;
    base.conversion.available = true;
    base.conversion.tomReviewFound = bool(outputs.revision.tom_review_found);
    base.conversion.tomFixesReceived = num(outputs.revision.tom_fixes_received_count);
    base.conversion.tomFixesApplied = num(outputs.revision.tom_fixes_applied_count);
    base.conversion.tomFixesUnresolved = num(outputs.revision.tom_fixes_unresolved_count);
    base.conversion.nonTomFixesApplied = num(outputs.revision.non_tom_fixes_applied_count);
    base.conversion.briefAdherenceSelfCheck = num(outputs.revision.brief_adherence_score_self_check);
    base.conversion.conversionAdherenceSelfCheck = num(outputs.revision.conversion_adherence_score_self_check);
    if (base.conversion.tomConversionScore == null) base.conversion.tomConversionScore = num(outputs.revision.tom_conversion_score_received);
    // brief context fallback from revision output
    if (!base.recommendedSlug) base.recommendedSlug = str(outputs.revision.slug);
    if (!base.targetKeyword) base.targetKeyword = str(outputs.revision.primary_keyword);
    if (!base.pageType) base.pageType = str(outputs.revision.page_type);
  }

  // ── Clara final QA (step 7) ──
  if (outputs.finalQa) {
    base.reached.finalQa = true;
    const q = base.finalQa;
    q.available = true;
    q.seoScore = num(outputs.finalQa.seo_score);
    q.threshold = num(outputs.finalQa.publish_threshold);
    q.qaStatus = str(outputs.finalQa.qa_status);
    q.approvedForPublish = bool(outputs.finalQa.approved_for_publish);
    q.publishRecommendation = str(outputs.finalQa.publish_recommendation);
    q.finalQaReportId = num(outputs.finalQa.final_qa_report_id);
    q.scoreBreakdown = Array.isArray(outputs.finalQa.score_breakdown)
      ? outputs.finalQa.score_breakdown.map((c: any) => ({
          category: str(c?.category) ?? 'unknown',
          points: num(c?.points),
          maxPoints: num(c?.max_points),
          explanation: str(c?.explanation),
        }))
      : [];
    q.requiredFixes = Array.isArray(outputs.finalQa.required_fixes)
      ? outputs.finalQa.required_fixes.map((f: any) => ({
          fixId: str(f?.fix_id),
          severity: str(f?.severity),
          responsibleAgent: str(f?.responsible_agent),
          section: str(f?.section),
          issue: str(f?.issue),
          requiredChange: str(f?.required_change),
          evidence: str(f?.evidence),
          retryRecommended: bool(f?.retry_recommended),
        }))
      : [];
    q.failedChecklistItems = toStrArray(outputs.finalQa.failed_checklist_items);
    q.missingRequiredSections = toStrArray(outputs.finalQa.missing_required_sections);
    q.missingRequiredFaqs = toStrArray(outputs.finalQa.missing_required_faqs);
    q.missingConversionElements = toStrArray(outputs.finalQa.missing_conversion_elements);
    q.genericCopyFlags = toStrArray(outputs.finalQa.generic_copy_flags);
    q.localRelevanceScore = num(outputs.finalQa.local_relevance_score);
    q.proofTrustScore = num(outputs.finalQa.trust_score);
    q.conversionScore = num(outputs.finalQa.conversion_score);
    q.briefAdherenceScore = num(outputs.finalQa.brief_adherence_score);
    q.contentDepthScore = num(outputs.finalQa.content_depth_score);
    if (base.approvedBriefUsed == null) base.approvedBriefUsed = bool(outputs.finalQa.brief_was_used);
    if (!base.approvedBriefId) base.approvedBriefId = str(outputs.finalQa.approved_brief_id);
  }

  // ── Gutenberg publish gate (step 8) ──
  if (outputs.gutenberg) {
    base.reached.gutenberg = true;
    const g = base.publishGate;
    g.available = true;
    g.draftStatus = str(outputs.gutenberg.draft_status);
    g.publishReady = bool(outputs.gutenberg.publish_ready);
    g.approvalGate = str(outputs.gutenberg.approval_gate);
    g.approvalStatus = str(outputs.gutenberg.approval_status);
    g.publishStatus = str(outputs.gutenberg.publish_status);
    g.publishedUrl = str(outputs.gutenberg.published_url);
    g.hasDraft = !!str(outputs.gutenberg.draft_url);
    g.qaFailed = bool(outputs.gutenberg.qa_failed);
    g.guardrailIssues = toStrArray(outputs.gutenberg.guardrail_issues);
  }

  // ── Clara post-publish (step 9) ──
  if (outputs.postPublish) {
    base.reached.postPublish = true;
    const p = base.postPublish;
    p.available = true;
    p.qaStatus = str(outputs.postPublish.qa_status);
    p.reason = str(outputs.postPublish.reason);
    p.publishedUrl = str(outputs.postPublish.published_url);
    p.allPassed = bool(outputs.postPublish.all_passed);
  }

  computeDisplay(base);
  return base;
}

/**
 * Compute the safe, user-facing display fields. Uses the EXACT status labels
 * mandated by the product spec and never shows a misleading "pass"/"publish
 * ready" when no live page exists or Clara has not approved.
 */
function computeDisplay(r: Wf3QualityReport): void {
  const d = r.display;
  const labels: string[] = [];

  // approved brief used
  if (r.approvedBriefUsed === true) labels.push('Research Brief Used');

  // draft generated
  if (r.reached.draft || r.reached.revision || r.reached.finalQa) labels.push('Draft Generated');

  const publishedUrl = r.publishGate.publishedUrl || r.postPublish.publishedUrl || null;
  const hasLivePage = !!publishedUrl;

  // Safe publish-readiness: Clara must approve AND Gutenberg gate must permit.
  const claraApproved = r.finalQa.approvedForPublish === true && r.finalQa.qaStatus !== 'fail';
  const gatePermits = r.publishGate.publishReady === true;
  const computedPublishReady = claraApproved && gatePermits;
  d.publishReady = computedPublishReady;

  // primary status label + blocker
  let primary = 'In Progress';
  let blockedBy: string | null = null;

  if (r.overallStatus === 'running' || (!r.reached.finalQa && !r.reached.gutenberg)) {
    primary = r.found ? 'In Progress' : 'Not Started';
  }
  if (r.overallStatus === 'failed') {
    primary = 'Workflow Failed';
    blockedBy = 'Workflow step failed';
  } else if (r.overallStatus === 'blocked') {
    primary = 'Publish Blocked';
    blockedBy = 'Workflow step blocked';
  }

  // final QA outcome takes precedence once reached
  if (r.finalQa.available) {
    if (r.finalQa.qaStatus === 'fail') {
      primary = 'Failed QA';
      blockedBy = 'Failed QA';
    } else if (r.finalQa.publishRecommendation === 'return_for_revision') {
      primary = 'Needs Revision';
      blockedBy = 'Needs Revision';
    }
  }

  // gutenberg gate state
  if (r.publishGate.available) {
    if (r.publishGate.qaFailed === true) {
      labels.push('Publish Blocked');
      if (!blockedBy) blockedBy = 'Publish gate blocked (QA failed)';
    }
    if (r.publishGate.publishReady === false) {
      labels.push('Not Publish Ready');
    }
    if ((r.publishGate.draftStatus === 'draft' || r.publishGate.hasDraft) && !hasLivePage) {
      labels.push('Draft Only');
    }
  }

  // approved for publish — ONLY if Clara approved AND gate permits
  if (computedPublishReady) {
    primary = 'Approved for Publish';
  } else if (r.finalQa.available && r.finalQa.qaStatus !== 'fail' && r.finalQa.publishRecommendation !== 'return_for_revision' && primary === 'In Progress') {
    // QA reached, not a fail, but gate not satisfied → still not publish ready
    primary = 'Not Publish Ready';
  }

  // post-publish verification line
  if (r.postPublish.available && r.postPublish.qaStatus === 'deferred') {
    d.postPublishLabel = `Post-publish verification: Deferred — ${r.postPublish.reason === 'draft_not_published' ? 'draft not published' : (r.postPublish.reason ?? 'draft not published')}`;
    labels.push('Post-Publish Check Deferred');
  } else if (hasLivePage && r.postPublish.allPassed === true) {
    d.postPublishLabel = 'Post-publish verification: Passed';
  } else if (!hasLivePage) {
    d.postPublishLabel = 'Post-publish verification: Deferred — draft not published';
  } else {
    d.postPublishLabel = 'Post-publish verification: Pending';
  }

  // top fixes (max 3) — required-change text
  d.topFixes = r.finalQa.requiredFixes
    .map((f) => f.requiredChange || f.issue || '')
    .filter(Boolean)
    .slice(0, 3);

  // de-dup labels, drop primary if duplicated in secondary
  d.statusLabel = primary;
  d.secondaryLabels = Array.from(new Set(labels)).filter((l) => l !== primary);
  d.blockedBy = blockedBy;
}