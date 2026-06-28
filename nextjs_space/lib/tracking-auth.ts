/**
 * Shared business-access resolver for tracking-pixel APIs.
 * Ensures the authenticated user owns the business (or is an admin) before
 * any tracking config is read or written. Prevents cross-business leakage.
 */
import { NextRequest } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';

export async function resolveBusinessAccess(
  _req: NextRequest,
  businessId: string
): Promise<
  | { error: string; status: 401 | 404 }
  | { user: { id: string; role: string | null }; business: { id: string; businessName: string | null } }
> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return { error: 'Unauthorized', status: 401 };
  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, role: true },
  });
  if (!user) return { error: 'Unauthorized', status: 401 };
  const business = await prisma.business.findFirst({
    where: user.role === 'admin' ? { id: businessId } : { id: businessId, userId: user.id },
    select: { id: true, businessName: true },
  });
  if (!business) return { error: 'Business not found', status: 404 };
  return { user, business };
}
