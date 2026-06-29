export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { execSync } from 'child_process';

/**
 * GET /api/version
 * Lightweight build/version + feature-flag probe. Used to confirm which commit
 * is actually deployed and which capabilities are live in a given environment.
 *
 * Commit SHA + build time are resolved from Render/Git env vars when available
 * (the deployed standalone bundle has no .git), falling back to a git lookup in
 * dev, then to safe defaults. No secrets are exposed.
 */

const APP_NAME = 'launch-os';
const SERVICE_NAME = 'ad-launch-frontend';

// Captured once at module load (process/boot time) as a build-time approximation
// when no explicit build timestamp env var is provided by the platform.
const MODULE_LOAD_TIME = new Date().toISOString();

let cached: {
  commitSha: string;
  commitShaFull: string;
  buildTime: string;
  buildTimeSource: string;
  commitSource: string;
} | null = null;

function resolveVersion() {
  if (cached) return cached;

  // ── Commit SHA: prefer platform env vars, then git, then fallback ──
  let commitShaFull =
    process.env.RENDER_GIT_COMMIT ||
    process.env.GIT_COMMIT ||
    process.env.SOURCE_VERSION ||
    process.env.VERCEL_GIT_COMMIT_SHA ||
    '';
  let commitSource = commitShaFull ? 'env' : '';

  if (!commitShaFull) {
    try {
      commitShaFull = execSync('git rev-parse HEAD 2>/dev/null', { encoding: 'utf8' }).trim();
      commitSource = commitShaFull ? 'git' : '';
    } catch {
      /* no git in standalone bundle */
    }
  }
  if (!commitShaFull) {
    commitShaFull = 'unknown';
    commitSource = 'fallback';
  }
  const commitSha = commitShaFull === 'unknown' ? 'unknown' : commitShaFull.slice(0, 7);

  // ── Build time: prefer explicit build env var, else module load time ──
  let buildTime =
    process.env.BUILD_TIME ||
    process.env.RENDER_BUILD_TIME ||
    process.env.NEXT_PUBLIC_BUILD_TIME ||
    '';
  let buildTimeSource = buildTime ? 'env' : '';
  if (!buildTime) {
    buildTime = MODULE_LOAD_TIME;
    buildTimeSource = 'module_load';
  }

  cached = { commitSha, commitShaFull, buildTime, buildTimeSource, commitSource };
  return cached;
}

export async function GET() {
  const v = resolveVersion();

  // Feature flags — booleans reflecting capabilities live in this build.
  const featureFlags = {
    three_tier_research: true,
    light_research: true,
    deep_research_gate: true,
    search_intelligence: true,
    tracking_pixels: true,
    pixel_discovery: true,
    no_google_scraping: true,
    // Deliberately-deferred capabilities (off until keys / scheduling are enabled):
    search_intelligence_live_providers: false,
    search_intelligence_weekly_automation: false,
  };

  return NextResponse.json({
    app: APP_NAME,
    service: SERVICE_NAME,
    commitSha: v.commitSha,
    commitShaFull: v.commitShaFull,
    commitSource: v.commitSource,
    buildTime: v.buildTime,
    buildTimeSource: v.buildTimeSource,
    environment: process.env.NODE_ENV ?? 'unknown',
    serverTime: new Date().toISOString(),
    tombstoneApiUrl: process.env.TOMBSTONE_API_URL || process.env.TOMBSTONE_URL ? 'configured' : 'default',
    feature_flags: featureFlags,
    // Legacy flat list kept for backward compatibility with older probes.
    features: Object.entries(featureFlags)
      .filter(([, on]) => on)
      .map(([k]) => k),
  });
}
