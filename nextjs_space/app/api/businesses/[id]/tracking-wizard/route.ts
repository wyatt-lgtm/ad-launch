export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { resolveBusinessAccess } from '@/lib/tracking-auth';
import { logPixelAudit } from '@/lib/tracking-pixels';
import {
  buildWizardPlan,
  getPlatformCapability,
  getTrackingGoal,
  getWizardMetadata,
  INSTALLATION_TARGETS,
} from '@/lib/tracking-wizard';

/**
 * GET /api/businesses/[id]/tracking-wizard
 * Returns the wizard metadata (platforms, goals, recommended plans).
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const r = await resolveBusinessAccess(req, params.id);
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json(getWizardMetadata());
}

/**
 * POST /api/businesses/[id]/tracking-wizard
 * Body: {
 *   platform, goal,
 *   mode: 'create_plan' | 'have_id' | 'save_setup_needed',
 *   pixelId?, baseCode?, websiteUrl?, installationTarget?
 * }
 * Atomically creates ONE base pixel + recommended events + audiences + routes,
 * all scoped to this business.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const r = await resolveBusinessAccess(req, params.id);
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: r.status });
  const { user, business } = r;

  const body = await req.json().catch(() => ({}));
  const platform: string = (body.platform || '').trim();
  const goal: string = (body.goal || '').trim();
  const mode: string = body.mode || 'create_plan';

  const cap = getPlatformCapability(platform);
  if (!cap) return NextResponse.json({ error: 'Unknown platform' }, { status: 400 });
  if (!getTrackingGoal(goal)) return NextResponse.json({ error: 'Unknown tracking goal' }, { status: 400 });

  const pixelIdValue: string | null = typeof body.pixelId === 'string' && body.pixelId.trim() ? body.pixelId.trim() : null;
  const baseCode: string | null = typeof body.baseCode === 'string' && body.baseCode.trim() ? body.baseCode.trim() : null;
  const websiteUrl: string | null = typeof body.websiteUrl === 'string' && body.websiteUrl.trim() ? body.websiteUrl.trim() : null;
  let installationTarget: string = typeof body.installationTarget === 'string' ? body.installationTarget : 'unknown';
  if (!(INSTALLATION_TARGETS as readonly string[]).includes(installationTarget)) installationTarget = 'unknown';

  const plan = buildWizardPlan(platform, goal, business.businessName || 'Your Business');

  // Decide lifecycle + setup status based on whether we have an id.
  const hasId = mode === 'have_id' && !!pixelIdValue;
  const status = hasId ? 'active' : 'draft';
  const setupStatus = mode === 'save_setup_needed'
    ? 'needs_customer_action'
    : hasId
      ? 'ready_to_install'
      : 'needs_customer_action';

  // Map the platform id into the right column.
  const idColumn = cap.idField;
  const pixelData: Record<string, any> = {
    businessId: business.id,
    ...plan.pixel,
    pixelId: pixelIdValue,
    scriptSnippet: baseCode,
    status,
    setupStatus,
    installationTarget,
    installStatus: installationTarget === 'tombstone_generated_site' ? 'auto' : 'pending',
    installNotes: websiteUrl ? `Website: ${websiteUrl}` : null,
    createdByUserId: user.id,
    updatedByUserId: user.id,
  };
  if (pixelIdValue && idColumn && idColumn !== 'pixelId') pixelData[idColumn] = pixelIdValue;
  if (websiteUrl) pixelData.lastVerifiedUrl = websiteUrl;

  try {
    const result = await prisma.$transaction(async (tx) => {
      const pixel = await tx.trackingPixel.create({ data: pixelData as any });

      const createdEvents = [] as any[];
      for (const ev of plan.events) {
        const created = await tx.trackingEvent.create({
          data: {
            businessId: business.id,
            pixelId: pixel.id,
            eventName: ev.eventName,
            platformEventName: ev.platformEventName,
            eventType: ev.eventType,
            triggerType: ev.triggerType,
            pageScope: ev.pageScope,
            consentCategory: ev.consentCategory,
            requiresConsent: ev.requiresConsent,
          } as any,
        });
        createdEvents.push(created);
      }

      const createdAudiences = [] as any[];
      for (const a of plan.audiences) {
        const created = await tx.trackingAudience.create({
          data: {
            businessId: business.id,
            audienceName: a.audienceName,
            platform: a.platform,
            audienceType: a.audienceType,
            sourceEvent: a.sourceEvent,
            includeRulesJson: a.includeRulesJson ?? undefined,
            excludeRulesJson: a.excludeRulesJson ?? undefined,
            funnelStage: a.funnelStage,
          } as any,
        });
        createdAudiences.push(created);
      }

      const createdRoutes = [] as any[];
      for (const rt of plan.routes) {
        const created = await tx.trackingEventRoute.create({
          data: {
            businessId: business.id,
            pageType: rt.pageType,
            eventName: rt.eventName,
            firesOn: rt.firesOn,
            platformsJson: rt.platformsJson ?? undefined,
          } as any,
        });
        createdRoutes.push(created);
      }

      return { pixel, createdEvents, createdAudiences, createdRoutes };
    });

    await logPixelAudit({
      businessId: business.id,
      pixelId: result.pixel.id,
      action: 'created',
      details: {
        source: 'wizard',
        platform,
        goal,
        mode,
        events: result.createdEvents.length,
        audiences: result.createdAudiences.length,
        routes: result.createdRoutes.length,
        setupStatus,
      },
      userId: user.id,
    });

    return NextResponse.json({
      ok: true,
      pixel: result.pixel,
      counts: {
        events: result.createdEvents.length,
        audiences: result.createdAudiences.length,
        routes: result.createdRoutes.length,
      },
    });
  } catch (e: any) {
    console.error('[tracking-wizard] failed to create plan', e);
    return NextResponse.json({ error: e?.message || 'Failed to create tracking plan' }, { status: 500 });
  }
}
