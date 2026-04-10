export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';

const TOMBSTONE_URL = process.env.TOMBSTONE_API_URL ?? 'https://tombstone-api-xjc4.onrender.com';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = searchParams.get('limit') || '50';
    const res = await fetch(`${TOMBSTONE_URL}/content/queue?limit=${limit}`, {
      headers: { 'Accept': 'application/json' },
      cache: 'no-store',
    });
    if (!res.ok) {
      return NextResponse.json({ error: 'Failed to fetch content queue' }, { status: res.status });
    }
    const data = await res.json();
    return NextResponse.json(data);
  } catch (e: any) {
    console.error('[content/queue] Error:', e.message);
    return NextResponse.json({ error: 'Content queue unavailable' }, { status: 502 });
  }
}
