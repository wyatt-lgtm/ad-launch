// @ts-nocheck
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-guard';
import { prisma } from '@/lib/db';

export async function GET(req: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.authorized) return auth.response;

  const url = new URL(req.url);
  const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') || '50')));

  const resets = await prisma.passwordResetToken.findMany({
    select: {
      id: true,
      // NEVER return the actual token
      userId: true,
      expiresAt: true,
      used: true,
      createdAt: true,
      user: {
        select: { email: true },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });

  const now = new Date();
  const items = resets.map(r => ({
    id: r.id,
    userEmail: r.user.email,
    requestedAt: r.createdAt.toISOString(),
    expiresAt: r.expiresAt.toISOString(),
    used: r.used,
    expired: r.expiresAt < now && !r.used,
    status: r.used ? 'used' : r.expiresAt < now ? 'expired' : 'active',
  }));

  return NextResponse.json({ resets: items, total: items.length });
}
