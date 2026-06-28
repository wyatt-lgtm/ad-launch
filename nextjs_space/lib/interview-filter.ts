/**
 * Pure, framework-agnostic helpers for the Business Profile Interview question
 * filter. Extracted so the behaviour can be unit-tested and so the same logic is
 * shared by the sidebar counts and the (frozen) visible-question computation.
 *
 * THE FREEZE CONTRACT
 * -------------------
 * The interview renders one section at a time and supports filters such as
 * "Missing". The visible set of questions for the active section MUST be a pure
 * function of (section, filter, prefill, confirmedKeys) and MUST NOT depend on
 * the live `answers` value while the user is typing.
 *
 * If the visible set were recomputed from live answers on every keystroke, then
 * under the "Missing" filter the very first character typed into a question would
 * make it "answered", remove it from the list, and unmount its <textarea>
 * mid-keystroke — dropping focus and every subsequent character. That is exactly
 * the bug this module guards against: the component computes the visible key set
 * from a snapshot of answers taken at navigation/filter/confirm time and keeps it
 * stable while the user types.
 */

export type QuestionFilter = 'all' | 'missing' | 'needs_review' | 'confirmed' | 'compliance';

export interface FilterQuestion {
  key: string;
  sensitive?: boolean;
}

export interface FilterPrefillItem {
  sectionId: string;
  questionKey: string;
  needsOwnerConfirmation: boolean;
}

export interface FilterContext {
  sectionId: string;
  /** Answers for the current section only: { [questionKey]: value } */
  sectionAnswers: Record<string, string>;
  prefillItems: FilterPrefillItem[];
  confirmedKeys: Set<string>;
}

function hasAnswer(sectionAnswers: Record<string, string>, key: string): boolean {
  return (sectionAnswers[key] || '').trim().length > 0;
}

/**
 * Returns true if a single question should be visible under the given filter.
 */
export function matchesQuestionFilter(
  q: FilterQuestion,
  filter: QuestionFilter,
  ctx: FilterContext,
): boolean {
  if (filter === 'all') return true;
  const compositeKey = `${ctx.sectionId}::${q.key}`;
  const pf = ctx.prefillItems.find(
    i => i.sectionId === ctx.sectionId && i.questionKey === q.key,
  );
  const answered = hasAnswer(ctx.sectionAnswers, q.key);
  const isConfirmed = ctx.confirmedKeys.has(compositeKey);

  switch (filter) {
    case 'missing':
      return !answered;
    case 'needs_review':
      return !!pf && !isConfirmed && pf.needsOwnerConfirmation;
    case 'confirmed':
      return isConfirmed;
    case 'compliance':
      return !!q.sensitive || ctx.sectionId === 'compliance';
    default:
      return true;
  }
}

/**
 * Computes the set of visible question keys for a section under a filter, from a
 * snapshot of answers. Callers MUST pass the snapshot captured at
 * navigation/filter/confirm time (NOT the live, per-keystroke answers) so the
 * set stays frozen while the user types. See the freeze contract above.
 */
export function computeVisibleQuestionKeys(
  questions: FilterQuestion[],
  filter: QuestionFilter,
  ctx: FilterContext,
): Set<string> {
  if (filter === 'all') return new Set(questions.map(q => q.key));
  return new Set(
    questions.filter(q => matchesQuestionFilter(q, filter, ctx)).map(q => q.key),
  );
}
