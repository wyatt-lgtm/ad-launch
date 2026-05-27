export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';

const TOMBSTONE_URL = process.env.TOMBSTONE_API_URL ?? 'https://tombstone-api-xjc4.onrender.com';

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || (session.user as any)?.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const endpoint = searchParams.get('endpoint') || '';

  // Allowed endpoints
  const ALLOWED = [
    /^\/business-memory\/[\w-]+$/,
    /^\/industry-playbooks$/,
    /^\/industry-playbooks\/[\w-]+$/,
    /^\/feedback-events\/[\w-]+$/,
    /^\/local-intelligence\/[\w-]+$/,
  ];

  if (!ALLOWED.some(r => r.test(endpoint))) {
    return NextResponse.json({ error: 'Invalid endpoint' }, { status: 400 });
  }

  try {
    const res = await fetch(`${TOMBSTONE_URL}${endpoint}`, {
      headers: { 'Content-Type': 'application/json' },
      cache: 'no-store',
    });
    const data = await res.json();
    return NextResponse.json(data);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || (session.user as any)?.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const endpoint = searchParams.get('endpoint') || '';

  const ALLOWED_POST = [
    /^\/seed-playbooks$/,
    /^\/feedback-events$/,
  ];

  if (!ALLOWED_POST.some(r => r.test(endpoint))) {
    return NextResponse.json({ error: 'Invalid endpoint' }, { status: 400 });
  }

  try {
    const body = await req.json();
    const res = await fetch(`${TOMBSTONE_URL}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    return NextResponse.json(data);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
