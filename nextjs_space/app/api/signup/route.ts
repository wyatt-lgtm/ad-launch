export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';

const BLOCKED_DOMAINS = ['gmail.com', 'yahoo.com', 'rocketmail.com', 'hotmail.com', 'outlook.com', 'aol.com', 'mail.com', 'protonmail.com', 'icloud.com', 'yandex.com'];

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, password } = body ?? {};
    if (!email || !password) {
      return NextResponse.json({ error: 'Email and password required' }, { status: 400 });
    }
    const domain = email?.split('@')?.[1]?.toLowerCase?.() ?? '';
    if (BLOCKED_DOMAINS.includes(domain)) {
      return NextResponse.json({ error: 'Please use a business email address. Free email providers (Gmail, Yahoo, etc.) are not allowed.' }, { status: 400 });
    }
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return NextResponse.json({ error: 'Account already exists' }, { status: 400 });
    }
    const hashed = await bcrypt.hash(password, 10);
    const confirmationToken = crypto.randomBytes(32).toString('hex');
    const user = await prisma.user.create({
      data: { email, password: hashed, confirmationToken },
    });
    return NextResponse.json({ id: user.id, email: user.email, confirmationToken }, { status: 201 });
  } catch (err: any) {
    console.error('Signup error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
