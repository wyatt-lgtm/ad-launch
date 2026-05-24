import crypto from 'crypto';
import { prisma } from '@/lib/db';

const SECRET = process.env.NEXTAUTH_SECRET || 'fallback-secret-change-me';

interface TokenPayload {
  userId: string;
  businessId: string;
  scoutReportId?: string;
  storyId?: string;
  action: 'create_post' | 'review_stories' | 'review_package';
  expiresInHours?: number; // default 48
}

/**
 * Generate a signed, expiring magic-link token.
 * Token is stored in the DB for single-use enforcement.
 */
export async function generateMagicToken(payload: TokenPayload): Promise<string> {
  const nonce = crypto.randomBytes(16).toString('hex');
  const expiresAt = new Date(Date.now() + (payload.expiresInHours ?? 48) * 60 * 60 * 1000);

  // Build data string to sign
  const data = [
    payload.userId,
    payload.businessId,
    payload.scoutReportId || '',
    payload.storyId || '',
    payload.action,
    nonce,
    expiresAt.toISOString(),
  ].join('|');

  const signature = crypto.createHmac('sha256', SECRET).update(data).digest('hex');
  const token = Buffer.from(JSON.stringify({
    u: payload.userId,
    b: payload.businessId,
    r: payload.scoutReportId || null,
    s: payload.storyId || null,
    a: payload.action,
    n: nonce,
    e: expiresAt.toISOString(),
    sig: signature,
  })).toString('base64url');

  // Store in DB
  await prisma.magicToken.create({
    data: {
      token,
      userId: payload.userId,
      businessId: payload.businessId,
      scoutReportId: payload.scoutReportId || null,
      storyId: payload.storyId || null,
      action: payload.action,
      nonce,
      expiresAt,
    },
  });

  console.log(`[magic-token] Generated ${payload.action} token for user=${payload.userId} business=${payload.businessId} story=${payload.storyId || 'N/A'}`);
  return token;
}

/**
 * Verify and consume a magic-link token.
 * Returns the decoded payload or an error.
 * For cost-incurring actions (create_post), marks as single-use.
 */
export async function verifyMagicToken(token: string): Promise<{
  valid: boolean;
  error?: string;
  payload?: {
    userId: string;
    businessId: string;
    scoutReportId: string | null;
    storyId: string | null;
    action: string;
  };
}> {
  try {
    const decoded = JSON.parse(Buffer.from(token, 'base64url').toString('utf-8'));
    const { u: userId, b: businessId, r: scoutReportId, s: storyId, a: action, n: nonce, e: expiresIso, sig } = decoded;

    // Verify signature
    const data = [userId, businessId, scoutReportId || '', storyId || '', action, nonce, expiresIso].join('|');
    const expectedSig = crypto.createHmac('sha256', SECRET).update(data).digest('hex');
    if (sig !== expectedSig) {
      console.warn('[magic-token] Invalid signature');
      return { valid: false, error: 'invalid_token' };
    }

    // Check expiry
    if (new Date(expiresIso) < new Date()) {
      console.warn('[magic-token] Token expired');
      return { valid: false, error: 'expired' };
    }

    // Check DB record
    const record = await prisma.magicToken.findFirst({ where: { nonce } });
    if (!record) {
      console.warn('[magic-token] Token not found in DB');
      return { valid: false, error: 'invalid_token' };
    }

    // Single-use check for cost-incurring actions
    if (action === 'create_post' && record.used) {
      console.warn('[magic-token] Token already used');
      return { valid: false, error: 'already_used' };
    }

    // Mark as used for cost-incurring actions
    if (action === 'create_post') {
      await prisma.magicToken.update({
        where: { id: record.id },
        data: { used: true, usedAt: new Date() },
      });
    }

    console.log(`[magic-token] Verified ${action} token for user=${userId}`);
    return {
      valid: true,
      payload: { userId, businessId, scoutReportId, storyId, action },
    };
  } catch (err: any) {
    console.error('[magic-token] Verification error:', err.message);
    return { valid: false, error: 'invalid_token' };
  }
}
