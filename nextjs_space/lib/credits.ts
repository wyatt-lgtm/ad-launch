/**
 * Credit System Service — Lot-based with Expiration
 *
 * All credit mutations are transactional.
 * Idempotency keys prevent double-charges.
 * Credits are tracked in CreditLot buckets and consumed FIFO (earliest-expiring first).
 * Balance can never go negative (unless admin override).
 */
import { prisma } from '@/lib/db';
import { Prisma } from '@prisma/client';

// ─── Constants ────────────────────────────────────────────────────

export const CREDIT_COSTS = {
  IMAGE_POST: 1,
  VIDEO_UPGRADE: 3,
} as const;

export const DEFAULT_MONTHLY_ALLOWANCE = 6;

/** Days until starter/monthly credits expire after grant. */
export const GRANT_EXPIRY_DAYS = 60;

/** Days until purchased credits expire after account closure. */
export const CLOSURE_EXPIRY_DAYS = 30;

/** Days threshold for "expiring soon" warning. */
export const EXPIRING_SOON_DAYS = 14;

export const RECHARGE_PACKS = [
  { id: 'pack_6', credits: 6, priceUsd: 9.99, label: '6 Credits', active: false },
] as const;

// ─── Types ────────────────────────────────────────────────────────

export type TransactionType =
  | 'monthly_grant'
  | 'admin_grant'
  | 'starter_grant'
  | 'image_post_charge'
  | 'video_upgrade_charge'
  | 'recharge_grant'
  | 'refund'
  | 'adjustment'
  | 'failed_generation_refund'
  | 'recharge_pending'
  | 'credit_expired';

export type CreditLotType = 'starter' | 'monthly' | 'recharge' | 'admin' | 'refund';

export interface CreditCheckResult {
  allowed: boolean;
  balance: number;
  required: number;
  shortfall: number;
  accountId: string | null;
}

export interface ChargeResult {
  success: boolean;
  transactionId: string | null;
  balanceAfter: number;
  error?: string;
  alreadyCharged?: boolean;
  lotId?: string;
}

// ─── Expiration Helpers ──────────────────────────────────────────

/** Check if a credit lot is effectively expired. */
export function isLotExpired(lot: { expiresAt: Date | null; closureExpiresAt: Date | null }, now: Date = new Date()): boolean {
  if (lot.expiresAt && lot.expiresAt < now) return true;
  if (lot.closureExpiresAt && lot.closureExpiresAt < now) return true;
  return false;
}

/** Get effective expiration date for a lot (earliest of expiresAt and closureExpiresAt). */
export function effectiveExpiration(lot: { expiresAt: Date | null; closureExpiresAt: Date | null }): Date | null {
  if (lot.expiresAt && lot.closureExpiresAt) {
    return lot.expiresAt < lot.closureExpiresAt ? lot.expiresAt : lot.closureExpiresAt;
  }
  return lot.expiresAt || lot.closureExpiresAt;
}

/** Calculate available balance from non-expired lots. */
export async function getAvailableBalance(businessId: string, now: Date = new Date()): Promise<number> {
  const lots = await prisma.creditLot.findMany({
    where: { businessId, remainingAmount: { gt: 0 } },
  });
  return lots.reduce((sum, lot) => {
    if (isLotExpired(lot, now)) return sum;
    return sum + lot.remainingAmount;
  }, 0);
}

/**
 * Expire all effectively expired lots for a business.
 * Creates credit_expired transactions. Idempotent.
 */
export async function expireCreditsForBusiness(businessId: string): Promise<{
  expiredLots: number;
  expiredCredits: number;
}> {
  const now = new Date();
  const lots = await prisma.creditLot.findMany({
    where: { businessId, remainingAmount: { gt: 0 } },
  });

  let expiredLots = 0;
  let expiredCredits = 0;

  for (const lot of lots) {
    if (!isLotExpired(lot, now)) continue;
    if (lot.remainingAmount <= 0) continue;

    const idempotencyKey = `credit-expired:${lot.id}`;

    try {
      await prisma.$transaction(async (tx) => {
        // Double-check idempotency
        const existing = await tx.creditTransaction.findUnique({ where: { idempotencyKey } });
        if (existing) return; // already expired

        // Re-read lot inside transaction
        const freshLot = await tx.creditLot.findUnique({ where: { id: lot.id } });
        if (!freshLot || freshLot.remainingAmount <= 0) return;
        if (!isLotExpired(freshLot, now)) return;

        const amount = freshLot.remainingAmount;
        await tx.creditLot.update({ where: { id: lot.id }, data: { remainingAmount: 0 } });

        const account = await tx.creditAccount.findUnique({ where: { businessId } });
        if (!account) return;

        // Recalculate available balance from remaining lots
        const allLots = await tx.creditLot.findMany({
          where: { businessId, remainingAmount: { gt: 0 }, id: { not: lot.id } },
        });
        const newBalance = allLots.reduce((sum, l) => {
          if (isLotExpired(l, now)) return sum;
          return sum + l.remainingAmount;
        }, 0);

        await tx.creditAccount.update({
          where: { id: account.id },
          data: { creditBalance: newBalance },
        });

        const isClosureExpiry = lot.closureExpiresAt && lot.closureExpiresAt < now;
        const reason = isClosureExpiry
          ? 'Purchased credits expired 30 days after account closure'
          : `Credits expired ${GRANT_EXPIRY_DAYS} days after grant`;

        await tx.creditTransaction.create({
          data: {
            creditAccountId: account.id,
            businessId,
            transactionType: 'credit_expired',
            amount: -amount,
            balanceAfter: newBalance,
            reason,
            idempotencyKey,
            relatedCreditLotId: lot.id,
            expiresAt: effectiveExpiration(freshLot),
            metadata: {
              creditType: lot.creditType,
              lotId: lot.id,
              originalAmount: lot.originalAmount,
              expiredAmount: amount,
            },
          },
        });

        expiredLots++;
        expiredCredits += amount;
      });
    } catch (err: any) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        // Idempotent — already expired
        continue;
      }
      console.error(`[credits] Failed to expire lot ${lot.id}:`, err.message);
    }
  }

  return { expiredLots, expiredCredits };
}

// ─── Account Management ──────────────────────────────────────────

/** Get or create a CreditAccount for a business. */
export async function getOrCreateCreditAccount(businessId: string) {
  let account = await prisma.creditAccount.findUnique({ where: { businessId } });
  if (!account) {
    account = await prisma.creditAccount.create({
      data: {
        businessId,
        creditBalance: 0,
        monthlyCreditAllowance: DEFAULT_MONTHLY_ALLOWANCE,
        creditPlanName: 'starter',
        creditStatus: 'active',
      },
    });
  }
  return account;
}

/** Get credit balance for a business with expiration info. */
export async function getCreditBalance(businessId: string): Promise<{
  balance: number;
  availableCredits: number;
  expiringSoonCredits: number;
  nextExpirationDate: string | null;
  monthlyAllowance: number;
  planName: string;
  status: string;
  renewAt: Date | null;
  accountId: string | null;
  accountClosedAt: string | null;
  creditClosureExpiresAt: string | null;
}> {
  const now = new Date();
  const account = await prisma.creditAccount.findUnique({ where: { businessId } });

  if (!account) {
    return {
      balance: 0,
      availableCredits: 0,
      expiringSoonCredits: 0,
      nextExpirationDate: null,
      monthlyAllowance: DEFAULT_MONTHLY_ALLOWANCE,
      planName: 'starter',
      status: 'no_account',
      renewAt: null,
      accountId: null,
      accountClosedAt: null,
      creditClosureExpiresAt: null,
    };
  }

  // Expire before calculating
  await expireCreditsForBusiness(businessId);

  // Get active (non-expired) lots
  const lots = await prisma.creditLot.findMany({
    where: { businessId, remainingAmount: { gt: 0 } },
  });

  const activeLots = lots.filter(l => !isLotExpired(l, now));
  const availableCredits = activeLots.reduce((sum, l) => sum + l.remainingAmount, 0);

  // Expiring soon: within 14 days
  const soonThreshold = new Date(now.getTime() + EXPIRING_SOON_DAYS * 24 * 60 * 60 * 1000);
  let expiringSoonCredits = 0;
  let nextExpirationDate: Date | null = null;

  for (const lot of activeLots) {
    const eff = effectiveExpiration(lot);
    if (eff && eff <= soonThreshold) {
      expiringSoonCredits += lot.remainingAmount;
    }
    if (eff && (!nextExpirationDate || eff < nextExpirationDate)) {
      nextExpirationDate = eff;
    }
  }

  // Sync account balance to actual available
  if (account.creditBalance !== availableCredits) {
    await prisma.creditAccount.update({
      where: { id: account.id },
      data: { creditBalance: availableCredits },
    });
  }

  return {
    balance: availableCredits,
    availableCredits,
    expiringSoonCredits,
    nextExpirationDate: nextExpirationDate?.toISOString() || null,
    monthlyAllowance: account.monthlyCreditAllowance,
    planName: account.creditPlanName || 'starter',
    status: account.creditStatus,
    renewAt: account.creditsRenewAt,
    accountId: account.id,
    accountClosedAt: account.accountClosedAt?.toISOString() || null,
    creditClosureExpiresAt: account.creditClosureExpiresAt?.toISOString() || null,
  };
}

// ─── Credit Checks ───────────────────────────────────────────────

/** Check if a business has enough credits for an operation. */
export async function checkCredits(
  businessId: string,
  requiredCredits: number,
): Promise<CreditCheckResult> {
  // Expire first
  await expireCreditsForBusiness(businessId);
  const balance = await getAvailableBalance(businessId);
  const account = await prisma.creditAccount.findUnique({ where: { businessId } });
  const shortfall = Math.max(0, requiredCredits - balance);
  return {
    allowed: balance >= requiredCredits,
    balance,
    required: requiredCredits,
    shortfall,
    accountId: account?.id ?? null,
  };
}

/** Check credits + count active generating packages (concurrency guard). */
export async function canStartGeneration(
  businessId: string,
  creditCost: number = CREDIT_COSTS.IMAGE_POST,
): Promise<CreditCheckResult & { activeGenerating: number }> {
  const creditCheck = await checkCredits(businessId, creditCost);
  const activeGenerating = await prisma.postPackage.count({
    where: { businessId, status: 'generating' },
  });
  return { ...creditCheck, activeGenerating };
}

// ─── FIFO Lot Consumption ────────────────────────────────────────

/**
 * Consume credits from lots in FIFO order (earliest effective expiration first,
 * non-expiring recharge lots last). All within a Prisma transaction.
 */
async function consumeLotsInTransaction(
  tx: Prisma.TransactionClient,
  businessId: string,
  amount: number,
  now: Date = new Date(),
): Promise<{ consumed: Array<{ lotId: string; amount: number }>; totalConsumed: number }> {
  const lots = await tx.creditLot.findMany({
    where: { businessId, remainingAmount: { gt: 0 } },
    orderBy: { grantedAt: 'asc' },
  });

  // Partition: lots with expiration first (sorted by effective date), then non-expiring
  const expiringLots: typeof lots = [];
  const nonExpiringLots: typeof lots = [];
  for (const lot of lots) {
    if (isLotExpired(lot, now)) continue; // skip expired
    const eff = effectiveExpiration(lot);
    if (eff) {
      expiringLots.push(lot);
    } else {
      nonExpiringLots.push(lot);
    }
  }
  expiringLots.sort((a, b) => {
    const ea = effectiveExpiration(a)!;
    const eb = effectiveExpiration(b)!;
    return ea.getTime() - eb.getTime();
  });

  const orderedLots = [...expiringLots, ...nonExpiringLots];
  const consumed: Array<{ lotId: string; amount: number }> = [];
  let remaining = amount;

  for (const lot of orderedLots) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, lot.remainingAmount);
    await tx.creditLot.update({
      where: { id: lot.id },
      data: { remainingAmount: lot.remainingAmount - take },
    });
    consumed.push({ lotId: lot.id, amount: take });
    remaining -= take;
  }

  return { consumed, totalConsumed: amount - remaining };
}

// ─── Credit Mutations (all transactional) ────────────────────────

/**
 * Charge credits for a completed post package.
 * Consumes from lots FIFO. Idempotent.
 */
export async function chargeForPostPackage(
  businessId: string,
  postPackageId: string,
  userId: string | null,
  chargeType: 'image_post_charge' | 'video_upgrade_charge' = 'image_post_charge',
): Promise<ChargeResult> {
  const cost = chargeType === 'video_upgrade_charge' ? CREDIT_COSTS.VIDEO_UPGRADE : CREDIT_COSTS.IMAGE_POST;
  const idempotencyKey = chargeType === 'video_upgrade_charge'
    ? `credit-charge:video:${postPackageId}`
    : `credit-charge:image-post:${postPackageId}`;

  // Check idempotency first (fast path)
  const existing = await prisma.creditTransaction.findUnique({ where: { idempotencyKey } });
  if (existing) {
    return {
      success: true,
      transactionId: existing.id,
      balanceAfter: existing.balanceAfter,
      alreadyCharged: true,
    };
  }

  // Expire before charging
  await expireCreditsForBusiness(businessId);

  try {
    const now = new Date();
    const result = await prisma.$transaction(async (tx) => {
      const account = await tx.creditAccount.findUnique({ where: { businessId } });
      if (!account) throw new Error('NO_ACCOUNT');

      // Check available balance from lots
      const availLots = await tx.creditLot.findMany({
        where: { businessId, remainingAmount: { gt: 0 } },
      });
      const available = availLots.reduce((sum, l) => {
        if (isLotExpired(l, now)) return sum;
        return sum + l.remainingAmount;
      }, 0);
      if (available < cost) throw new Error('INSUFFICIENT_CREDITS');

      // Consume from lots
      const { consumed } = await consumeLotsInTransaction(tx, businessId, cost, now);

      // Recalculate new balance
      const newLots = await tx.creditLot.findMany({
        where: { businessId, remainingAmount: { gt: 0 } },
      });
      const newBalance = newLots.reduce((sum, l) => {
        if (isLotExpired(l, now)) return sum;
        return sum + l.remainingAmount;
      }, 0);

      await tx.creditAccount.update({
        where: { id: account.id },
        data: { creditBalance: newBalance },
      });

      const txn = await tx.creditTransaction.create({
        data: {
          creditAccountId: account.id,
          businessId,
          userId,
          postPackageId,
          transactionType: chargeType,
          amount: -cost,
          balanceAfter: newBalance,
          reason: `${chargeType === 'video_upgrade_charge' ? 'Video upgrade' : 'Image post'} package`,
          idempotencyKey,
          metadata: { consumedLots: consumed },
        },
      });

      await tx.postPackage.update({
        where: { id: postPackageId },
        data: {
          creditChargedAt: new Date(),
          creditCost: cost,
          creditTransactionId: txn.id,
        },
      });

      return { transactionId: txn.id, balanceAfter: newBalance };
    });

    return { success: true, ...result };
  } catch (err: any) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const existing2 = await prisma.creditTransaction.findUnique({ where: { idempotencyKey } });
      return {
        success: true,
        transactionId: existing2?.id ?? null,
        balanceAfter: existing2?.balanceAfter ?? 0,
        alreadyCharged: true,
      };
    }
    return {
      success: false,
      transactionId: null,
      balanceAfter: 0,
      error: err.message === 'INSUFFICIENT_CREDITS' ? 'Insufficient credits' :
             err.message === 'NO_ACCOUNT' ? 'No credit account' : err.message,
    };
  }
}

/** Refund credits for a failed/rejected post package. Creates a refund lot. */
export async function refundPostPackage(
  businessId: string,
  postPackageId: string,
  userId: string | null,
  reason: string = 'Generation failed — credits refunded',
): Promise<ChargeResult> {
  const idempotencyKey = `credit-refund:${postPackageId}`;

  const existing = await prisma.creditTransaction.findUnique({ where: { idempotencyKey } });
  if (existing) {
    return { success: true, transactionId: existing.id, balanceAfter: existing.balanceAfter, alreadyCharged: true };
  }

  const originalCharge = await prisma.creditTransaction.findFirst({
    where: { postPackageId, amount: { lt: 0 } },
    orderBy: { createdAt: 'desc' },
  });
  if (!originalCharge) {
    return { success: true, transactionId: null, balanceAfter: 0, error: 'No charge to refund' };
  }

  const refundAmount = Math.abs(originalCharge.amount);

  try {
    const result = await prisma.$transaction(async (tx) => {
      const account = await tx.creditAccount.findUnique({ where: { businessId } });
      if (!account) throw new Error('NO_ACCOUNT');

      // Create refund lot — inherits expiration from the original charge's consumed lots if possible
      const chargeMetadata = originalCharge.metadata as any;
      const consumedLots = chargeMetadata?.consumedLots as Array<{ lotId: string }> | undefined;
      let refundExpiresAt: Date | null = null;
      if (consumedLots?.length) {
        const originalLot = await tx.creditLot.findUnique({ where: { id: consumedLots[0].lotId } });
        if (originalLot) {
          refundExpiresAt = effectiveExpiration(originalLot);
        }
      }

      const lot = await tx.creditLot.create({
        data: {
          businessId,
          creditAccountId: account.id,
          creditType: 'refund',
          originalAmount: refundAmount,
          remainingAmount: refundAmount,
          expiresAt: refundExpiresAt,
          metadata: { refundedPostPackageId: postPackageId },
        },
      });

      const now = new Date();
      const allLots = await tx.creditLot.findMany({
        where: { businessId, remainingAmount: { gt: 0 } },
      });
      const newBalance = allLots.reduce((sum, l) => {
        if (isLotExpired(l, now)) return sum;
        return sum + l.remainingAmount;
      }, 0);

      await tx.creditAccount.update({
        where: { id: account.id },
        data: { creditBalance: newBalance },
      });

      const txn = await tx.creditTransaction.create({
        data: {
          creditAccountId: account.id,
          businessId,
          userId,
          postPackageId,
          transactionType: 'failed_generation_refund',
          amount: refundAmount,
          balanceAfter: newBalance,
          reason,
          idempotencyKey,
          creditLotId: lot.id,
          expiresAt: refundExpiresAt,
        },
      });

      await tx.creditLot.update({ where: { id: lot.id }, data: { sourceTransactionId: txn.id } });

      await tx.postPackage.update({
        where: { id: postPackageId },
        data: { creditChargedAt: null, creditCost: 0, creditTransactionId: null },
      });

      return { transactionId: txn.id, balanceAfter: newBalance };
    });

    return { success: true, ...result };
  } catch (err: any) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const existing2 = await prisma.creditTransaction.findUnique({ where: { idempotencyKey } });
      return { success: true, transactionId: existing2?.id ?? null, balanceAfter: existing2?.balanceAfter ?? 0, alreadyCharged: true };
    }
    return { success: false, transactionId: null, balanceAfter: 0, error: err.message };
  }
}

/**
 * Grant credits with lot creation.
 * Used for admin grants, monthly grants, recharge grants.
 */
export async function grantCredits(
  businessId: string,
  amount: number,
  transactionType: TransactionType,
  reason: string,
  opts: {
    userId?: string;
    idempotencyKey?: string;
    metadata?: Record<string, any>;
    expiresAt?: Date | null;
    creditLotType?: CreditLotType;
  } = {},
): Promise<ChargeResult> {
  if (amount <= 0) return { success: false, transactionId: null, balanceAfter: 0, error: 'Amount must be positive' };

  if (opts.idempotencyKey) {
    const existing = await prisma.creditTransaction.findUnique({ where: { idempotencyKey: opts.idempotencyKey } });
    if (existing) {
      return { success: true, transactionId: existing.id, balanceAfter: existing.balanceAfter, alreadyCharged: true };
    }
  }

  // Determine lot type from transaction type
  const lotType: CreditLotType = opts.creditLotType ||
    (transactionType === 'starter_grant' ? 'starter' :
     transactionType === 'monthly_grant' ? 'monthly' :
     transactionType === 'recharge_grant' ? 'recharge' :
     transactionType === 'admin_grant' ? 'admin' : 'admin');

  // Determine expiration
  let expiresAt = opts.expiresAt;
  if (expiresAt === undefined) {
    if (lotType === 'starter' || lotType === 'monthly') {
      expiresAt = new Date(Date.now() + GRANT_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
    } else {
      expiresAt = null; // recharge/admin don't expire by default
    }
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      let account = await tx.creditAccount.findUnique({ where: { businessId } });
      if (!account) {
        account = await tx.creditAccount.create({
          data: {
            businessId,
            creditBalance: 0,
            monthlyCreditAllowance: DEFAULT_MONTHLY_ALLOWANCE,
            creditPlanName: 'starter',
            creditStatus: 'active',
          },
        });
      }

      // Create the lot
      const lot = await tx.creditLot.create({
        data: {
          businessId,
          creditAccountId: account.id,
          creditType: lotType,
          originalAmount: amount,
          remainingAmount: amount,
          expiresAt,
          metadata: opts.metadata ?? undefined,
        },
      });

      const newBalance = account.creditBalance + amount;
      await tx.creditAccount.update({
        where: { id: account.id },
        data: { creditBalance: newBalance },
      });

      const txn = await tx.creditTransaction.create({
        data: {
          creditAccountId: account.id,
          businessId,
          userId: opts.userId,
          transactionType,
          amount,
          balanceAfter: newBalance,
          reason,
          idempotencyKey: opts.idempotencyKey,
          expiresAt,
          creditLotId: lot.id,
          metadata: opts.metadata ?? undefined,
        },
      });

      // Link lot back to its source transaction
      await tx.creditLot.update({ where: { id: lot.id }, data: { sourceTransactionId: txn.id } });

      return { transactionId: txn.id, balanceAfter: newBalance, lotId: lot.id };
    });

    return { success: true, ...result };
  } catch (err: any) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      if (opts.idempotencyKey) {
        const existing2 = await prisma.creditTransaction.findUnique({ where: { idempotencyKey: opts.idempotencyKey } });
        return { success: true, transactionId: existing2?.id ?? null, balanceAfter: existing2?.balanceAfter ?? 0, alreadyCharged: true };
      }
    }
    return { success: false, transactionId: null, balanceAfter: 0, error: err.message };
  }
}

/** Adjust credits (admin). Can be positive or negative. */
export async function adjustCredits(
  businessId: string,
  amount: number,
  reason: string,
  opts: { userId?: string; metadata?: Record<string, any>; expiresAt?: Date | null } = {},
): Promise<ChargeResult> {
  try {
    const result = await prisma.$transaction(async (tx) => {
      let account = await tx.creditAccount.findUnique({ where: { businessId } });
      if (!account) {
        account = await tx.creditAccount.create({
          data: {
            businessId,
            creditBalance: 0,
            monthlyCreditAllowance: DEFAULT_MONTHLY_ALLOWANCE,
            creditPlanName: 'starter',
            creditStatus: 'active',
          },
        });
      }

      if (amount > 0) {
        // Positive adjustment: create an admin lot
        await tx.creditLot.create({
          data: {
            businessId,
            creditAccountId: account.id,
            creditType: 'admin',
            originalAmount: amount,
            remainingAmount: amount,
            expiresAt: opts.expiresAt ?? null,
            metadata: opts.metadata ?? undefined,
          },
        });
      } else {
        // Negative adjustment: consume from lots
        const now = new Date();
        const absAmount = Math.abs(amount);
        const availLots = await tx.creditLot.findMany({
          where: { businessId, remainingAmount: { gt: 0 } },
        });
        const available = availLots.reduce((sum, l) => {
          if (isLotExpired(l, now)) return sum;
          return sum + l.remainingAmount;
        }, 0);
        if (available < absAmount) throw new Error('WOULD_GO_NEGATIVE');
        await consumeLotsInTransaction(tx, businessId, absAmount, now);
      }

      const newBalance = account.creditBalance + amount;
      if (newBalance < 0) throw new Error('WOULD_GO_NEGATIVE');

      await tx.creditAccount.update({
        where: { id: account.id },
        data: { creditBalance: newBalance },
      });

      const txn = await tx.creditTransaction.create({
        data: {
          creditAccountId: account.id,
          businessId,
          userId: opts.userId,
          transactionType: 'adjustment',
          amount,
          balanceAfter: newBalance,
          reason,
          metadata: opts.metadata ?? undefined,
        },
      });

      return { transactionId: txn.id, balanceAfter: newBalance };
    });

    return { success: true, ...result };
  } catch (err: any) {
    return {
      success: false,
      transactionId: null,
      balanceAfter: 0,
      error: err.message === 'WOULD_GO_NEGATIVE' ? 'Adjustment would make balance negative' : err.message,
    };
  }
}

/** Grant monthly credits for a business (idempotent per month). */
export async function grantMonthlyCredits(businessId: string): Promise<ChargeResult> {
  const now = new Date();
  const monthKey = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  const idempotencyKey = `monthly-grant:${businessId}:${monthKey}`;

  const account = await getOrCreateCreditAccount(businessId);

  return grantCredits(
    businessId,
    account.monthlyCreditAllowance,
    'monthly_grant',
    `Monthly credit grant for ${monthKey}`,
    {
      idempotencyKey,
      metadata: { month: monthKey, allowance: account.monthlyCreditAllowance },
      creditLotType: 'monthly',
    },
  );
}

// ─── Starter Grant ───────────────────────────────────────────────

/** Grant starter credits once to a new beta business. Idempotent. Creates a lot expiring in 60 days. */
export async function grantStarterCredits(
  businessId: string,
  opts: { userId?: string } = {},
): Promise<ChargeResult> {
  const idempotencyKey = `starter-grant:${businessId}`;

  const existing = await prisma.creditTransaction.findUnique({ where: { idempotencyKey } });
  if (existing) {
    return {
      success: true,
      transactionId: existing.id,
      balanceAfter: existing.balanceAfter,
      alreadyCharged: true,
    };
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      let account = await tx.creditAccount.findUnique({ where: { businessId } });
      if (!account) {
        account = await tx.creditAccount.create({
          data: {
            businessId,
            creditBalance: 0,
            monthlyCreditAllowance: DEFAULT_MONTHLY_ALLOWANCE,
            creditPlanName: 'beta',
            creditStatus: 'active',
          },
        });
      } else {
        const updates: any = {};
        if (!account.monthlyCreditAllowance) updates.monthlyCreditAllowance = DEFAULT_MONTHLY_ALLOWANCE;
        if (!account.creditPlanName || account.creditPlanName === 'starter') updates.creditPlanName = 'beta';
        if (account.creditStatus !== 'active') updates.creditStatus = 'active';
        if (Object.keys(updates).length > 0) {
          account = await tx.creditAccount.update({ where: { id: account.id }, data: updates });
        }
      }

      const existingTxn = await tx.creditTransaction.findUnique({ where: { idempotencyKey } });
      if (existingTxn) {
        return { transactionId: existingTxn.id, balanceAfter: existingTxn.balanceAfter, alreadyCharged: true };
      }

      const expiresAt = new Date(Date.now() + GRANT_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

      // Create the starter lot
      const lot = await tx.creditLot.create({
        data: {
          businessId,
          creditAccountId: account.id,
          creditType: 'starter',
          originalAmount: DEFAULT_MONTHLY_ALLOWANCE,
          remainingAmount: DEFAULT_MONTHLY_ALLOWANCE,
          expiresAt,
          metadata: { source: 'automatic_beta_onboarding' },
        },
      });

      const newBalance = account.creditBalance + DEFAULT_MONTHLY_ALLOWANCE;
      await tx.creditAccount.update({
        where: { id: account.id },
        data: { creditBalance: newBalance },
      });

      const txn = await tx.creditTransaction.create({
        data: {
          creditAccountId: account.id,
          businessId,
          userId: opts.userId,
          transactionType: 'starter_grant',
          amount: DEFAULT_MONTHLY_ALLOWANCE,
          balanceAfter: newBalance,
          reason: 'First month beta starter credits',
          idempotencyKey,
          expiresAt,
          creditLotId: lot.id,
          metadata: { source: 'automatic_beta_onboarding' },
        },
      });

      await tx.creditLot.update({ where: { id: lot.id }, data: { sourceTransactionId: txn.id } });

      return { transactionId: txn.id, balanceAfter: newBalance, lotId: lot.id };
    });

    const alreadyCharged = (result as any).alreadyCharged ?? false;
    return { success: true, transactionId: result.transactionId, balanceAfter: result.balanceAfter, alreadyCharged };
  } catch (err: any) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const existing2 = await prisma.creditTransaction.findUnique({ where: { idempotencyKey } });
      return {
        success: true,
        transactionId: existing2?.id ?? null,
        balanceAfter: existing2?.balanceAfter ?? 0,
        alreadyCharged: true,
      };
    }
    console.error(`[credits] Starter grant failed for business ${businessId}:`, err.message);
    return { success: false, transactionId: null, balanceAfter: 0, error: err.message };
  }
}

/** Backfill starter credits for all businesses that don't have one yet. */
export async function backfillStarterCredits(): Promise<{
  granted: number;
  skipped: number;
  errors: number;
  details: Array<{ businessId: string; status: string }>;
}> {
  const businesses = await prisma.business.findMany({ select: { id: true } });
  let granted = 0;
  let skipped = 0;
  let errors = 0;
  const details: Array<{ businessId: string; status: string }> = [];

  for (const biz of businesses) {
    const result = await grantStarterCredits(biz.id);
    if (!result.success) {
      errors++;
      details.push({ businessId: biz.id, status: `error: ${result.error}` });
    } else if (result.alreadyCharged) {
      skipped++;
      details.push({ businessId: biz.id, status: 'skipped' });
    } else {
      granted++;
      details.push({ businessId: biz.id, status: 'granted' });
    }
  }

  return { granted, skipped, errors, details };
}

// ─── Account Closure ─────────────────────────────────────────────

/**
 * Close a credit account — sets closure timestamps and
 * marks recharge lots to expire in CLOSURE_EXPIRY_DAYS.
 */
export async function closeAccountCreditWindow(businessId: string): Promise<void> {
  const now = new Date();
  const closureExpires = new Date(now.getTime() + CLOSURE_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

  await prisma.creditAccount.update({
    where: { businessId },
    data: {
      accountClosedAt: now,
      creditClosureExpiresAt: closureExpires,
    },
  });

  // Set closure_expires_at on all recharge lots with remaining credits
  await prisma.creditLot.updateMany({
    where: {
      businessId,
      creditType: 'recharge',
      remainingAmount: { gt: 0 },
      closureExpiresAt: null,
    },
    data: { closureExpiresAt: closureExpires },
  });

  console.log(`[credits] Account closure window set for business ${businessId}: expires ${closureExpires.toISOString()}`);
}

// ─── Transaction History ─────────────────────────────────────────

/** Get credit transactions for a business. */
export async function getTransactions(
  businessId: string,
  opts: { limit?: number; offset?: number; type?: string } = {},
) {
  const where: any = { businessId };
  if (opts.type) where.transactionType = opts.type;

  const [transactions, total] = await Promise.all([
    prisma.creditTransaction.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: opts.limit ?? 50,
      skip: opts.offset ?? 0,
    }),
    prisma.creditTransaction.count({ where }),
  ]);

  return { transactions, total };
}

/** Get credit lots for a business. */
export async function getCreditLots(
  businessId: string,
  opts: { includeEmpty?: boolean } = {},
) {
  const where: any = { businessId };
  if (!opts.includeEmpty) {
    where.remainingAmount = { gt: 0 };
  }

  const now = new Date();
  const lots = await prisma.creditLot.findMany({
    where,
    orderBy: { grantedAt: 'asc' },
  });

  return lots.map(lot => ({
    ...lot,
    effectiveExpiration: effectiveExpiration(lot)?.toISOString() || null,
    isExpired: isLotExpired(lot, now),
  }));
}
