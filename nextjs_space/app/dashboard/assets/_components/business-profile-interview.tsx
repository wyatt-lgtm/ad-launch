'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  X, ArrowLeft, ArrowRight, Loader2, CheckCircle, Sparkles,
  Save, FileText, AlertCircle, Download, Edit3, Eye, Lock,
  ChevronDown, ChevronUp,
} from 'lucide-react';

const INTERVIEW_STEPS = [
  {
    id: 'basics',
    title: 'Business Basics',
    questions: [
      { key: 'officialName', label: 'What is the official business name?' },
      { key: 'namesAbbreviations', label: 'What names, nicknames, or abbreviations should we use or avoid?' },
      { key: 'oneSentence', label: 'What does the business do in one sentence?' },
      { key: 'mainServices', label: 'What are the main services or products?' },
      { key: 'yearsOperating', label: 'How long has the business been operating?' },
      { key: 'location', label: 'Where is the business located?' },
      { key: 'ownerLeader', label: 'Who owns or leads the business?' },
      { key: 'contactInfo', label: 'What is the main phone number, website, and public contact information?' },
    ],
  },
  {
    id: 'founder',
    title: 'Owner / Founder Story',
    questions: [
      { key: 'founderName', label: 'Who is the owner or founder?' },
      { key: 'founderBackground', label: 'What is their background?' },
      { key: 'whyStarted', label: 'Why did they start or join this business?' },
      { key: 'problemSolving', label: 'What problem were they trying to solve?' },
      { key: 'credibility', label: 'What experience, training, or personal story makes them credible?' },
      { key: 'values', label: 'What values do they want customers to associate with the business?' },
      { key: 'bioTone', label: 'What should the owner bio sound like? (professional, friendly, local, premium, etc.)' },
      { key: 'excludeDetails', label: 'Are there personal details that should not be included publicly?' },
    ],
  },
  {
    id: 'history',
    title: 'Company History',
    questions: [
      { key: 'whenStarted', label: 'When was the company started?' },
      { key: 'whyStartedCompany', label: 'Why was it started?' },
      { key: 'milestones', label: 'What major milestones should be included?' },
      { key: 'changes', label: 'Has the business changed names, locations, or services over time?' },
      { key: 'proudOf', label: 'What is the company most proud of?' },
      { key: 'storyDifferent', label: 'What makes the company\'s story different from competitors?' },
    ],
  },
  {
    id: 'mission',
    title: 'Mission & Purpose',
    questions: [
      { key: 'whyExists', label: 'Why does this business exist beyond making money?' },
      { key: 'problemSolved', label: 'What problem does it solve for customers?' },
      { key: 'customerDeserve', label: 'What does the business believe customers deserve?' },
      { key: 'missionPlain', label: 'What is the mission statement in plain language?' },
      { key: 'brandPromise', label: 'What promise should customers feel from the brand?' },
    ],
  },
  {
    id: 'services',
    title: 'Services & Customers',
    questions: [
      { key: 'coreServices', label: 'What are the core services or products?' },
      { key: 'mostProfitable', label: 'Which services are most profitable?' },
      { key: 'promoteOften', label: 'Which services should Launch OS promote most often?' },
      { key: 'avoidServices', label: 'Which services should be avoided or de-emphasized?' },
      { key: 'idealCustomer', label: 'Who is the ideal customer?' },
      { key: 'notGoodFit', label: 'Who is not a good fit?' },
      { key: 'customerTypes', label: 'Are customers residential, commercial, local, national, high-income, budget-conscious, urgent-need, recurring, etc.?' },
      { key: 'triggerToCall', label: 'What customer problems usually trigger someone to call?' },
    ],
  },
  {
    id: 'serviceArea',
    title: 'Service Area',
    questions: [
      { key: 'areasServed', label: 'What cities, neighborhoods, counties, or regions does the business serve?' },
      { key: 'priorityMarkets', label: 'Are there priority markets?' },
      { key: 'areasNotServed', label: 'Are there areas the business does not serve?' },
      { key: 'serviceModel', label: 'Does the business have a storefront, service radius, mobile area, or multiple locations?' },
      { key: 'localTerms', label: 'Are there local landmarks, communities, or regional terms customers recognize?' },
    ],
  },
  {
    id: 'differentiators',
    title: 'Differentiators',
    questions: [
      { key: 'whyChoose', label: 'Why should a customer choose this business instead of a competitor?' },
      { key: 'whatBetter', label: 'What does the business do better?' },
      { key: 'proof', label: 'What proof supports those claims?' },
      { key: 'competitorWeakness', label: 'What are competitors bad at that this business avoids?' },
      { key: 'neverClaim', label: 'What should never be claimed if it is not true?' },
    ],
  },
  {
    id: 'credentials',
    title: 'Credentials & Guarantees',
    questions: [
      { key: 'licenses', label: 'What licenses, certifications, memberships, or credentials should be mentioned?' },
      { key: 'awardsRatings', label: 'Are there awards, years in business, review counts, or ratings that can be used?' },
      { key: 'guarantees', label: 'Are there warranties, guarantees, trial offers, or satisfaction policies?' },
      { key: 'disclaimers', label: 'Are there conditions or disclaimers tied to those guarantees?' },
      { key: 'legalReview', label: 'Are there claims that require legal review before publishing?' },
    ],
  },
  {
    id: 'questions',
    title: 'Customer Questions',
    questions: [
      { key: 'preBuyQuestions', label: 'What questions do customers ask before buying?' },
      { key: 'postBuyQuestions', label: 'What questions do customers ask after buying?' },
      { key: 'comparisonQuestions', label: 'What questions do customers ask when comparing competitors?' },
      { key: 'salesTeamExplains', label: 'What does the sales team explain over and over?' },
      { key: 'faqCandidates', label: 'What questions should be turned into website FAQs, social posts, or explainer videos?' },
    ],
  },
  {
    id: 'objections',
    title: 'Customer Objections',
    questions: [
      { key: 'hesitateWhy', label: 'Why do customers hesitate?' },
      { key: 'priceObjections', label: 'What price objections come up?' },
      { key: 'trustObjections', label: 'What trust objections come up?' },
      { key: 'timingObjections', label: 'What timing objections come up?' },
      { key: 'competitorComparisons', label: 'What competitor comparisons come up?' },
      { key: 'howToAnswer', label: 'How should the business answer those objections?' },
      { key: 'dontArgue', label: 'What objections should not be argued with directly?' },
    ],
  },
  {
    id: 'voice',
    title: 'Brand Voice',
    questions: [
      { key: 'soundLike', label: 'What should the business sound like?' },
      { key: 'useOften', label: 'What words or phrases should Launch OS use often?' },
      { key: 'avoidWords', label: 'What words or phrases should Launch OS avoid?' },
      { key: 'tone', label: 'Should the tone be professional, casual, technical, local, premium, warm, direct, etc.?' },
      { key: 'industryTermsKnown', label: 'Are there industry terms customers understand?' },
      { key: 'industryTermsUnknown', label: 'Are there industry terms customers do NOT understand?' },
      { key: 'pronouns', label: 'Should copy say "I," "we," "our team," or the business name?' },
    ],
  },
  {
    id: 'compliance',
    title: 'Claims & Compliance',
    questions: [
      { key: 'regulatedClaims', label: 'Are there regulated claims, legal disclaimers, financing disclosures, or medical/legal/financial restrictions?' },
      { key: 'cannotPromise', label: 'Are there things the business cannot legally promise?' },
      { key: 'competitorClaimsAvoid', label: 'Are there claims competitors make that this business should avoid?' },
      { key: 'testimonialRules', label: 'Are there before/after, customer result, or testimonial rules?' },
      { key: 'manualReview', label: 'Should any generated content require manual review before publishing?' },
    ],
  },
];

interface Props {
  businessId: string;
  onClose: () => void;
  onComplete: () => void;
  existingInterview?: { id: string; currentStep: number; answersJson: any; status: string } | null;
}

export default function BusinessProfileInterview({ businessId, onClose, onComplete, existingInterview }: Props) {
  const [step, setStep] = useState(existingInterview?.currentStep || 0);
  const [answers, setAnswers] = useState<Record<string, Record<string, string>>>(
    existingInterview?.answersJson || {}
  );
  const [interviewId, setInterviewId] = useState(existingInterview?.id || '');
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generatedDocs, setGeneratedDocs] = useState<any[]>([]);
  const [error, setError] = useState('');
  const [showReview, setShowReview] = useState(false);
  const [expandedDoc, setExpandedDoc] = useState<string | null>(null);

  const currentStepData = INTERVIEW_STEPS[step];
  const isLastStep = step === INTERVIEW_STEPS.length - 1;
  const totalSteps = INTERVIEW_STEPS.length;
  const progress = ((step + 1) / totalSteps) * 100;

  // Count answered questions
  const totalQuestions = INTERVIEW_STEPS.reduce((t, s) => t + s.questions.length, 0);
  const answeredQuestions = INTERVIEW_STEPS.reduce((t, s) => {
    const stepAnswers = answers[s.id] || {};
    return t + s.questions.filter(q => (stepAnswers[q.key] || '').trim().length > 0).length;
  }, 0);

  const handleAnswer = (key: string, value: string) => {
    setAnswers(prev => ({
      ...prev,
      [currentStepData.id]: { ...(prev[currentStepData.id] || {}), [key]: value },
    }));
  };

  const saveProgress = async (nextStep?: number) => {
    setSaving(true);
    setError('');
    try {
      const res = await fetch(`/api/businesses/${businessId}/business-profile/interview`, {
        method: interviewId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: interviewId || undefined,
          currentStep: nextStep ?? step,
          answersJson: answers,
          status: 'draft',
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save');
      if (data.id) setInterviewId(data.id);
    } catch (err: any) {
      setError(err.message);
    }
    setSaving(false);
  };

  const handleNext = async () => {
    if (isLastStep) {
      await saveProgress(step);
      setShowReview(true);
    } else {
      const nextStep = step + 1;
      setStep(nextStep);
      await saveProgress(nextStep);
    }
  };

  const handleBack = () => {
    if (step > 0) setStep(step - 1);
  };

  const handleGenerate = async () => {
    setGenerating(true);
    setError('');
    try {
      // Save final state
      await saveProgress(step);

      const res = await fetch(`/api/businesses/${businessId}/business-profile/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ interviewId, answersJson: answers }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Generation failed');
      setGeneratedDocs(data.documents || []);
    } catch (err: any) {
      setError(err.message);
    }
    setGenerating(false);
  };

  const handleApproveAll = async () => {
    setSaving(true);
    setError('');
    try {
      const res = await fetch(`/api/businesses/${businessId}/business-profile/interview`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: interviewId,
          currentStep: step,
          answersJson: answers,
          status: 'approved',
        }),
      });
      if (!res.ok) throw new Error('Failed to approve');

      // Approve all generated docs
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

  // Generated docs review screen
  if (generatedDocs.length > 0) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
        <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl max-h-[90vh] overflow-y-auto">
          <div className="flex items-center justify-between p-5 border-b border-gray-100">
            <div>
              <h2 className="text-lg font-bold text-gray-900">Review Your Business Profile Documents</h2>
              <p className="text-sm text-gray-500 mt-0.5">
                These documents will help Launch OS write more accurate websites, posts, videos, ads, and community engagement responses.
              </p>
            </div>
            <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-lg"><X className="w-5 h-5 text-gray-500" /></button>
          </div>

          <div className="p-5 space-y-3">
            {generatedDocs.map(doc => (
              <div key={doc.id} className="border border-gray-200 rounded-xl overflow-hidden">
                <button
                  onClick={() => setExpandedDoc(expandedDoc === doc.id ? null : doc.id)}
                  className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors text-left"
                >
                  <div className="flex items-center gap-3">
                    <FileText className="w-4 h-4 text-indigo-600" />
                    <div>
                      <h4 className="text-sm font-semibold text-gray-900">{doc.title}</h4>
                      <p className="text-xs text-gray-500">{doc.documentType.replace(/_/g, ' ')}</p>
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
            ))}
          </div>

          {error && (
            <div className="mx-5 mb-3 flex items-center gap-2 p-3 bg-red-50 border border-red-100 rounded-lg text-sm text-red-700">
              <AlertCircle className="w-4 h-4" /> {error}
            </div>
          )}

          <div className="p-5 border-t border-gray-100 flex justify-between">
            <button onClick={() => { setGeneratedDocs([]); setShowReview(true); }} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">
              ← Back to Review
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

  // Review screen before generation
  if (showReview) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
        <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
          <div className="flex items-center justify-between p-5 border-b border-gray-100">
            <div>
              <h2 className="text-lg font-bold text-gray-900">Review & Generate</h2>
              <p className="text-sm text-gray-500 mt-0.5">{answeredQuestions} of {totalQuestions} questions answered</p>
            </div>
            <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-lg"><X className="w-5 h-5 text-gray-500" /></button>
          </div>

          <div className="p-5 space-y-3">
            {INTERVIEW_STEPS.map((s, i) => {
              const stepAnswers = answers[s.id] || {};
              const answered = s.questions.filter(q => (stepAnswers[q.key] || '').trim().length > 0).length;
              return (
                <div key={s.id} className="flex items-center justify-between px-4 py-2.5 bg-gray-50 rounded-lg">
                  <div className="flex items-center gap-3">
                    {answered === s.questions.length ? (
                      <CheckCircle className="w-4 h-4 text-green-500" />
                    ) : answered > 0 ? (
                      <AlertCircle className="w-4 h-4 text-amber-500" />
                    ) : (
                      <div className="w-4 h-4 rounded-full border-2 border-gray-300" />
                    )}
                    <span className="text-sm text-gray-700">{s.title}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-gray-500">{answered}/{s.questions.length}</span>
                    <button onClick={() => { setStep(i); setShowReview(false); }} className="text-xs text-blue-600 hover:text-blue-800 font-medium">
                      Edit
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Quality warnings */}
          {answeredQuestions < 20 && (
            <div className="mx-5 p-3 bg-amber-50 border border-amber-100 rounded-lg text-sm text-amber-700">
              <AlertCircle className="w-4 h-4 inline mr-1" />
              Answering more questions will produce richer, more accurate profile documents.
            </div>
          )}

          {error && (
            <div className="mx-5 mt-3 flex items-center gap-2 p-3 bg-red-50 border border-red-100 rounded-lg text-sm text-red-700">
              <AlertCircle className="w-4 h-4" /> {error}
            </div>
          )}

          <div className="p-5 border-t border-gray-100 flex justify-between">
            <button onClick={() => setShowReview(false)} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">
              ← Continue Editing
            </button>
            <button
              onClick={handleGenerate}
              disabled={generating || answeredQuestions < 5}
              className="flex items-center gap-2 px-6 py-2.5 bg-indigo-600 text-white rounded-lg text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50 transition-colors"
            >
              {generating ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Generating Documents...</>
              ) : (
                <><Sparkles className="w-4 h-4" /> Generate Profile Documents</>
              )}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Interview step view
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-gray-100 flex-shrink-0">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Help Me Build It</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Step {step + 1} of {totalSteps} — {currentStepData.title}
            </p>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-lg">
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        {/* Progress Bar */}
        <div className="px-5 pt-3 flex-shrink-0">
          <div className="bg-gray-200 rounded-full h-1.5">
            <div className="bg-indigo-600 h-1.5 rounded-full transition-all duration-300" style={{ width: `${progress}%` }} />
          </div>
          <div className="flex justify-between mt-1">
            <span className="text-[10px] text-gray-400">{answeredQuestions}/{totalQuestions} questions answered</span>
            <span className="text-[10px] text-gray-400">{Math.round(progress)}%</span>
          </div>
        </div>

        {/* Questions */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <h3 className="text-base font-semibold text-gray-800 mb-1">{currentStepData.title}</h3>
          {currentStepData.questions.map(q => {
            const val = (answers[currentStepData.id] || {})[q.key] || '';
            return (
              <div key={q.key}>
                <label className="block text-sm font-medium text-gray-700 mb-1">{q.label}</label>
                <textarea
                  value={val}
                  onChange={(e) => handleAnswer(q.key, e.target.value)}
                  rows={2}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
                  placeholder="Type your answer... (skip if not applicable)"
                />
              </div>
            );
          })}
        </div>

        {/* Error */}
        {error && (
          <div className="mx-5 mb-3 flex items-center gap-2 p-3 bg-red-50 border border-red-100 rounded-lg text-sm text-red-700">
            <AlertCircle className="w-4 h-4" /> {error}
          </div>
        )}

        {/* Footer Navigation */}
        <div className="flex items-center justify-between p-5 border-t border-gray-100 flex-shrink-0">
          <button
            onClick={handleBack}
            disabled={step === 0}
            className="flex items-center gap-1.5 px-4 py-2 text-sm text-gray-600 hover:text-gray-800 disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <ArrowLeft className="w-4 h-4" /> Back
          </button>

          <div className="flex items-center gap-3">
            <button
              onClick={() => saveProgress()}
              disabled={saving}
              className="flex items-center gap-1.5 px-4 py-2 text-sm text-gray-600 hover:text-gray-800 border border-gray-200 rounded-lg"
            >
              {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
              Save Progress
            </button>
            <button
              onClick={handleNext}
              className="flex items-center gap-1.5 px-5 py-2 bg-indigo-600 text-white rounded-lg text-sm font-semibold hover:bg-indigo-700 transition-colors"
            >
              {isLastStep ? 'Review & Generate' : 'Next'}
              {!isLastStep && <ArrowRight className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
