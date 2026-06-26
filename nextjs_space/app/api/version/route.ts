export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { execSync } from 'child_process';

let cachedVersion: { commitSha: string; buildTime: string; features: string[] } | null = null;

function getVersion() {
  if (cachedVersion) return cachedVersion;

  let commitSha = 'unknown';
  try {
    commitSha = execSync('git rev-parse --short HEAD 2>/dev/null', { encoding: 'utf8' }).trim();
  } catch {
    commitSha = process.env.RENDER_GIT_COMMIT?.slice(0, 7) || 'unknown';
  }

  cachedVersion = {
    commitSha,
    buildTime: new Date().toISOString(),
    features: [
      'lane1_workflow_discovery',
      'lane2_business_discovery',
      'persistent_sync_button',
      'diagnostic_poll_logging',
    ],
  };
  return cachedVersion;
}

export async function GET() {
  const version = getVersion();
  return NextResponse.json({
    ...version,
    serverTime: new Date().toISOString(),
    env: process.env.NODE_ENV,
    tombstoneApiUrl: process.env.TOMBSTONE_API_URL ? 'configured' : 'default',
  });
}
