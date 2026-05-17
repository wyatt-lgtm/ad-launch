/**
 * Server-side admin guard for API routes.
 * Use as a double-check inside each /api/admin/* route handler
 * (middleware already protects, but defense-in-depth).
 */
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { NextResponse } from 'next/server';

export async function requireAdmin(): Promise<
  { authorized: true; userId: string } | { authorized: false; response: NextResponse }
> {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return { authorized: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }
  if ((session.user as any).role !== 'admin') {
    return { authorized: false, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  }
  return { authorized: true, userId: (session.user as any).id };
}
