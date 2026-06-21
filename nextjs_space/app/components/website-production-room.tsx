'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  CheckCircle2, Circle, Loader2, AlertCircle, Clock, Sparkles,
  FileText, Palette, Image as ImageIcon, Code, Shield, Search,
  LayoutDashboard, ChevronDown, ChevronUp, Eye, EyeOff,
  Building2, Target, Map, PenTool, Camera, Globe, ShieldCheck,
  ThumbsUp, MessageSquare, ArrowRight, Layers, ListChecks,
} from 'lucide-react';

// ── Agent → Customer-Facing Label Map ────────────────────────────────────────
const AGENT_TO_LABEL: Record<string, string> = {
  'Jim Bridger': 'Business Research',
  'Zig Ziglar': 'Website Strategy',
  'David Ogilvy': 'Copywriting',
  'Don Draper': 'Creative Direction',
  'Andy Warhol': 'Image Production',
  'George Boole': 'Website Assembly',
  'Peter Drucker': 'Quality Review',
};

// Department → Customer-Facing Stage Label
const DEPT_TO_STAGE: Record<string, string> = {
  'Research': 'Business Research',
  'Marketing': 'Website Strategy',
  'Creative Strategy': 'Copywriting',
  'Creative Direction': 'Creative Direction',
  'Asset Retrieval': 'Asset Collection',
  'Render Production': 'Image Production',
  'Code Execution': 'Website Assembly',
  'Strategy & Intelligence': 'Quality Review',
};

// Customer-safe activity messages (overrides any agent-name messages from backend)
const STAGE_ACTIVITY_MESSAGES: Record<string, string> = {
  'Business Research': 'Researching your business…',
  'Website Strategy': 'Building your website strategy…',
  'Copywriting': 'Writing homepage copy…',
  'Creative Direction': 'Creating image direction…',
  'Asset Collection': 'Gathering visual assets…',
  'Image Production': 'Generating images for your website…',
  'Website Assembly': 'Assembling your website…',
  'Quality Review': 'Running final quality review…',
};

// ── Types ────────────────────────────────────────────────────────────────────

interface TimelineStage {
  stage: string;
  department: string;
  status: 'completed' | 'active' | 'queued' | 'pending' | 'error';
  agent: string;
  task_id: number;
  elapsed_ms: number | null;
  artifact: { type: string; label: string; task_id: number } | null;
  error: string | null;
  blocked_reason: string | null;
}

interface OperatorDiag {
  task_id: number;
  department: string;
  agent: string | null;
  status: string;
  retry_count: number;
  last_error: string | null;
  blocked_reason: string | null;
  heartbeat_at: string | null;
  claimed_at: string | null;
  warning: string | null;
}

interface ProgressData {
  status: string;
  workflow_id: string;
  activity_message: string;
  timeline: TimelineStage[];
  available_artifacts: { type: string; label: string; task_id: number }[];
  still_working: { label: string; status: string }[];
  completed_count: number;
  total_count: number;
  events: any[];
  operator_diagnostics: OperatorDiag[];
  artifact_details: Record<string, any>;
}

type StageStatus = 'waiting' | 'working' | 'ready' | 'needs_review' | 'approved' | 'failed';

interface ProductionStage {
  id: string;
  label: string;
  status: StageStatus;
  elapsed_ms: number | null;
  artifactType: string | null;
  hasArtifact: boolean;
  requiresReview: boolean;
  reviewStatus: 'none' | 'pending' | 'approved' | 'changes_requested';
  error: string | null;
}

interface WebsiteProductionRoomProps {
  workflowId: string | null;
  businessName?: string;
  isAdmin?: boolean;
  onArtifactView?: (type: string, details: any) => void;
  onReviewAction?: (stage: string, action: 'approve' | 'request_changes', feedback?: string) => void;
  onWebsitePreview?: () => void;
}

// ── Artifact type → display config ──────────────────────────────────────────

const ARTIFACT_CONFIG: Record<string, {
  icon: typeof Search;
  color: string;
  bgColor: string;
  borderColor: string;
  cards: { key: string; label: string; icon: typeof Search }[];
}> = {
  business_research: {
    icon: Building2,
    color: 'text-blue-700',
    bgColor: 'bg-blue-50',
    borderColor: 'border-blue-200',
    cards: [
      { key: 'summary', label: 'Business Summary', icon: Building2 },
      { key: 'products_services', label: 'Products / Services Found', icon: ListChecks },
      { key: 'brand_notes', label: 'Brand Notes', icon: PenTool },
    ],
  },
  strategy_brief: {
    icon: Target,
    color: 'text-indigo-700',
    bgColor: 'bg-indigo-50',
    borderColor: 'border-indigo-200',
    cards: [
      { key: 'brief', label: 'Strategy Brief', icon: Target },
      { key: 'target_customer', label: 'Target Customer', icon: Search },
      { key: 'positioning', label: 'Positioning', icon: Layers },
      { key: 'seo_priorities', label: 'SEO Priorities', icon: Globe },
    ],
  },
  copy_deck: {
    icon: FileText,
    color: 'text-violet-700',
    bgColor: 'bg-violet-50',
    borderColor: 'border-violet-200',
    cards: [
      { key: 'sections', label: 'Section Copy', icon: FileText },
      { key: 'cta_strategy', label: 'CTA Strategy', icon: ArrowRight },
      { key: 'headline', label: 'Homepage Headline', icon: PenTool },
    ],
  },
  image_direction: {
    icon: Camera,
    color: 'text-orange-700',
    bgColor: 'bg-orange-50',
    borderColor: 'border-orange-200',
    cards: [
      { key: 'briefs', label: 'Image Briefs', icon: Camera },
    ],
  },
  rendered_images: {
    icon: ImageIcon,
    color: 'text-pink-700',
    bgColor: 'bg-pink-50',
    borderColor: 'border-pink-200',
    cards: [
      { key: 'renders', label: 'Generated Images', icon: ImageIcon },
    ],
  },
  website_preview: {
    icon: Code,
    color: 'text-emerald-700',
    bgColor: 'bg-emerald-50',
    borderColor: 'border-emerald-200',
    cards: [
      { key: 'preview', label: 'Open Website Preview', icon: Globe },
    ],
  },
  qa_report: {
    icon: ShieldCheck,
    color: 'text-green-700',
    bgColor: 'bg-green-50',
    borderColor: 'border-green-200',
    cards: [
      { key: 'report', label: 'QA Report', icon: ShieldCheck },
    ],
  },
};

// Review-gated stages
const REVIEW_GATES = new Set(['copy_deck', 'image_direction']);
// We include strategy_brief (sitemap/services) as part of strategy_brief type
const SITEMAP_REVIEW = 'strategy_brief';

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatElapsed(ms: number | null): string {
  if (!ms || ms < 0) return '';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}m ${rem}s`;
}

function sanitizeAgentName(name: string): string {
  return AGENT_TO_LABEL[name] || name;
}

function sanitizeDepartment(dept: string): string {
  return DEPT_TO_STAGE[dept] || dept;
}

function getCustomerActivityMessage(backendMessage: string): string {
  // Replace any agent-name references in the activity message
  let msg = backendMessage;
  for (const [agent, label] of Object.entries(AGENT_TO_LABEL)) {
    if (msg.includes(agent)) {
      msg = msg.replace(new RegExp(agent, 'g'), label);
    }
  }
  // Also replace "is working" patterns
  msg = msg.replace(/\bis working\b/g, 'in progress');
  return msg;
}

// ── Status Icon ──────────────────────────────────────────────────────────────

function StageStatusBadge({ status }: { status: StageStatus }) {
  switch (status) {
    case 'ready':
    case 'approved':
      return (
        <span className="flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-green-100 text-green-700">
          <CheckCircle2 className="w-3 h-3" />
          {status === 'approved' ? 'Approved' : 'Ready'}
        </span>
      );
    case 'working':
      return (
        <span className="flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-violet-100 text-violet-700">
          <Loader2 className="w-3 h-3 animate-spin" />
          Working
        </span>
      );
    case 'needs_review':
      return (
        <span className="flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
          <Eye className="w-3 h-3" />
          Review recommended
        </span>
      );
    case 'failed':
      return (
        <span className="flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-red-100 text-red-700">
          <AlertCircle className="w-3 h-3" />
          Failed
        </span>
      );
    default:
      return (
        <span className="flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">
          <Clock className="w-3 h-3" />
          Waiting
        </span>
      );
  }
}

function StageStatusDot({ status }: { status: StageStatus }) {
  switch (status) {
    case 'ready':
    case 'approved':
      return <CheckCircle2 className="w-5 h-5 text-green-500 flex-shrink-0" />;
    case 'working':
      return <Loader2 className="w-5 h-5 text-violet-500 animate-spin flex-shrink-0" />;
    case 'needs_review':
      return <Eye className="w-5 h-5 text-amber-500 flex-shrink-0" />;
    case 'failed':
      return <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0" />;
    default:
      return <Circle className="w-5 h-5 text-gray-300 flex-shrink-0" />;
  }
}

// ── Production Header ────────────────────────────────────────────────────────

function ProductionHeader({
  businessName,
  currentPhase,
  status,
  availableStages,
  nextDecision,
  pct,
}: {
  businessName: string;
  currentPhase: string;
  status: string;
  availableStages: string[];
  nextDecision: string | null;
  pct: number;
}) {
  const statusLabel = status === 'completed' ? 'Ready' :
    status === 'error' ? 'Issue Detected' :
    nextDecision ? 'Waiting for review' : 'In production';

  const statusColor = status === 'completed' ? 'text-green-300' :
    status === 'error' ? 'text-red-300' :
    nextDecision ? 'text-amber-300' : 'text-violet-200';

  return (
    <div className="bg-gradient-to-r from-slate-900 via-violet-950 to-slate-900 text-white px-6 py-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            <Globe className="w-4 h-4 text-violet-400 flex-shrink-0" />
            <span className="text-xs font-medium text-violet-300 uppercase tracking-wider">Website Production</span>
          </div>
          <h3 className="text-lg font-bold truncate">
            Building: {businessName || 'Your Website'}
          </h3>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-sm">
            <span className="text-violet-300">Phase: <strong className="text-white">{currentPhase}</strong></span>
            <span className={statusColor}>Status: <strong>{statusLabel}</strong></span>
          </div>
          {availableStages.length > 0 && (
            <div className="mt-1.5 text-xs text-violet-400">
              Available now: <span className="text-violet-200 font-medium">{availableStages.join(', ')}</span>
            </div>
          )}
          {nextDecision && (
            <div className="mt-1 text-xs text-amber-400 flex items-center gap-1">
              <Eye className="w-3 h-3" />
              Next decision: {nextDecision}
            </div>
          )}
        </div>
        <div className="flex flex-col items-end gap-1 flex-shrink-0">
          <span className="text-2xl font-bold tabular-nums">{pct}%</span>
          <div className="w-32 h-2 bg-white/15 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-violet-400 to-fuchsia-400 rounded-full transition-all duration-700 ease-out"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Activity Ribbon ──────────────────────────────────────────────────────────

function ActivityRibbon({ message }: { message: string }) {
  return (
    <div className="bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white px-5 py-2 flex items-center gap-2">
      <Sparkles className="w-3.5 h-3.5 flex-shrink-0 animate-pulse" />
      <span className="text-sm font-medium truncate">{message}</span>
    </div>
  );
}

// ── Production Timeline ──────────────────────────────────────────────────────

function ProductionTimeline({
  stages,
  artifactDetails,
  expandedArtifact,
  onToggleArtifact,
  onReviewAction,
  reviewStates,
}: {
  stages: ProductionStage[];
  artifactDetails: Record<string, any>;
  expandedArtifact: string | null;
  onToggleArtifact: (type: string) => void;
  onReviewAction?: (stage: string, action: 'approve' | 'request_changes', feedback?: string) => void;
  reviewStates: Record<string, 'none' | 'pending' | 'approved' | 'changes_requested'>;
}) {
  return (
    <div className="px-5 py-4">
      <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Production Timeline</h4>
      <div className="relative">
        <div className="absolute left-[9px] top-3 bottom-3 w-0.5 bg-gray-200" />
        <div className="space-y-1">
          {stages.map((stage) => {
            const hasDetails = stage.hasArtifact && artifactDetails[stage.artifactType || ''];
            const isExpanded = expandedArtifact === stage.artifactType;
            const config = stage.artifactType ? ARTIFACT_CONFIG[stage.artifactType] : null;
            const Icon = config?.icon || Circle;
            const elapsed = formatElapsed(stage.elapsed_ms);
            const isReviewGate = stage.artifactType && (REVIEW_GATES.has(stage.artifactType) || stage.artifactType === SITEMAP_REVIEW);
            const reviewState = stage.artifactType ? reviewStates[stage.artifactType] || 'none' : 'none';

            return (
              <div key={stage.id} className="relative">
                <div className="flex items-center gap-3 py-2 pl-7">
                  <div className="absolute left-0 top-1/2 -translate-y-1/2">
                    <StageStatusDot status={stage.status} />
                  </div>
                  <Icon className={`w-4 h-4 flex-shrink-0 ${
                    stage.status === 'ready' || stage.status === 'approved' ? 'text-green-600' :
                    stage.status === 'working' ? 'text-violet-600' :
                    stage.status === 'needs_review' ? 'text-amber-600' :
                    stage.status === 'failed' ? 'text-red-500' :
                    'text-gray-400'
                  }`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-sm font-medium ${
                        stage.status === 'ready' || stage.status === 'approved' ? 'text-green-700' :
                        stage.status === 'working' ? 'text-violet-700' :
                        stage.status === 'needs_review' ? 'text-amber-700' :
                        stage.status === 'failed' ? 'text-red-600' :
                        'text-gray-400'
                      }`}>
                        {stage.label}
                      </span>
                      <StageStatusBadge status={stage.status} />
                    </div>
                    {stage.error && (
                      <p className="text-xs text-red-400 truncate mt-0.5">{stage.error}</p>
                    )}
                  </div>
                  {elapsed && (
                    <span className="text-xs text-gray-400 tabular-nums flex-shrink-0">{elapsed}</span>
                  )}
                  {hasDetails && (
                    <button
                      onClick={() => onToggleArtifact(stage.artifactType!)}
                      className="flex items-center gap-1 text-xs font-medium text-violet-600 hover:text-violet-800 px-2 py-1 rounded-md hover:bg-violet-50 transition-colors flex-shrink-0"
                    >
                      {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                      {isExpanded ? 'Hide' : 'View'}
                    </button>
                  )}
                </div>

                {/* Expanded artifact detail card */}
                {isExpanded && hasDetails && config && (
                  <div className={`ml-7 mb-2 rounded-lg p-4 border ${config.bgColor} ${config.borderColor}`}>
                    <ArtifactDetailCard
                      type={stage.artifactType!}
                      details={artifactDetails[stage.artifactType!]}
                      config={config}
                    />
                    {/* Review gate controls */}
                    {isReviewGate && stage.hasArtifact && (
                      <ReviewGateControls
                        stage={stage.artifactType!}
                        stageLabel={stage.label}
                        reviewState={reviewState}
                        onAction={onReviewAction}
                      />
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Artifact Detail Card ─────────────────────────────────────────────────────

function ArtifactDetailCard({
  type,
  details,
  config,
}: {
  type: string;
  details: any;
  config: { color: string };
}) {
  if (!details) return null;

  switch (type) {
    case 'business_research':
      return (
        <div className="space-y-2 text-xs">
          {details.business_name && (
            <div><span className="font-semibold text-blue-800">Business:</span> <span className="text-blue-900">{details.business_name}</span></div>
          )}
          {details.industry && (
            <div><span className="font-semibold text-blue-800">Industry:</span> <span className="text-blue-900">{details.industry}</span></div>
          )}
          {details.location && (
            <div><span className="font-semibold text-blue-800">Location:</span> <span className="text-blue-900">{details.location}</span></div>
          )}
          {details.summary && (
            <div className="mt-2 bg-white/60 rounded p-2 border border-blue-100">
              <span className="font-semibold text-blue-800">Summary:</span>
              <p className="text-blue-900 mt-1 whitespace-pre-wrap">{typeof details.summary === 'string' ? details.summary.slice(0, 500) : JSON.stringify(details.summary).slice(0, 500)}</p>
            </div>
          )}
          {details.products_services && (
            <div className="mt-2 bg-white/60 rounded p-2 border border-blue-100">
              <span className="font-semibold text-blue-800">Products / Services:</span>
              {Array.isArray(details.products_services) ? (
                <ul className="mt-1 space-y-0.5">
                  {details.products_services.slice(0, 10).map((s: any, i: number) => (
                    <li key={i} className="text-blue-900 flex items-start gap-1">
                      <ArrowRight className="w-3 h-3 text-blue-400 flex-shrink-0 mt-0.5" />
                      {typeof s === 'string' ? s : s.name || JSON.stringify(s)}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-blue-900 mt-1">{typeof details.products_services === 'string' ? details.products_services : JSON.stringify(details.products_services).slice(0, 300)}</p>
              )}
            </div>
          )}
          {details.brand_notes && (
            <div className="mt-2 bg-white/60 rounded p-2 border border-blue-100">
              <span className="font-semibold text-blue-800">Brand Notes:</span>
              <p className="text-blue-900 mt-1">{typeof details.brand_notes === 'string' ? details.brand_notes.slice(0, 300) : JSON.stringify(details.brand_notes).slice(0, 300)}</p>
            </div>
          )}
        </div>
      );

    case 'strategy_brief':
      return (
        <div className="space-y-2 text-xs">
          {details.primary_business_type && (
            <div><span className="font-semibold text-indigo-800">Business Type:</span> <span className="text-indigo-900">{details.primary_business_type}</span></div>
          )}
          {details.target_customer && (
            <div><span className="font-semibold text-indigo-800">Target Customer:</span> <span className="text-indigo-900">{typeof details.target_customer === 'string' ? details.target_customer : JSON.stringify(details.target_customer)}</span></div>
          )}
          {details.positioning && (
            <div><span className="font-semibold text-indigo-800">Positioning:</span> <span className="text-indigo-900">{typeof details.positioning === 'string' ? details.positioning : JSON.stringify(details.positioning).slice(0, 200)}</span></div>
          )}
          {details.primary_conversion_action && (
            <div><span className="font-semibold text-indigo-800">Primary Conversion:</span> <span className="text-indigo-900">{details.primary_conversion_action}</span></div>
          )}
          {details.core_pain_points && Array.isArray(details.core_pain_points) && (
            <div className="mt-2 bg-white/60 rounded p-2 border border-indigo-100">
              <span className="font-semibold text-indigo-800">Core Pain Points:</span>
              <ul className="mt-1 space-y-0.5">
                {details.core_pain_points.slice(0, 5).map((p: string, i: number) => (
                  <li key={i} className="text-indigo-900 flex items-start gap-1">
                    <ArrowRight className="w-3 h-3 text-indigo-400 flex-shrink-0 mt-0.5" />
                    {p}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {details.seo_sitemap && (
            <div className="mt-2 bg-white/60 rounded p-2 border border-indigo-100">
              <span className="font-semibold text-indigo-800">Sitemap:</span>
              {Array.isArray(details.seo_sitemap) ? (
                <ul className="mt-1 space-y-0.5">
                  {details.seo_sitemap.slice(0, 8).map((p: any, i: number) => (
                    <li key={i} className="text-indigo-900 flex items-start gap-1">
                      <Map className="w-3 h-3 text-indigo-400 flex-shrink-0 mt-0.5" />
                      {typeof p === 'string' ? p : p.page || p.title || JSON.stringify(p)}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-indigo-900 mt-1">{JSON.stringify(details.seo_sitemap).slice(0, 300)}</p>
              )}
            </div>
          )}
          {details.service_taxonomy && (
            <div className="mt-2 bg-white/60 rounded p-2 border border-indigo-100">
              <span className="font-semibold text-indigo-800">Service Taxonomy:</span>
              {Array.isArray(details.service_taxonomy) ? (
                <ul className="mt-1 space-y-0.5">
                  {details.service_taxonomy.slice(0, 8).map((s: any, i: number) => (
                    <li key={i} className="text-indigo-900 flex items-start gap-1">
                      <ListChecks className="w-3 h-3 text-indigo-400 flex-shrink-0 mt-0.5" />
                      {typeof s === 'string' ? s : s.name || s.service || JSON.stringify(s)}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-indigo-900 mt-1">{typeof details.service_taxonomy === 'string' ? details.service_taxonomy : JSON.stringify(details.service_taxonomy).slice(0, 300)}</p>
              )}
            </div>
          )}
          {details.seo_priorities && (
            <div className="mt-2 bg-white/60 rounded p-2 border border-indigo-100">
              <span className="font-semibold text-indigo-800">SEO Priorities:</span>
              <p className="text-indigo-900 mt-1">{Array.isArray(details.seo_priorities) ? details.seo_priorities.join(', ') : typeof details.seo_priorities === 'string' ? details.seo_priorities : JSON.stringify(details.seo_priorities).slice(0, 200)}</p>
            </div>
          )}
        </div>
      );

    case 'copy_deck':
      return (
        <div className="space-y-2 text-xs">
          {details.headline && (
            <div className="bg-white/60 rounded p-2 border border-violet-100">
              <span className="font-semibold text-violet-800">Headline:</span>
              <p className="text-violet-900 mt-1 text-sm font-bold">{details.headline}</p>
            </div>
          )}
          {details.sections && Array.isArray(details.sections) && (
            <div className="bg-white/60 rounded p-2 border border-violet-100">
              <span className="font-semibold text-violet-800">Sections ({details.sections.length}):</span>
              <div className="mt-1 space-y-1">
                {details.sections.slice(0, 6).map((sec: any, i: number) => (
                  <div key={i} className="text-violet-900">
                    <span className="font-medium">{sec.section_id || sec.section_type || sec.title || `Section ${i + 1}`}</span>
                    {sec.benefit_statement && <span className="text-violet-600"> — {sec.benefit_statement}</span>}
                    {sec.headline && <span className="text-violet-700"> · "{sec.headline}"</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
          {details.section_contracts && Array.isArray(details.section_contracts) && (
            <div className="bg-white/60 rounded p-2 border border-violet-100">
              <span className="font-semibold text-violet-800">Section Contracts ({details.section_contracts.length}):</span>
              <div className="mt-1 space-y-1">
                {details.section_contracts.slice(0, 6).map((sc: any, i: number) => (
                  <div key={i} className="text-violet-900">
                    <span className="font-medium">{sc.section_id || sc.section_type || `Section ${i + 1}`}</span>
                    {sc.benefit_statement && <span className="text-violet-600"> — {sc.benefit_statement}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
          {details.cta_strategy && (
            <div className="bg-white/60 rounded p-2 border border-violet-100">
              <span className="font-semibold text-violet-800">CTA Strategy:</span>
              <p className="text-violet-900 mt-1">{typeof details.cta_strategy === 'string' ? details.cta_strategy : JSON.stringify(details.cta_strategy).slice(0, 200)}</p>
            </div>
          )}
        </div>
      );

    case 'image_direction':
      return (
        <div className="space-y-2 text-xs">
          {details.briefs && Array.isArray(details.briefs) && details.briefs.map((brief: any, i: number) => (
            <div key={i} className="bg-white/60 rounded p-2 border border-orange-100">
              <span className="font-semibold text-orange-800">{brief.section_id || brief.section || `Section ${i + 1}`}</span>
              {brief.image_purpose && <p className="text-orange-900 mt-0.5">Purpose: {brief.image_purpose}</p>}
              {brief.visual_style && <p className="text-orange-700">Style: {brief.visual_style}</p>}
              {brief.must_show && (
                <p className="text-orange-700">Must show: {Array.isArray(brief.must_show) ? brief.must_show.join(', ') : brief.must_show}</p>
              )}
              {brief.must_avoid && (
                <p className="text-orange-700">Must avoid: {Array.isArray(brief.must_avoid) ? brief.must_avoid.join(', ') : brief.must_avoid}</p>
              )}
            </div>
          ))}
        </div>
      );

    case 'rendered_images':
      return (
        <div className="text-xs">
          <div className="text-pink-800">
            <span className="font-semibold">{details.image_count || 0} images</span> generated
          </div>
          {details.renders?.length > 0 && (
            <div className="mt-1 space-y-0.5">
              {details.renders.map((r: any, i: number) => (
                <div key={i} className="text-pink-700 flex items-center gap-1">
                  <ImageIcon className="w-3 h-3" />
                  {r.section || `Image ${i + 1}`}
                  <span className={`text-[10px] px-1 rounded ${r.status === 'complete' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                    {r.status || 'pending'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      );

    case 'qa_report':
      return (
        <div className="text-xs">
          {details.verdict && (
            <div className={`flex items-center gap-1.5 mb-1 ${
              details.verdict === 'APPROVED' ? 'text-green-800' : 'text-red-800'
            }`}>
              <ShieldCheck className="w-3.5 h-3.5" />
              <span className="font-bold">Verdict: {details.verdict}</span>
              {details.pass_count != null && details.total_gates != null && (
                <span className="text-gray-500 ml-1">({details.pass_count}/{details.total_gates} gates passed)</span>
              )}
            </div>
          )}
          {details.summary && (
            <p className="text-green-900 mt-1">{details.summary}</p>
          )}
          {details.gates && details.gates.filter((g: any) => g.status !== 'PASS').length > 0 && (
            <div className="mt-2 space-y-0.5">
              {details.gates.filter((g: any) => g.status !== 'PASS').slice(0, 5).map((g: any, i: number) => (
                <div key={i} className={`flex items-center gap-1 ${
                  g.status === 'FAIL' ? 'text-red-700' : 'text-amber-700'
                }`}>
                  {g.status === 'FAIL' ? <AlertCircle className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                  <span className="font-medium">{g.gate_id}:</span> {g.reason}
                </div>
              ))}
            </div>
          )}
        </div>
      );

    default:
      return <div className="text-xs text-gray-500">Output details available</div>;
  }
}

// ── Review Gate Controls ─────────────────────────────────────────────────────

function ReviewGateControls({
  stage,
  stageLabel,
  reviewState,
  onAction,
}: {
  stage: string;
  stageLabel: string;
  reviewState: 'none' | 'pending' | 'approved' | 'changes_requested';
  onAction?: (stage: string, action: 'approve' | 'request_changes', feedback?: string) => void;
}) {
  const [showFeedback, setShowFeedback] = useState(false);
  const [feedbackText, setFeedbackText] = useState('');

  if (reviewState === 'approved') {
    return (
      <div className="mt-3 pt-3 border-t border-green-200 flex items-center gap-2">
        <CheckCircle2 className="w-4 h-4 text-green-600" />
        <span className="text-xs font-semibold text-green-700">Approved</span>
      </div>
    );
  }

  return (
    <div className="mt-3 pt-3 border-t border-gray-200">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-amber-700 font-medium flex items-center gap-1">
          <Eye className="w-3.5 h-3.5" />
          Review recommended for {stageLabel}
        </span>
        <div className="flex gap-2">
          <button
            onClick={() => onAction?.(stage, 'approve')}
            className="flex items-center gap-1 text-xs font-semibold text-white bg-green-600 hover:bg-green-700 px-3 py-1.5 rounded-lg transition-colors"
          >
            <ThumbsUp className="w-3 h-3" />
            Approve
          </button>
          <button
            onClick={() => setShowFeedback(!showFeedback)}
            className="flex items-center gap-1 text-xs font-semibold text-amber-700 bg-amber-100 hover:bg-amber-200 px-3 py-1.5 rounded-lg transition-colors"
          >
            <MessageSquare className="w-3 h-3" />
            Request Changes
          </button>
        </div>
      </div>
      {showFeedback && (
        <div className="mt-2">
          <textarea
            value={feedbackText}
            onChange={(e) => setFeedbackText(e.target.value)}
            placeholder="Describe what you'd like changed…"
            rows={2}
            className="w-full px-3 py-2 text-sm border border-amber-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-300 resize-none bg-white"
          />
          <div className="flex justify-end gap-2 mt-2">
            <button
              onClick={() => { setShowFeedback(false); setFeedbackText(''); }}
              className="text-xs text-gray-500 hover:text-gray-700"
            >
              Cancel
            </button>
            <button
              onClick={() => {
                onAction?.(stage, 'request_changes', feedbackText.trim());
                setShowFeedback(false);
                setFeedbackText('');
              }}
              disabled={!feedbackText.trim()}
              className="text-xs font-semibold text-white bg-amber-600 hover:bg-amber-700 px-3 py-1.5 rounded-lg disabled:opacity-50 transition-colors"
            >
              Submit Feedback
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Operator Diagnostics (Admin Only) ────────────────────────────────────────

function OperatorDiagnostics({ diags }: { diags: OperatorDiag[] }) {
  const [open, setOpen] = useState(false);
  if (diags.length === 0) return null;

  return (
    <div className="px-5 py-3 border-t border-gray-100 bg-gray-50/50">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 text-xs font-semibold text-gray-500 uppercase tracking-wider hover:text-gray-700 transition-colors w-full"
      >
        {open ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
        Operator Diagnostics (Admin)
        {open ? <ChevronUp className="w-3 h-3 ml-auto" /> : <ChevronDown className="w-3 h-3 ml-auto" />}
      </button>
      {open && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-gray-400 border-b border-gray-200">
                <th className="py-1 pr-3">ID</th>
                <th className="py-1 pr-3">Dept</th>
                <th className="py-1 pr-3">Agent</th>
                <th className="py-1 pr-3">Status</th>
                <th className="py-1 pr-3">Retries</th>
                <th className="py-1">Error</th>
              </tr>
            </thead>
            <tbody>
              {diags.map((d) => (
                <tr key={d.task_id} className="border-b border-gray-100">
                  <td className="py-1.5 pr-3 text-gray-600 font-mono">{d.task_id}</td>
                  <td className="py-1.5 pr-3 text-gray-600">{d.department}</td>
                  <td className="py-1.5 pr-3 text-gray-500">{d.agent || '—'}</td>
                  <td className="py-1.5 pr-3">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                      d.status === 'Complete' ? 'bg-green-100 text-green-700' :
                      d.status === 'In Progress' ? 'bg-violet-100 text-violet-700' :
                      d.status === 'Failed' ? 'bg-red-100 text-red-700' :
                      d.status === 'Blocked' ? 'bg-amber-100 text-amber-700' :
                      'bg-gray-100 text-gray-600'
                    }`}>
                      {d.status}
                    </span>
                  </td>
                  <td className="py-1.5 pr-3 text-gray-500">{d.retry_count}</td>
                  <td className="py-1.5 truncate max-w-[200px]">
                    {d.last_error && <span className="text-red-400">{d.last_error}</span>}
                    {!d.last_error && d.warning && <span className="text-amber-500">{d.warning}</span>}
                    {!d.last_error && !d.warning && <span className="text-gray-300">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Main Component ───────────────────────────────────────────────────────────

export default function WebsiteProductionRoom({
  workflowId,
  businessName = '',
  isAdmin = false,
  onArtifactView,
  onReviewAction,
  onWebsitePreview,
}: WebsiteProductionRoomProps) {
  const [progress, setProgress] = useState<ProgressData | null>(null);
  const [expandedArtifact, setExpandedArtifact] = useState<string | null>(null);
  const [reviewStates, setReviewStates] = useState<Record<string, 'none' | 'pending' | 'approved' | 'changes_requested'>>({});
  const pollRef = useRef<NodeJS.Timeout | null>(null);
  const mountedRef = useRef(true);
  const lastArtifactCountRef = useRef(0);

  const fetchProgress = useCallback(async () => {
    if (!workflowId || !mountedRef.current) return;
    try {
      const res = await fetch(
        `/api/workflow-progress?workflowId=${encodeURIComponent(workflowId)}&includeArtifacts=true`,
        { cache: 'no-store' }
      );
      if (!res.ok) return;
      const data: ProgressData = await res.json();
      if (!mountedRef.current) return;
      setProgress(data);

      // Auto-expand newly available artifacts
      if (data.available_artifacts?.length > lastArtifactCountRef.current) {
        const newArtifacts = data.available_artifacts.slice(lastArtifactCountRef.current);
        if (newArtifacts.length > 0 && !expandedArtifact) {
          // Auto-expand the latest artifact
          const latest = newArtifacts[newArtifacts.length - 1];
          if (latest && data.artifact_details?.[latest.type]) {
            setExpandedArtifact(latest.type);
          }
        }
        lastArtifactCountRef.current = data.available_artifacts.length;
      }

      // Stop polling on terminal states
      if (data.status === 'completed' || data.status === 'error' || data.status === 'not_found') {
        if (pollRef.current) {
          clearInterval(pollRef.current);
          pollRef.current = null;
        }
      }
    } catch {
      // Non-fatal — keep polling
    }
  }, [workflowId, expandedArtifact]);

  useEffect(() => {
    mountedRef.current = true;
    lastArtifactCountRef.current = 0;
    if (!workflowId) return;

    const initialTimer = setTimeout(fetchProgress, 1500);
    pollRef.current = setInterval(fetchProgress, 5000);

    return () => {
      mountedRef.current = false;
      clearTimeout(initialTimer);
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [workflowId, fetchProgress]);

  // Build production stages from progress data
  const productionStages: ProductionStage[] = useMemo(() => {
    if (!progress?.timeline?.length) return [];

    return progress.timeline.map((t) => {
      const customerLabel = sanitizeDepartment(t.department);
      let stageStatus: StageStatus = 'waiting';
      if (t.status === 'completed') {
        // Check if this is a review-gated stage
        const artType = t.artifact?.type;
        const isReviewable = artType && (REVIEW_GATES.has(artType) || artType === SITEMAP_REVIEW);
        const rs = artType ? reviewStates[artType] : undefined;
        if (isReviewable && rs !== 'approved') {
          stageStatus = 'needs_review';
        } else {
          stageStatus = 'ready';
        }
      } else if (t.status === 'active') {
        stageStatus = 'working';
      } else if (t.status === 'error') {
        stageStatus = 'failed';
      } else if (t.status === 'queued') {
        stageStatus = 'waiting';
      } else {
        stageStatus = 'waiting';
      }

      return {
        id: `stage-${t.task_id}`,
        label: customerLabel,
        status: stageStatus,
        elapsed_ms: t.elapsed_ms,
        artifactType: t.artifact?.type || null,
        hasArtifact: !!t.artifact && t.status === 'completed',
        requiresReview: !!(t.artifact?.type && (REVIEW_GATES.has(t.artifact.type) || t.artifact.type === SITEMAP_REVIEW)),
        reviewStatus: (t.artifact?.type ? reviewStates[t.artifact.type] : 'none') || 'none',
        error: t.error,
      };
    });
  }, [progress, reviewStates]);

  // Compute derived values
  const pct = progress && progress.total_count > 0
    ? Math.round((progress.completed_count / progress.total_count) * 100)
    : 0;

  const currentPhase = useMemo(() => {
    if (!progress) return 'Preparing';
    const activeStage = productionStages.find(s => s.status === 'working');
    if (activeStage) return activeStage.label;
    if (progress.status === 'completed') return 'Complete';
    if (progress.status === 'error') return 'Issue Detected';
    return 'Queued';
  }, [progress, productionStages]);

  const availableStages = useMemo(() => {
    return productionStages
      .filter(s => s.hasArtifact)
      .map(s => s.label);
  }, [productionStages]);

  const nextDecision = useMemo(() => {
    const reviewNeeded = productionStages.find(s => s.status === 'needs_review');
    if (reviewNeeded) {
      return `Review ${reviewNeeded.label.toLowerCase()}`;
    }
    return null;
  }, [productionStages]);

  const activityMessage = useMemo(() => {
    if (!progress) return 'Preparing…';
    const activeStage = productionStages.find(s => s.status === 'working');
    if (activeStage) {
      return STAGE_ACTIVITY_MESSAGES[activeStage.label] || `Working on ${activeStage.label.toLowerCase()}…`;
    }
    return getCustomerActivityMessage(progress.activity_message);
  }, [progress, productionStages]);

  // Handle review actions
  const handleReviewAction = useCallback((stage: string, action: 'approve' | 'request_changes', feedback?: string) => {
    if (action === 'approve') {
      setReviewStates(prev => ({ ...prev, [stage]: 'approved' }));
    } else {
      setReviewStates(prev => ({ ...prev, [stage]: 'changes_requested' }));
    }
    onReviewAction?.(stage, action, feedback);
  }, [onReviewAction]);

  const handleToggleArtifact = useCallback((type: string) => {
    setExpandedArtifact(prev => prev === type ? null : type);
  }, []);

  // Don't render until we have data
  if (!progress || !workflowId) return null;
  if (progress.status === 'not_found' && progress.timeline.length === 0) return null;

  const isActive = progress.status === 'in_progress' || progress.status === 'pending';

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden mb-4">
      {/* Production Header */}
      <ProductionHeader
        businessName={businessName}
        currentPhase={currentPhase}
        status={progress.status}
        availableStages={availableStages}
        nextDecision={nextDecision}
        pct={pct}
      />

      {/* Activity Ribbon (only when actively working) */}
      {isActive && (
        <ActivityRibbon message={activityMessage} />
      )}

      {/* Completed banner */}
      {progress.status === 'completed' && (
        <div className="bg-gradient-to-r from-green-500 to-emerald-500 text-white px-5 py-2.5 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4" />
          <span className="text-sm font-medium">Your website is ready!</span>
          {onWebsitePreview && (
            <button
              onClick={onWebsitePreview}
              className="ml-auto text-xs font-semibold bg-white/20 hover:bg-white/30 px-3 py-1 rounded-lg transition-colors"
            >
              Open Preview
            </button>
          )}
        </div>
      )}

      {/* Error banner */}
      {progress.status === 'error' && (
        <div className="bg-gradient-to-r from-red-500 to-rose-500 text-white px-5 py-2.5 flex items-center gap-2">
          <AlertCircle className="w-4 h-4" />
          <span className="text-sm font-medium">{getCustomerActivityMessage(progress.activity_message)}</span>
        </div>
      )}

      {/* Production Timeline with integrated artifact cards and review gates */}
      {productionStages.length > 0 && (
        <ProductionTimeline
          stages={productionStages}
          artifactDetails={progress.artifact_details || {}}
          expandedArtifact={expandedArtifact}
          onToggleArtifact={handleToggleArtifact}
          onReviewAction={handleReviewAction}
          reviewStates={reviewStates}
        />
      )}

      {/* Operator Diagnostics (admin only) */}
      {isAdmin && (
        <OperatorDiagnostics diags={progress.operator_diagnostics} />
      )}
    </div>
  );
}
