/**
 * WF3 SEO Page Quality (P10) — unit tests for the pure display-normalization
 * logic (`buildWf3Report`). No network: step outputs are passed in directly.
 *
 * Verifies the user-facing status labels, publish-readiness safety rules,
 * required-fix surfacing, Tom conversion fix counts, post-publish deferral,
 * in-progress handling, and missing-QA handling. Fixtures mirror the real
 * WF3 output field shapes captured from the live backend.
 */
import { buildWf3Report, type Wf3StepOutputs } from '../lib/wf3-quality';

// ── Builders ────────────────────────────────────────────────────────────────
function step(stepOrder: number, department: string, status = 'complete', id = 2800 + stepOrder) {
  return { id, step_order: stepOrder, department, status, business_id: 9 };
}

/** Full 9-step completed workflow task list (all complete). */
function fullTasks(): any[] {
  return [
    step(1, 'SEO Audit'), step(2, 'Keyword Strategy'), step(3, 'SEO Audit'),
    step(4, 'Creative Strategy'), step(5, 'Sales Coaching'), step(6, 'Creative Strategy'),
    step(7, 'SEO Audit'), step(8, 'Site Publishing'), step(9, 'SEO Audit'),
  ];
}

function emptyOutputs(): Wf3StepOutputs {
  return { brief: null, draftComplete: false, tom: null, revision: null, finalQa: null, gutenberg: null, postPublish: null };
}

/** Real failed-QA scenario (workflow af955969): score 83.5/85, qa fail, return_for_revision. */
function failedQaOutputs(): Wf3StepOutputs {
  return {
    brief: {
      used_approved_brief: true, approved_brief_id: 'cmqzjumre0003u8bbler7t0x1',
      primary_keyword: 'emergency roof repair', target_location: 'Austin, TX',
      recommended_slug: 'emergency-roof-repair-austin', page_type: 'service',
    },
    draftComplete: true,
    tom: { conversion_score: 72, required_conversion_fixes: [] },
    revision: {
      tom_review_found: true, tom_fixes_received_count: 0, tom_fixes_applied_count: 0,
      tom_fixes_unresolved_count: 0, non_tom_fixes_applied_count: 13,
      brief_adherence_score_self_check: 88, conversion_adherence_score_self_check: 80,
    },
    finalQa: {
      seo_score: 83.5, publish_threshold: 85, qa_status: 'fail', approved_for_publish: false,
      publish_recommendation: 'return_for_revision', final_qa_report_id: 123,
      score_breakdown: [
        { category: 'local_relevance', points: 18, max_points: 20, explanation: 'Good local signals' },
        { category: 'content_depth', points: 12, max_points: 15, explanation: 'Could be deeper' },
      ],
      required_fixes: [
        { fix_id: 'FX1', severity: 'high', responsible_agent: 'ogilvy', section: 'hero',
          issue: 'Weak headline', required_change: 'Add urgency + locale', evidence: 'h1 generic', retry_recommended: true },
      ],
      failed_checklist_items: ['Missing schema markup', 'No phone CTA above fold'],
      missing_required_sections: ['FAQ'], missing_required_faqs: ['warranty'],
      missing_conversion_elements: ['sticky call button'], generic_copy_flags: ['"best in town"'],
      local_relevance_score: 90, trust_score: 80, conversion_score: 72,
      brief_adherence_score: 88, content_depth_score: 80, brief_was_used: true,
    },
    gutenberg: {
      draft_status: 'failed_qa', publish_ready: false, approval_gate: 'blocked_failed_qa',
      approval_status: 'pending', publish_status: 'not_published', published_url: '',
      draft_url: 'https://example.com/?p=1&preview=true', qa_failed: true, guardrail_issues: [],
    },
    postPublish: { qa_status: 'deferred', reason: 'draft_not_published', published_url: '', all_passed: false },
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('buildWf3Report — failed QA scenario (real af955969 data)', () => {
  const r = buildWf3Report('wf-failed', fullTasks(), failedQaOutputs());

  it('finds the workflow and marks it completed', () => {
    expect(r.found).toBe(true);
    expect(r.overallStatus).toBe('completed');
    expect(r.totalSteps).toBe(9);
    expect(r.completedSteps).toBe(9);
    expect(r.businessId).toBe(9);
  });

  it('shows the "Failed QA" status label and blocks publish', () => {
    expect(r.display.statusLabel).toBe('Failed QA');
    expect(r.display.publishReady).toBe(false);
    expect(r.display.blockedBy).toBe('Failed QA');
  });

  it('surfaces the secondary status labels with exact wording', () => {
    expect(r.display.secondaryLabels).toEqual(expect.arrayContaining([
      'Research Brief Used', 'Draft Generated', 'Publish Blocked',
      'Not Publish Ready', 'Draft Only', 'Post-Publish Check Deferred',
    ]));
  });

  it('exposes the SEO score and threshold from Clara QA', () => {
    expect(r.finalQa.seoScore).toBe(83.5);
    expect(r.finalQa.threshold).toBe(85);
    expect(r.finalQa.qaStatus).toBe('fail');
    expect(r.finalQa.publishRecommendation).toBe('return_for_revision');
  });

  it('surfaces required fixes (top fixes for the card)', () => {
    expect(r.finalQa.requiredFixes.length).toBe(1);
    expect(r.finalQa.requiredFixes[0].issue).toBe('Weak headline');
    expect(r.display.topFixes.length).toBeGreaterThan(0);
  });

  it('surfaces failed checklist items and missing lists', () => {
    expect(r.finalQa.failedChecklistItems).toContain('Missing schema markup');
    expect(r.finalQa.missingRequiredSections).toContain('FAQ');
    expect(r.finalQa.missingConversionElements).toContain('sticky call button');
  });

  it('reports Tom conversion fix counts (received/applied/unresolved/non-Tom)', () => {
    expect(r.conversion.tomReviewFound).toBe(true);
    expect(r.conversion.tomFixesReceived).toBe(0);
    expect(r.conversion.tomFixesApplied).toBe(0);
    expect(r.conversion.tomFixesUnresolved).toBe(0);
    expect(r.conversion.nonTomFixesApplied).toBe(13);
  });

  it('reflects the publish gate as blocked with no published URL', () => {
    expect(r.publishGate.draftStatus).toBe('failed_qa');
    expect(r.publishGate.publishReady).toBe(false);
    expect(r.publishGate.qaFailed).toBe(true);
    expect(r.publishGate.publishedUrl).toBeFalsy();
    expect(r.publishGate.hasDraft).toBe(true);
  });

  it('defers post-publish verification with the exact label (no published page)', () => {
    expect(r.postPublish.qaStatus).toBe('deferred');
    expect(r.display.postPublishLabel).toBe('Post-publish verification: Deferred — draft not published');
  });
});

describe('buildWf3Report — publish-readiness safety rules', () => {
  it('never marks publish-ready when Clara failed QA, even if gate flag is odd', () => {
    const o = failedQaOutputs();
    // Force a contradictory gate flag — display must still be blocked.
    o.gutenberg.publish_ready = true;
    const r = buildWf3Report('wf-contradict', fullTasks(), o);
    expect(r.display.publishReady).toBe(false);
    expect(r.display.statusLabel).toBe('Failed QA');
  });

  it('marks "Approved for Publish" ONLY when Clara approves AND the gate permits', () => {
    const o = failedQaOutputs();
    o.finalQa.qa_status = 'pass';
    o.finalQa.approved_for_publish = true;
    o.finalQa.seo_score = 92;
    o.finalQa.publish_recommendation = 'approve';
    o.gutenberg.publish_ready = true;
    o.gutenberg.draft_status = 'ready';
    o.gutenberg.qa_failed = false;
    o.gutenberg.approval_gate = 'permitted';
    const r = buildWf3Report('wf-approved', fullTasks(), o);
    expect(r.display.publishReady).toBe(true);
    expect(r.display.statusLabel).toBe('Approved for Publish');
  });

  it('does NOT mark approved when Clara approves but the gate withholds permission', () => {
    const o = failedQaOutputs();
    o.finalQa.qa_status = 'pass';
    o.finalQa.approved_for_publish = true;
    o.gutenberg.publish_ready = false; // gate withholds
    const r = buildWf3Report('wf-gate-hold', fullTasks(), o);
    expect(r.display.publishReady).toBe(false);
    expect(r.display.statusLabel).not.toBe('Approved for Publish');
  });
});

describe('buildWf3Report — incomplete / missing-data handling', () => {
  it('reports "Not Started" with no tasks (found=false)', () => {
    const r = buildWf3Report('wf-empty', [], emptyOutputs());
    expect(r.found).toBe(false);
    expect(r.display.statusLabel).toBe('Not Started');
    expect(r.display.publishReady).toBe(false);
  });

  it('reports "In Progress" and never publish-ready while QA has not run', () => {
    const tasks = [
      step(1, 'SEO Audit'), step(2, 'Keyword Strategy'), step(3, 'SEO Audit'),
      step(4, 'Creative Strategy', 'active'),
      step(5, 'Sales Coaching', 'waiting'), step(6, 'Creative Strategy', 'waiting'),
      step(7, 'SEO Audit', 'waiting'), step(8, 'Site Publishing', 'waiting'), step(9, 'SEO Audit', 'waiting'),
    ];
    const o = emptyOutputs();
    o.brief = { used_approved_brief: true, primary_keyword: 'roof repair' };
    o.draftComplete = false;
    const r = buildWf3Report('wf-running', tasks, o);
    expect(r.overallStatus).toBe('running');
    expect(r.display.statusLabel).toBe('In Progress');
    expect(r.display.publishReady).toBe(false);
    expect(r.finalQa.available).toBe(false);
  });

  it('handles a missing QA report gracefully (gutenberg present, finalQa null)', () => {
    const o = failedQaOutputs();
    o.finalQa = null; // QA report missing
    const r = buildWf3Report('wf-noqa', fullTasks(), o);
    expect(r.finalQa.available).toBe(false);
    expect(r.display.publishReady).toBe(false);
    expect(r.display.statusLabel).not.toBe('Approved for Publish');
  });
});
