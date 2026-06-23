'use client';

import { useState, useEffect } from 'react';
import {
  ChevronDown, ChevronUp, Target, Trophy, Lightbulb,
  MapPin, Search, MousePointerClick, Compass, BarChart3,
  Shield, AlertTriangle, Globe
} from 'lucide-react';

interface WebsiteTerritory {
  territory_name: string;
  homepage_positioning: string;
  audience_insight: string;
  primary_customer_action: string;
  navigation_strategy: string;
  section_hierarchy: string;
  local_seo_angle: string;
  visual_direction: string;
  cta_recommendation: string;
  reference_site_influence: string;
  competitor_seo_influence: string;
  map_storefront_usage: string;
  brand_differentiation: string;
  risks: string;
}

interface ScorecardEntry {
  territory_name?: string;
  total_score: number;
  scores?: Record<string, number>;
  dimensions?: Record<string, number>;
  verdict?: string;
  creative_rationale?: string;
}

interface WebsiteBriefData {
  workflow_id: string;
  has_website_territories: boolean;
  website_territories: WebsiteTerritory[];
  selected_territory: WebsiteTerritory | null;
  scorecard: ScorecardEntry | ScorecardEntry[] | null;
  creative_rationale: string | null;
  why_this_website_works: string | null;
  seo_positioning_notes: string | null;
  cta_nav_rationale: string | null;
}

const DIMENSION_LABELS: Record<string, { label: string; icon: React.ReactNode }> = {
  audience_relevance: { label: 'Audience Relevance', icon: <Target className="w-3.5 h-3.5" /> },
  brand_fit: { label: 'Brand Fit', icon: <Shield className="w-3.5 h-3.5" /> },
  local_seo_strength: { label: 'Local SEO Strength', icon: <Search className="w-3.5 h-3.5" /> },
  cta_fit: { label: 'CTA Fit', icon: <MousePointerClick className="w-3.5 h-3.5" /> },
  visual_originality: { label: 'Visual Originality', icon: <Lightbulb className="w-3.5 h-3.5" /> },
  local_specificity: { label: 'Local Specificity', icon: <MapPin className="w-3.5 h-3.5" /> },
  competitive_differentiation: { label: 'Competitive Edge', icon: <Trophy className="w-3.5 h-3.5" /> },
  html_build_feasibility: { label: 'Build Feasibility', icon: <Globe className="w-3.5 h-3.5" /> },
  map_storefront_integration: { label: 'Map/Storefront', icon: <Compass className="w-3.5 h-3.5" /> },
};

function ScoreBar({ score, label, icon }: { score: number; label: string; icon: React.ReactNode }) {
  const pct = Math.min(score * 10, 100);
  const color = score >= 8 ? 'bg-emerald-500' : score >= 6 ? 'bg-amber-400' : 'bg-red-400';
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="flex items-center gap-1 w-36 text-gray-600 shrink-0">{icon} {label}</span>
      <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color} transition-all duration-700`} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-6 text-right font-semibold text-gray-700">{score}</span>
    </div>
  );
}

function TerritoryCard({ territory, isSelected }: { territory: WebsiteTerritory; isSelected: boolean }) {
  const [open, setOpen] = useState(isSelected);
  return (
    <div className={`rounded-xl border ${
      isSelected
        ? 'border-violet-300 bg-violet-50/60 ring-2 ring-violet-200'
        : 'border-gray-200 bg-gray-50/60'
    }`}>
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-3 text-left"
      >
        <div className="flex items-center gap-2">
          {isSelected && <Trophy className="w-4 h-4 text-violet-600" />}
          <span className={`font-semibold text-sm ${isSelected ? 'text-violet-800' : 'text-gray-700'}`}>
            {territory.territory_name}
          </span>
          {isSelected && (
            <span className="text-[10px] font-bold uppercase tracking-wider bg-violet-200 text-violet-700 px-2 py-0.5 rounded-full">
              Top Recommendation
            </span>
          )}
        </div>
        {open ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
      </button>
      {open && (
        <div className="px-4 pb-4 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-xs text-gray-600">
          <div>
            <span className="font-semibold text-gray-700 block mb-0.5">Homepage Positioning</span>
            {territory.homepage_positioning}
          </div>
          <div>
            <span className="font-semibold text-gray-700 block mb-0.5">Audience Insight</span>
            {territory.audience_insight}
          </div>
          <div>
            <span className="font-semibold text-gray-700 block mb-0.5">Primary Customer Action</span>
            {territory.primary_customer_action}
          </div>
          <div>
            <span className="font-semibold text-gray-700 block mb-0.5">CTA Recommendation</span>
            {territory.cta_recommendation}
          </div>
          <div>
            <span className="font-semibold text-gray-700 block mb-0.5">Navigation Strategy</span>
            {territory.navigation_strategy}
          </div>
          <div>
            <span className="font-semibold text-gray-700 block mb-0.5">Section Hierarchy</span>
            {territory.section_hierarchy}
          </div>
          <div>
            <span className="font-semibold text-gray-700 block mb-0.5">Visual Direction</span>
            {territory.visual_direction}
          </div>
          <div>
            <span className="font-semibold text-gray-700 block mb-0.5">Local SEO Angle</span>
            {territory.local_seo_angle}
          </div>
          <div>
            <span className="font-semibold text-gray-700 block mb-0.5">Map / Storefront Usage</span>
            {territory.map_storefront_usage}
          </div>
          <div>
            <span className="font-semibold text-gray-700 block mb-0.5">Brand Differentiation</span>
            {territory.brand_differentiation}
          </div>
          <div>
            <span className="font-semibold text-gray-700 block mb-0.5">Reference Site Influence</span>
            {territory.reference_site_influence}
          </div>
          <div>
            <span className="font-semibold text-gray-700 block mb-0.5">Competitor SEO Influence</span>
            {territory.competitor_seo_influence}
          </div>
          {territory.risks && (
            <div className="sm:col-span-2">
              <span className="font-semibold text-amber-700 block mb-0.5 flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" /> Risks
              </span>
              {territory.risks}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function WebsiteAgencyBrief({ workflowId }: { workflowId: string }) {
  const [brief, setBrief] = useState<WebsiteBriefData | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [showAllTerritories, setShowAllTerritories] = useState(false);

  useEffect(() => {
    if (!workflowId) return;
    let cancelled = false;

    async function fetchBrief() {
      try {
        const res = await fetch(`/api/agency-brief/${workflowId}`);
        if (res.ok) {
          const data = await res.json();
          if (!cancelled) setBrief(data);
        }
      } catch {
        // Silently fail — brief is supplementary
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchBrief();
    return () => { cancelled = true; };
  }, [workflowId]);

  if (loading || !brief?.has_website_territories) return null;

  const { website_territories, selected_territory } = brief;
  // scorecard can be a list (new VCE format) or a single object (legacy)
  const rawSc = brief.scorecard;
  let winnerEntry: ScorecardEntry | null = null;
  if (Array.isArray(rawSc)) {
    const selName = (selected_territory?.territory_name || '').toLowerCase();
    winnerEntry = rawSc.find((s) => s.verdict === 'win' || (s.territory_name || '').toLowerCase() === selName) ?? rawSc[0] ?? null;
  } else if (rawSc && typeof rawSc === 'object') {
    winnerEntry = rawSc;
  }
  const otherTerritories = website_territories.filter(
    (t) => t.territory_name !== selected_territory?.territory_name
  );

  return (
    <div className="mx-6 mb-4 rounded-xl border border-violet-200 bg-white overflow-hidden shadow-sm">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-5 py-3 bg-gradient-to-r from-violet-50 to-fuchsia-50 hover:from-violet-100 hover:to-fuchsia-100 transition-colors"
      >
        <div className="flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-violet-600" />
          <span className="font-bold text-sm text-violet-800">Website Strategy Brief</span>
          {winnerEntry && (
            <span className="text-[10px] font-bold bg-violet-200 text-violet-700 px-2 py-0.5 rounded-full">
              Score: {winnerEntry.total_score}/90
            </span>
          )}
        </div>
        {expanded ? <ChevronUp className="w-4 h-4 text-violet-500" /> : <ChevronDown className="w-4 h-4 text-violet-500" />}
      </button>

      {expanded && (
        <div className="p-5 space-y-5">
          {/* ── Selected Direction ── */}
          {selected_territory && (
            <div>
              <h4 className="text-xs font-bold uppercase tracking-wider text-violet-600 mb-2 flex items-center gap-1">
                <Trophy className="w-3.5 h-3.5" /> Top Recommendation
              </h4>
              <TerritoryCard territory={selected_territory} isSelected />
            </div>
          )}

          {/* ── Why This Website Works ── */}
          {brief.why_this_website_works && (
            <div className="bg-emerald-50 rounded-lg p-4 border border-emerald-100">
              <h4 className="text-xs font-bold uppercase tracking-wider text-emerald-700 mb-1 flex items-center gap-1">
                <Lightbulb className="w-3.5 h-3.5" /> Why This Website Works
              </h4>
              <p className="text-sm text-emerald-800 leading-relaxed">{brief.why_this_website_works}</p>
            </div>
          )}

          {/* ── SEO / Local Positioning Notes ── */}
          {brief.seo_positioning_notes && (
            <div className="bg-blue-50 rounded-lg p-4 border border-blue-100">
              <h4 className="text-xs font-bold uppercase tracking-wider text-blue-700 mb-1 flex items-center gap-1">
                <Search className="w-3.5 h-3.5" /> SEO / Local Positioning Notes
              </h4>
              <p className="text-sm text-blue-800 leading-relaxed">{brief.seo_positioning_notes}</p>
            </div>
          )}

          {/* ── CTA / Nav Rationale ── */}
          {brief.cta_nav_rationale && (
            <div className="bg-amber-50 rounded-lg p-4 border border-amber-100">
              <h4 className="text-xs font-bold uppercase tracking-wider text-amber-700 mb-1 flex items-center gap-1">
                <MousePointerClick className="w-3.5 h-3.5" /> CTA / Navigation Rationale
              </h4>
              <p className="text-sm text-amber-800 leading-relaxed">{brief.cta_nav_rationale}</p>
            </div>
          )}

          {/* ── War Room Scorecard ── */}
          {winnerEntry && (winnerEntry.dimensions || winnerEntry.scores) && (
            <div>
              <h4 className="text-xs font-bold uppercase tracking-wider text-gray-600 mb-3 flex items-center gap-1">
                <BarChart3 className="w-3.5 h-3.5" /> War Room Scorecard
              </h4>
              <div className="space-y-2">
                {Object.entries(winnerEntry.dimensions || winnerEntry.scores || {}).map(([key, score]) => {
                  const dim = DIMENSION_LABELS[key] ?? { label: key.replace(/_/g, ' '), icon: <Target className="w-3.5 h-3.5" /> };
                  return <ScoreBar key={key} score={score as number} label={dim.label} icon={dim.icon} />;
                })}
              </div>
              {winnerEntry.verdict && (
                <p className="mt-3 text-xs text-gray-500 italic">{winnerEntry.verdict}</p>
              )}
            </div>
          )}

          {/* ── Other Territories (rejected) ── */}
          {otherTerritories.length > 0 && (
            <div>
              <button
                onClick={() => setShowAllTerritories(!showAllTerritories)}
                className="text-xs font-medium text-gray-500 hover:text-violet-600 flex items-center gap-1 transition-colors"
              >
                {showAllTerritories ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                {showAllTerritories ? 'Hide' : 'Show'} alternative directions ({otherTerritories.length})
              </button>
              {showAllTerritories && (
                <div className="mt-2 space-y-2">
                  {otherTerritories.map((t) => (
                    <TerritoryCard key={t.territory_name} territory={t} isSelected={false} />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── Creative Rationale ── */}
          {brief.creative_rationale && (
            <div className="text-xs text-gray-500 border-t border-gray-100 pt-3">
              <span className="font-semibold">Creative Rationale: </span>
              {brief.creative_rationale}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
