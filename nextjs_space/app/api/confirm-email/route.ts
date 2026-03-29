export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const token = searchParams.get('token');
    if (!token) {
      return NextResponse.json({ error: 'Token is required' }, { status: 400 });
    }
    const user = await prisma.user.findFirst({ where: { confirmationToken: token } });
    if (!user) {
      return NextResponse.json({ error: 'Invalid or expired confirmation token' }, { status: 400 });
    }
    await prisma.user.update({
      where: { id: user.id },
      data: { confirmed: true, confirmationToken: null },
    });
    return NextResponse.json({ success: true, email: user.email, userId: user.id });
  } catch (err: any) {
    console.error('Confirm email error:', err);
    return NextResponse.json({ error: 'Confirmation failed' }, { status: 500 });
  }
}
