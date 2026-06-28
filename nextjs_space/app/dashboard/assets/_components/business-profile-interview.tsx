'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  X, ArrowLeft, ArrowRight, Loader2, CheckCircle, Sparkles,
  Save, FileText, AlertCircle, ChevronDown, ChevronUp,
  Zap, BookOpen, Eye, EyeOff, Lock, Globe, Bot,
  Ban, HelpCircle, Lightbulb, MessageSquare, BarChart3,
  RefreshCw, Download, Check, Pencil, XCircle, Filter,
  AlertTriangle, Info, Shield, Search,
} from 'lucide-react';
import {
  INTERVIEW_SECTIONS, QUICK_START_QUESTIONS, DOCUMENT_TYPES,
  SECTION_STATUS_CONFIG, SECTION_GENERATE_BUTTONS, SECTION_FEEDS,
  PRIVACY_LEVELS, calculateQualityScore, getSectionStatus,
  type InterviewSection, type InterviewQuestion, type PrivacyLevel,
  type SectionStatus, type QualityScore,
} from '@/lib/interview-data';
import {
  type PrefillItem, type PrefillResult, type PrefillSource, type PrefillConfidence,
  type EnhancedSectionStatus, ENHANCED_STATUS_CONFIG, getEnhancedSectionStatus,
} from '@/lib/interview-prefill';
import { computeVisibleQuestionKeys, matchesQuestionFilter } from '@/lib/interview-filter';

// ── Types ──────────────────────────────────────────────────────────────────────

type InterviewMode = 'select' | 'review_known' | 'full';
type ViewState = 'interview' | 'review' | 'documents';
type QuestionFilter = 'all' | 'missing' | 'needs_review' | 'confirmed' | 'compliance';

interface Props {
  businessId: string;
  onClose: () => void;
  onComplete: () => void;
  existingInterview?: { id: string; currentStep: number; answersJson: any; status: string } | null;
}

const PRIVACY_ICONS: Record<PrivacyLevel, typeof Globe> = {
  public: Globe,
  ai_reference_only: Bot,
  private_internal: Lock,
  do_not_use: Ban,
};

const SOURCE_BADGES: Record<PrefillSource, { label: string; color: string; bg: string }> = {
  owner_confirmed: { label: 'Owner confirmed', color: 'text-green-700', bg: 'bg-green-50 border-green-200' },
  prior_answer: { label: 'Prior answer', color: 'text-blue-700', bg: 'bg-blue-50 border-blue-200' },
  generated_document: { label: 'Approved document', color: 'text-purple-700', bg: 'bg-purple-50 border-purple-200' },
  business_record: { label: 'Business record', color: 'text-teal-700', bg: 'bg-teal-50 border-teal-200' },
  website: { label: 'Website crawl', color: 'text-cyan-700', bg: 'bg-cyan-50 border-cyan-200' },
  gbp: { label: 'Google Business Profile', color: 'text-sky-700', bg: 'bg-sky-50 border-sky-200' },
  content_profile: { label: 'Content profile', color: 'text-violet-700', bg: 'bg-violet-50 border-violet-200' },
  jim_bridger: { label: 'Business research', color: 'text-amber-700', bg: 'bg-amber-50 border-amber-200' },
  creative_asset: { label: 'Creative asset', color: 'text-pink-700', bg: 'bg-pink-50 border-pink-200' },
  unknown: { label: 'Unknown', color: 'text-gray-600', bg: 'bg-gray-50 border-gray-200' },
};

const CONFIDENCE_BADGES: Record<PrefillConfidence, { label: string; color: string; bg: string }> = {
  high: { label: 'High', color: 'text-green-700', bg: 'bg-green-50' },
  medium: { label: 'Medium', color: 'text-amber-700', bg: 'bg-amber-50' },
  low: { label: 'Low', color: 'text-red-600', bg: 'bg-red-50' },
};

// ── Component ────────────────────────────────────────────────────────────────

export default function BusinessProfileInterview({ businessId, onClose, onComplete, existingInterview }: Props) {
  // Core state
  const [mode, setMode] = useState<InterviewMode>('select');
  const [view, setView] = useState<ViewState>('interview');
  const [activeSectionIdx, setActiveSectionIdx] = useState(0);
  const [answers, setAnswers] = useState<Record<string, Record<string, string>>>(
    existingInterview?.answersJson || {}
  );
  const [privacySettings, setPrivacySettings] = useState<Record<string, PrivacyLevel>>({});
  const [interviewId, setInterviewId] = useState(existingInterview?.id || '');

  // Prefill state
  const [prefill, setPrefill] = useState<PrefillResult | null>(null);
  const [prefillLoading, setPrefillLoading] = useState(true);
  const [confirmedKeys, setConfirmedKeys] = useState<Set<string>>(new Set());
  const [rejectedKeys, setRejectedKeys] = useState<Set<string>>(new Set());
  const [editingKeys, setEditingKeys] = useState<Set<string>>(new Set());

  // Filtering
  const [questionFilter, setQuestionFilter] = useState<QuestionFilter>('all');
  const [servicesPanelCount, setServicesPanelCount] = useState(0);

  // UI state
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generatingSection, setGeneratingSection] = useState<string | null>(null);
  const [generatedDocs, setGeneratedDocs] = useState<any[]>([]);
  const [error, setError] = useState('');
  const [expandedDoc, setExpandedDoc] = useState<string | null>(null);
  const [showHelper, setShowHelper] = useState<string | null>(null);
  const [showConflicts, setShowConflicts] = useState(false);

  // AI state
  const [followUps, setFollowUps] = useState<Record<string, string[]>>({});
  const [followUpLoading, setFollowUpLoading] = useState<string | null>(null);
  const [suggestLoading, setSuggestLoading] = useState<string | null>(null);
  const [followUpAnswers, setFollowUpAnswers] = useState<Record<string, Record<string, string>>>({});

  // Autosave
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastSavedRef = useRef<string>('');
  // Always-current snapshot of answers, read inside frozen memos so that typing
  // does NOT trigger re-filtering / re-bucketing (which would unmount the field).
  const answersRef = useRef(answers);
  answersRef.current = answers;

  // ── Load prefill data on mount ───────────────────────────────────────

  useEffect(() => {
    let cancelled = false;
    const loadPrefill = async () => {
      setPrefillLoading(true);
      try {
        const res = await fetch(`/api/businesses/${businessId}/business-profile/prefill`);
        if (res.ok) {
          const data: PrefillResult = await res.json();
          if (!cancelled) {
            setPrefill(data);
            // Apply prefill values to answers (only where no existing answer)
            if (data.items.length > 0) {
              setAnswers(prev => {
                const updated = { ...prev };
                for (const item of data.items) {
                  if (!updated[item.sectionId]) updated[item.sectionId] = {};
                  // Only prefill if no existing answer
                  if (!(updated[item.sectionId][item.questionKey] || '').trim()) {
                    updated[item.sectionId][item.questionKey] = item.value;
                  }
                }
                return updated;
              });
              // Auto-confirm owner-confirmed high-confidence items
              const autoConfirmed = new Set<string>();
              for (const item of data.items) {
                if (item.ownerConfirmed && item.confidence === 'high' && !item.needsOwnerConfirmation) {
                  autoConfirmed.add(`${item.sectionId}::${item.questionKey}`);
                }
              }
              setConfirmedKeys(autoConfirmed);
            }
          }
        }
      } catch (err) {
        console.error('[prefill] Failed to load:', err);
      }
      if (!cancelled) setPrefillLoading(false);
    };
    loadPrefill();
    return () => { cancelled = true; };
  }, [businessId]);

  // Detect existing interview mode
  useEffect(() => {
    if (existingInterview?.answersJson && Object.keys(existingInterview.answersJson).length > 0) {
      const hasNonQuickStartAnswers = INTERVIEW_SECTIONS.some(s => {
        const sa = existingInterview.answersJson[s.id];
        if (!sa) return false;
        return s.questions.some(q => !q.quickStart && (sa[q.key] || '').trim());
      });
      setMode(hasNonQuickStartAnswers ? 'full' : 'review_known');
    }
  }, [existingInterview]);

  // Autosave on answer changes
  useEffect(() => {
    const serialized = JSON.stringify(answers);
    if (serialized === lastSavedRef.current) return;
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
      saveProgress();
    }, 3000);
    return () => { if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [answers]);

  // ── Computed ──────────────────────────────────────────────────────────────

  const currentSection = INTERVIEW_SECTIONS[activeSectionIdx];
  const qualityScore = calculateQualityScore(answers);

  const totalQuestions = INTERVIEW_SECTIONS.reduce((t, s) => t + s.questions.length, 0);
  const answeredQuestions = INTERVIEW_SECTIONS.reduce((t, s) => {
    const sa = answers[s.id] || {};
    return t + s.questions.filter(q => (sa[q.key] || '').trim().length > 0).length;
  }, 0);

  // Get prefill item for a question
  const getPrefillForQuestion = (sectionId: string, questionKey: string): PrefillItem | undefined => {
    return prefill?.items.find(i => i.sectionId === sectionId && i.questionKey === questionKey);
  };

  // Question filter logic (LIVE — used for sidebar "X shown" counts only).
  const getFilteredQuestions = (section: InterviewSection): InterviewQuestion[] => {
    if (questionFilter === 'all') return section.questions;
    return section.questions.filter(q => matchesQuestionFilter(q, questionFilter, {
      sectionId: section.id,
      sectionAnswers: answers[section.id] || {},
      prefillItems: prefill?.items || [],
      confirmedKeys,
    }));
  };

  // Frozen set of visible question keys for the ACTIVE section.
  // Recomputes only when the user navigates, changes the filter, or confirms/
  // rejects an item — NOT when they type. This prevents a question from being
  // filtered out (and its textarea unmounted) the instant the first character
  // is typed under a filter like "Missing". Answers are read via answersRef so
  // that text changes do not invalidate the memo.
  const visibleQuestionKeys = useMemo<Set<string>>(() => {
    const section = INTERVIEW_SECTIONS[activeSectionIdx];
    if (!section) return new Set();
    // Snapshot answers via the ref so typing does NOT invalidate this memo.
    return computeVisibleQuestionKeys(section.questions, questionFilter, {
      sectionId: section.id,
      sectionAnswers: answersRef.current[section.id] || {},
      prefillItems: prefill?.items || [],
      confirmedKeys,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSectionIdx, questionFilter, prefill, confirmedKeys, rejectedKeys]);

  // Review Known Info: show high-confidence confirmed answers in compact view, then
  // missing. Frozen via useMemo (answers read through answersRef) so that typing into
  // a prefilled-but-empty question does not re-bucket it mid-keystroke and unmount the
  // textarea. Recomputes only on prefill load or confirm/reject actions. MUST live
  // above all early returns to satisfy the rules of hooks.
  const reviewKnownQuestions = useMemo(() => {
    if (mode !== 'review_known') return null;
    const ans = answersRef.current;
    const confirmed: { q: InterviewQuestion; sectionId: string; sectionTitle: string; pf: PrefillItem }[] = [];
    const needsReview: { q: InterviewQuestion; sectionId: string; sectionTitle: string; pf: PrefillItem }[] = [];
    const missing: { q: InterviewQuestion; sectionId: string; sectionTitle: string }[] = [];

    // Start with Quick Start questions but add any other missing essential ones
    const essentialKeys = new Set(QUICK_START_QUESTIONS.map(q => `${q.sectionId}::${q.key}`));
    // Add critical missing questions
    const criticalMissing = [
      'differentiators::whyChoose', 'compliance::cannotPromise', 'compliance::regulatedClaims',
      'questions::preBuyQuestions', 'objections::hesitateWhy', 'founder::excludeDetails',
    ];
    criticalMissing.forEach(k => essentialKeys.add(k));

    for (const section of INTERVIEW_SECTIONS) {
      for (const q of section.questions) {
        const compositeKey = `${section.id}::${q.key}`;
        if (!essentialKeys.has(compositeKey) && !q.quickStart) continue;
        const pf = prefill?.items.find(i => i.sectionId === section.id && i.questionKey === q.key);
        const val = (ans[section.id] || {})[q.key] || '';
        const isConf = confirmedKeys.has(compositeKey);

        if (pf && val.trim() && isConf) {
          confirmed.push({ q, sectionId: section.id, sectionTitle: section.title, pf });
        } else if (pf && val.trim() && !isConf) {
          needsReview.push({ q, sectionId: section.id, sectionTitle: section.title, pf });
        } else {
          missing.push({ q, sectionId: section.id, sectionTitle: section.title });
        }
      }
    }
    return { confirmed, needsReview, missing };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, prefill, confirmedKeys, rejectedKeys]);

  // Count questions per filter
  const getFilterCounts = () => {
    let missing = 0, needsReview = 0, confirmed = 0, compliance = 0;
    for (const section of INTERVIEW_SECTIONS) {
      for (const q of section.questions) {
        const compositeKey = `${section.id}::${q.key}`;
        const pf = getPrefillForQuestion(section.id, q.key);
        const hasAnswer = ((answers[section.id] || {})[q.key] || '').trim().length > 0;
        if (!hasAnswer) missing++;
        if (pf && !confirmedKeys.has(compositeKey) && pf.needsOwnerConfirmation) needsReview++;
        if (confirmedKeys.has(compositeKey)) confirmed++;
        if (q.sensitive || section.id === 'compliance') compliance++;
      }
    }
    return { missing, needsReview, confirmed, compliance };
  };

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleAnswer = useCallback((sectionId: string, key: string, value: string) => {
    setAnswers(prev => ({
      ...prev,
      [sectionId]: { ...(prev[sectionId] || {}), [key]: value },
    }));
  }, []);

  const handlePrivacy = useCallback((questionKey: string, level: PrivacyLevel) => {
    setPrivacySettings(prev => ({ ...prev, [questionKey]: level }));
  }, []);

  const handleConfirm = useCallback((sectionId: string, questionKey: string) => {
    const compositeKey = `${sectionId}::${questionKey}`;
    setConfirmedKeys(prev => { const n = new Set(prev); n.add(compositeKey); return n; });
    setRejectedKeys(prev => { const n = new Set(prev); n.delete(compositeKey); return n; });
    setEditingKeys(prev => { const n = new Set(prev); n.delete(compositeKey); return n; });
  }, []);

  const handleReject = useCallback((sectionId: string, questionKey: string) => {
    const compositeKey = `${sectionId}::${questionKey}`;
    setRejectedKeys(prev => { const n = new Set(prev); n.add(compositeKey); return n; });
    setConfirmedKeys(prev => { const n = new Set(prev); n.delete(compositeKey); return n; });
    // Clear the prefilled value
    handleAnswer(sectionId, questionKey, '');
  }, [handleAnswer]);

  const handleEdit = useCallback((sectionId: string, questionKey: string) => {
    const compositeKey = `${sectionId}::${questionKey}`;
    setEditingKeys(prev => { const n = new Set(prev); n.add(compositeKey); return n; });
    setConfirmedKeys(prev => { const n = new Set(prev); n.delete(compositeKey); return n; });
  }, []);

  const handleConfirmAll = useCallback((sectionId: string) => {
    const section = INTERVIEW_SECTIONS.find(s => s.id === sectionId);
    if (!section) return;
    setConfirmedKeys(prev => {
      const n = new Set(prev);
      for (const q of section.questions) {
        const val = (answers[sectionId] || {})[q.key];
        if (val?.trim()) {
          n.add(`${sectionId}::${q.key}`);
        }
      }
      return n;
    });
  }, [answers]);

  const saveProgress = async (status?: string) => {
    setSaving(true);
    setError('');
    try {
      const res = await fetch(`/api/businesses/${businessId}/business-profile/interview`, {
        method: interviewId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: interviewId || undefined,
          currentStep: activeSectionIdx,
          answersJson: answers,
          status: status || 'draft',
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save');
      if (data.id) setInterviewId(data.id);
      lastSavedRef.current = JSON.stringify(answers);
    } catch (err: any) {
      setError(err.message);
    }
    setSaving(false);
  };

  const handleGenerate = async (docTypes?: string[], isQuickStart = false) => {
    if (docTypes) {
      setGeneratingSection(docTypes[0]);
    } else {
      setGenerating(true);
    }
    setError('');
    try {
      await saveProgress();
      const res = await fetch(`/api/businesses/${businessId}/business-profile/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          interviewId,
          answersJson: answers,
          docTypes,
          isQuickStart,
          // Pass confidence metadata so generation knows what to flag
          prefillMetadata: prefill ? {
            confirmedKeys: Array.from(confirmedKeys),
            lowConfidenceKeys: prefill.items.filter(i => i.confidence === 'low').map(i => `${i.sectionId}::${i.questionKey}`),
            complianceKeys: INTERVIEW_SECTIONS.flatMap(s => s.questions.filter(q => q.sensitive).map(q => `${s.id}::${q.key}`)),
          } : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Generation failed');
      setGeneratedDocs(prev => {
        const existing = new Map(prev.map((d: any) => [d.documentType, d]));
        (data.documents || []).forEach((d: any) => existing.set(d.documentType, d));
        return Array.from(existing.values());
      });
      if (!docTypes) setView('documents');
    } catch (err: any) {
      setError(err.message);
    }
    setGenerating(false);
    setGeneratingSection(null);
  };

  const handleAIFollowUp = async (sectionId: string) => {
    setFollowUpLoading(sectionId);
    try {
      const section = INTERVIEW_SECTIONS.find(s => s.id === sectionId);
      const res = await fetch(`/api/businesses/${businessId}/business-profile/ai-followup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sectionId,
          sectionTitle: section?.title || sectionId,
          answers: answers[sectionId] || {},
        }),
      });
      const data = await res.json();
      if (data.followUps?.length > 0) {
        setFollowUps(prev => ({ ...prev, [sectionId]: data.followUps }));
      }
    } catch (err) {
      console.error('[follow-up]', err);
    }
    setFollowUpLoading(null);
  };

  const handleAISuggest = async (sectionId: string, question: InterviewQuestion) => {
    setSuggestLoading(`${sectionId}:${question.key}`);
    try {
      const section = INTERVIEW_SECTIONS.find(s => s.id === sectionId);
      const res = await fetch(`/api/businesses/${businessId}/business-profile/ai-suggest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          questionKey: question.key,
          questionLabel: question.label,
          sectionTitle: section?.title,
          existingAnswers: answers,
          helper: question.helper,
          example: question.example,
        }),
      });
      const data = await res.json();
      if (data.suggestion) {
        handleAnswer(sectionId, question.key, data.suggestion);
      }
    } catch (err) {
      console.error('[ai-suggest]', err);
    }
    setSuggestLoading(null);
  };

  const handleApproveAll = async () => {
    setSaving(true);
    setError('');
    try {
      await saveProgress('approved');
      for (const doc of generatedDocs) {
        await fetch(`/api/businesses/${businessId}/business-profile/documents/${doc.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'approved', approvedForAI: true, publicUseAllowed: true, requiresReview: false }),
        });
      }
      onComplete();
    } catch (err: any) {
      setError(err.message);
    }
    setSaving(false);
  };

  // ── Quality Score Badge ───────────────────────────────────────────────

  const QualityBadge = () => {
    const score = qualityScore.total;
    const color = score >= 70 ? 'text-green-600' : score >= 40 ? 'text-amber-600' : 'text-red-500';
    const bg = score >= 70 ? 'bg-green-50' : score >= 40 ? 'bg-amber-50' : 'bg-red-50';
    return (
      <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg ${bg}`}>
        <BarChart3 className={`w-4 h-4 ${color}`} />
        <span className={`text-sm font-bold ${color}`}>{score}</span>
        <span className="text-xs text-gray-500">/100</span>
      </div>
    );
  };

  // ── Source / Confidence badges ────────────────────────────────────────

  const SourceBadge = ({ source, confidence }: { source: PrefillSource; confidence: PrefillConfidence }) => {
    const sb = SOURCE_BADGES[source];
    const cb = CONFIDENCE_BADGES[confidence];
    return (
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${sb.bg} ${sb.color}`}>
          {sb.label}
        </span>
        <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${cb.bg} ${cb.color}`}>
          {cb.label} confidence
        </span>
      </div>
    );
  };

  // ── Question renderer (prefill-aware) ───────────────────────────────

  const renderQuestion = (q: InterviewQuestion, sectionId: string) => {
    const val = (answers[sectionId] || {})[q.key] || '';
    const privacy = privacySettings[q.key] || q.defaultPrivacy;
    const PrivIcon = PRIVACY_ICONS[privacy];
    const isLoadingSuggest = suggestLoading === `${sectionId}:${q.key}`;
    const helperOpen = showHelper === `${sectionId}:${q.key}`;

    // Prefill state
    const compositeKey = `${sectionId}::${q.key}`;
    const pf = getPrefillForQuestion(sectionId, q.key);
    const isConfirmed = confirmedKeys.has(compositeKey);
    const isRejected = rejectedKeys.has(compositeKey);
    const isEditing = editingKeys.has(compositeKey);
    const hasPrefill = !!pf && !isRejected;
    const isPrefilled = hasPrefill && val.trim().length > 0;
    const showCollapsed = isConfirmed && !isEditing && pf?.confidence === 'high';

    // Collapsed confirmed view
    if (showCollapsed) {
      return (
        <div key={q.key} className="group border border-green-100 bg-green-50/30 rounded-lg px-4 py-2.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <Check className="w-4 h-4 text-green-500 flex-shrink-0" />
              <span className="text-sm text-gray-700 font-medium truncate">{q.label}</span>
            </div>
            <button
              onClick={() => handleEdit(sectionId, q.key)}
              className="text-[11px] text-gray-400 hover:text-gray-600 flex items-center gap-1 flex-shrink-0"
            >
              <Pencil className="w-3 h-3" /> Edit
            </button>
          </div>
          <p className="text-sm text-gray-600 mt-1 line-clamp-2">{val}</p>
          {pf && <div className="mt-1"><SourceBadge source={pf.source} confidence={pf.confidence} /></div>}
        </div>
      );
    }

    return (
      <div key={q.key} className={`group ${
        isPrefilled && !isConfirmed && pf?.needsOwnerConfirmation
          ? 'border border-amber-200 bg-amber-50/20 rounded-xl p-4'
          : isConfirmed
            ? 'border border-green-100 bg-green-50/20 rounded-xl p-4'
            : 'p-0'
      }`}>
        {/* Label & controls */}
        <div className="flex items-start justify-between gap-2 mb-1.5">
          <label className="block text-sm font-medium text-gray-700">{q.label}</label>
          <div className="flex items-center gap-1 flex-shrink-0">
            <button
              onClick={() => setShowHelper(helperOpen ? null : `${sectionId}:${q.key}`)}
              className="p-1 rounded text-gray-400 hover:text-indigo-500 hover:bg-indigo-50 transition-colors"
              title="Show helper & example"
            >
              <HelpCircle className="w-3.5 h-3.5" />
            </button>
            <div className="relative">
              <select
                value={privacy}
                onChange={(e) => handlePrivacy(q.key, e.target.value as PrivacyLevel)}
                className="appearance-none text-xs pl-5 pr-1 py-0.5 rounded border border-gray-200 bg-white text-gray-500 cursor-pointer"
                title="Privacy level"
              >
                {PRIVACY_LEVELS.map(p => (
                  <option key={p.value} value={p.value}>{p.icon} {p.label}</option>
                ))}
              </select>
              <PrivIcon className="w-3 h-3 text-gray-400 absolute left-1.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>
          </div>
        </div>

        {/* Source & confidence badges for prefilled */}
        {isPrefilled && pf && (
          <div className="mb-2">
            <SourceBadge source={pf.source} confidence={pf.confidence} />
            {pf.notes && <p className="text-[10px] text-gray-400 mt-0.5">{pf.notes}</p>}
            {pf.confidence === 'low' && (
              <p className="text-[10px] text-amber-600 mt-0.5 flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" />
                Needs review. Found from public research — may be incomplete or outdated.
              </p>
            )}
            {pf.ownerConfirmed && !q.sensitive && (
              <p className="text-[10px] text-green-600 mt-0.5">
                Owner-confirmed. We will use this unless you edit it.
              </p>
            )}
            {!pf.ownerConfirmed && pf.confidence !== 'low' && (
              <p className="text-[10px] text-blue-600 mt-0.5">
                Suggested from research. Please confirm before use in content.
              </p>
            )}
          </div>
        )}

        {/* Helper panel */}
        {helperOpen && (
          <div className="mb-2 p-3 bg-indigo-50/50 border border-indigo-100 rounded-lg text-xs space-y-1.5">
            <div className="flex items-start gap-1.5">
              <Lightbulb className="w-3.5 h-3.5 text-indigo-500 mt-0.5 flex-shrink-0" />
              <span className="text-gray-600">{q.helper}</span>
            </div>
            {q.example && (
              <div className="flex items-start gap-1.5">
                <FileText className="w-3.5 h-3.5 text-indigo-400 mt-0.5 flex-shrink-0" />
                <span className="text-gray-500 italic">&ldquo;{q.example}&rdquo;</span>
              </div>
            )}
          </div>
        )}

        {/* Answer field */}
        <textarea
          value={val}
          onChange={(e) => {
            handleAnswer(sectionId, q.key, e.target.value);
            // If user edits a prefilled value, mark as editing
            if (pf) setEditingKeys(prev => { const n = new Set(prev); n.add(compositeKey); return n; });
          }}
          rows={2}
          className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400 resize-none transition-shadow"
          placeholder={val ? '' : 'Type your answer... (skip if not applicable)'}
        />

        {/* Action buttons */}
        <div className="flex items-center gap-2 mt-1 flex-wrap">
          {/* Confirm / Edit / Reject for prefilled items */}
          {isPrefilled && !isConfirmed && (
            <>
              <button
                onClick={() => handleConfirm(sectionId, q.key)}
                className="flex items-center gap-1 text-[11px] text-green-600 hover:text-green-800 font-medium transition-colors"
              >
                <Check className="w-3 h-3" /> Confirm
              </button>
              <span className="text-gray-200">|</span>
              <button
                onClick={() => handleEdit(sectionId, q.key)}
                className="flex items-center gap-1 text-[11px] text-blue-600 hover:text-blue-800 transition-colors"
              >
                <Pencil className="w-3 h-3" /> Edit
              </button>
              <span className="text-gray-200">|</span>
              <button
                onClick={() => handleReject(sectionId, q.key)}
                className="flex items-center gap-1 text-[11px] text-red-500 hover:text-red-700 transition-colors"
              >
                <XCircle className="w-3 h-3" /> Mark Incorrect
              </button>
            </>
          )}
          {isConfirmed && (
            <span className="flex items-center gap-1 text-[11px] text-green-600 font-medium">
              <Check className="w-3 h-3" /> Confirmed
            </span>
          )}
          {!isPrefilled && !isConfirmed && (
            <button
              onClick={() => handleAnswer(sectionId, q.key, '')}
              className="text-[11px] text-gray-400 hover:text-gray-600 transition-colors"
            >
              Skip
            </button>
          )}
          <span className="text-gray-200">|</span>
          <button
            onClick={() => handleAISuggest(sectionId, q)}
            disabled={isLoadingSuggest}
            className="flex items-center gap-1 text-[11px] text-indigo-500 hover:text-indigo-700 disabled:opacity-50 transition-colors"
          >
            {isLoadingSuggest ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
            Use AI to Suggest
          </button>
        </div>
      </div>
    );
  };

  // ── Mode Selection Screen ────────────────────────────────────────────

  if (mode === 'select') {
    const hasPrefillData = prefill && prefill.totalPrefilled > 0;

    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
        <div className="bg-white rounded-2xl shadow-xl w-full max-w-xl overflow-hidden">
          <div className="p-6 pb-3">
            <div className="flex items-center justify-between mb-1">
              <h2 className="text-xl font-bold text-gray-900">Help Me Build It</h2>
              <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-lg"><X className="w-5 h-5 text-gray-500" /></button>
            </div>

            {prefillLoading ? (
              <div className="flex items-center gap-2 text-sm text-gray-500 mt-2">
                <Loader2 className="w-4 h-4 animate-spin" /> Loading your business research...
              </div>
            ) : hasPrefillData ? (
              <>
                <p className="text-sm text-gray-600 mt-2">
                  We already researched your business and confirmed your location. Review what we found, correct anything that is wrong, and answer only the missing questions.
                </p>
                <div className="mt-3 flex items-center gap-3 p-3 bg-blue-50 border border-blue-100 rounded-lg">
                  <Info className="w-5 h-5 text-blue-600 flex-shrink-0" />
                  <div className="text-xs text-blue-700">
                    <strong>{prefill!.totalPrefilled} of {prefill!.totalQuestions}</strong> questions already have suggested answers.
                    {prefill!.hasOwnerData && ' Includes owner-confirmed data.'}
                    {prefill!.conflictsFound.length > 0 && (
                      <span className="text-amber-600"> {prefill!.conflictsFound.length} conflict(s) found and resolved.</span>
                    )}
                  </div>
                </div>
                {/* Source summary */}
                <div className="mt-2 flex flex-wrap gap-1">
                  {prefill!.sources.map(s => (
                    <span key={s.source} className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${SOURCE_BADGES[s.source].bg} ${SOURCE_BADGES[s.source].color}`}>
                      {s.label}: {s.count}
                    </span>
                  ))}
                </div>
              </>
            ) : (
              <>
                <p className="text-sm text-gray-500">
                  Answer a few questions and Launch OS will build your business profile, owner bio, founder story, FAQs, objections, brand voice, and compliance notes.
                </p>
                <p className="text-xs text-gray-400 mt-1">You can start with the short version and improve it later.</p>
              </>
            )}
          </div>

          <div className="p-6 pt-3 space-y-3">
            {/* Review Known Info (replaces Quick Start when prefill exists) */}
            <button
              onClick={() => setMode('review_known')}
              className="w-full text-left p-5 border-2 border-indigo-100 hover:border-indigo-300 rounded-xl transition-all hover:shadow-md group"
            >
              <div className="flex items-start gap-4">
                <div className="p-2.5 bg-indigo-50 rounded-xl group-hover:bg-indigo-100 transition-colors">
                  {hasPrefillData ? <CheckCircle className="w-6 h-6 text-indigo-600" /> : <Zap className="w-6 h-6 text-indigo-600" />}
                </div>
                <div>
                  <h3 className="font-semibold text-gray-900 text-base">
                    {hasPrefillData ? 'Confirm Business Profile' : 'Start Quick Interview'}
                  </h3>
                  <p className="text-sm text-gray-500 mt-0.5">
                    {hasPrefillData
                      ? `Review ${prefill!.totalPrefilled} pre-filled answers · Confirm or edit · Fill ${prefill!.totalQuestions - prefill!.totalPrefilled} missing`
                      : '13 essential questions · About 10–15 minutes'
                    }
                  </p>
                  <p className="text-xs text-gray-400 mt-1">
                    {hasPrefillData
                      ? 'Fastest way to a usable profile. Only asks what we could not find.'
                      : 'Get a usable first draft quickly. Add more details anytime.'
                    }
                  </p>
                </div>
              </div>
            </button>

            {/* Full Interview */}
            <button
              onClick={() => setMode('full')}
              className="w-full text-left p-5 border-2 border-gray-100 hover:border-indigo-200 rounded-xl transition-all hover:shadow-md group"
            >
              <div className="flex items-start gap-4">
                <div className="p-2.5 bg-gray-50 rounded-xl group-hover:bg-indigo-50 transition-colors">
                  <BookOpen className="w-6 h-6 text-gray-600 group-hover:text-indigo-600" />
                </div>
                <div>
                  <h3 className="font-semibold text-gray-900 text-base">Complete Full Brand Interview</h3>
                  <p className="text-sm text-gray-500 mt-0.5">
                    12 sections · 74 questions · {hasPrefillData ? `${prefill!.totalPrefilled} pre-filled` : 'Complete in any order'}
                  </p>
                  <p className="text-xs text-gray-400 mt-1">
                    {hasPrefillData
                      ? 'All questions shown with pre-filled answers. Filter by confirmed, missing, or needs review.'
                      : 'Best for more accurate websites, social posts, videos, SEO, and community engagement.'
                    }
                  </p>
                </div>
              </div>
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Documents Review Screen ──────────────────────────────────────────

  if (view === 'documents' && generatedDocs.length > 0) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
        <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl max-h-[90vh] overflow-y-auto">
          <div className="flex items-center justify-between p-5 border-b border-gray-100">
            <div>
              <h2 className="text-lg font-bold text-gray-900">Review Your Business Profile Documents</h2>
              <p className="text-sm text-gray-500 mt-0.5">
                {generatedDocs.length} documents generated. Review, edit, and approve.
              </p>
            </div>
            <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-lg"><X className="w-5 h-5 text-gray-500" /></button>
          </div>

          <div className="p-5 space-y-3">
            {generatedDocs.map(doc => {
              const docType = DOCUMENT_TYPES.find(d => d.type === doc.documentType);
              return (
                <div key={doc.id} className="border border-gray-200 rounded-xl overflow-hidden">
                  <button
                    onClick={() => setExpandedDoc(expandedDoc === doc.id ? null : doc.id)}
                    className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors text-left"
                  >
                    <div className="flex items-center gap-3">
                      <FileText className="w-4 h-4 text-indigo-600" />
                      <div>
                        <h4 className="text-sm font-semibold text-gray-900">{doc.title}</h4>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                            doc.status === 'approved' ? 'bg-green-100 text-green-700' :
                            doc.status === 'draft' ? 'bg-gray-100 text-gray-600' :
                            'bg-amber-100 text-amber-700'
                          }`}>
                            {doc.status === 'needs_review' ? 'Needs Review' : doc.status.charAt(0).toUpperCase() + doc.status.slice(1)}
                          </span>
                        </div>
                      </div>
                    </div>
                    {expandedDoc === doc.id ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
                  </button>
                  {expandedDoc === doc.id && (
                    <div className="px-4 pb-4 border-t border-gray-100">
                      <div className="mt-3 bg-gray-50 rounded-lg p-4 text-sm text-gray-700 whitespace-pre-wrap max-h-[300px] overflow-y-auto">
                        {doc.content}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {error && (
            <div className="mx-5 mb-3 flex items-center gap-2 p-3 bg-red-50 border border-red-100 rounded-lg text-sm text-red-700">
              <AlertCircle className="w-4 h-4" /> {error}
            </div>
          )}

          <div className="p-5 border-t border-gray-100 flex justify-between">
            <button onClick={() => setView('interview')} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">
              ← Back to Interview
            </button>
            <div className="flex gap-3">
              <button
                onClick={handleApproveAll}
                disabled={saving}
                className="flex items-center gap-2 px-5 py-2 bg-green-600 text-white rounded-lg text-sm font-semibold hover:bg-green-700 disabled:opacity-50 transition-colors"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                Approve All & Save
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Review Screen ────────────────────────────────────────────────────

  if (view === 'review') {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
        <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
          <div className="flex items-center justify-between p-5 border-b border-gray-100">
            <div className="flex items-center gap-3">
              <div>
                <h2 className="text-lg font-bold text-gray-900">Review & Generate</h2>
                <p className="text-sm text-gray-500 mt-0.5">{answeredQuestions} of {totalQuestions} questions answered · {confirmedKeys.size} confirmed</p>
              </div>
              <QualityBadge />
            </div>
            <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-lg"><X className="w-5 h-5 text-gray-500" /></button>
          </div>

          <div className="p-5 space-y-3">
            {INTERVIEW_SECTIONS.map((s, i) => {
              const sectionAnswers = answers[s.id] || {};
              const sectionPrefills = prefill?.items.filter(p => p.sectionId === s.id) || [];
              const enhancedStatus = getEnhancedSectionStatus(s, sectionPrefills, confirmedKeys);
              const cfg = ENHANCED_STATUS_CONFIG[enhancedStatus];
              const answered = s.questions.filter(q => (sectionAnswers[q.key] || '').trim().length > 0).length;
              const sectionConfirmed = s.questions.filter(q => confirmedKeys.has(`${s.id}::${q.key}`)).length;
              const genBtn = SECTION_GENERATE_BUTTONS[s.id];

              return (
                <div key={s.id} className="flex items-center justify-between px-4 py-3 bg-gray-50 rounded-lg">
                  <div className="flex items-center gap-3">
                    {enhancedStatus === 'confirmed' ? (
                      <CheckCircle className="w-4 h-4 text-green-500" />
                    ) : enhancedStatus === 'missing_key_details' ? (
                      <XCircle className="w-4 h-4 text-red-500" />
                    ) : enhancedStatus === 'requires_manual_review' ? (
                      <Shield className="w-4 h-4 text-purple-500" />
                    ) : (
                      <AlertCircle className={`w-4 h-4 ${cfg.color}`} />
                    )}
                    <div>
                      <span className="text-sm text-gray-700 font-medium">{s.title}</span>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-xs text-gray-500">{answered}/{s.questions.length}</span>
                        {sectionConfirmed > 0 && (
                          <span className="text-[10px] text-green-600">{sectionConfirmed} confirmed</span>
                        )}
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${cfg.bgColor} ${cfg.color} font-medium`}>
                          {cfg.label}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {genBtn && answered > 0 && (
                      <button
                        onClick={() => handleGenerate(genBtn.docTypes)}
                        disabled={!!generatingSection}
                        className="text-[11px] text-indigo-600 hover:text-indigo-800 font-medium disabled:opacity-50"
                      >
                        {generatingSection === genBtn.docTypes[0] ? (
                          <Loader2 className="w-3 h-3 animate-spin inline" />
                        ) : (
                          genBtn.label
                        )}
                      </button>
                    )}
                    <button
                      onClick={() => { setActiveSectionIdx(i); setView('interview'); }}
                      className="text-xs text-blue-600 hover:text-blue-800 font-medium"
                    >
                      Edit
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Conflicts */}
          {prefill && prefill.conflictsFound.length > 0 && (
            <div className="mx-5 mb-3">
              <button
                onClick={() => setShowConflicts(!showConflicts)}
                className="flex items-center gap-2 text-xs text-amber-600 hover:text-amber-800"
              >
                <AlertTriangle className="w-3.5 h-3.5" />
                {prefill.conflictsFound.length} data conflict(s) resolved
                {showConflicts ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              </button>
              {showConflicts && (
                <div className="mt-2 space-y-2">
                  {prefill.conflictsFound.map((c, i) => (
                    <div key={i} className="p-2 bg-amber-50 border border-amber-100 rounded-lg text-xs">
                      <p className="font-medium text-amber-800">{c.questionKey}</p>
                      {c.values.map((v, j) => (
                        <p key={j} className={`mt-0.5 ${j === 0 ? 'text-green-700' : 'text-gray-500 line-through'}`}>
                          {SOURCE_BADGES[v.source].label}: {v.value.slice(0, 100)}{v.value.length > 100 ? '...' : ''}
                        </p>
                      ))}
                      <p className="mt-1 text-[10px] text-amber-600">Using: {SOURCE_BADGES[c.resolvedSource].label}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Quality improvements */}
          {qualityScore.improvements.length > 0 && (
            <div className="mx-5 p-3 bg-amber-50 border border-amber-100 rounded-lg">
              <p className="text-xs font-semibold text-amber-700 mb-1">To improve this profile:</p>
              <ul className="text-xs text-amber-600 space-y-0.5">
                {qualityScore.improvements.slice(0, 4).map((imp, i) => (
                  <li key={i}>• {imp}</li>
                ))}
              </ul>
            </div>
          )}

          {error && (
            <div className="mx-5 mt-3 flex items-center gap-2 p-3 bg-red-50 border border-red-100 rounded-lg text-sm text-red-700">
              <AlertCircle className="w-4 h-4" /> {error}
            </div>
          )}

          <div className="p-5 border-t border-gray-100 flex justify-between">
            <button onClick={() => setView('interview')} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">
              ← Continue Editing
            </button>
            <button
              onClick={() => handleGenerate(undefined, mode === 'review_known')}
              disabled={generating || answeredQuestions < 5}
              className="flex items-center gap-2 px-6 py-2.5 bg-indigo-600 text-white rounded-lg text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50 transition-colors"
            >
              {generating ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Generating Documents...</>
              ) : (
                <><Sparkles className="w-4 h-4" /> Generate All Profile Documents</>
              )}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Main Interview View ───────────────────────────────────────────────

  const isReviewKnown = mode === 'review_known';
  const progress = (answeredQuestions / totalQuestions) * 100;
  const filterCounts = getFilterCounts();


  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-gray-100 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div>
              <h2 className="text-lg font-bold text-gray-900">Help Me Build It</h2>
              <p className="text-xs text-gray-500 mt-0.5">
                {isReviewKnown
                  ? `Confirm Business Profile — ${confirmedKeys.size} confirmed`
                  : `${currentSection.title} — Section ${activeSectionIdx + 1} of ${INTERVIEW_SECTIONS.length}`
                }
              </p>
            </div>
            <QualityBadge />
          </div>
          <div className="flex items-center gap-2">
            {saving && <span className="text-[10px] text-gray-400 flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" />Saving...</span>}
            <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-lg">
              <X className="w-5 h-5 text-gray-500" />
            </button>
          </div>
        </div>

        {/* Progress Bar */}
        <div className="px-5 pt-3 flex-shrink-0">
          <div className="bg-gray-200 rounded-full h-1.5">
            <div className="bg-indigo-600 h-1.5 rounded-full transition-all duration-300" style={{ width: `${progress}%` }} />
          </div>
          <div className="flex justify-between mt-1">
            <span className="text-[10px] text-gray-400">
              {isReviewKnown ? 'Review & Confirm' : 'Full Interview'}: {answeredQuestions}/{totalQuestions} answered
            </span>
            <span className="text-[10px] text-gray-400">{Math.round(progress)}%</span>
          </div>
        </div>

        <div className="flex flex-1 overflow-hidden">
          {/* Sidebar — Full interview only */}
          {!isReviewKnown && (
            <div className="w-52 border-r border-gray-100 overflow-y-auto flex-shrink-0 p-3 space-y-1 hidden md:block">
              {/* Filter buttons */}
              <div className="mb-3 space-y-1">
                <p className="text-[10px] text-gray-400 font-semibold uppercase tracking-wide px-1">Filter</p>
                {[
                  { key: 'all' as QuestionFilter, label: 'Show All', count: totalQuestions },
                  { key: 'missing' as QuestionFilter, label: 'Missing', count: filterCounts.missing },
                  { key: 'needs_review' as QuestionFilter, label: 'Needs Review', count: filterCounts.needsReview },
                  { key: 'confirmed' as QuestionFilter, label: 'Confirmed', count: filterCounts.confirmed },
                  { key: 'compliance' as QuestionFilter, label: 'Compliance', count: filterCounts.compliance },
                ].map(f => (
                  <button
                    key={f.key}
                    onClick={() => setQuestionFilter(f.key)}
                    className={`w-full text-left px-2 py-1 rounded text-[11px] flex items-center justify-between ${
                      questionFilter === f.key
                        ? 'bg-indigo-50 text-indigo-700 font-medium'
                        : 'text-gray-500 hover:bg-gray-50'
                    }`}
                  >
                    <span>{f.label}</span>
                    <span className="text-[10px] text-gray-400">{f.count}</span>
                  </button>
                ))}
              </div>

              {/* Section nav */}
              {INTERVIEW_SECTIONS.map((s, i) => {
                const sectionAnswers = answers[s.id] || {};
                const sectionPrefills = prefill?.items.filter(p => p.sectionId === s.id) || [];
                const enhancedStatus = getEnhancedSectionStatus(s, sectionPrefills, confirmedKeys);
                const cfg = ENHANCED_STATUS_CONFIG[enhancedStatus];
                const isActive = i === activeSectionIdx;
                const answered = s.questions.filter(q => (sectionAnswers[q.key] || '').trim().length > 0).length;
                const sectionConfirmed = s.questions.filter(q => confirmedKeys.has(`${s.id}::${q.key}`)).length;
                const filteredCount = getFilteredQuestions(s).length;

                return (
                  <button
                    key={s.id}
                    onClick={() => setActiveSectionIdx(i)}
                    className={`w-full text-left px-3 py-2 rounded-lg text-xs transition-all ${
                      isActive
                        ? 'bg-indigo-50 border border-indigo-200 text-indigo-700 font-semibold'
                        : 'hover:bg-gray-50 text-gray-600'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="truncate">{s.title}</span>
                      {enhancedStatus === 'confirmed' && <CheckCircle className="w-3 h-3 text-green-500 flex-shrink-0" />}
                    </div>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span className="text-[10px] text-gray-400">{answered}/{s.questions.length}</span>
                      {sectionConfirmed > 0 && <span className="text-[10px] text-green-600">✓{sectionConfirmed}</span>}
                      {questionFilter !== 'all' && filteredCount !== s.questions.length && (
                        <span className="text-[10px] text-indigo-500">{filteredCount} shown</span>
                      )}
                      <span className={`text-[9px] px-1 py-px rounded ${cfg.bgColor} ${cfg.color}`}>{cfg.label}</span>
                    </div>
                  </button>
                );
              })}

              {/* Section feeds */}
              {SECTION_FEEDS[currentSection.id] && (
                <div className="mt-3 pt-3 border-t border-gray-100">
                  <p className="text-[10px] text-gray-400 font-semibold uppercase tracking-wide mb-1">This section feeds:</p>
                  <ul className="text-[10px] text-gray-500 space-y-0.5">
                    {SECTION_FEEDS[currentSection.id].map(f => (
                      <li key={f}>• {f}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* Questions Area */}
          <div className="flex-1 overflow-y-auto p-5 space-y-4">
            {isReviewKnown && reviewKnownQuestions ? (
              // Review Known Info mode
              <>
                <div className="mb-3">
                  <h3 className="text-base font-semibold text-gray-800">Confirm Business Profile</h3>
                  <p className="text-xs text-gray-500 mt-0.5">
                    Review what we found, correct anything wrong, and answer the missing questions.
                  </p>
                </div>

                {/* Needs Review section */}
                {reviewKnownQuestions.needsReview.length > 0 && (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 text-amber-500" />
                      <h4 className="text-sm font-semibold text-amber-700">Needs Your Review ({reviewKnownQuestions.needsReview.length})</h4>
                    </div>
                    {reviewKnownQuestions.needsReview.map(({ q, sectionId, sectionTitle }) => (
                      <div key={`${sectionId}:${q.key}`}>
                        <p className="text-[10px] text-indigo-500 font-medium mb-0.5">{sectionTitle}</p>
                        {renderQuestion(q, sectionId)}
                      </div>
                    ))}
                  </div>
                )}

                {/* Missing section */}
                {reviewKnownQuestions.missing.length > 0 && (
                  <div className="space-y-3 mt-4">
                    <div className="flex items-center gap-2">
                      <HelpCircle className="w-4 h-4 text-gray-400" />
                      <h4 className="text-sm font-semibold text-gray-700">Still Need Answers ({reviewKnownQuestions.missing.length})</h4>
                    </div>
                    {reviewKnownQuestions.missing.map(({ q, sectionId, sectionTitle }) => (
                      <div key={`${sectionId}:${q.key}`}>
                        <p className="text-[10px] text-indigo-500 font-medium mb-0.5">{sectionTitle}</p>
                        {renderQuestion(q, sectionId)}
                      </div>
                    ))}
                  </div>
                )}

                {/* Confirmed section (collapsed) */}
                {reviewKnownQuestions.confirmed.length > 0 && (
                  <div className="space-y-2 mt-4">
                    <div className="flex items-center gap-2">
                      <CheckCircle className="w-4 h-4 text-green-500" />
                      <h4 className="text-sm font-semibold text-green-700">Confirmed ({reviewKnownQuestions.confirmed.length})</h4>
                    </div>
                    {reviewKnownQuestions.confirmed.map(({ q, sectionId }) => renderQuestion(q, sectionId))}
                  </div>
                )}
              </>
            ) : (
              // Full interview: section view
              <>
                <div className="mb-1">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-base font-semibold text-gray-800">{currentSection.title}</h3>
                      <p className="text-xs text-gray-500 mt-0.5">{currentSection.description}</p>
                    </div>
                    {/* Confirm All button */}
                    {(() => {
                      const sectionAnswers = answers[currentSection.id] || {};
                      const answered = currentSection.questions.filter(q => (sectionAnswers[q.key] || '').trim()).length;
                      const allConfirmed = currentSection.questions.every(q => confirmedKeys.has(`${currentSection.id}::${q.key}`));
                      if (answered > 0 && !allConfirmed) {
                        return (
                          <button
                            onClick={() => handleConfirmAll(currentSection.id)}
                            className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-green-600 hover:text-green-800 border border-green-200 rounded-lg hover:bg-green-50 transition-colors"
                          >
                            <Check className="w-3 h-3" /> Confirm All in Section
                          </button>
                        );
                      }
                      return null;
                    })()}
                  </div>
                </div>

                {/* Prefilled service checklist (Services & Customers step) */}
                {currentSection.id === 'services' && (
                  <ServicesChecklistPanel businessId={businessId} onCount={setServicesPanelCount} />
                )}

                {/* Filtered questions */}
                {(() => {
                  // Use the FROZEN visible-key set so typing never unmounts a field.
                  let filtered = questionFilter === 'all'
                    ? currentSection.questions
                    : currentSection.questions.filter(q => visibleQuestionKeys.has(q.key));
                  // When the prefilled service checklist has services, it replaces the blank "core services" question
                  if (currentSection.id === 'services' && servicesPanelCount > 0) {
                    filtered = filtered.filter(q => q.key !== 'coreServices');
                  }
                  if (filtered.length === 0) {
                    return (
                      <div className="text-center py-8 text-gray-400">
                        <Filter className="w-8 h-8 mx-auto mb-2 opacity-50" />
                        <p className="text-sm">No questions match the current filter in this section.</p>
                        <button
                          onClick={() => setQuestionFilter('all')}
                          className="text-xs text-indigo-600 hover:text-indigo-800 mt-2"
                        >
                          Show all questions
                        </button>
                      </div>
                    );
                  }
                  return filtered.map(q => renderQuestion(q, currentSection.id));
                })()}

                {/* AI follow-up questions */}
                {followUps[currentSection.id]?.length > 0 && (
                  <div className="mt-4 p-4 bg-blue-50/50 border border-blue-100 rounded-xl space-y-3">
                    <div className="flex items-center gap-2">
                      <MessageSquare className="w-4 h-4 text-blue-600" />
                      <span className="text-sm font-semibold text-blue-800">Follow-up Questions</span>
                      <span className="text-[10px] text-blue-500">(optional)</span>
                    </div>
                    {followUps[currentSection.id].map((fq, i) => {
                      const fKey = `followup_${currentSection.id}_${i}`;
                      const fVal = (followUpAnswers[currentSection.id] || {})[fKey] || '';
                      return (
                        <div key={i}>
                          <label className="block text-sm text-blue-700 mb-1">{fq}</label>
                          <textarea
                            value={fVal}
                            onChange={(e) => {
                              setFollowUpAnswers(prev => ({
                                ...prev,
                                [currentSection.id]: { ...(prev[currentSection.id] || {}), [fKey]: e.target.value },
                              }));
                              handleAnswer(currentSection.id, fKey, e.target.value);
                            }}
                            rows={2}
                            className="w-full px-3 py-2 border border-blue-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400/40 resize-none bg-white"
                            placeholder="Optional — skip if not relevant"
                          />
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Section-level generate + follow-up buttons */}
                <div className="flex items-center gap-2 mt-4 pt-4 border-t border-gray-100">
                  {(() => {
                    const sectionAnswers = answers[currentSection.id] || {};
                    const answered = currentSection.questions.filter(q => (sectionAnswers[q.key] || '').trim().length > 0).length;
                    const genBtn = SECTION_GENERATE_BUTTONS[currentSection.id];
                    return (
                      <>
                        <button
                          onClick={() => handleAIFollowUp(currentSection.id)}
                          disabled={followUpLoading === currentSection.id || answered === 0}
                          className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-blue-600 hover:text-blue-800 border border-blue-200 rounded-lg hover:bg-blue-50 disabled:opacity-50 transition-colors"
                        >
                          {followUpLoading === currentSection.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <MessageSquare className="w-3 h-3" />}
                          AI Follow-ups
                        </button>
                        {genBtn && answered > 0 && (
                          <button
                            onClick={() => handleGenerate(genBtn.docTypes)}
                            disabled={!!generatingSection}
                            className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-indigo-600 hover:text-indigo-800 border border-indigo-200 rounded-lg hover:bg-indigo-50 disabled:opacity-50 transition-colors"
                          >
                            {generatingSection === genBtn.docTypes[0] ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                            {genBtn.label}
                          </button>
                        )}
                      </>
                    );
                  })()}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="mx-5 mb-3 flex items-center gap-2 p-3 bg-red-50 border border-red-100 rounded-lg text-sm text-red-700">
            <AlertCircle className="w-4 h-4" /> {error}
          </div>
        )}

        {/* Footer Navigation */}
        <div className="flex items-center justify-between p-5 border-t border-gray-100 flex-shrink-0">
          <div className="flex items-center gap-2">
            {!isReviewKnown && activeSectionIdx > 0 && (
              <button
                onClick={() => setActiveSectionIdx(prev => prev - 1)}
                className="flex items-center gap-1.5 px-4 py-2 text-sm text-gray-600 hover:text-gray-800"
              >
                <ArrowLeft className="w-4 h-4" /> Back
              </button>
            )}
            {isReviewKnown && (
              <button
                onClick={() => { setMode('full'); setActiveSectionIdx(0); }}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-500 hover:text-gray-700 border border-gray-200 rounded-lg"
              >
                <BookOpen className="w-3.5 h-3.5" /> Switch to Full Interview
              </button>
            )}
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => saveProgress()}
              disabled={saving}
              className="flex items-center gap-1.5 px-4 py-2 text-sm text-gray-600 hover:text-gray-800 border border-gray-200 rounded-lg"
            >
              {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
              Save
            </button>

            {isReviewKnown ? (
              <button
                onClick={() => {
                  if (answeredQuestions >= 5) setView('review');
                }}
                disabled={answeredQuestions < 5}
                className="flex items-center gap-1.5 px-5 py-2 bg-indigo-600 text-white rounded-lg text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50 transition-colors"
              >
                Review & Generate <ArrowRight className="w-4 h-4" />
              </button>
            ) : activeSectionIdx < INTERVIEW_SECTIONS.length - 1 ? (
              <button
                onClick={() => setActiveSectionIdx(prev => prev + 1)}
                className="flex items-center gap-1.5 px-5 py-2 bg-indigo-600 text-white rounded-lg text-sm font-semibold hover:bg-indigo-700 transition-colors"
              >
                Next <ArrowRight className="w-4 h-4" />
              </button>
            ) : (
              <button
                onClick={() => setView('review')}
                className="flex items-center gap-1.5 px-5 py-2 bg-indigo-600 text-white rounded-lg text-sm font-semibold hover:bg-indigo-700 transition-colors"
              >
                Review & Generate
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Services & Customers — prefilled service checklist
// Replaces the blank "core services" question with a confirm/reject
// checklist sourced from the matched industry + Jim Bridger research.
// ═══════════════════════════════════════════════════════════════
interface ServicesChecklistPanelProps {
  businessId: string;
  onCount: (n: number) => void;
}

function ServicesChecklistPanel({ businessId, onCount }: ServicesChecklistPanelProps) {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<any>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/businesses/${businessId}/services`);
      if (res.ok) {
        const d = await res.json();
        setData(d);
        onCount((d.offerings || []).length);
      } else {
        onCount(0);
      }
    } catch {
      onCount(0);
    }
    setLoading(false);
  }, [businessId, onCount]);

  useEffect(() => { load(); }, [load]);

  const patch = async (offeringId: string, status: string) => {
    setBusyId(offeringId);
    try {
      await fetch(`/api/businesses/${businessId}/services/${offeringId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      await load();
    } catch {}
    setBusyId(null);
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-gray-400 py-4">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading your service checklist…
      </div>
    );
  }

  const offerings: any[] = data?.offerings || [];
  const active = offerings.filter(o => o.status !== 'rejected' && o.status !== 'hidden');

  // No taxonomy services yet — fall back to the standard free-text question
  if (active.length === 0) {
    return (
      <div className="mb-4 p-4 rounded-xl border border-dashed border-gray-300 bg-gray-50">
        <p className="text-sm text-gray-600">
          We don&apos;t have an industry service checklist for this business yet. List your core services below,
          or open <a href="/dashboard/website/services" className="text-blue-600 hover:underline font-medium">Services Offered</a> to
          match an industry and load suggestions automatically.
        </p>
      </div>
    );
  }

  return (
    <div className="mb-5 p-4 rounded-xl border border-blue-100 bg-blue-50/40">
      <div className="flex items-start gap-2 mb-3">
        <Sparkles className="w-4 h-4 text-blue-600 mt-0.5 shrink-0" />
        <div>
          <h4 className="text-sm font-semibold text-gray-800">Your services</h4>
          <p className="text-xs text-gray-600">
            We found these likely services from your industry{data?.matchedIndustry ? <> (<span className="font-medium">{data.matchedIndustry.name}</span>)</> : ''} and Jim Bridger&apos;s research.
            Confirm which ones you offer — these power your SEO pages, ads, and social content.
          </p>
        </div>
      </div>
      <div className="space-y-1.5">
        {active.map(o => {
          const confirmed = o.status === 'confirmed';
          const busy = busyId === o.id;
          return (
            <div key={o.id} className="flex items-center gap-2 bg-white border border-gray-200 rounded-lg px-3 py-2">
              <button
                onClick={() => patch(o.id, confirmed ? 'suggested' : 'confirmed')}
                disabled={busy}
                className="shrink-0"
                title={confirmed ? 'Confirmed — click to unconfirm' : 'Confirm you offer this'}
              >
                {confirmed
                  ? <CheckCircle className="w-5 h-5 text-green-600" />
                  : <div className="w-5 h-5 rounded-full border-2 border-gray-300 hover:border-blue-500" />}
              </button>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium text-gray-900">{o.name}</span>
                  {o.status === 'needs_review' && <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-yellow-100 text-yellow-800">needs review</span>}
                  {o.confidence && <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-100 text-gray-500">{o.confidence}</span>}
                </div>
                {o.shortDescription && <p className="text-xs text-gray-400 truncate">{o.shortDescription}</p>}
              </div>
              {busy && <Loader2 className="w-4 h-4 text-blue-600 animate-spin" />}
              <button
                onClick={() => patch(o.id, 'rejected')}
                disabled={busy}
                className="p-1 rounded hover:bg-red-50 text-gray-400 hover:text-red-500 shrink-0"
                title="We don't offer this"
              >
                <Ban className="w-4 h-4" />
              </button>
            </div>
          );
        })}
      </div>
      <div className="mt-3 text-xs text-gray-500">
        Need to add a service or generate pages? Open the full <a href="/dashboard/website/services" className="text-blue-600 hover:underline font-medium">Services Offered</a> manager.
      </div>
    </div>
  );
}