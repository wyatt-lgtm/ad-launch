import {
  matchesQuestionFilter,
  computeVisibleQuestionKeys,
  type FilterQuestion,
  type FilterContext,
} from '@/lib/interview-filter';

/**
 * Regression tests for the Business Profile Interview question filter.
 *
 * Bug: under a filter like "Missing", typing the first character into a question
 * made it "answered", which removed it from the visible list and unmounted its
 * <textarea> mid-keystroke — so later sections appeared to "not accept typing".
 *
 * The fix freezes the visible question set so it is computed from a snapshot of
 * answers taken at navigation/filter/confirm time, never from the live answers
 * being typed. These tests lock in both the per-filter predicate and the freeze
 * contract.
 */

const SECTION_ID = 'questions';

const QUESTIONS: FilterQuestion[] = [
  { key: 'preBuyQuestions' },
  { key: 'postBuyQuestions' },
  { key: 'comparisonQuestions' },
  { key: 'priceObjections', sensitive: true },
];

function ctx(partial: Partial<FilterContext>): FilterContext {
  return {
    sectionId: SECTION_ID,
    sectionAnswers: {},
    prefillItems: [],
    confirmedKeys: new Set<string>(),
    ...partial,
  };
}

describe('matchesQuestionFilter', () => {
  it('1. "all" filter shows every question regardless of state', () => {
    for (const q of QUESTIONS) {
      expect(matchesQuestionFilter(q, 'all', ctx({}))).toBe(true);
    }
  });

  it('2. "missing" shows only unanswered questions', () => {
    const c = ctx({ sectionAnswers: { preBuyQuestions: 'we get asked about price' } });
    expect(matchesQuestionFilter(QUESTIONS[0], 'missing', c)).toBe(false); // answered
    expect(matchesQuestionFilter(QUESTIONS[1], 'missing', c)).toBe(true); // empty
  });

  it('3. whitespace-only answers are still "missing"', () => {
    const c = ctx({ sectionAnswers: { preBuyQuestions: '   \n  ' } });
    expect(matchesQuestionFilter(QUESTIONS[0], 'missing', c)).toBe(true);
  });

  it('4. "needs_review" requires an unconfirmed prefill needing confirmation', () => {
    const c = ctx({
      prefillItems: [{ sectionId: SECTION_ID, questionKey: 'preBuyQuestions', needsOwnerConfirmation: true }],
    });
    expect(matchesQuestionFilter(QUESTIONS[0], 'needs_review', c)).toBe(true);
    // Once confirmed, it no longer needs review
    const confirmed = ctx({
      prefillItems: [{ sectionId: SECTION_ID, questionKey: 'preBuyQuestions', needsOwnerConfirmation: true }],
      confirmedKeys: new Set([`${SECTION_ID}::preBuyQuestions`]),
    });
    expect(matchesQuestionFilter(QUESTIONS[0], 'needs_review', confirmed)).toBe(false);
  });

  it('5. "confirmed" shows only confirmed questions', () => {
    const c = ctx({ confirmedKeys: new Set([`${SECTION_ID}::comparisonQuestions`]) });
    expect(matchesQuestionFilter(QUESTIONS[2], 'confirmed', c)).toBe(true);
    expect(matchesQuestionFilter(QUESTIONS[0], 'confirmed', c)).toBe(false);
  });

  it('6. "compliance" shows sensitive questions or compliance-section questions', () => {
    expect(matchesQuestionFilter(QUESTIONS[3], 'compliance', ctx({}))).toBe(true); // sensitive
    expect(matchesQuestionFilter(QUESTIONS[0], 'compliance', ctx({}))).toBe(false);
    const compSection = ctx({ sectionId: 'compliance' });
    expect(matchesQuestionFilter(QUESTIONS[0], 'compliance', compSection)).toBe(true);
  });
});

describe('computeVisibleQuestionKeys', () => {
  it('7. "all" returns every key', () => {
    const keys = computeVisibleQuestionKeys(QUESTIONS, 'all', ctx({}));
    expect(keys.size).toBe(QUESTIONS.length);
  });

  it('8. "missing" returns only the unanswered keys for a given snapshot', () => {
    const snapshot = ctx({ sectionAnswers: { preBuyQuestions: 'answered' } });
    const keys = computeVisibleQuestionKeys(QUESTIONS, 'missing', snapshot);
    expect(keys.has('preBuyQuestions')).toBe(false);
    expect(keys.has('postBuyQuestions')).toBe(true);
  });

  it('9. FREEZE CONTRACT: a question typed into AFTER the snapshot stays visible', () => {
    // Snapshot taken when the user navigated to the section: postBuyQuestions empty.
    const frozen = computeVisibleQuestionKeys(
      QUESTIONS,
      'missing',
      ctx({ sectionAnswers: {} }),
    );
    expect(frozen.has('postBuyQuestions')).toBe(true);

    // The user now types into postBuyQuestions. The component renders against the
    // FROZEN key set (not a recomputation), so the question — and its textarea —
    // remains mounted and can receive the full multi-character answer.
    const liveAnswers = { postBuyQuestions: 'How long is the warranty?' };
    const stillVisible = QUESTIONS.filter(q => frozen.has(q.key)).map(q => q.key);
    expect(stillVisible).toContain('postBuyQuestions');

    // Sanity check: a LIVE recomputation (the old, buggy behaviour) WOULD drop it,
    // which is exactly why the frozen snapshot is required.
    const liveRecompute = computeVisibleQuestionKeys(
      QUESTIONS,
      'missing',
      ctx({ sectionAnswers: liveAnswers }),
    );
    expect(liveRecompute.has('postBuyQuestions')).toBe(false);
  });

  it('10. switching filter/section recomputes a fresh snapshot', () => {
    // After answering, re-entering the "missing" filter recomputes from the new
    // snapshot and correctly hides the now-answered question.
    const after = computeVisibleQuestionKeys(
      QUESTIONS,
      'missing',
      ctx({ sectionAnswers: { postBuyQuestions: 'answered now' } }),
    );
    expect(after.has('postBuyQuestions')).toBe(false);
  });
});
