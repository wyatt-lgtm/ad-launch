'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Trophy, Target, Lightbulb, MapPin, Search, MousePointerClick,
  Compass, BarChart3, Shield, AlertTriangle, Globe, CheckCircle2,
  Clock, Sparkles, ChevronDown, ChevronUp, Loader2
} from 'lucide-react';

/* ── types ── */
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

interface BriefData {
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

interface DirectionSelection {
  directionName: string;
  selectedBy: 'customer' | 'auto_timer' | 'system_default';
  selectedAt: string;
}

interface WebsiteWarRoomProps {
  workflowId: string;
  analysisId?: string;
  onDirectionSelected: (selection: DirectionSelection) => void;
}

const AUTO_SELECT_SECONDS = 300; // 5 minutes

/* ── Score comparison bar chart ── */
function ScoreBarChart({ entries, topName, selectedName }: {
  entries: { name: string; score: number }[];
  topName: string;
  selectedName?: string;
}) {
  const maxScore = Math.max(...entries.map(e => e.score), 1);
  return (
    <div className="space-y-3">
      {entries.map((e) => {
        const isTop = e.name === topName;
        const isSelected = e.name === selectedName;
        const pct = Math.round((e.score / 90) * 100);
        return (
          <div key={e.name} className="flex items-center gap-3">
            <span className={`text-xs font-semibold w-40 truncate ${
              isSelected ? 'text-emerald-700' : isTop ? 'text-violet-700' : 'text-gray-600'
            }`}>
              {e.name}
              {isTop && !isSelected && (
                <span className="ml-1 text-[10px] bg-violet-100 text-violet-600 px-1.5 py-0.5 rounded-full">Top</span>
              )}
              {isSelected && (
                <span className="ml-1 text-[10px] bg-emerald-100 text-emerald-600 px-1.5 py-0.5 rounded-full">Picked</span>
              )}
            </span>
            <div className="flex-1 h-4 bg-gray-100 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-700 ${
                  isSelected ? 'bg-gradient-to-r from-emerald-400 to-emerald-500'
                    : isTop ? 'bg-gradient-to-r from-violet-400 to-violet-500'
                    : 'bg-gradient-to-r from-gray-300 to-gray-400'
                }`}
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className={`text-sm font-bold w-12 text-right ${
              isSelected ? 'text-emerald-700' : isTop ? 'text-violet-700' : 'text-gray-500'
            }`}>
              {e.score}/90
            </span>
          </div>
        );
      })}
    </div>
  );
}

/* ── Direction detail card ── */
function DirectionCard({ territory, score, isTop, isSelected, onPick, locked }: {
  territory: WebsiteTerritory;
  score?: number;
  isTop: boolean;
  isSelected: boolean;
  onPick: () => void;
  locked: boolean;
}) {
  const fields: { label: string; key: keyof WebsiteTerritory }[] = [
    { label: 'Homepage Positioning', key: 'homepage_positioning' },
    { label: 'Audience Insight', key: 'audience_insight' },
    { label: 'Primary Customer Action', key: 'primary_customer_action' },
    { label: 'CTA Recommendation', key: 'cta_recommendation' },
    { label: 'Navigation Strategy', key: 'navigation_strategy' },
    { label: 'Section Hierarchy', key: 'section_hierarchy' },
    { label: 'Visual Direction', key: 'visual_direction' },
    { label: 'Local SEO Angle', key: 'local_seo_angle' },
    { label: 'Map / Storefront Usage', key: 'map_storefront_usage' },
    { label: 'Brand Differentiation', key: 'brand_differentiation' },
    { label: 'Reference Site Influence', key: 'reference_site_influence' },
    { label: 'Competitor SEO Influence', key: 'competitor_seo_influence' },
  ];

  const borderClass = isSelected
    ? 'border-emerald-300 bg-emerald-50/40 ring-2 ring-emerald-200'
    : isTop
    ? 'border-violet-300 bg-violet-50/40 ring-2 ring-violet-200'
    : 'border-gray-200 bg-white';

  return (
    <div className={`rounded-xl border-2 overflow-hidden transition-all ${borderClass}`}>
      {/* Card header */}
      <div className="px-5 py-3 flex items-center justify-between bg-white/60">
        <div className="flex items-center gap-2">
          {isSelected ? (
            <CheckCircle2 className="w-5 h-5 text-emerald-600" />
          ) : isTop ? (
            <Trophy className="w-5 h-5 text-violet-600" />
          ) : (
            <Compass className="w-5 h-5 text-gray-400" />
          )}
          <span className="font-bold text-gray-900">{territory.territory_name}</span>
          {isSelected && (
            <span className="text-[10px] font-bold uppercase tracking-wider bg-emerald-200 text-emerald-700 px-2 py-0.5 rounded-full">
              Customer Selected
            </span>
          )}
          {isTop && !isSelected && (
            <span className="text-[10px] font-bold uppercase tracking-wider bg-violet-200 text-violet-700 px-2 py-0.5 rounded-full">
              Top Recommendation
            </span>
          )}
          {!isTop && !isSelected && (
            <span className="text-[10px] font-bold uppercase tracking-wider bg-gray-200 text-gray-600 px-2 py-0.5 rounded-full">
              Alternative
            </span>
          )}
        </div>
        {score != null && (
          <span className={`text-sm font-bold ${
            isSelected ? 'text-emerald-700' : isTop ? 'text-violet-700' : 'text-gray-500'
          }`}>
            Score: {score}/90
          </span>
        )}
      </div>

      {/* Card body — always open */}
      <div className="px-5 pb-4 pt-2 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-xs text-gray-600">
        {fields.map(({ label, key }) => {
          const val = territory[key];
          if (!val) return null;
          return (
            <div key={key}>
              <span className="font-semibold text-gray-700 block mb-0.5">{label}</span>
              {val}
            </div>
          );
        })}
        {territory.risks && (
          <div className="sm:col-span-2">
            <span className="font-semibold text-amber-700 block mb-0.5 flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" /> Risks
            </span>
            {territory.risks}
          </div>
        )}
      </div>

      {/* Pick button */}
      {!locked && (
        <div className="px-5 pb-4">
          <button
            onClick={onPick}
            disabled={isSelected}
            className={`w-full py-2.5 rounded-lg font-semibold text-sm transition-all ${
              isSelected
                ? 'bg-emerald-100 text-emerald-700 cursor-default'
                : 'bg-gradient-to-r from-violet-600 to-fuchsia-500 hover:from-violet-700 hover:to-fuchsia-600 text-white shadow-md hover:shadow-lg'
            }`}
          >
            {isSelected ? '✓ Direction Selected' : 'Pick This Direction'}
          </button>
        </div>
      )}
    </div>
  );
}

/* ── Main War Room component ── */
export default function WebsiteWarRoom({ workflowId, analysisId, onDirectionSelected }: WebsiteWarRoomProps) {
  const [brief, setBrief] = useState<BriefData | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedDirection, setSelectedDirection] = useState<string | null>(null);
  const [selectedBy, setSelectedBy] = useState<'customer' | 'auto_timer' | 'system_default' | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(AUTO_SELECT_SECONDS);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const pollRef = useRef<NodeJS.Timeout | null>(null);
  const selectionMade = useRef(false);

  // Poll for agency brief data until available
  useEffect(() => {
    if (!workflowId) return;
    let cancelled = false;

    const fetchBrief = async () => {
      try {
        const res = await fetch(`/api/agency-brief/${workflowId}`);
        if (res.ok) {
          const data = await res.json();
          if (!cancelled && data?.has_website_territories && data.website_territories?.length > 0) {
            setBrief(data);
            setLoading(false);
            if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
          }
        }
      } catch { /* retry next poll */ }
    };

    fetchBrief();
    pollRef.current = setInterval(fetchBrief, 6000);

    return () => {
      cancelled = true;
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [workflowId]);

  // Start countdown timer once brief is loaded
  useEffect(() => {
    if (!brief || selectionMade.current) return;

    timerRef.current = setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          // Auto-select the top recommendation
          if (!selectionMade.current) {
            selectionMade.current = true;
            const topName = brief.selected_territory?.territory_name || brief.website_territories[0]?.territory_name || '';
            setSelectedDirection(topName);
            setSelectedBy('auto_timer');
            onDirectionSelected({
              directionName: topName,
              selectedBy: 'auto_timer',
              selectedAt: new Date().toISOString(),
            });
          }
          if (timerRef.current) clearInterval(timerRef.current);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [brief, onDirectionSelected]);

  const handlePick = useCallback((name: string) => {
    if (selectionMade.current) return;
    selectionMade.current = true;
    setSelectedDirection(name);
    setSelectedBy('customer');
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    onDirectionSelected({
      directionName: name,
      selectedBy: 'customer',
      selectedAt: new Date().toISOString(),
    });
  }, [onDirectionSelected]);

  // Loading / polling state
  if (loading) {
    return (
      <div className="px-6 py-8 text-center">
        <Loader2 className="w-6 h-6 text-violet-500 animate-spin mx-auto mb-3" />
        <p className="text-sm font-semibold text-violet-700">Running Website War Room...</p>
        <p className="text-xs text-gray-400 mt-1">Evaluating multiple website directions for your business</p>
      </div>
    );
  }

  if (!brief) return null;

  const { website_territories, selected_territory } = brief;
  const topName = selected_territory?.territory_name || website_territories[0]?.territory_name || '';

  // Build score entries from scorecard
  const rawSc = brief.scorecard;
  const scoreEntries: { name: string; score: number }[] = [];
  if (Array.isArray(rawSc)) {
    for (const s of rawSc) {
      scoreEntries.push({ name: s.territory_name || 'Unknown', score: s.total_score });
    }
  } else if (rawSc) {
    scoreEntries.push({ name: topName, score: rawSc.total_score });
  }
  // Sort by score descending
  scoreEntries.sort((a, b) => b.score - a.score);

  // Build score lookup
  const scoreLookup: Record<string, number> = {};
  for (const e of scoreEntries) scoreLookup[e.name] = e.score;

  const isLocked = !!selectedDirection;
  const mins = Math.floor(secondsLeft / 60);
  const secs = secondsLeft % 60;

  return (
    <div className="px-6 py-5 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BarChart3 className="w-5 h-5 text-violet-600" />
          <h3 className="text-lg font-bold text-gray-900">Website War Room</h3>
        </div>
        {isLocked ? (
          <div className="flex items-center gap-2 text-sm">
            <CheckCircle2 className="w-4 h-4 text-emerald-500" />
            <span className="font-semibold text-emerald-700">
              {selectedBy === 'customer' ? 'Direction selected' : 'Auto-selected Top Recommendation'}
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <Clock className="w-4 h-4" />
            <span>Auto-selecting in <span className="font-mono font-semibold text-violet-700">{mins}:{secs.toString().padStart(2, '0')}</span></span>
          </div>
        )}
      </div>

      {/* Timer notice */}
      {!isLocked && (
        <div className="bg-violet-50 border border-violet-200 rounded-lg px-4 py-3 text-sm text-violet-800">
          <Sparkles className="w-4 h-4 inline mr-1.5 -mt-0.5" />
          Pick a direction, or we&apos;ll continue with the <strong>Top Recommendation</strong> in {mins > 0 ? `${mins}m ` : ''}{secs}s.
        </div>
      )}

      {/* Selection confirmation */}
      {isLocked && selectedDirection && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-3 text-sm text-emerald-800">
          <CheckCircle2 className="w-4 h-4 inline mr-1.5 -mt-0.5" />
          Website direction selected: <strong>{selectedDirection}</strong>
          {selectedBy === 'auto_timer' && ' (auto-selected)'}
          . Proceeding to website copywriting...
        </div>
      )}

      {/* Score comparison bar chart */}
      {scoreEntries.length > 0 && (
        <div className="bg-gray-50 rounded-xl p-5 border border-gray-200">
          <h4 className="text-xs font-bold uppercase tracking-wider text-gray-600 mb-4 flex items-center gap-1">
            <BarChart3 className="w-3.5 h-3.5" /> Direction Scores Comparison
          </h4>
          <ScoreBarChart entries={scoreEntries} topName={topName} selectedName={selectedDirection || undefined} />
        </div>
      )}

      {/* Direction cards — all fully visible */}
      <div className="space-y-4">
        {/* Top recommendation first */}
        {website_territories
          .sort((a, b) => {
            // Top recommendation first, then by score
            if (a.territory_name === topName) return -1;
            if (b.territory_name === topName) return 1;
            return (scoreLookup[b.territory_name] ?? 0) - (scoreLookup[a.territory_name] ?? 0);
          })
          .map((t) => (
            <DirectionCard
              key={t.territory_name}
              territory={t}
              score={scoreLookup[t.territory_name]}
              isTop={t.territory_name === topName}
              isSelected={t.territory_name === selectedDirection}
              onPick={() => handlePick(t.territory_name)}
              locked={isLocked}
            />
          ))}
      </div>

      {/* Why This Website Works */}
      {brief.why_this_website_works && (
        <div className="bg-emerald-50 rounded-lg p-4 border border-emerald-100">
          <h4 className="text-xs font-bold uppercase tracking-wider text-emerald-700 mb-1 flex items-center gap-1">
            <Lightbulb className="w-3.5 h-3.5" /> Why This Website Works
          </h4>
          <p className="text-sm text-emerald-800 leading-relaxed">{brief.why_this_website_works}</p>
        </div>
      )}

      {/* SEO / Local Positioning Notes */}
      {brief.seo_positioning_notes && (
        <div className="bg-blue-50 rounded-lg p-4 border border-blue-100">
          <h4 className="text-xs font-bold uppercase tracking-wider text-blue-700 mb-1 flex items-center gap-1">
            <Search className="w-3.5 h-3.5" /> SEO / Local Positioning Notes
          </h4>
          <p className="text-sm text-blue-800 leading-relaxed">{brief.seo_positioning_notes}</p>
        </div>
      )}

      {/* CTA / Navigation Rationale */}
      {brief.cta_nav_rationale && (
        <div className="bg-amber-50 rounded-lg p-4 border border-amber-100">
          <h4 className="text-xs font-bold uppercase tracking-wider text-amber-700 mb-1 flex items-center gap-1">
            <MousePointerClick className="w-3.5 h-3.5" /> CTA / Navigation Rationale
          </h4>
          <p className="text-sm text-amber-800 leading-relaxed">{brief.cta_nav_rationale}</p>
        </div>
      )}
    </div>
  );
}
