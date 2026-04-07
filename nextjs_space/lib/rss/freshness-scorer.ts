/**
 * Phase 4: Freshness & Quality Scoring Engine
 *
 * Produces two independent scores per feed (0–100):
 *
 *   freshnessScore — How recent and regular is the publishing?
 *     - Recency of latest item (40%)
 *     - Publishing frequency / items-per-week (30%)
 *     - Regularity / consistency of publish cadence (20%)
 *     - Feed-level lastBuildDate signal (10%)
 *
 *   qualityScore — How trustworthy and useful is this source?
 *     - Source quality tier (30%) — official > trusted > community > etc.
 *     - Item completeness (25%) — title, description, link, date, image
 *     - Content length of descriptions (20%)
 *     - Has geo coverage assigned (15%)
 *     - Feed metadata completeness (10%)
 */

import type { ParsedFeed, ParsedItem } from './feed-parser';
import type { SourceQuality } from './types';

export interface FreshnessResult {
  freshnessScore: number;        // 0-100
  qualityScore: number;          // 0-100
  avgItemsPerWeek: number;
  lastItemDate: Date | null;
  itemCount: number;
  breakdown: {
    recency: number;
    frequency: number;
    regularity: number;
    buildDateSignal: number;
    sourceTier: number;
    itemCompleteness: number;
    contentLength: number;
    geoBonus: number;
    metaCompleteness: number;
  };
}

// ═══════════════════════════════════════════════════════════════
// Main scoring function
// ═══════════════════════════════════════════════════════════════

export function scoreFeed(
  feed: ParsedFeed,
  sourceQuality: SourceQuality,
  hasGeo: boolean,
): FreshnessResult {
  const now = Date.now();
  const items = feed.items;
  const datedItems = items.filter(i => i.pubDate != null).sort(
    (a, b) => (b.pubDate!.getTime()) - (a.pubDate!.getTime())
  );

  // ── Freshness components ──────────────────────────────────

  // 1. Recency (40%) — how old is the newest item?
  const latestDate = datedItems[0]?.pubDate ?? null;
  let recency = 0;
  if (latestDate) {
    const ageHours = (now - latestDate.getTime()) / (1000 * 60 * 60);
    if (ageHours < 6) recency = 100;
    else if (ageHours < 24) recency = 90;
    else if (ageHours < 72) recency = 75;
    else if (ageHours < 168) recency = 60;  // 1 week
    else if (ageHours < 336) recency = 40;  // 2 weeks
    else if (ageHours < 720) recency = 20;  // 30 days
    else recency = 5;  // stale
  }

  // 2. Frequency (30%) — items per week
  let avgItemsPerWeek = 0;
  let frequency = 0;
  if (datedItems.length >= 2) {
    const oldest = datedItems[datedItems.length - 1].pubDate!;
    const newest = datedItems[0].pubDate!;
    const spanWeeks = Math.max((newest.getTime() - oldest.getTime()) / (1000 * 60 * 60 * 24 * 7), 0.143); // min 1 day
    avgItemsPerWeek = datedItems.length / spanWeeks;

    if (avgItemsPerWeek >= 14) frequency = 100;       // 2+/day
    else if (avgItemsPerWeek >= 7) frequency = 90;    // daily
    else if (avgItemsPerWeek >= 3) frequency = 75;    // every other day
    else if (avgItemsPerWeek >= 1) frequency = 55;    // weekly
    else if (avgItemsPerWeek >= 0.25) frequency = 30; // monthly
    else frequency = 10;
  } else if (datedItems.length === 1) {
    avgItemsPerWeek = 0.5;
    frequency = 20;
  }

  // 3. Regularity (20%) — coefficient of variation of gaps
  let regularity = 50; // default neutral
  if (datedItems.length >= 3) {
    const gaps: number[] = [];
    for (let i = 0; i < datedItems.length - 1; i++) {
      gaps.push(datedItems[i].pubDate!.getTime() - datedItems[i + 1].pubDate!.getTime());
    }
    const mean = gaps.reduce((s, g) => s + g, 0) / gaps.length;
    if (mean > 0) {
      const variance = gaps.reduce((s, g) => s + (g - mean) ** 2, 0) / gaps.length;
      const cv = Math.sqrt(variance) / mean; // coefficient of variation
      // cv < 0.3 = very regular, cv > 2 = very erratic
      if (cv < 0.3) regularity = 100;
      else if (cv < 0.5) regularity = 80;
      else if (cv < 1.0) regularity = 60;
      else if (cv < 2.0) regularity = 35;
      else regularity = 10;
    }
  }

  // 4. Feed lastBuildDate signal (10%)
  let buildDateSignal = 0;
  if (feed.meta.lastBuildDate) {
    const ageHours = (now - feed.meta.lastBuildDate.getTime()) / (1000 * 60 * 60);
    buildDateSignal = ageHours < 24 ? 100 : ageHours < 168 ? 60 : 20;
  }

  const freshnessScore = Math.round(
    recency * 0.4 +
    frequency * 0.3 +
    regularity * 0.2 +
    buildDateSignal * 0.1
  );

  // ── Quality components ────────────────────────────────────

  // 1. Source tier (30%)
  const TIER_SCORES: Record<string, number> = {
    official: 100,
    trusted: 80,
    community: 55,
    aggregator: 30,
    unverified: 15,
  };
  const sourceTier = TIER_SCORES[sourceQuality] ?? 15;

  // 2. Item completeness (25%) — avg across items
  let itemCompleteness = 0;
  if (items.length > 0) {
    const sample = items.slice(0, 20); // sample first 20
    const scores = sample.map(i => {
      let s = 0;
      if (i.title) s += 25;
      if (i.description && i.description.length > 20) s += 25;
      if (i.link) s += 20;
      if (i.pubDate) s += 20;
      if (i.imageUrl) s += 10;
      return s;
    });
    itemCompleteness = scores.reduce((a, b) => a + b, 0) / scores.length;
  }

  // 3. Content length (20%) — avg description length
  let contentLength = 0;
  if (items.length > 0) {
    const sample = items.slice(0, 20);
    const avgLen = sample.reduce((s, i) => s + (i.description?.length ?? 0), 0) / sample.length;
    if (avgLen >= 300) contentLength = 100;
    else if (avgLen >= 150) contentLength = 75;
    else if (avgLen >= 50) contentLength = 45;
    else if (avgLen > 0) contentLength = 20;
  }

  // 4. Geo coverage (15%)
  const geoBonus = hasGeo ? 100 : 0;

  // 5. Feed metadata (10%)
  let metaCompleteness = 0;
  if (feed.meta.title) metaCompleteness += 35;
  if (feed.meta.description) metaCompleteness += 25;
  if (feed.meta.siteUrl) metaCompleteness += 20;
  if (feed.meta.language) metaCompleteness += 10;
  if (feed.meta.generator) metaCompleteness += 10;

  const qualityScore = Math.round(
    sourceTier * 0.30 +
    itemCompleteness * 0.25 +
    contentLength * 0.20 +
    geoBonus * 0.15 +
    metaCompleteness * 0.10
  );

  return {
    freshnessScore: Math.min(100, Math.max(0, freshnessScore)),
    qualityScore: Math.min(100, Math.max(0, qualityScore)),
    avgItemsPerWeek: Math.round(avgItemsPerWeek * 100) / 100,
    lastItemDate: latestDate,
    itemCount: items.length,
    breakdown: {
      recency,
      frequency,
      regularity,
      buildDateSignal,
      sourceTier,
      itemCompleteness: Math.round(itemCompleteness),
      contentLength,
      geoBonus,
      metaCompleteness,
    },
  };
}
