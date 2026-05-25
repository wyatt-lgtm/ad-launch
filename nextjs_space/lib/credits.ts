/**
 * Credit System Service
 *
 * All credit mutations are transactional.
 * Idempotency keys prevent double-charges.
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

export const RECHARGE_PACKS = [
  { id: 'pack_6', credits: 6, priceUsd: 9.99, label: '6 Credits', active: false },
] as const;

// ─── Types ────────────────────────────────────────────────────────

export type TransactionType =
  | 'monthly_grant'
  | 'admin_grant'
  | 'image_post_charge'
  | 'video_upgrade_charge'
  | 'recharge_grant'
  | 'refund'
  | 'adjustment'
  | 'failed_generation_refund'
  | 'recharge_pending';

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

/** Get credit balance for a business. Returns 0 if no account. */
export async function getCreditBalance(businessId: string): Promise<{
  balance: number;
  monthlyAllowance: number;
  planName: string;
  status: string;
  renewAt: Date | null;
  accountId: string | null;
}> {
  const account = await prisma.creditAccount.findUnique({ where: { businessId } });
  if (!account) {
    return {
      balance: 0,
      monthlyAllowance: DEFAULT_MONTHLY_ALLOWANCE,
      planName: 'starter',
      status: 'no_account',
      renewAt: null,
      accountId: null,
    };
  }
  return {
    balance: account.creditBalance,
    monthlyAllowance: account.monthlyCreditAllowance,
    planName: account.creditPlanName || 'starter',
    status: account.creditStatus,
    renewAt: account.creditsRenewAt,
    accountId: account.id,
  };
}

// ─── Credit Checks ───────────────────────────────────────────────

/** Check if a business has enough credits for an operation. */
export async function checkCredits(
  businessId: string,
  requiredCredits: number,
): Promise<CreditCheckResult> {
  const account = await prisma.creditAccount.findUnique({ where: { businessId } });
  const balance = account?.creditBalance ?? 0;
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

// ─── Credit Mutations (all transactional) ────────────────────────

/**
 * Charge credits for a completed post package.
 * Uses idempotency key to prevent double-charge.
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

  try {
    // Transactional charge
    const result = await prisma.$transaction(async (tx) => {
      const account = await tx.creditAccount.findUnique({ where: { businessId } });
      if (!account) throw new Error('NO_ACCOUNT');
      if (account.creditBalance < cost) throw new Error('INSUFFICIENT_CREDITS');

      const newBalance = account.creditBalance - cost;

      // Update balance
      await tx.creditAccount.update({
        where: { id: account.id },
        data: { creditBalance: newBalance },
      });

      // Write transaction
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
        },
      });

      // Mark PostPackage as charged
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
    // Handle unique constraint (race condition on idempotency key)
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

/** Refund credits for a failed/rejected post package. */
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

  // Find the original charge
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

      const newBalance = account.creditBalance + refundAmount;
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
        },
      });

      // Clear charge on PostPackage
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

/** Grant credits (admin or monthly). */
export async function grantCredits(
  businessId: string,
  amount: number,
  transactionType: TransactionType,
  reason: string,
  opts: { userId?: string; idempotencyKey?: string; metadata?: Record<string, any> } = {},
): Promise<ChargeResult> {
  if (amount <= 0) return { success: false, transactionId: null, balanceAfter: 0, error: 'Amount must be positive' };

  if (opts.idempotencyKey) {
    const existing = await prisma.creditTransaction.findUnique({ where: { idempotencyKey: opts.idempotencyKey } });
    if (existing) {
      return { success: true, transactionId: existing.id, balanceAfter: existing.balanceAfter, alreadyCharged: true };
    }
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      // Ensure account exists
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
          metadata: opts.metadata ?? undefined,
        },
      });

      return { transactionId: txn.id, balanceAfter: newBalance };
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
  opts: { userId?: string; metadata?: Record<string, any> } = {},
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
    },
  );
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
