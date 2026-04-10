export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';

const TOMBSTONE_URL = process.env.TOMBSTONE_API_URL ?? 'https://tombstone-api-xjc4.onrender.com';

export async function POST(
  request: Request,
  { params }: { params: { taskId: string } }
) {
  try {
    const { taskId } = params;
    const body = await request.json();
    const outboundUrl = `${TOMBSTONE_URL}/publish/${taskId}`;

    const res = await fetch(outboundUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const resText = await res.text();

    if (!res.ok) {
      let errMsg = `Publish failed (${res.status})`;
      try {
        const errData = JSON.parse(resText);
        errMsg = errData.detail || errData.error || errMsg;
      } catch {}
      return NextResponse.json({ error: errMsg }, { status: res.status });
    }

    let data;
    try {
      data = JSON.parse(resText);
    } catch {
      data = { raw: resText };
    }
    return NextResponse.json(data);
  } catch (e: any) {
    console.error(`[publish/${params.taskId}] POST error:`, e.message);
    return NextResponse.json({ error: 'Publish failed — backend unavailable' }, { status: 502 });
  }
}
