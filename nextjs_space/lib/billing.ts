/**
 * Stripe Billing Service
 *
 * Handles Stripe Customer creation, Checkout Sessions, Portal Sessions,
 * and webhook event processing for subscription lifecycle.
 *
 * NEVER exposes secret keys to client code.
 * NEVER stores raw card data.
 */
import Stripe from 'stripe';
import { prisma } from '@/lib/db';
import { grantCredits, closeAccountCreditWindow } from '@/lib/credits';

// ─── Stripe Client ───────────────────────────────────────────────

function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY is not configured');
  return new Stripe(key, { apiVersion: '2025-04-30.basil' as any });
}

// ─── Customer Management ─────────────────────────────────────────

/**
 * Get or create a Stripe Customer for a business.
 * Stores stripeCustomerId on the CreditAccount.
 */
export async function getOrCreateStripeCustomer(
  businessId: string,
  email: string,
  businessName?: string | null,
): Promise<string> {
  const account = await prisma.creditAccount.findUnique({ where: { businessId } });

  // Reuse existing customer
  if (account?.stripeCustomerId) {
    return account.stripeCustomerId;
  }

  const stripe = getStripe();
  const customer = await stripe.customers.create({
    email,
    name: businessName || undefined,
    metadata: { businessId },
  });

  // Upsert account with customer ID
  if (account) {
    await prisma.creditAccount.update({
      where: { id: account.id },
      data: { stripeCustomerId: customer.id },
    });
  } else {
    await prisma.creditAccount.create({
      data: {
        businessId,
        creditBalance: 0,
        monthlyCreditAllowance: 6,
        creditPlanName: 'beta',
        creditStatus: 'active',
        stripeCustomerId: customer.id,
      },
    });
  }

  return customer.id;
}

// ─── Checkout Session ────────────────────────────────────────────

export interface CreateCheckoutParams {
  businessId: string;
  userId: string;
  email: string;
  businessName?: string | null;
  origin: string;
  trialDays?: number;
}

/**
 * Create a Stripe Checkout Session in subscription mode.
 * Returns the checkout URL.
 */
export async function createCheckoutSession(params: CreateCheckoutParams): Promise<string> {
  const { businessId, userId, email, businessName, origin, trialDays } = params;

  const priceId = process.env.STRIPE_PRICE_ID_STARTER;
  if (!priceId) throw new Error('STRIPE_PRICE_ID_STARTER is not configured');

  const stripe = getStripe();
  const customerId = await getOrCreateStripeCustomer(businessId, email, businessName);

  const successUrl = process.env.STRIPE_SUCCESS_URL || `${origin}/dashboard?billing=success`;
  const cancelUrl = process.env.STRIPE_CANCEL_URL || `${origin}/dashboard?billing=cancelled`;

  const sessionParams: Stripe.Checkout.SessionCreateParams = {
    mode: 'subscription',
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: {
      businessId,
      userId,
      planName: 'starter',
    },
    subscription_data: {
      metadata: {
        businessId,
        userId,
        planName: 'starter',
      },
    },
  };

  // Add trial if configured
  if (trialDays && trialDays > 0) {
    sessionParams.subscription_data!.trial_period_days = trialDays;
  }

  const session = await stripe.checkout.sessions.create(sessionParams);

  if (!session.url) throw new Error('Stripe did not return a checkout URL');
  return session.url;
}

// ─── Portal Session ──────────────────────────────────────────────

/**
 * Create a Stripe Billing Portal session for managing subscription.
 */
export async function createPortalSession(
  businessId: string,
  returnUrl: string,
): Promise<string> {
  const account = await prisma.creditAccount.findUnique({ where: { businessId } });
  if (!account?.stripeCustomerId) {
    throw new Error('No Stripe customer found for this business');
  }

  const stripe = getStripe();
  const session = await stripe.billingPortal.sessions.create({
    customer: account.stripeCustomerId,
    return_url: returnUrl,
  });

  return session.url;
}

// ─── Webhook Event Processing ────────────────────────────────────

/** Verify and construct a Stripe webhook event. */
export function constructWebhookEvent(rawBody: string | Buffer, signature: string): Stripe.Event {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) throw new Error('STRIPE_WEBHOOK_SECRET is not configured');
  const stripe = getStripe();
  return stripe.webhooks.constructEvent(rawBody, signature, secret);
}

/** Handle checkout.session.completed — link subscription to business. */
export async function handleCheckoutCompleted(session: Stripe.Checkout.Session): Promise<void> {
  const businessId = session.metadata?.businessId;
  if (!businessId) {
    console.error('[billing] checkout.session.completed missing businessId metadata');
    return;
  }

  const subscriptionId = typeof session.subscription === 'string'
    ? session.subscription
    : (session.subscription as Stripe.Subscription)?.id;

  const customerId = typeof session.customer === 'string'
    ? session.customer
    : (session.customer as Stripe.Customer)?.id;

  if (!subscriptionId || !customerId) {
    console.error('[billing] checkout.session.completed missing subscription/customer');
    return;
  }

  // Fetch subscription details (cast to any for cross-version property access)
  const stripe = getStripe();
  const subRaw = await stripe.subscriptions.retrieve(subscriptionId);
  const sub = subRaw as any;

  const periodStart = sub.current_period_start ? new Date(sub.current_period_start * 1000) : null;
  const periodEnd = sub.current_period_end ? new Date(sub.current_period_end * 1000) : null;

  await prisma.creditAccount.upsert({
    where: { businessId },
    create: {
      businessId,
      creditBalance: 0,
      monthlyCreditAllowance: 6,
      creditPlanName: 'starter',
      creditStatus: 'active',
      stripeCustomerId: customerId,
      stripeSubscriptionId: subscriptionId,
      stripeSubscriptionStatus: sub.status,
      stripePriceId: sub.items?.data?.[0]?.price?.id || null,
      trialStartedAt: sub.trial_start ? new Date(sub.trial_start * 1000) : null,
      trialEndsAt: sub.trial_end ? new Date(sub.trial_end * 1000) : null,
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
      cancelAtPeriodEnd: sub.cancel_at_period_end ?? false,
    },
    update: {
      stripeCustomerId: customerId,
      stripeSubscriptionId: subscriptionId,
      stripeSubscriptionStatus: sub.status,
      stripePriceId: sub.items?.data?.[0]?.price?.id || null,
      trialStartedAt: sub.trial_start ? new Date(sub.trial_start * 1000) : null,
      trialEndsAt: sub.trial_end ? new Date(sub.trial_end * 1000) : null,
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
      cancelAtPeriodEnd: sub.cancel_at_period_end ?? false,
      creditStatus: 'active',
    },
  });

  console.log(`[billing] Checkout completed: business=${businessId} sub=${subscriptionId}`);
}

/** Handle subscription created/updated — sync status. */
export async function handleSubscriptionUpdate(rawSub: Stripe.Subscription): Promise<void> {
  const sub = rawSub as any;
  const businessId = sub.metadata?.businessId;

  // Try metadata first, then lookup by stripeSubscriptionId
  let account = businessId
    ? await prisma.creditAccount.findUnique({ where: { businessId } })
    : await prisma.creditAccount.findFirst({ where: { stripeSubscriptionId: sub.id } });

  if (!account) {
    // Try by customer ID
    const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id;
    if (customerId) {
      account = await prisma.creditAccount.findFirst({ where: { stripeCustomerId: customerId } });
    }
  }

  if (!account) {
    console.error(`[billing] subscription.updated: cannot find account for sub=${sub.id}`);
    return;
  }

  const updateData: any = {
    stripeSubscriptionId: sub.id,
    stripeSubscriptionStatus: sub.status,
    stripePriceId: sub.items?.data?.[0]?.price?.id || null,
    currentPeriodStart: sub.current_period_start ? new Date(sub.current_period_start * 1000) : undefined,
    currentPeriodEnd: sub.current_period_end ? new Date(sub.current_period_end * 1000) : undefined,
    cancelAtPeriodEnd: sub.cancel_at_period_end ?? false,
  };

  if (sub.trial_start) updateData.trialStartedAt = new Date(sub.trial_start * 1000);
  if (sub.trial_end) updateData.trialEndsAt = new Date(sub.trial_end * 1000);

  // Map sub status to credit status
  if (sub.status === 'active' || sub.status === 'trialing') {
    updateData.creditStatus = 'active';
  } else if (sub.status === 'past_due') {
    updateData.creditStatus = 'past_due';
  } else if (sub.status === 'canceled' || sub.status === 'unpaid') {
    updateData.creditStatus = 'canceled';
  }

  await prisma.creditAccount.update({
    where: { id: account.id },
    data: updateData,
  });

  console.log(`[billing] Subscription updated: account=${account.id} status=${sub.status}`);
}

/** Handle subscription deleted — mark canceled. */
export async function handleSubscriptionDeleted(rawSub: Stripe.Subscription): Promise<void> {
  const sub = rawSub as any;
  const businessId = sub.metadata?.businessId;

  let account = businessId
    ? await prisma.creditAccount.findUnique({ where: { businessId } })
    : await prisma.creditAccount.findFirst({ where: { stripeSubscriptionId: sub.id } });

  if (!account) {
    const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id;
    if (customerId) {
      account = await prisma.creditAccount.findFirst({ where: { stripeCustomerId: customerId } });
    }
  }

  if (!account) {
    console.error(`[billing] subscription.deleted: cannot find account for sub=${sub.id}`);
    return;
  }

  await prisma.creditAccount.update({
    where: { id: account.id },
    data: {
      stripeSubscriptionStatus: 'canceled',
      creditStatus: 'canceled',
      cancelAtPeriodEnd: false,
    },
  });

  // Trigger account closure credit window (sets 30-day expiry on recharge lots)
  try {
    await closeAccountCreditWindow(account.businessId);
  } catch (err: any) {
    console.error(`[billing] Failed to set closure window for business=${account.businessId}:`, err.message);
  }

  console.log(`[billing] Subscription canceled: account=${account.id}`);
}

/** Handle invoice.payment_succeeded — grant monthly credits. */
export async function handleInvoicePaymentSucceeded(rawInvoice: Stripe.Invoice): Promise<void> {
  const invoice = rawInvoice as any;
  const subscriptionId = typeof invoice.subscription === 'string'
    ? invoice.subscription
    : invoice.subscription?.id;

  if (!subscriptionId) {
    console.log('[billing] invoice.payment_succeeded: no subscription (one-off invoice), skipping');
    return;
  }

  // Find account by subscription
  let account = await prisma.creditAccount.findFirst({ where: { stripeSubscriptionId: subscriptionId } });

  if (!account) {
    // Try by customer ID
    const customerId = typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id;
    if (customerId) {
      account = await prisma.creditAccount.findFirst({ where: { stripeCustomerId: customerId } });
    }
  }

  if (!account) {
    console.error(`[billing] invoice.payment_succeeded: no account for sub=${subscriptionId}`);
    return;
  }

  // Update payment info
  await prisma.creditAccount.update({
    where: { id: account.id },
    data: {
      lastInvoiceId: invoice.id,
      lastPaymentStatus: 'paid',
      creditStatus: 'active',
    },
  });

  // Grant monthly credits with invoice-based idempotency key
  const idempotencyKey = `monthly-grant:${account.businessId}:${invoice.id}`;
  const result = await grantCredits(
    account.businessId,
    account.monthlyCreditAllowance,
    'monthly_grant',
    'Stripe invoice payment succeeded',
    {
      idempotencyKey,
      metadata: {
        invoiceId: invoice.id,
        subscriptionId,
        customerId: typeof invoice.customer === 'string' ? invoice.customer : (invoice.customer as any)?.id,
      },
    },
  );

  if (result.success && !result.alreadyCharged) {
    console.log(`[billing] Monthly credits granted: business=${account.businessId} amount=${account.monthlyCreditAllowance} invoice=${invoice.id}`);
  } else if (result.alreadyCharged) {
    console.log(`[billing] Monthly credits already granted for invoice=${invoice.id} (idempotent skip)`);
  } else {
    console.error(`[billing] Failed to grant monthly credits: business=${account.businessId} error=${result.error}`);
  }
}

/** Handle invoice.payment_failed — mark billing issue. */
export async function handleInvoicePaymentFailed(rawInvoice: Stripe.Invoice): Promise<void> {
  const invoice = rawInvoice as any;
  const subscriptionId = typeof invoice.subscription === 'string'
    ? invoice.subscription
    : invoice.subscription?.id;

  if (!subscriptionId) return;

  let account = await prisma.creditAccount.findFirst({ where: { stripeSubscriptionId: subscriptionId } });
  if (!account) {
    const customerId = typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id;
    if (customerId) {
      account = await prisma.creditAccount.findFirst({ where: { stripeCustomerId: customerId } });
    }
  }

  if (!account) {
    console.error(`[billing] invoice.payment_failed: no account for sub=${subscriptionId}`);
    return;
  }

  // Update status but DO NOT remove existing credits
  await prisma.creditAccount.update({
    where: { id: account.id },
    data: {
      lastInvoiceId: invoice.id,
      lastPaymentStatus: 'failed',
      creditStatus: 'billing_issue',
    },
  });

  console.log(`[billing] Payment failed: business=${account.businessId} invoice=${invoice.id}`);
}
