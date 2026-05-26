'use client';

import { useState, useEffect } from 'react';
import { ChevronDown, ChevronUp, Target, Trophy, Lightbulb, Palette, Shield, AlertTriangle } from 'lucide-react';

interface Territory {
  territory_name: string;
  audience_insight: string;
  strategic_angle: string;
  sample_headline: string;
  visual_direction: string;
  cta_recommendation: string;
  why_it_could_work: string;
  risks: string;
}

interface Scorecard {
  total_score: number;
  dimensions?: Record<string, number>;
  verdict?: string;
  creative_rationale?: string;
}

interface AgencyBriefData {
  workflow_id: string;
  has_territories: boolean;
  creative_territories: Territory[];
  selected_territory: Territory | null;
  scorecard: Scorecard | null;
  creative_rationale: string | null;
  why_this_works: string | null;
  final_headline: string | null;
  final_cta: string | null;
  visual_concept: string | null;
  render_prompt_preview: string | null;
  brand_fit_score: number | null;
  brand_fit_passed: boolean | null;
  validation_notes: string[];
}

export default function AgencyBrief({ workflowId }: { workflowId: string }) {
  const [brief, setBrief] = useState<AgencyBriefData | null>(null);
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

  if (loading || !brief || !brief.has_territories) return null;

  const selected = brief.selected_territory;
  const scorecard = brief.scorecard;

  return (
    <div className="mt-4 rounded-xl border border-amber-200/60 bg-gradient-to-br from-amber-50/80 to-orange-50/40 dark:from-amber-950/20 dark:to-orange-950/10 dark:border-amber-800/30">
      {/* Header — always visible */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between px-4 py-3 text-left"
      >
        <div className="flex items-center gap-2">
          <Lightbulb className="h-4 w-4 text-amber-600 dark:text-amber-400" />
          <span className="text-sm font-semibold text-amber-900 dark:text-amber-200">
            Creative Brief
          </span>
          {selected && (
            <span className="ml-1 rounded-full bg-amber-200/60 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-800/40 dark:text-amber-200">
              {selected.territory_name}
            </span>
          )}
          {scorecard?.total_score && (
            <span className="rounded-full bg-green-100 px-1.5 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900/40 dark:text-green-300">
              {scorecard.total_score}/70
            </span>
          )}
        </div>
        {expanded ? (
          <ChevronUp className="h-4 w-4 text-amber-600" />
        ) : (
          <ChevronDown className="h-4 w-4 text-amber-600" />
        )}
      </button>

      {/* Expanded content */}
      {expanded && (
        <div className="space-y-4 border-t border-amber-200/40 px-4 pb-4 pt-3 dark:border-amber-800/20">
          {/* Selected Territory */}
          {selected && (
            <div>
              <div className="mb-2 flex items-center gap-1.5">
                <Trophy className="h-3.5 w-3.5 text-amber-600" />
                <h4 className="text-xs font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-300">
                  Selected Creative Direction
                </h4>
              </div>
              <div className="rounded-lg bg-white/70 p-3 dark:bg-white/5">
                <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                  {selected.territory_name}
                </p>
                <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">
                  {selected.strategic_angle}
                </p>
                {selected.sample_headline && (
                  <p className="mt-2 text-sm italic text-gray-700 dark:text-gray-300">
                    &ldquo;{selected.sample_headline}&rdquo;
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Why This Works */}
          {brief.why_this_works && (
            <div>
              <div className="mb-1.5 flex items-center gap-1.5">
                <Target className="h-3.5 w-3.5 text-amber-600" />
                <h4 className="text-xs font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-300">
                  Why This Works
                </h4>
              </div>
              <p className="text-xs leading-relaxed text-gray-600 dark:text-gray-400">
                {brief.why_this_works}
              </p>
            </div>
          )}

          {/* Final CTA & Headline */}
          {(brief.final_headline || brief.final_cta) && (
            <div className="flex flex-wrap gap-3">
              {brief.final_headline && (
                <div className="flex-1 min-w-[120px]">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">Final Headline</span>
                  <p className="mt-0.5 text-sm font-medium text-gray-900 dark:text-gray-100">
                    {brief.final_headline}
                  </p>
                </div>
              )}
              {brief.final_cta && (
                <div>
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">CTA</span>
                  <p className="mt-0.5 inline-block rounded-md bg-amber-600 px-3 py-1 text-xs font-semibold text-white">
                    {brief.final_cta}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Image Direction */}
          {brief.visual_concept && (
            <div>
              <div className="mb-1.5 flex items-center gap-1.5">
                <Palette className="h-3.5 w-3.5 text-amber-600" />
                <h4 className="text-xs font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-300">
                  Image Direction
                </h4>
              </div>
              <p className="text-xs text-gray-600 dark:text-gray-400">
                {brief.visual_concept}
              </p>
            </div>
          )}

          {/* Brand Fit */}
          {brief.brand_fit_score !== null && (
            <div className="flex items-center gap-2">
              <Shield className={`h-3.5 w-3.5 ${
                brief.brand_fit_passed ? 'text-green-600' : 'text-red-500'
              }`} />
              <span className="text-xs text-gray-600 dark:text-gray-400">
                Brand Fit: {brief.brand_fit_score}/100
                {brief.brand_fit_passed ? ' ✓' : ' — needs review'}
              </span>
            </div>
          )}

          {/* Validation Notes */}
          {brief.validation_notes.length > 0 && (
            <div className="rounded-md bg-yellow-50 p-2 dark:bg-yellow-900/10">
              <div className="flex items-center gap-1 mb-1">
                <AlertTriangle className="h-3 w-3 text-yellow-600" />
                <span className="text-[10px] font-semibold uppercase text-yellow-700 dark:text-yellow-400">Notes</span>
              </div>
              {brief.validation_notes.slice(0, 3).map((note, i) => (
                <p key={i} className="text-[11px] text-yellow-800 dark:text-yellow-300">
                  {note}
                </p>
              ))}
            </div>
          )}

          {/* All Territories (collapsed by default) */}
          {brief.creative_territories.length > 1 && (
            <div>
              <button
                onClick={() => setShowAllTerritories(!showAllTerritories)}
                className="flex items-center gap-1 text-xs text-amber-600 hover:text-amber-700 dark:text-amber-400"
              >
                {showAllTerritories ? 'Hide' : 'Show'} all {brief.creative_territories.length} territories
                {showAllTerritories ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              </button>
              {showAllTerritories && (
                <div className="mt-2 space-y-2">
                  {brief.creative_territories.map((t, i) => (
                    <div
                      key={i}
                      className={`rounded-md border p-2 text-xs ${
                        t.territory_name === selected?.territory_name
                          ? 'border-amber-400 bg-amber-50/50 dark:border-amber-600 dark:bg-amber-900/20'
                          : 'border-gray-200 bg-gray-50/50 dark:border-gray-700 dark:bg-gray-800/30'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-gray-900 dark:text-gray-100">
                          {t.territory_name}
                        </span>
                        {t.territory_name === selected?.territory_name && (
                          <span className="rounded bg-amber-200 px-1.5 py-0.5 text-[10px] font-bold text-amber-800 dark:bg-amber-700 dark:text-amber-100">
                            WINNER
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-gray-500 dark:text-gray-400">
                        {t.strategic_angle}
                      </p>
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
