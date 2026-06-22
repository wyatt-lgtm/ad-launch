export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import bcrypt from 'bcryptjs';

/**
 * POST /api/admin/bootstrap
 *
 * Safe emergency admin recovery mechanism.
 *
 * Required Render env vars:
 *   ADMIN_BOOTSTRAP_ENABLED=true
 *   ADMIN_EMAIL=<admin email>
 *   ADMIN_TEMP_PASSWORD=<temporary password>
 *
 * Optional:
 *   ADMIN_BOOTSTRAP_SECRET=<bearer token for extra protection>
 *
 * Behavior:
 *   - If ADMIN_BOOTSTRAP_ENABLED !== 'true', returns 404 (feature disabled).
 *   - If ADMIN_BOOTSTRAP_SECRET is set, requires Authorization header match.
 *   - Creates admin user if missing, or resets password + ensures admin role.
 *   - Only affects the configured ADMIN_EMAIL user.
 *   - Never logs the password.
 *   - After recovery, operator should set ADMIN_BOOTSTRAP_ENABLED=false in Render.
 */
export async function POST(request: NextRequest) {
  // ── Gate: feature must be explicitly enabled ───────────────────────
  if (process.env.ADMIN_BOOTSTRAP_ENABLED !== 'true') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // ── Gate: optional bearer token protection ─────────────────────────
  const secret = process.env.ADMIN_BOOTSTRAP_SECRET;
  if (secret) {
    const authHeader = request.headers.get('authorization') || '';
    const provided = authHeader.replace(/^Bearer\s+/i, '');
    if (provided !== secret) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  // ── Validate env config ────────────────────────────────────────────
  const adminEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const adminTempPassword = process.env.ADMIN_TEMP_PASSWORD;

  if (!adminEmail) {
    return NextResponse.json(
      { error: 'ADMIN_EMAIL env var not configured' },
      { status: 500 },
    );
  }
  if (!adminTempPassword || adminTempPassword.length < 6) {
    return NextResponse.json(
      { error: 'ADMIN_TEMP_PASSWORD must be at least 6 characters' },
      { status: 500 },
    );
  }

  try {
    const hashed = await bcrypt.hash(adminTempPassword, 12);
    let action: 'created' | 'reset';

    const existing = await prisma.user.findUnique({ where: { email: adminEmail } });

    if (existing) {
      // Reset password and ensure admin role
      await prisma.user.update({
        where: { email: adminEmail },
        data: {
          password: hashed,
          role: 'admin',
          confirmed: true,
        },
      });
      action = 'reset';
    } else {
      // Create new admin user
      await prisma.user.create({
        data: {
          email: adminEmail,
          password: hashed,
          role: 'admin',
          confirmed: true,
        },
      });
      action = 'created';
    }

    console.log(`[admin-bootstrap] Admin bootstrap applied for configured admin email (action=${action})`);

    return NextResponse.json({
      success: true,
      action,
      message: `Admin account ${action}. Disable ADMIN_BOOTSTRAP_ENABLED after recovery.`,
    });
  } catch (err: any) {
    console.error('[admin-bootstrap] Error:', err?.message);
    return NextResponse.json(
      { error: 'Bootstrap failed' },
      { status: 500 },
    );
  }
}
