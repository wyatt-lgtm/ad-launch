export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getTradeAreaItems, getItemsByRadius, generateContentBrief } from '@/lib/rss/trade-area-feed';
import type { TradeAreaRequest } from '@/lib/rss/types';

/**
 * POST /api/rss/trade-area
 *
 * Clark Kent's primary endpoint. Returns safe, fresh, geo-relevant RSS items
 * for a business's trade area.
 *
 * Body options:
 *   { zip: "80202", radius: 25 }                          → radius query
 *   { zips: ["80202", "80203"], days: 3, limit: 20 }      → direct ZIP list
 *   { cities: ["Denver, CO"], sourceTypes: ["local_news"] } → city query
 *   { counties: ["El Paso, CO"] }                          → county query
 *   { zip: "80202", radius: 25, brief: true }              → full content brief
 *
 * All queries return only filterStatus='approved' items from active feeds.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    // ── Content Brief mode ─────────────────────────────────────────────
    if (body.brief && body.zip) {
      const brief = await generateContentBrief(
        body.zip,
        body.radius ?? 25,
        {
          days: body.days ?? 3,
          sourceTypes: body.sourceTypes,
          excludeUsed: body.excludeUsed ?? false,
          excludeInferred: body.excludeInferred ?? false,
          minConfidence: body.minConfidence ?? 0.3,
        },
      );
      return NextResponse.json(brief);
    }

    // ── Radius mode (shorthand) ────────────────────────────────────────
    if (body.zip && body.radius) {
      const result = await getItemsByRadius(
        body.zip,
        body.radius,
        {
          limit: body.limit ?? 30,
          days: body.days ?? 7,
          sourceTypes: body.sourceTypes,
          excludeUsed: body.excludeUsed ?? false,
          excludeInferred: body.excludeInferred ?? false,
          minConfidence: body.minConfidence ?? 0.3,
        },
      );
      return NextResponse.json(result);
    }

    // ── Full trade area query ───────────────────────────────────────────
    const request: TradeAreaRequest = {
      zips: body.zips ?? (body.zip ? [body.zip] : undefined),
      cities: body.cities,
      counties: body.counties,
      states: body.states,
      limit: body.limit ?? 30,
      days: body.days ?? 7,
      sourceTypes: body.sourceTypes,
      minConfidence: body.minConfidence ?? 0.3,
      excludeInferred: body.excludeInferred ?? false,
      excludeUsed: body.excludeUsed ?? false,
    };

    const result = await getTradeAreaItems(request);
    return NextResponse.json(result);

  } catch (err: any) {
    console.error('[trade-area] Error:', err);
    return NextResponse.json(
      { error: 'Trade area query failed', detail: err.message },
      { status: 500 },
    );
  }
}

/**
 * GET /api/rss/trade-area?zip=80202&radius=25&days=7&limit=20
 *
 * Convenience GET endpoint for simple radius queries.
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const zip = searchParams.get('zip');
    if (!zip) {
      return NextResponse.json({ error: 'zip parameter required' }, { status: 400 });
    }

    const radius = parseInt(searchParams.get('radius') ?? '25', 10);
    const days = parseInt(searchParams.get('days') ?? '7', 10);
    const limit = parseInt(searchParams.get('limit') ?? '20', 10);
    const brief = searchParams.get('brief') === 'true';

    if (brief) {
      const briefResult = await generateContentBrief(zip, radius, { days, limit });
      return NextResponse.json(briefResult);
    }

    const result = await getItemsByRadius(zip, radius, { days, limit });
    return NextResponse.json(result);

  } catch (err: any) {
    console.error('[trade-area] GET Error:', err);
    return NextResponse.json(
      { error: 'Trade area query failed', detail: err.message },
      { status: 500 },
    );
  }
}
