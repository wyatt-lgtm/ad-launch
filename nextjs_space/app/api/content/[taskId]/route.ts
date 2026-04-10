export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';

const TOMBSTONE_URL = process.env.TOMBSTONE_API_URL ?? 'https://tombstone-api-xjc4.onrender.com';

export async function GET(
  _request: Request,
  { params }: { params: { taskId: string } }
) {
  try {
    const { taskId } = params;
    const res = await fetch(`${TOMBSTONE_URL}/content/${taskId}`, {
      headers: { 'Accept': 'application/json' },
      cache: 'no-store',
    });
    if (!res.ok) {
      return NextResponse.json(
        { error: `Content ${taskId} not found` },
        { status: res.status }
      );
    }
    const data = await res.json();
    return NextResponse.json(data);
  } catch (e: any) {
    console.error(`[content/${params.taskId}] Error:`, e.message);
    return NextResponse.json({ error: 'Content detail unavailable' }, { status: 502 });
  }
}

/* ── PUT — save draft edits back to Tombstone ─────────────────────────────── */

export async function PUT(
  request: Request,
  { params }: { params: { taskId: string } }
) {
  try {
    const { taskId } = params;
    const body = await request.json();
    const outboundUrl = `${TOMBSTONE_URL}/content/${taskId}`;

    const res = await fetch(outboundUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const resText = await res.text();

    if (!res.ok) {
      return NextResponse.json(
        { error: `Failed to save edits (${res.status})` },
        { status: res.status }
      );
    }

    // Parse the successful response text as JSON
    let data;
    try {
      data = JSON.parse(resText);
    } catch {
      data = { raw: resText };
    }
    return NextResponse.json(data);
  } catch (e: any) {
    console.error(`[content/${params.taskId}] PUT error:`, e.message);
    return NextResponse.json({ error: 'Save failed — backend unavailable' }, { status: 502 });
  }
}
