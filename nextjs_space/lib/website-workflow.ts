/**
 * Two-Stage Website Workflow — shared state model + helpers.
 *
 * The website has TWO independent state machines that live on a single
 * WebsiteProject record:
 *   - Concept stage  (existing 8-step Tombstone concept workflow)
 *   - Production stage (multi-page SEO build, gated behind concept approval)
 *
 * Concept records (WebsiteConcept) and Production records (WebsiteProduction
 * + WebsitePage + WebsiteSection + WebsiteAsset) are kept fully separate so a
 * concept revision can never overwrite generated production pages.
 */

import { prisma } from '@/lib/db';

// ── Stage ─────────────────────────────────────────────────────────────
export const WEBSITE_STAGE = {
  CONCEPT: 'concept',
  PRODUCTION: 'production',
} as const;
export type WebsiteStage = (typeof WEBSITE_STAGE)[keyof typeof WEBSITE_STAGE];

// ── Concept status ────────────────────────────────────────────────────
export const CONCEPT_STATUS = {
  NOT_STARTED: 'not_started',
  GENERATING: 'generating',
  READY_FOR_REVIEW: 'ready_for_review',
  REVISION_REQUESTED: 'revision_requested',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  ARCHIVED: 'archived',
} as const;
export type ConceptStatus = (typeof CONCEPT_STATUS)[keyof typeof CONCEPT_STATUS];

// ── Production status ─────────────────────────────────────────────────
export const PRODUCTION_STATUS = {
  NOT_STARTED: 'not_started',
  WAITING_FOR_CONCEPT_APPROVAL: 'waiting_for_concept_approval',
  PLANNING: 'planning',
  GENERATING: 'generating',
  QA_PENDING: 'qa_pending',
  QA_FAILED: 'qa_failed',
  READY_FOR_REVIEW: 'ready_for_review',
  APPROVED: 'approved',
  PUBLISHED: 'published',
  ARCHIVED: 'archived',
} as const;
export type ProductionStatus =
  (typeof PRODUCTION_STATUS)[keyof typeof PRODUCTION_STATUS];

/**
 * Production generation can ONLY start when the concept has been approved,
 * unless an admin override is supplied. This is the hard gating rule.
 */
export function canStartProduction(
  conceptStatus: string,
  opts?: { adminOverride?: boolean },
): boolean {
  if (opts?.adminOverride) return true;
  return conceptStatus === CONCEPT_STATUS.APPROVED;
}

/**
 * Resolve the current user + verify they own the given business.
 * Returns { user, business, isAdmin } or null when not authorized.
 */
export async function resolveBusinessAccess(
  email: string | null | undefined,
  businessId: string,
): Promise<{
  user: { id: string; role: string | null };
  isAdmin: boolean;
} | null> {
  if (!email || !businessId) return null;
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, role: true },
  });
  if (!user) return null;
  const business = await prisma.business.findFirst({
    where: { id: businessId, userId: user.id },
    select: { id: true },
  });
  const isAdmin = (user.role || '').toLowerCase() === 'admin';
  // Admins may act on any business; owners only on their own.
  if (!business && !isAdmin) return null;
  return { user: { id: user.id, role: user.role }, isAdmin };
}

/**
 * Ensure a WebsiteProject exists for the business. Idempotent — returns the
 * existing project or creates a fresh one in the default (not_started) state.
 */
export async function ensureWebsiteProject(businessId: string) {
  const existing = await prisma.websiteProject.findFirst({
    where: { businessId },
    orderBy: { createdAt: 'asc' },
  });
  if (existing) return existing;
  return prisma.websiteProject.create({
    data: {
      businessId,
      currentStage: WEBSITE_STAGE.CONCEPT,
      conceptStatus: CONCEPT_STATUS.NOT_STARTED,
      productionStatus: PRODUCTION_STATUS.NOT_STARTED,
    },
  });
}
