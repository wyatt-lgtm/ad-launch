'use client';

import { Globe, Layout, Users, Briefcase, ArrowRight, Lock, Copy, Check, Sparkles, Loader2, ExternalLink, Mail, ChevronDown, ChevronUp, CheckCircle2, Circle, AlertCircle, Clock, Plus, Trash2, Search, AlertTriangle } from 'lucide-react';
import { useState, useRef, useCallback, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import WebsiteAgencyBrief from '@/components/website-agency-brief';

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

function SectionCard({ section, icon: Icon, color }: { section: any; icon: any; color: string }) {
  const allText = [section.headline, section.cta].filter(Boolean).join('\n\n');
  return (
    <div className="bg-gray-50 rounded-xl p-5 border border-gray-100">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className={`w-8 h-8 ${color} rounded-lg flex items-center justify-center`}>
            <Icon className="w-4 h-4 text-white" />
          </div>
          <h4 className="font-semibold text-gray-900 text-sm">{section.title}</h4>
        </div>
        <CopyAll text={allText} />
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

  // Competitive SEO scout state
  const [seoScoutEnabled, setSeoScoutEnabled] = useState(false);
  const [primaryKeyword, setPrimaryKeyword] = useState('');
  const [tradeArea, setTradeArea] = useState('');
  const [competitorUrls, setCompetitorUrls] = useState<string[]>(['']);
  const [seoWarnings, setSeoWarnings] = useState<string[]>([]);

  // Competitor intelligence (3 concepts + war room)
  const [competitorIntel, setCompetitorIntel] = useState<any>(null);

  const isLoggedIn = !!(session?.user as any)?.email;

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

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
          // Mark all completed steps visually, keep remaining as-is
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

  const handleGenerate = async () => {
    if (!data?.sections?.length || generating) return;

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
          // Competitive SEO scout
          analyzeCompetitors: seoScoutEnabled,
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
        { id: 1, department: 'Research', label: 'Brand Asset Recon', status: 'waiting' },
        { id: 2, department: 'Marketing', label: 'Website Strategy', status: 'waiting' },
        { id: 3, department: 'Creative Strategy', label: 'Copy Deck', status: 'waiting' },
        { id: 4, department: 'Creative Direction', label: 'Creative Contract', status: 'waiting' },
        { id: 5, department: 'Asset Retrieval', label: 'Asset Retrieval', status: 'waiting' },
        { id: 6, department: 'Render Production', label: 'Image Generation', status: 'waiting' },
        { id: 7, department: 'Code Execution', label: 'HTML Generation', status: 'waiting' },
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

  const sectionIcons = [Layout, Users, Briefcase, ArrowRight];
  const sectionColors = ['bg-blue-600', 'bg-purple-600', 'bg-orange-500', 'bg-green-600'];

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
          onClick={(e) => { e.stopPropagation(); handleGenerate(); }}
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

      {/* Workflow progress */}
      {(generating || workflowStatus === 'completed') && workflowSteps.length > 0 && (
        <WorkflowProgress steps={workflowSteps} status={workflowStatus} />
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
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={seoScoutEnabled}
              onChange={(e) => setSeoScoutEnabled(e.target.checked)}
              className="w-4 h-4 rounded border-gray-300 text-violet-600 focus:ring-violet-500"
            />
            <span className="flex items-center gap-1.5 text-sm font-semibold text-gray-700">
              <Search className="w-4 h-4" />
              Analyze top local organic competitors
            </span>
          </label>
          <p className="text-xs text-gray-400 mt-1 ml-6">Discover SEO patterns from competitors in your area</p>

          {seoScoutEnabled && (
            <div className="mt-3 ml-6 space-y-3">
              <p className="text-xs text-gray-500 bg-blue-50 px-3 py-2 rounded-lg">
                We'll use competitor sites to understand SEO patterns, not to copy their content or design.
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

      {/* Competitor Intelligence Panel */}
      {expanded && competitorIntel?.concepts?.length > 0 && (
        <div className="px-6 pb-4 border-b border-gray-100">
          <div className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-xl p-5 border border-blue-100">
            <h4 className="flex items-center gap-2 text-sm font-bold text-indigo-900 mb-3">
              <Users className="w-4 h-4" />
              Competitive Strategy: 3 Concepts Evaluated
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
              {(competitorIntel.concepts as any[]).map((concept: any) => {
                const isWinner = concept.concept_id === competitorIntel.winningConceptId;
                const evaluation = (competitorIntel.warRoomEvaluation?.evaluations ?? []).find(
                  (e: any) => e.concept_id === concept.concept_id
                );
                return (
                  <div
                    key={concept.concept_id}
                    className={`rounded-lg p-4 border-2 transition-all ${
                      isWinner
                        ? 'border-green-400 bg-green-50 shadow-md'
                        : 'border-gray-200 bg-white'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-bold text-gray-500">Concept {concept.concept_id}</span>
                      {isWinner && (
                        <span className="text-xs font-bold text-green-700 bg-green-100 px-2 py-0.5 rounded-full flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3" /> Winner
                        </span>
                      )}
                    </div>
                    <h5 className="font-semibold text-sm text-gray-900 mb-1">{concept.concept_name}</h5>
                    <p className="text-xs text-gray-600 mb-2">{concept.strategic_angle}</p>
                    {concept.homepage_hero_headline && (
                      <p className="text-xs font-medium text-indigo-700 italic mb-1">
                        &ldquo;{concept.homepage_hero_headline}&rdquo;
                      </p>
                    )}
                    {concept.primary_cta && (
                      <span className="inline-block text-xs bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded font-medium">
                        {concept.primary_cta}
                      </span>
                    )}
                    {evaluation?.total_score != null && (
                      <div className="mt-2 pt-2 border-t border-gray-100">
                        <span className="text-xs text-gray-500">War Room Score: </span>
                        <span className={`text-xs font-bold ${
                          evaluation.total_score >= 60 ? 'text-green-600' : 'text-amber-600'
                        }`}>{evaluation.total_score}/90</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            {competitorIntel.warRoomEvaluation?.decision_reasons?.length > 0 && (
              <div className="text-xs text-gray-600 bg-white/60 rounded-lg p-3">
                <span className="font-semibold text-gray-700">War Room Decision: </span>
                {(competitorIntel.warRoomEvaluation.decision_reasons as string[]).join(' ')}
              </div>
            )}
            {competitorIntel.competitiveSynthesis?.gaps_all_competitors_leave_open?.length > 0 && (
              <div className="mt-3 text-xs text-gray-600">
                <span className="font-semibold text-gray-700">Competitive Gaps Found: </span>
                {(competitorIntel.competitiveSynthesis.gaps_all_competitors_leave_open as string[]).slice(0, 3).join(' • ')}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Collapsible body */}
      {expanded && (
        <div className="p-6 relative">
          {locked && (
            <div className="absolute inset-0 bg-white/80 backdrop-blur-sm z-10 flex items-center justify-center">
              <div className="text-center">
                <Lock className="w-10 h-10 text-gray-400 mx-auto mb-3" />
                <p className="font-semibold text-gray-700">Register to unlock website concept</p>
              </div>
            </div>
          )}

          <div className="space-y-4">
            {(data.sections ?? []).map((section: any, i: number) => (
              <SectionCard
                key={i}
                section={section}
                icon={sectionIcons[i] ?? Globe}
                color={sectionColors[i] ?? 'bg-gray-600'}
              />
            ))}
          </div>

          {/* Color Palette */}
          {data.colorPalette?.length > 0 && (
            <div className="mt-6">
              <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Suggested Color Palette</h4>
              <div className="flex gap-3">
                {(data.colorPalette as any[]).map((c: any, i: number) => (
                  <div key={i} className="flex flex-col items-center gap-1">
                    <div className="w-10 h-10 rounded-lg shadow-sm border border-gray-200" style={{ backgroundColor: c.hex ?? '#ccc' }} />
                    <span className="text-xs text-gray-500">{c.name ?? c.hex}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
