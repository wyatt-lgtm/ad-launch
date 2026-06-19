/**
 * Access control utilities for Creative Asset Library.
 * Enforces that only registered owners/admins can manage business assets.
 */

import { prisma } from './db';
import { getServerSession } from 'next-auth';
import { authOptions } from './auth-options';

export interface AssetAccessResult {
  authorized: boolean;
  userId?: string;
  businessId?: string;
  error?: string;
  statusCode?: number;
}

/**
 * Verify that the current session user is a registered owner/admin of the business.
 * Returns authorization result with user and business IDs if authorized.
 *
 * Rules:
 * - Business must exist
 * - Business must have a userId (not anonymous/provisional)
 * - Current user must be the business owner OR an admin
 * - anonymousToken presence alone is NOT sufficient
 * - tombstoneBusinessId alone is NOT sufficient
 */
export async function verifyAssetAccess(businessId: string): Promise<AssetAccessResult> {
  const session = await getServerSession(authOptions);

  if (!session?.user?.email) {
    return { authorized: false, error: 'Authentication required. Please log in.', statusCode: 401 };
  }

  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, role: true },
  });

  if (!user) {
    return { authorized: false, error: 'User not found.', statusCode: 401 };
  }

  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: { id: true, userId: true, tombstoneBusinessId: true, tombstoneBusinessUuid: true },
  });

  if (!business) {
    return { authorized: false, error: 'Business not found.', statusCode: 404 };
  }

  // Business must be claimed by a registered user (userId not null)
  if (!business.userId) {
    return {
      authorized: false,
      error: 'Creative Assets are only available for registered businesses. Please register and claim this business first.',
      statusCode: 403,
    };
  }

  // User must be the owner OR an admin
  const isOwner = business.userId === user.id;
  const isAdmin = user.role === 'admin';

  if (!isOwner && !isAdmin) {
    return {
      authorized: false,
      error: 'You do not have permission to manage assets for this business.',
      statusCode: 403,
    };
  }

  return {
    authorized: true,
    userId: user.id,
    businessId: business.id,
  };
}

/**
 * Check if a business is eligible for Creative Assets (read-only check, no session required).
 * Used by the frontend to determine whether to show the Creative Assets tab.
 */
export async function isBusinessAssetEligible(businessId: string, userId?: string): Promise<boolean> {
  if (!businessId || !userId) return false;

  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: { userId: true },
  });

  if (!business || !business.userId) return false;

  // Only the owner or admin sees creative assets
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true },
  });

  return business.userId === userId || user?.role === 'admin';
}
