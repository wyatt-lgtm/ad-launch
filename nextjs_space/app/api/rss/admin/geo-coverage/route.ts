// @ts-nocheck
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getGeoCoverageReport, discoverValidateAndLink, backfillFeedGeo } from '@/lib/rss/geo-linker';

/**
 * GET /api/rss/admin/geo-coverage?zip=14203&city=BUFFALO&state=NY
 *   Show feed coverage by location.
 *   Show active feeds with and without FeedGeo.
 *   Show locations with zero feed coverage.
 *   Show recent discovery attempts and failures.
 *
 * POST /api/rss/admin/geo-coverage
 *   { action: 'discover', zip?, city?, county?, state? }
 *   { action: 'backfill', dryRun?, limit?, state? }
 *   Manual trigger for feed discovery/backfill.
 */

export async function GET(req: NextRequest) {
  try {
    // Auth check: require ADMIN_API_KEY header
    const apiKey = req.headers.get('x-api-key') || req.headers.get('authorization')?.replace('Bearer ', '');
    if (apiKey !== process.env.ADMIN_API_KEY) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const zip = searchParams.get('zip') || undefined;
    const city = searchParams.get('city') || undefined;
    const county = searchParams.get('county') || undefined;
    const state = searchParams.get('state') || undefined;

    const report = await getGeoCoverageReport(
      (zip || city || state) ? { zip, city, county, state } : undefined
    );

    return NextResponse.json(report);
  } catch (error: any) {
    console.error('Geo coverage report error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    // Auth check
    const apiKey = req.headers.get('x-api-key') || req.headers.get('authorization')?.replace('Bearer ', '');
    if (apiKey !== process.env.ADMIN_API_KEY) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { action } = body;

    if (action === 'discover') {
      const { zip, city, county, state } = body;
      if (!city && !state && !zip) {
        return NextResponse.json({ error: 'At least zip, city, or state is required' }, { status: 400 });
      }

      const result = await discoverValidateAndLink({ zip, city, county, state });
      return NextResponse.json({
        action: 'discover',
        location: { zip, city, county, state },
        result,
      });
    }

    if (action === 'backfill') {
      const { dryRun = false, limit = 100, state } = body;
      const result = await backfillFeedGeo({ dryRun, limit, state });
      return NextResponse.json({
        action: 'backfill',
        dryRun,
        result,
      });
    }

    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (error: any) {
    console.error('Geo coverage action error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
