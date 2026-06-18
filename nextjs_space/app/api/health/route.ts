export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

/**
 * GET /api/health
 * Lightweight diagnostics endpoint — tests DB connectivity and env vars.
 * Safe to expose in staging; consider gating in production.
 */
export async function GET() {
  const checks: Record<string, any> = {};

  // 1. Environment variables (only vars the frontend is allowed to hold)
  checks.env = {
    DATABASE_URL: process.env.DATABASE_URL ? 'set (' + process.env.DATABASE_URL.substring(0, 20) + '...)' : 'MISSING',
    NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET ? 'set' : 'MISSING',
    NEXTAUTH_URL: process.env.NEXTAUTH_URL || 'MISSING',
    GOOGLE_MAPS_API_KEY: process.env.GOOGLE_MAPS_API_KEY ? 'set' : 'MISSING',
    TOMBSTONE_API_URL: process.env.TOMBSTONE_API_URL || 'MISSING',
    NODE_ENV: process.env.NODE_ENV || 'not set',
  };

  // Flag vars that should NOT be on the frontend (architecture violation)
  const disallowed = ['OPENAI_API_KEY', 'ABACUSAI_API_KEY'];
  const leaked = disallowed.filter(k => !!process.env[k]);
  if (leaked.length > 0) {
    checks.architecture_warning = `Disallowed model-provider keys present on frontend: ${leaked.join(', ')}. All AI/model calls must route through Tombstone.`;
  }

  // 2. Database connectivity
  try {
    const result = await prisma.$queryRaw`SELECT 1 as ok`;
    checks.database = { status: 'connected', result };
  } catch (err: any) {
    checks.database = { status: 'FAILED', error: err?.message?.substring(0, 500) };
  }

  // 3. Prisma model introspection — can we reference Analysis?
  try {
    const count = await prisma.analysis.count();
    checks.analysisTable = { status: 'ok', count };
  } catch (err: any) {
    checks.analysisTable = { status: 'FAILED', error: err?.message?.substring(0, 500) };
  }

  // 4. Quick Tombstone API ping
  try {
    const tombstoneUrl = process.env.TOMBSTONE_API_URL;
    if (tombstoneUrl) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(`${tombstoneUrl}/health`, { signal: controller.signal }).catch(() => null);
      clearTimeout(timeout);
      checks.tombstone = res ? { status: res.status, ok: res.ok } : { status: 'unreachable' };
    } else {
      checks.tombstone = { status: 'TOMBSTONE_API_URL not set' };
    }
  } catch (err: any) {
    checks.tombstone = { status: 'error', error: err?.message?.substring(0, 200) };
  }

  const allOk = checks.database?.status === 'connected' && checks.analysisTable?.status === 'ok';

  return NextResponse.json({
    healthy: allOk,
    timestamp: new Date().toISOString(),
    checks,
  }, { status: allOk ? 200 : 503 });
}
