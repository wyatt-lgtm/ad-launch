'use client';

import { Globe, Layout, Users, Briefcase, ArrowRight, Lock, Copy, Check, Sparkles, Loader2, ExternalLink, Mail, ChevronDown, ChevronUp, CheckCircle2, Circle, AlertCircle, Clock, Plus, Trash2, Search, AlertTriangle, MessageSquarePlus, Send, RefreshCw, FileText, ImageIcon, ShieldCheck } from 'lucide-react';
import { useState, useRef, useCallback, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import WebsiteAgencyBrief from '@/components/website-agency-brief';
import WebsiteProductionRoom from './website-production-room';
import WebsiteWarRoom from './website-war-room';

interface WebsiteConceptProps {
  data: any;
  locked?: boolean;
  analysisId?: string;
  collapsed?: boolean;
}

interface WorkflowStep {
  id: number;
  department: string;
  label: string;
  status: 'waiting' | 'active' | 'complete' | 'error';
  rawStatus?: string;
  lastError?: string | null;
}

interface FeedbackEntry {
  id: string;
  sectionId: string;
  target: string;
  feedback: string;
  requestedAction: string;
  status: string;
  createdAt: string;
}

function SectionFeedbackButton({ sectionId, sectionTitle, analysisId, workflowId, onFeedbackAdded }: {
  sectionId: string;
  sectionTitle: string;
  analysisId?: string;
  workflowId?: string;
  onFeedbackAdded: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [action, setAction] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!text.trim() || !analysisId) return;
    setSubmitting(true);
    try {
      await fetch('/api/site-feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          analysisId,
          workflowId: workflowId || '',
          sectionId,
          target: 'section',
          feedback: text.trim(),
          requestedAction: action.trim() || undefined,
        }),
      });
      setText('');
      setAction('');
      setOpen(false);
      onFeedbackAdded();
    } catch { /* ignore */ }
    setSubmitting(false);
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1 text-xs text-gray-400 hover:text-violet-600 transition-colors"
        title={`Give feedback on ${sectionTitle}`}
      >
        <MessageSquarePlus className="w-3.5 h-3.5" />
        Feedback
      </button>
    );
  }

  return (
    <div className="mt-3 p-3 bg-violet-50 rounded-lg border border-violet-100">
      <div className="text-xs font-semibold text-violet-700 mb-2">Feedback for: {sectionTitle}</div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="What would you change about this section?"
        rows={2}
        className="w-full px-3 py-2 text-sm border border-violet-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-300 resize-none bg-white"
      />
      <input
        type="text"
        value={action}
        onChange={(e) => setAction(e.target.value)}
        placeholder="Requested action (optional, e.g. 'rewrite headline')"
        className="w-full mt-2 px-3 py-2 text-sm border border-violet-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-300 bg-white"
      />
      <div className="flex justify-end gap-2 mt-2">
        <button onClick={() => setOpen(false)} className="text-xs text-gray-500 hover:text-gray-700">Cancel</button>
        <button
          onClick={handleSubmit}
          disabled={submitting || !text.trim()}
          className="flex items-center gap-1 text-xs font-semibold text-white bg-violet-600 hover:bg-violet-700 px-3 py-1.5 rounded-lg disabled:opacity-50 transition-colors"
        >
          {submitting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
          Submit
        </button>
      </div>
    </div>
  );
}

function FeedbackPanel({ analysisId, workflowId, feedbackList, onRevision, revising }: {
  analysisId: string;
  workflowId: string;
  feedbackList: FeedbackEntry[];
  onRevision: () => void;
  revising: boolean;
}) {
  const pendingCount = feedbackList.filter(f => f.status === 'pending').length;

  if (feedbackList.length === 0) return null;

  return (
    <div className="px-6 py-4 bg-amber-50/50 border-b border-amber-100">
      <div className="flex items-center justify-between mb-3">
        <h4 className="flex items-center gap-2 text-sm font-bold text-amber-900">
          <MessageSquarePlus className="w-4 h-4" />
          Owner Feedback ({pendingCount} pending)
        </h4>
        {pendingCount > 0 && (
          <button
            onClick={onRevision}
            disabled={revising}
            className="flex items-center gap-1.5 text-xs font-semibold text-white bg-amber-600 hover:bg-amber-700 px-3 py-1.5 rounded-lg disabled:opacity-50 transition-colors"
          >
            {revising ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            Apply & Regenerate
          </button>
        )}
      </div>
      <div className="space-y-2 max-h-48 overflow-y-auto">
        {feedbackList.map((fb) => (
          <div key={fb.id} className={`text-xs p-2.5 rounded-lg border ${
            fb.status === 'applied' ? 'bg-green-50 border-green-200 text-green-800' : 'bg-white border-amber-200 text-gray-700'
          }`}>
            <div className="flex items-center justify-between mb-1">
              <span className="font-semibold">{fb.sectionId}</span>
              <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${
                fb.status === 'applied' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'
              }`}>
                {fb.status}
              </span>
            </div>
            <p>{fb.feedback}</p>
            {fb.requestedAction && <p className="mt-1 text-violet-600 italic">Action: {fb.requestedAction}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}

function DiagnosticsPanel({ workflowId }: { workflowId: string }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  const loadDiagnostics = async () => {
    if (data) { setOpen(!open); return; }
    setLoading(true);
    try {
      const res = await fetch(`/api/site-diagnostics?workflowId=${encodeURIComponent(workflowId)}`);
      const result = await res.json().catch(() => ({}));
      if (result.strategyBrief || result.sectionContracts || result.qaGates) {
        setData(result);
        setOpen(true);
      }
    } catch { /* ignore */ }
    setLoading(false);
  };

  return (
    <div className="px-6 py-3 border-b border-gray-100">
      <button
        onClick={loadDiagnostics}
        disabled={loading}
        className="flex items-center gap-2 text-sm font-semibold text-gray-600 hover:text-violet-600 transition-colors"
      >
        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
        Generation Diagnostics
        {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
      </button>

      {open && data && (
        <div className="mt-3 space-y-4">
          {/* Strategy Brief */}
          {data.strategyBrief && (
            <div className="bg-blue-50 rounded-lg p-4 border border-blue-100">
              <h5 className="flex items-center gap-1.5 text-xs font-bold text-blue-800 mb-2">
                <Briefcase className="w-3.5 h-3.5" /> Strategy Brief
              </h5>
              <div className="text-xs text-blue-900 space-y-1">
                {data.strategyBrief.primary_business_type && <p><span className="font-semibold">Type:</span> {data.strategyBrief.primary_business_type}</p>}
                {data.strategyBrief.target_customer && <p><span className="font-semibold">Target:</span> {data.strategyBrief.target_customer}</p>}
                {data.strategyBrief.primary_conversion_action && <p><span className="font-semibold">Conversion:</span> {data.strategyBrief.primary_conversion_action}</p>}
                {Array.isArray(data.strategyBrief.core_pain_points) && (
                  <p><span className="font-semibold">Pain Points:</span> {data.strategyBrief.core_pain_points.join(', ')}</p>
                )}
              </div>
            </div>
          )}

          {/* Section Contracts */}
          {data.sectionContracts && Array.isArray(data.sectionContracts) && (
            <div className="bg-violet-50 rounded-lg p-4 border border-violet-100">
              <h5 className="flex items-center gap-1.5 text-xs font-bold text-violet-800 mb-2">
                <Layout className="w-3.5 h-3.5" /> Section Contracts ({data.sectionContracts.length})
              </h5>
              <div className="space-y-2">
                {data.sectionContracts.map((sc: any, i: number) => (
                  <div key={i} className="text-xs bg-white rounded p-2 border border-violet-100">
                    <span className="font-semibold text-violet-700">{sc.section_id || sc.section_type || `Section ${i + 1}`}</span>
                    {sc.benefit_statement && <span className="text-gray-600"> — {sc.benefit_statement}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Image Strategy */}
          {data.imageStrategy && (
            <div className="bg-orange-50 rounded-lg p-4 border border-orange-100">
              <h5 className="flex items-center gap-1.5 text-xs font-bold text-orange-800 mb-2">
                <ImageIcon className="w-3.5 h-3.5" /> Image Strategy
              </h5>
              <div className="text-xs text-orange-900">
                {Array.isArray(data.imageStrategy) ? (
                  <div className="space-y-1">
                    {data.imageStrategy.map((img: any, i: number) => (
                      <p key={i}>
                        <span className="font-semibold">{img.section_id || `Section ${i + 1}`}:</span>{' '}
                        {img.image_purpose || img.visual_style || 'Brief defined'}
                      </p>
                    ))}
                  </div>
                ) : (
                  <p className="text-gray-600">Image strategy defined</p>
                )}
              </div>
            </div>
          )}

          {/* QA Gates */}
          {data.qaGates && (
            <div className={`rounded-lg p-4 border ${
              data.qaGates.verdict === 'APPROVED' ? 'bg-green-50 border-green-100' : 'bg-red-50 border-red-100'
            }`}>
              <h5 className={`flex items-center gap-1.5 text-xs font-bold mb-2 ${
                data.qaGates.verdict === 'APPROVED' ? 'text-green-800' : 'text-red-800'
              }`}>
                <ShieldCheck className="w-3.5 h-3.5" /> QA Review: {data.qaGates.verdict || 'Unknown'}
              </h5>
              {data.qaGates.summary && <p className="text-xs text-gray-700 mb-2">{data.qaGates.summary}</p>}
              {Array.isArray(data.qaGates.gates) && (
                <div className="space-y-1">
                  {data.qaGates.gates.filter((g: any) => g.status !== 'PASS').map((g: any, i: number) => (
                    <div key={i} className={`text-xs flex items-center gap-1.5 ${
                      g.status === 'FAIL' ? 'text-red-700' : 'text-amber-700'
                    }`}>
                      {g.status === 'FAIL' ? <AlertCircle className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />}
                      <span className="font-semibold">{g.gate_id}:</span> {g.reason}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function CopyAll({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(text).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button onClick={handleCopy} className="flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-blue-600 transition-colors">
      {copied ? <><Check className="w-3.5 h-3.5 text-green-500" /> Copied!</> : <><Copy className="w-3.5 h-3.5" /> Copy All</>}
    </button>
  );
}

function SectionCard({ section, icon: Icon, color, index, analysisId, workflowId, showFeedback, onFeedbackAdded }: {
  section: any; icon: any; color: string; index: number;
  analysisId?: string; workflowId?: string; showFeedback?: boolean;
  onFeedbackAdded: () => void;
}) {
  const allText = [section.headline, section.cta].filter(Boolean).join('\n\n');
  const sectionId = section.id || section.title || `section-${index}`;
  return (
    <div className="bg-gray-50 rounded-xl p-5 border border-gray-100">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className={`w-8 h-8 ${color} rounded-lg flex items-center justify-center`}>
            <Icon className="w-4 h-4 text-white" />
          </div>
          <h4 className="font-semibold text-gray-900 text-sm">{section.title}</h4>
        </div>
        <div className="flex items-center gap-3">
          {showFeedback && (
            <SectionFeedbackButton
              sectionId={sectionId}
              sectionTitle={section.title || `Section ${index + 1}`}
              analysisId={analysisId}
              workflowId={workflowId}
              onFeedbackAdded={onFeedbackAdded}
            />
          )}
          <CopyAll text={allText} />
        </div>
      </div>
      {section.headline && (
        <div className="mb-3">
          <div className="text-xs text-gray-400 uppercase font-medium mb-1">Headline</div>
          <p className="text-lg font-bold text-gray-900 leading-tight">{section.headline}</p>
        </div>
      )}
      {section.cta && (
        <div>
          <div className="text-xs text-gray-400 uppercase font-medium mb-1">Call to Action</div>
          <span className="inline-block bg-blue-600 text-white text-sm font-semibold px-4 py-2 rounded-lg">{section.cta}</span>
        </div>
      )}
      {section.items?.length > 0 && (
        <div className="mt-3">
          <div className="text-xs text-gray-400 uppercase font-medium mb-2">Key Points</div>
          <ul className="space-y-1.5">
            {(section.items as string[]).map((item: string, i: number) => (
              <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                <ArrowRight className="w-3.5 h-3.5 text-blue-500 flex-shrink-0 mt-0.5" />
                {item}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function StepIcon({ status }: { status: WorkflowStep['status'] }) {
  switch (status) {
    case 'complete':
      return <CheckCircle2 className="w-5 h-5 text-green-500" />;
    case 'active':
      return <Loader2 className="w-5 h-5 text-violet-500 animate-spin" />;
    case 'error':
      return <AlertCircle className="w-5 h-5 text-red-500" />;
    default:
      return <Circle className="w-5 h-5 text-gray-300" />;
  }
}

function WorkflowProgress({ steps, status }: { steps: WorkflowStep[]; status: string }) {
  const completedCount = steps.filter(s => s.status === 'complete').length;
  const totalCount = steps.length || 5;
  const pct = Math.round((completedCount / totalCount) * 100);

  return (
    <div className="px-6 py-5 bg-violet-50/50 border-b border-violet-100">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-violet-500" />
          <span className="text-sm font-semibold text-violet-900">
            {status === 'completed' ? 'Generation Complete' : 'Generating Concept Website...'}
          </span>
        </div>
        <span className="text-xs font-medium text-violet-600">{pct}%</span>
      </div>

      {/* Progress bar */}
      <div className="w-full h-2 bg-violet-100 rounded-full mb-4 overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-violet-500 to-fuchsia-500 rounded-full transition-all duration-700 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>

      {/* Step list */}
      <div className="space-y-2">
        {steps.map((step, i) => (
          <div key={step.id || i} className="flex items-center gap-3">
            <StepIcon status={step.status} />
            <span className={`text-sm ${
              step.status === 'complete' ? 'text-green-700 font-medium' :
              step.status === 'active' ? 'text-violet-700 font-semibold' :
              step.status === 'error' ? 'text-red-600 font-medium' :
              'text-gray-400'
            }`}>
              {step.label}
            </span>
            {step.status === 'error' && step.lastError && (
              <span className="text-xs text-red-400 truncate max-w-[200px]">{step.lastError}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function WebsiteConcept({ data, locked = false, analysisId, collapsed = false }: WebsiteConceptProps) {
  const { data: session } = useSession() || {};
  const [expanded, setExpanded] = useState(!collapsed);
  const [generating, setGenerating] = useState(false);
  const [generatedUrl, setGeneratedUrl] = useState<string | null>(null);
  const [genError, setGenError] = useState('');
  const [showEmailPrompt, setShowEmailPrompt] = useState(false);
  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState('');

  // Workflow progress state
  const [workflowSteps, setWorkflowSteps] = useState<WorkflowStep[]>([]);
  const [workflowStatus, setWorkflowStatus] = useState<string>('');
  const pollRef = useRef<NodeJS.Timeout | null>(null);
  const workflowRef = useRef<{ workflowId: string; finalTaskId: number } | null>(null);
  const genStartRef = useRef<number>(0);
  const stallCountRef = useRef<number>(0);
  const lastProgressRef = useRef<string>('');

  // Reference websites state
  const [refUrls, setRefUrls] = useState<string[]>(['']);
  const [refInstructions, setRefInstructions] = useState('');
  const [showRefSection, setShowRefSection] = useState(false);

  // Competitive SEO scout state — checked by default, always-on for backend
  const [seoScoutEnabled, setSeoScoutEnabled] = useState(true);
  const [primaryKeyword, setPrimaryKeyword] = useState('');
  const [tradeArea, setTradeArea] = useState('');
  const [defaultsPrefilled, setDefaultsPrefilled] = useState(false);
  const [competitorUrls, setCompetitorUrls] = useState<string[]>(['']);
  const [seoWarnings, setSeoWarnings] = useState<string[]>([]);

  // Competitor intelligence (3 concepts + war room)
  const [competitorIntel, setCompetitorIntel] = useState<any>(null);

  // Owner feedback state
  const [feedbackList, setFeedbackList] = useState<FeedbackEntry[]>([]);
  const [revising, setRevising] = useState(false);

  // War Room direction selection state
  const [showWarRoom, setShowWarRoom] = useState(false);
  const [directionSelected, setDirectionSelected] = useState<{
    directionName: string;
    selectedBy: 'customer' | 'auto_timer' | 'system_default';
    selectedAt: string;
  } | null>(null);

  const isLoggedIn = !!(session?.user as any)?.email;

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  // Prefill keyword and trade area from research data when card expands
  useEffect(() => {
    if (expanded && !defaultsPrefilled && data) {
      // Primary keyword from business type / category / industry
      if (!primaryKeyword) {
        const kw = data.contentProfile?.business_type
          || data.contentProfile?.business_research?.business_type
          || data.contentProfile?.business_category
          || data.industry
          || data.contentProfile?.industry
          || data.contentProfile?.detected_service_type
          || '';
        if (kw) setPrimaryKeyword(kw);
      }
      // Trade area from confirmed city / location
      if (!tradeArea) {
        const ta = data.contentProfile?.confirmed_location?.city
          || data.contentProfile?.city
          || data.contentProfile?.service_area?.primary_city
          || data.location
          || '';
        if (ta) setTradeArea(ta);
      }
      setDefaultsPrefilled(true);
    }
  }, [expanded, defaultsPrefilled, data, primaryKeyword, tradeArea]);

  // Load existing feedback on mount
  const loadFeedback = useCallback(async () => {
    if (!analysisId) return;
    try {
      const res = await fetch(`/api/site-feedback?analysisId=${encodeURIComponent(analysisId)}`);
      const data = await res.json().catch(() => ({}));
      if (Array.isArray(data.feedback)) setFeedbackList(data.feedback);
    } catch { /* ignore */ }
  }, [analysisId]);

  useEffect(() => { loadFeedback(); }, [loadFeedback]);

  const handleRevision = async () => {
    if (!analysisId || revising) return;
    setRevising(true);
    try {
      const res = await fetch('/api/site-revision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          analysisId,
          websiteUrl: data?.websiteUrl || '',
          businessName: data?.businessName || '',
          industry: data?.industry || '',
          location: data?.location || '',
        }),
      });
      const result = await res.json().catch(() => ({}));
      if (result.workflowId) {
        // Start a new generation cycle with the revision workflow
        workflowRef.current = { workflowId: result.workflowId, finalTaskId: result.taskIds?.[result.taskIds.length - 1] ?? 0 };
        setGenerating(true);
        setGeneratedUrl(null);
        setGenError('');
        setWorkflowStatus('generating');
        genStartRef.current = Date.now();
        stallCountRef.current = 0;
        lastProgressRef.current = '';
        const defaultSteps: WorkflowStep[] = [
          { id: 1, department: 'Research', label: 'Research & Competitor Evaluation', status: 'waiting' },
          { id: 2, department: 'Marketing', label: 'Website Strategy Brief', status: 'waiting' },
          { id: 3, department: 'Creative Strategy', label: 'Website War Room', status: 'waiting' },
          { id: 4, department: 'Creative Direction', label: 'Direction Selection', status: 'waiting' },
          { id: 5, department: 'Asset Retrieval', label: 'Asset Retrieval', status: 'waiting' },
          { id: 6, department: 'Render Production', label: 'Image Generation', status: 'waiting' },
          { id: 7, department: 'Code Execution', label: 'Website Copywriting', status: 'waiting' },
          { id: 8, department: 'Strategy & Intelligence', label: 'Quality Review', status: 'waiting' },
        ];
        if (result.taskIds?.length) {
          result.taskIds.forEach((tid: number, i: number) => {
            if (defaultSteps[i]) defaultSteps[i].id = tid;
          });
        }
        setWorkflowSteps(defaultSteps);
        if (pollRef.current) clearInterval(pollRef.current);
        pollRef.current = setInterval(pollStatus, 5000);
        setTimeout(pollStatus, 3000);
        // Reload feedback to see applied status
        loadFeedback();
      } else {
        setGenError(result.error || 'Revision failed to start');
      }
    } catch { setGenError('Revision request failed'); }
    setRevising(false);
  };

  // Restore saved concept website workflow on mount
  useEffect(() => {
    if (!analysisId || generating || generatedUrl) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/concept-website-state?analysisId=${encodeURIComponent(analysisId)}`);
        const data = await res.json().catch(() => ({}));
        const cw = data?.conceptWebsiteWorkflow;
        if (!cw?.workflowId || cancelled) return;

        // Check workflow status
        const statusRes = await fetch(
          `/api/concept-site-status?workflowId=${encodeURIComponent(cw.workflowId)}&finalTaskId=${cw.finalTaskId ?? ''}`,
        );
        const statusData = await statusRes.json().catch(() => ({}));
        if (cancelled) return;

        if (statusData.steps?.length) setWorkflowSteps(statusData.steps);
        setWorkflowStatus(statusData.status ?? '');
        workflowRef.current = { workflowId: cw.workflowId, finalTaskId: cw.finalTaskId };

        if (statusData.html) {
          // HTML is available — show it regardless of War Room status
          const blob = new Blob([statusData.html], { type: 'text/html' });
          const url = URL.createObjectURL(blob);
          setGeneratedUrl(url);
          if (statusData.status !== 'completed' && statusData.status !== 'error') {
            setWorkflowStatus('completed');
          }
        } else if (statusData.status !== 'completed' && statusData.status !== 'error') {
          // Still in progress and no HTML yet — resume polling
          setGenerating(true);
          if (pollRef.current) clearInterval(pollRef.current);
          pollRef.current = setInterval(pollStatus, 5000);
        }
      } catch { /* ignore — no saved state */ }
    })();
    return () => { cancelled = true; };
  }, [analysisId]); // eslint-disable-line react-hooks/exhaustive-deps

  const pollStatus = useCallback(async () => {
    const wf = workflowRef.current;
    if (!wf) return;

    try {
      const res = await fetch(
        `/api/concept-site-status?workflowId=${encodeURIComponent(wf.workflowId)}&finalTaskId=${wf.finalTaskId}`,
      );
      const result = await res.json().catch(() => ({}));

      if (result.steps?.length) {
        setWorkflowSteps(result.steps);
      }
      setWorkflowStatus(result.status ?? '');

      // Capture competitor intelligence if present
      if (result.competitorIntelligence && !competitorIntel) {
        setCompetitorIntel(result.competitorIntelligence);
      }

      // Terminal states
      if (result.status === 'completed') {
        if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }

        if (result.html) {
          const blob = new Blob([result.html], { type: 'text/html' });
          const url = URL.createObjectURL(blob);
          setGeneratedUrl(url);
          window.open(url, '_blank');
        }
        if (result.competitorIntelligence) setCompetitorIntel(result.competitorIntelligence);
        setGenerating(false);
      } else if (result.status === 'error') {
        if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }

        // If HTML was generated (Code Execution completed) but a later step
        // (e.g. War Room review) failed, still show the HTML to the user
        if (result.html) {
          const blob = new Blob([result.html], { type: 'text/html' });
          const url = URL.createObjectURL(blob);
          setGeneratedUrl(url);
          window.open(url, '_blank');
          setGenerating(false);
        } else {
          // Build specific failure detail from steps
          const failedSteps = (result.steps ?? []).filter((s: any) => s.status === 'error');
          const failedLabels = failedSteps.map((s: any) => s.label || s.department).join(', ');
          const firstError = failedSteps[0]?.lastError;
          let msg = 'Generation encountered an issue.';
          if (failedLabels) msg = `Step failed: ${failedLabels}.`;
          if (firstError) msg += ` (${firstError.length > 120 ? firstError.slice(0, 120) + '…' : firstError})`;
          msg += ' Please try again.';
          setGenError(msg);
          setGenerating(false);
        }
      } else {
        // Still in progress — but if Code Execution completed and HTML is
        // available, show the website immediately. The War Room review step
        // is a quality gate bonus, not a blocker for the user.
        if (result.html) {
          if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
          const blob = new Blob([result.html], { type: 'text/html' });
          const url = URL.createObjectURL(blob);
          setGeneratedUrl(url);
          window.open(url, '_blank');
          setGenerating(false);
          // Mark all steps as complete (including QA) since HTML is ready
          // QA may still be running but it's non-blocking — user has their site
          setWorkflowSteps(prev => prev.map(s => ({
            ...s,
            status: s.status === 'waiting' ? 'complete' as const : s.status,
          })));
          setWorkflowStatus('completed');
          return;
        }

        // Check for stall (no progress for 8+ minutes)
        const progressKey = (result.steps ?? []).map((s: any) => `${s.id}:${s.status}`).join('|');
        if (progressKey === lastProgressRef.current) {
          stallCountRef.current += 1;
        } else {
          stallCountRef.current = 0;
          lastProgressRef.current = progressKey;
        }
        // ~8 min stall at 5s intervals = 96 polls, use 80 as threshold
        const elapsed = Date.now() - genStartRef.current;
        if (elapsed > 10 * 60 * 1000 && stallCountRef.current > 60) {
          if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
          const blockedSteps = (result.steps ?? []).filter((s: any) => s.status === 'waiting' || s.rawStatus === 'Blocked');
          const blockedLabels = blockedSteps.map((s: any) => s.label || s.department).join(', ');
          setGenError(`Generation timed out — ${blockedLabels ? `waiting on: ${blockedLabels}` : 'pipeline stalled'}. Our team has been notified. Please try again later.`);
          setGenerating(false);
        }
      }
    } catch {
      // Non-fatal — keep polling
    }
  }, []);

  const handleGenerateButtonClick = async () => {
    if (generating) return;

    // If card is collapsed, first click just expands the card
    if (!expanded) {
      setExpanded(true);
      setShowRefSection(true); // auto-open reference websites section
      return;
    }

    // Card is already expanded — this is the "Start Now" action
    if (!data?.sections?.length) return;

    if (!isLoggedIn) {
      setShowEmailPrompt(true);
      return;
    }

    doGenerate();
  };

  const handleEmailSubmit = async () => {
    if (!email.trim()) {
      setEmailError('Email is required');
      return;
    }
    const blockedDomains = ['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'aol.com', 'icloud.com'];
    const domain = email.split('@')?.[1]?.toLowerCase() ?? '';
    if (blockedDomains.includes(domain)) {
      setEmailError('Please use a business email');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setEmailError('Invalid email format');
      return;
    }
    setEmailError('');
    setShowEmailPrompt(false);
    doGenerate();
  };

  const doGenerate = async () => {
    setGenerating(true);
    setGenError('');
    setGeneratedUrl(null);
    setWorkflowSteps([]);
    setWorkflowStatus('starting');
    genStartRef.current = Date.now();
    stallCountRef.current = 0;
    lastProgressRef.current = '';

    try {
      // Build reference sites (filter empty)
      const validRefUrls = refUrls.map(u => u.trim()).filter(Boolean);
      // Always enable competitor analysis for website generation
      const effectiveSeoScout = true;
      const rawCompetitorUrls = competitorUrls.map(u => u.trim()).filter(Boolean).slice(0, 3);

      // Validate competitor URLs
      const validCompetitorUrls: string[] = [];
      for (const cu of rawCompetitorUrls) {
        try {
          const parsed = new URL(cu.startsWith('http') ? cu : `https://${cu}`);
          if (parsed.hostname && parsed.hostname.includes('.')) {
            validCompetitorUrls.push(cu.startsWith('http') ? cu : `https://${cu}`);
          }
        } catch {
          // Skip invalid URLs silently
        }
      }

      const res = await fetch('/api/generate-concept-site', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          websiteUrl: data.websiteUrl || '',
          businessName: data.businessName || '',
          industry: data.industry || '',
          location: data.location || '',
          contentProfile: data.contentProfile || {},
          businessId: data.businessId || '',
          // Reference websites
          referenceSites: validRefUrls.length > 0 ? validRefUrls.slice(0, 3) : undefined,
          referenceInstructions: refInstructions.trim() || undefined,
          // Competitive SEO scout — always enabled for website generation
          analyzeCompetitors: effectiveSeoScout,
          primaryKeyword: primaryKeyword.trim() || undefined,
          tradeArea: tradeArea.trim() || undefined,
          competitorUrls: validCompetitorUrls.length > 0 ? validCompetitorUrls : undefined,
          // Legacy fields for backward compat
          sections: data.sections,
          colorPalette: data.colorPalette,
        }),
      });
      const result = await res.json().catch(() => ({}));

      if (!res.ok) {
        setGenError(result.error ?? 'Failed to start generation');
        setGenerating(false);
        setWorkflowStatus('');
        return;
      }

      // ── Direct LLM mode (Tombstone unavailable) ──
      if (result.mode === 'direct' && result.html) {
        const blob = new Blob([result.html], { type: 'text/html' });
        const url = URL.createObjectURL(blob);
        setGeneratedUrl(url);
        window.open(url, '_blank');
        setGenerating(false);
        setWorkflowStatus('completed');
        // Show a completed single-step progress for visual feedback
        setWorkflowSteps([
          { id: 1, department: 'AI', label: 'Direct HTML Generation', status: 'complete' },
        ]);
        return;
      }

      // ── Workflow mode ──
      // Surface any warnings from backend (e.g., no search API configured)
      if (result.warnings?.length) {
        setSeoWarnings(result.warnings);
      }

      if (!result.workflowId) {
        setGenError(result.error ?? 'Failed to start generation');
        setGenerating(false);
        setWorkflowStatus('');
        return;
      }

      // Store workflow info for polling
      workflowRef.current = {
        workflowId: result.workflowId,
        finalTaskId: result.finalTaskId,
      };

      // Persist workflow info to analysis for reload recovery
      if (analysisId) {
        fetch('/api/concept-website-state', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ analysisId, workflowId: result.workflowId, finalTaskId: result.finalTaskId }),
        }).catch(() => {});
      }

      // Initialize placeholder steps
      const defaultSteps: WorkflowStep[] = [
        { id: 1, department: 'Research', label: 'Research & Competitor Evaluation', status: 'waiting' },
        { id: 2, department: 'Marketing', label: 'Website Strategy Brief', status: 'waiting' },
        { id: 3, department: 'Creative Strategy', label: 'Website War Room', status: 'waiting' },
        { id: 4, department: 'Creative Direction', label: 'Direction Selection', status: 'waiting' },
        { id: 5, department: 'Asset Retrieval', label: 'Asset Retrieval', status: 'waiting' },
        { id: 6, department: 'Render Production', label: 'Image Generation', status: 'waiting' },
        { id: 7, department: 'Code Execution', label: 'Website Copywriting', status: 'waiting' },
        { id: 8, department: 'Strategy & Intelligence', label: 'Quality Review', status: 'waiting' },
      ];

      // If we have real task IDs, use them
      if (result.taskIds?.length) {
        result.taskIds.forEach((tid: number, i: number) => {
          if (defaultSteps[i]) defaultSteps[i].id = tid;
        });
      }

      setWorkflowSteps(defaultSteps);
      setWorkflowStatus('generating');

      // Start polling every 5 seconds
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = setInterval(pollStatus, 5000);

      // Also do an immediate first poll after 3s
      setTimeout(pollStatus, 3000);

    } catch {
      setGenError('Something went wrong. Please try again.');
      setGenerating(false);
      setWorkflowStatus('');
    }
  };

  if (!data) {
    return (
      <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
        <h3 className="text-lg font-bold text-gray-900 mb-2">Website Concept</h3>
        <p className="text-gray-400 text-sm">Website concept will appear once analysis completes.</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
      {/* Header with Generate button and collapse toggle */}
      <div className="bg-gradient-to-r from-violet-600 to-fuchsia-500 px-6 py-4 flex items-center justify-between">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-3 flex-1 min-w-0 text-left"
        >
          <Globe className="w-5 h-5 text-white flex-shrink-0" />
          <div className="min-w-0">
            <h3 className="text-lg font-bold text-white">Website Concept</h3>
            <p className="text-violet-100 text-sm">
              Ready-to-use website copy for {data.businessName ?? 'your business'}
            </p>
          </div>
          {expanded ? <ChevronUp className="w-5 h-5 text-white flex-shrink-0" /> : <ChevronDown className="w-5 h-5 text-white flex-shrink-0" />}
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); handleGenerateButtonClick(); }}
          disabled={generating || locked}
          className="flex-shrink-0 inline-flex items-center gap-2 px-5 py-2.5 bg-white/20 hover:bg-white/30 text-white rounded-xl font-semibold transition-all disabled:opacity-50 text-sm border border-white/30 ml-3"
        >
          {generating ? (
            <><Loader2 className="w-4 h-4 animate-spin" /> Generating...</>
          ) : (
            <><Sparkles className="w-4 h-4" /> Generate Concept Website</>
          )}
        </button>
      </div>

      {/* Website Production Room — unified workflow display */}
      {workflowRef.current?.workflowId && (generating || workflowStatus === 'completed' || workflowStatus === 'error') ? (
        <WebsiteProductionRoom
          workflowId={workflowRef.current.workflowId}
          businessName={data?.businessName || ''}
          isAdmin={(session?.user as any)?.role === 'admin'}
          onWebsitePreview={generatedUrl ? () => window.open(generatedUrl, '_blank') : undefined}
          onReviewAction={async (stage, action, feedback) => {
            if (action === 'request_changes' && feedback && analysisId) {
              // Route review feedback into existing site-feedback system
              try {
                await fetch('/api/site-feedback', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    analysisId,
                    workflowId: workflowRef.current?.workflowId || '',
                    sectionId: stage,
                    target: 'stage_review',
                    feedback,
                    requestedAction: 'revise',
                  }),
                });
                loadFeedback();
              } catch { /* ignore */ }
            }
          }}
        />
      ) : (
        /* Fallback: simple workflow progress before workflowId exists */
        (generating || workflowStatus === 'completed') && workflowSteps.length > 0 && (
          <WorkflowProgress steps={workflowSteps} status={workflowStatus} />
        )
      )}

      {/* Website War Room — shown during/after generation for direction selection */}
      {workflowRef.current?.workflowId && generating && !generatedUrl && (
        <WebsiteWarRoom
          workflowId={workflowRef.current.workflowId}
          analysisId={analysisId}
          onDirectionSelected={(selection) => {
            setDirectionSelected(selection);
            // Persist selection
            if (analysisId) {
              fetch('/api/concept-direction-select', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  analysisId,
                  workflowId: workflowRef.current?.workflowId || '',
                  directionName: selection.directionName,
                  selectedBy: selection.selectedBy,
                  selectedAt: selection.selectedAt,
                }),
              }).catch(() => {});
            }
          }}
        />
      )}

      {/* Direction selection confirmation — shown after generation completes */}
      {directionSelected && generatedUrl && !generating && (
        <div className="px-6 py-3 bg-emerald-50 border-b border-emerald-100">
          <div className="flex items-center gap-2 text-sm text-emerald-800">
            <CheckCircle2 className="w-4 h-4 text-emerald-500" />
            <span>Website built using direction: <strong>{directionSelected.directionName}</strong>
            {directionSelected.selectedBy === 'auto_timer' && ' (auto-selected)'}
            {directionSelected.selectedBy === 'customer' && ' (your choice)'}
            </span>
          </div>
        </div>
      )}

      {/* Email prompt modal */}
      {showEmailPrompt && (
        <div className="p-6 bg-violet-50 border-b border-violet-100">
          <div className="max-w-md mx-auto text-center">
            <Mail className="w-8 h-8 text-violet-500 mx-auto mb-2" />
            <h4 className="font-bold text-gray-900 mb-1">Enter your business email</h4>
            <p className="text-sm text-gray-600 mb-4">Required to generate your concept website</p>
            <div className="flex gap-2">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                className="flex-1 px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-400"
              />
              <button
                onClick={handleEmailSubmit}
                className="px-5 py-2.5 bg-violet-600 text-white rounded-lg font-semibold text-sm hover:bg-violet-700 transition-colors"
              >
                Generate
              </button>
            </div>
            {emailError && <p className="text-red-500 text-xs mt-2">{emailError}</p>}
            <button onClick={() => setShowEmailPrompt(false)} className="text-xs text-gray-400 mt-2 hover:text-gray-600">Cancel</button>
          </div>
        </div>
      )}

      {/* SEO warnings */}
      {seoWarnings.length > 0 && (
        <div className="px-6 py-3 bg-amber-50 border-b border-amber-100">
          {seoWarnings.map((w, i) => (
            <div key={i} className="flex items-center gap-2 text-amber-700 text-sm">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" />
              {w}
            </div>
          ))}
        </div>
      )}

      {genError && (
        <div className="px-6 py-3 bg-red-50 border-b border-red-100">
          <p className="text-red-500 text-sm text-center">{genError}</p>
        </div>
      )}

      {generatedUrl && !generating && (
        <div className="px-6 py-3 bg-green-50 border-b border-green-100 text-center">
          <a
            href={generatedUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-violet-600 hover:text-violet-800 transition-colors"
          >
            <ExternalLink className="w-4 h-4" /> Open Generated Website Again
          </a>
        </div>
      )}

      {/* Owner Feedback Panel — shown after generation */}
      {analysisId && workflowRef.current?.workflowId && !generating && feedbackList.length > 0 && (
        <FeedbackPanel
          analysisId={analysisId}
          workflowId={workflowRef.current.workflowId}
          feedbackList={feedbackList}
          onRevision={handleRevision}
          revising={revising}
        />
      )}

      {/* Diagnostics Panel — shown after workflow completes */}
      {workflowRef.current?.workflowId && workflowStatus === 'completed' && (
        <DiagnosticsPanel workflowId={workflowRef.current.workflowId} />
      )}

      {/* Website Agency Brief — shown after workflow completes */}
      {workflowRef.current?.workflowId && workflowStatus === 'completed' && (
        <WebsiteAgencyBrief workflowId={workflowRef.current.workflowId} />
      )}

      {/* ── Optional: Reference Websites ── */}
      {expanded && !generating && !generatedUrl && (
        <div className="px-6 pt-5 pb-2 border-b border-gray-100">
          <button
            onClick={() => setShowRefSection(!showRefSection)}
            className="flex items-center gap-2 text-sm font-semibold text-gray-700 hover:text-violet-600 transition-colors"
          >
            <Globe className="w-4 h-4" />
            Reference Websites (optional)
            {showRefSection ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
          <p className="text-xs text-gray-400 mt-1">Add up to 3 websites for design inspiration</p>

          {showRefSection && (
            <div className="mt-3 space-y-3">
              <p className="text-xs text-gray-500 bg-violet-50 px-3 py-2 rounded-lg">
                We'll use these for design inspiration only. We won't copy their text, logos, images, or exact layout.
              </p>
              {refUrls.map((url, i) => (
                <div key={i} className="flex gap-2 items-center">
                  <input
                    type="url"
                    value={url}
                    onChange={(e) => {
                      const next = [...refUrls];
                      next[i] = e.target.value;
                      setRefUrls(next);
                    }}
                    placeholder={`Reference site ${i + 1} (e.g., www.example.com)`}
                    className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-300"
                  />
                  {refUrls.length > 1 && (
                    <button
                      onClick={() => setRefUrls(refUrls.filter((_, j) => j !== i))}
                      className="p-1.5 text-gray-400 hover:text-red-500 transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              ))}
              {refUrls.length < 3 && (
                <button
                  onClick={() => setRefUrls([...refUrls, ''])}
                  className="flex items-center gap-1 text-xs font-medium text-violet-600 hover:text-violet-800 transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" /> Add another reference
                </button>
              )}
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">What do you like about these sites?</label>
                <textarea
                  value={refInstructions}
                  onChange={(e) => setRefInstructions(e.target.value)}
                  placeholder="e.g., I like the dark moody feel of the first site and the clean navigation of the second..."
                  rows={2}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-300 resize-none"
                />
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Optional: Competitive SEO Scout ── */}
      {expanded && !generating && !generatedUrl && (
        <div className="px-6 pt-4 pb-4 border-b border-gray-100">
          <label className="flex items-center gap-2 cursor-default">
            <input
              type="checkbox"
              checked={seoScoutEnabled}
              readOnly
              className="w-4 h-4 rounded border-gray-300 text-violet-600 focus:ring-violet-500 cursor-default"
            />
            <span className="flex items-center gap-1.5 text-sm font-semibold text-gray-700">
              <Search className="w-4 h-4" />
              Analyze top local organic competitors
            </span>
            <span className="text-xs text-green-600 font-medium bg-green-50 px-2 py-0.5 rounded-full">Always on</span>
          </label>
          <p className="text-xs text-gray-400 mt-1 ml-6">Organic competitor evaluation is included automatically with every website generation</p>

          {seoScoutEnabled && (
            <div className="mt-3 ml-6 space-y-3">
              <p className="text-xs text-gray-500 bg-blue-50 px-3 py-2 rounded-lg">
                We&apos;ll analyze organic competitors for SEO patterns, offers, and positioning to build a stronger site for you.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-gray-600 block mb-1">Primary keyword</label>
                  <input
                    type="text"
                    value={primaryKeyword}
                    onChange={(e) => setPrimaryKeyword(e.target.value)}
                    placeholder={`e.g., ${data?.industry || 'plumber'} near me`}
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-300"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600 block mb-1">Trade area / city</label>
                  <input
                    type="text"
                    value={tradeArea}
                    onChange={(e) => setTradeArea(e.target.value)}
                    placeholder={data?.location || 'e.g., Colorado Springs, CO'}
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-300"
                  />
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Competitor URLs (up to 3 — optional)</label>
                <p className="text-xs text-gray-400 mb-2">We'll analyze each competitor's SEO, offers, positioning, and create a SWOT to build a stronger site for you.</p>
                {competitorUrls.map((url, i) => (
                  <div key={i} className="flex gap-2 items-center mb-2">
                    <input
                      type="url"
                      value={url}
                      onChange={(e) => {
                        const next = [...competitorUrls];
                        next[i] = e.target.value;
                        setCompetitorUrls(next);
                      }}
                      placeholder={`Competitor ${i + 1} website URL`}
                      className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-300"
                    />
                    {competitorUrls.length > 1 && (
                      <button
                        onClick={() => setCompetitorUrls(competitorUrls.filter((_, j) => j !== i))}
                        className="p-1.5 text-gray-400 hover:text-red-500 transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                ))}
                {competitorUrls.length < 3 && (
                  <button
                    onClick={() => setCompetitorUrls([...competitorUrls, ''])}
                    className="flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-800 transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" /> Add competitor
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Start Now CTA ── */}
      {expanded && !generating && !generatedUrl && (
        <div className="px-6 py-5 border-b border-gray-100 text-center">
          <button
            onClick={handleGenerateButtonClick}
            disabled={locked}
            className="inline-flex items-center gap-2.5 px-8 py-3.5 bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 text-white rounded-xl font-bold text-base transition-all shadow-lg shadow-emerald-200 hover:shadow-xl hover:shadow-emerald-300 disabled:opacity-50"
          >
            <Sparkles className="w-5 h-5" />
            Start Now
          </button>
          <p className="text-xs text-gray-400 mt-2">Add reference websites above, then click to generate your concept site</p>
        </div>
      )}

      {/* Locked overlay for unauthenticated users */}
      {expanded && locked && (
        <div className="p-6 relative">
          <div className="absolute inset-0 bg-white/80 backdrop-blur-sm z-10 flex items-center justify-center">
            <div className="text-center">
              <Lock className="w-10 h-10 text-gray-400 mx-auto mb-3" />
              <p className="font-semibold text-gray-700">Register to unlock website concept</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
