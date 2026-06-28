'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  X, ArrowLeft, ArrowRight, Loader2, CheckCircle, Sparkles,
  Save, FileText, AlertCircle, ChevronDown, ChevronUp,
  Zap, BookOpen, Eye, EyeOff, Lock, Globe, Bot,
  Ban, HelpCircle, Lightbulb, MessageSquare, BarChart3,
  RefreshCw, Download,
} from 'lucide-react';
import {
  INTERVIEW_SECTIONS, QUICK_START_QUESTIONS, DOCUMENT_TYPES,
  SECTION_STATUS_CONFIG, SECTION_GENERATE_BUTTONS, SECTION_FEEDS,
  PRIVACY_LEVELS, calculateQualityScore, getSectionStatus,
  type InterviewSection, type InterviewQuestion, type PrivacyLevel,
  type SectionStatus, type QualityScore,
} from '@/lib/interview-data';

// ── Types ────────────────────────────────────────────────────────────────────

type InterviewMode = 'select' | 'quick_start' | 'full';
type ViewState = 'interview' | 'review' | 'documents';

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

  // UI state
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generatingSection, setGeneratingSection] = useState<string | null>(null);
  const [generatedDocs, setGeneratedDocs] = useState<any[]>([]);
  const [error, setError] = useState('');
  const [expandedDoc, setExpandedDoc] = useState<string | null>(null);
  const [showHelper, setShowHelper] = useState<string | null>(null);

  // AI state
  const [followUps, setFollowUps] = useState<Record<string, string[]>>({});
  const [followUpLoading, setFollowUpLoading] = useState<string | null>(null);
  const [suggestLoading, setSuggestLoading] = useState<string | null>(null);
  const [followUpAnswers, setFollowUpAnswers] = useState<Record<string, Record<string, string>>>({});

  // Autosave
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastSavedRef = useRef<string>('');

  // Detect existing interview mode
  useEffect(() => {
    if (existingInterview?.answersJson && Object.keys(existingInterview.answersJson).length > 0) {
      // Has existing data — go directly to full interview
      const hasNonQuickStartAnswers = INTERVIEW_SECTIONS.some(s => {
        const sa = existingInterview.answersJson[s.id];
        if (!sa) return false;
        return s.questions.some(q => !q.quickStart && (sa[q.key] || '').trim());
      });
      setMode(hasNonQuickStartAnswers ? 'full' : 'quick_start');
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

  const totalQuestions = mode === 'quick_start'
    ? QUICK_START_QUESTIONS.length
    : INTERVIEW_SECTIONS.reduce((t, s) => t + s.questions.length, 0);

  const answeredQuestions = mode === 'quick_start'
    ? QUICK_START_QUESTIONS.filter(q => {
        const sa = answers[q.sectionId] || {};
        return (sa[q.key] || '').trim().length > 0;
      }).length
    : INTERVIEW_SECTIONS.reduce((t, s) => {
        const sa = answers[s.id] || {};
        return t + s.questions.filter(q => (sa[q.key] || '').trim().length > 0).length;
      }, 0);

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
        body: JSON.stringify({ interviewId, answersJson: answers, docTypes, isQuickStart }),
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

  // ── Quality Score Badge ─────────────────────────────────────────────────

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

  // ── Question renderer ──────────────────────────────────────────────────

  const renderQuestion = (q: InterviewQuestion, sectionId: string) => {
    const val = (answers[sectionId] || {})[q.key] || '';
    const privacy = privacySettings[q.key] || q.defaultPrivacy;
    const PrivIcon = PRIVACY_ICONS[privacy];
    const isLoadingSuggest = suggestLoading === `${sectionId}:${q.key}`;
    const helperOpen = showHelper === `${sectionId}:${q.key}`;

    return (
      <div key={q.key} className="group">
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
            {/* Privacy selector */}
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

        <textarea
          value={val}
          onChange={(e) => handleAnswer(sectionId, q.key, e.target.value)}
          rows={2}
          className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400 resize-none transition-shadow"
          placeholder="Type your answer... (skip if not applicable)"
        />

        {/* Action buttons */}
        <div className="flex items-center gap-2 mt-1">
          <button
            onClick={() => handleAnswer(sectionId, q.key, '')}
            className="text-[11px] text-gray-400 hover:text-gray-600 transition-colors"
          >
            Skip
          </button>
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

  // ── Mode Selection Screen ──────────────────────────────────────────────

  if (mode === 'select') {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
        <div className="bg-white rounded-2xl shadow-xl w-full max-w-xl overflow-hidden">
          <div className="p-6 pb-3">
            <div className="flex items-center justify-between mb-1">
              <h2 className="text-xl font-bold text-gray-900">Help Me Build It</h2>
              <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-lg"><X className="w-5 h-5 text-gray-500" /></button>
            </div>
            <p className="text-sm text-gray-500">
              Answer a few questions and Launch OS will build your business profile, owner bio, founder story, FAQs, objections, brand voice, and compliance notes.
            </p>
            <p className="text-xs text-gray-400 mt-1">You can start with the short version and improve it later.</p>
          </div>

          <div className="p-6 pt-3 space-y-3">
            {/* Quick Start */}
            <button
              onClick={() => setMode('quick_start')}
              className="w-full text-left p-5 border-2 border-indigo-100 hover:border-indigo-300 rounded-xl transition-all hover:shadow-md group"
            >
              <div className="flex items-start gap-4">
                <div className="p-2.5 bg-indigo-50 rounded-xl group-hover:bg-indigo-100 transition-colors">
                  <Zap className="w-6 h-6 text-indigo-600" />
                </div>
                <div>
                  <h3 className="font-semibold text-gray-900 text-base">Start Quick Interview</h3>
                  <p className="text-sm text-gray-500 mt-0.5">13 essential questions · About 10–15 minutes</p>
                  <p className="text-xs text-gray-400 mt-1">Get a usable first draft quickly. Add more details anytime.</p>
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
                  <p className="text-sm text-gray-500 mt-0.5">12 sections · 74 questions · Complete any order</p>
                  <p className="text-xs text-gray-400 mt-1">Best for more accurate websites, social posts, videos, SEO, and community engagement.</p>
                </div>
              </div>
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Documents Review Screen ────────────────────────────────────────────

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
                          {docType?.defaultPrivacy === 'ai_reference_only' && (
                            <span className="text-[10px] text-gray-400 flex items-center gap-0.5">
                              <Bot className="w-3 h-3" /> AI reference
                            </span>
                          )}
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

  // ── Review Screen ──────────────────────────────────────────────────────

  if (view === 'review') {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
        <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
          <div className="flex items-center justify-between p-5 border-b border-gray-100">
            <div className="flex items-center gap-3">
              <div>
                <h2 className="text-lg font-bold text-gray-900">Review & Generate</h2>
                <p className="text-sm text-gray-500 mt-0.5">{answeredQuestions} of {totalQuestions} questions answered</p>
              </div>
              <QualityBadge />
            </div>
            <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-lg"><X className="w-5 h-5 text-gray-500" /></button>
          </div>

          <div className="p-5 space-y-3">
            {INTERVIEW_SECTIONS.map((s, i) => {
              const sectionAnswers = answers[s.id] || {};
              const status = getSectionStatus(s, sectionAnswers);
              const cfg = SECTION_STATUS_CONFIG[status];
              const answered = s.questions.filter(q => (sectionAnswers[q.key] || '').trim().length > 0).length;
              const genBtn = SECTION_GENERATE_BUTTONS[s.id];

              return (
                <div key={s.id} className="flex items-center justify-between px-4 py-3 bg-gray-50 rounded-lg">
                  <div className="flex items-center gap-3">
                    {status === 'strong' ? (
                      <CheckCircle className="w-4 h-4 text-green-500" />
                    ) : status === 'not_started' ? (
                      <div className="w-4 h-4 rounded-full border-2 border-gray-300" />
                    ) : (
                      <AlertCircle className={`w-4 h-4 ${cfg.color}`} />
                    )}
                    <div>
                      <span className="text-sm text-gray-700 font-medium">{s.title}</span>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-xs text-gray-500">{answered}/{s.questions.length}</span>
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
              onClick={() => handleGenerate(undefined, mode === 'quick_start')}
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

  // ── Main Interview View ────────────────────────────────────────────────

  const isQuickStart = mode === 'quick_start';
  const progress = (answeredQuestions / totalQuestions) * 100;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-gray-100 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div>
              <h2 className="text-lg font-bold text-gray-900">Help Me Build It</h2>
              <p className="text-xs text-gray-500 mt-0.5">
                {isQuickStart ? 'Quick Start' : `${currentSection.title} — Section ${activeSectionIdx + 1} of ${INTERVIEW_SECTIONS.length}`}
              </p>
            </div>
            {!isQuickStart && <QualityBadge />}
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
              {isQuickStart ? 'Quick Start' : 'Full Interview'}: {answeredQuestions}/{totalQuestions} answered
            </span>
            <span className="text-[10px] text-gray-400">{Math.round(progress)}%</span>
          </div>
        </div>

        <div className="flex flex-1 overflow-hidden">
          {/* Sidebar — Full interview only */}
          {!isQuickStart && (
            <div className="w-52 border-r border-gray-100 overflow-y-auto flex-shrink-0 p-3 space-y-1 hidden md:block">
              {INTERVIEW_SECTIONS.map((s, i) => {
                const sectionAnswers = answers[s.id] || {};
                const status = getSectionStatus(s, sectionAnswers);
                const cfg = SECTION_STATUS_CONFIG[status];
                const isActive = i === activeSectionIdx;
                const answered = s.questions.filter(q => (sectionAnswers[q.key] || '').trim().length > 0).length;

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
                      {status === 'strong' && <CheckCircle className="w-3 h-3 text-green-500 flex-shrink-0" />}
                    </div>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span className="text-[10px] text-gray-400">{answered}/{s.questions.length}</span>
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
            {isQuickStart ? (
              // Quick Start: all 13 questions in one scrollable list
              <>
                <div className="mb-3">
                  <h3 className="text-base font-semibold text-gray-800">Quick Start Interview</h3>
                  <p className="text-xs text-gray-500 mt-0.5">Answer these 13 essential questions to generate your first draft.</p>
                </div>
                {QUICK_START_QUESTIONS.map(q => (
                  <div key={`${q.sectionId}:${q.key}`}>
                    <p className="text-[10px] text-indigo-500 font-medium mb-0.5">{q.sectionTitle}</p>
                    {renderQuestion(q, q.sectionId)}
                  </div>
                ))}
              </>
            ) : (
              // Full interview: section view
              <>
                <div className="mb-1">
                  <h3 className="text-base font-semibold text-gray-800">{currentSection.title}</h3>
                  <p className="text-xs text-gray-500 mt-0.5">{currentSection.description}</p>
                </div>
                {currentSection.questions.map(q => renderQuestion(q, currentSection.id))}

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
                              // Also store in main answers for generation
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
            {!isQuickStart && activeSectionIdx > 0 && (
              <button
                onClick={() => setActiveSectionIdx(prev => prev - 1)}
                className="flex items-center gap-1.5 px-4 py-2 text-sm text-gray-600 hover:text-gray-800"
              >
                <ArrowLeft className="w-4 h-4" /> Back
              </button>
            )}
            {isQuickStart && (
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

            {isQuickStart ? (
              <button
                onClick={() => {
                  if (answeredQuestions >= 5) {
                    setView('review');
                  }
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
