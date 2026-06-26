export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';
import { buildLandingPageBlock } from '@/lib/social-landing-page';
import {
  listGhlSocialAccounts,
  selectGhlAccount,
  createGhlSocialPost,
  lookupGhlUserId,
  uploadMediaToGhl,
  createTraceId,
  traceStep,
  type GhlTraceStep,
  type GhlMediaItem,
} from '@/lib/ghl-social-planner';

type RouteContext = { params: Promise<{ id: string }> };

/**
 * POST /api/social/posts/[id]/post-now
 *
 * Publishes a social post through GHL Social Planner.
 *
 * Architecture:
 *   Launch OS Post Now → GHL Social Planner API → Connected Facebook/TikTok Page → Platform
 *
 * The route reads ghlLocationId + ghlApiToken from the Launch OS Business record.
 * It does NOT require a direct Facebook token in Launch OS SocialConnection.
 *
 * Body: { platforms?: string[], includeLandingPage?: boolean }
 */
export async function POST(req: NextRequest, context: RouteContext) {
  const publishTraceId = createTraceId();
  const trace: GhlTraceStep[] = [];

  try {
    trace.push(traceStep('POST_NOW_REQUEST_RECEIVED'));

    // ── Auth ──────────────────────────────────────────────────────────
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const userId = (session.user as any).id;
    const { id } = await context.params;

    // ── Load SocialPost ──────────────────────────────────────────────
    const post = await prisma.socialPost.findFirst({
      where: { id, userId },
    });
    if (!post) {
      return NextResponse.json({ error: 'Post not found' }, { status: 404 });
    }
    trace.push(traceStep('SOCIAL_POST_LOADED', `id=${post.id} status=${post.status}`));

    // ── Duplicate prevention ─────────────────────────────────────────
    if (['published_by_ghl', 'published_unverified', 'publishing'].includes(post.status)) {
      return NextResponse.json(
        { error: 'already_posted', message: 'This post has already been published through Launch CRM.' },
        { status: 409 }
      );
    }
    // Allow re-publishing of failed_to_publish and manually_posted
    // Block generation_failed / generation_incomplete
    if (post.status === 'generation_failed' || post.status === 'generation_incomplete') {
      return NextResponse.json(
        { error: 'incomplete_post', message: 'Post generation failed or is incomplete. Fix or regenerate before publishing.' },
        { status: 422 }
      );
    }

    // ── Eligibility: caption ─────────────────────────────────────────
    if (!post.caption?.trim()) {
      return NextResponse.json(
        { error: 'incomplete_post', message: 'Post is incomplete — caption is missing.' },
        { status: 422 }
      );
    }

    // ── Eligibility: image ───────────────────────────────────────────
    const carouselUrls = (post as any).carouselImageUrls as string[] | null;
    const hasImage = !!post.imageUrl || (Array.isArray(carouselUrls) && carouselUrls.length > 0);
    if (!hasImage) {
      return NextResponse.json(
        { error: 'incomplete_post', message: 'Post is incomplete — image is missing.' },
        { status: 422 }
      );
    }

    // ── Load Business ────────────────────────────────────────────────
    if (!post.businessId) {
      return fail(publishTraceId, trace, 'Post is not associated with a business.', 422);
    }
    const business = await prisma.business.findUnique({
      where: { id: post.businessId },
      select: {
        id: true,
        businessName: true,
        ghlLocationId: true,
        ghlApiToken: true,
        ghlProvisioningStatus: true,
        defaultSocialLandingPageUrl: true,
        defaultSocialLandingPageEnabled: true,
        defaultSocialCtaText: true,
        defaultGhlSocialAccountId: true,
        defaultGhlSocialAccountName: true,
        defaultGhlSocialPlatform: true,
        defaultGhlSocialOriginId: true,
        defaultGhlUserId: true,
        defaultGhlUserName: true,
        defaultGhlUserEmail: true,
      },
    });
    if (!business) {
      return fail(publishTraceId, trace, 'Business not found.', 404);
    }
    trace.push(traceStep('BUSINESS_LOADED', `id=${business.id} name=${business.businessName}`));

    // ── Validate GHL credentials ─────────────────────────────────────
    if (!business.ghlLocationId) {
      return fail(publishTraceId, trace, 'Missing Launch CRM location ID for this business.', 422);
    }
    trace.push(traceStep('GHL_LOCATION_RESOLVED', `locationId=${business.ghlLocationId}`));

    if (!business.ghlApiToken) {
      return fail(publishTraceId, trace, 'Missing Launch CRM API token for this business.', 422);
    }
    trace.push(traceStep('GHL_TOKEN_PRESENT'));

    // ── Mark as publishing (optimistic) ──────────────────────────────
    await prisma.socialPost.update({
      where: { id: post.id },
      data: {
        status: 'publishing',
        publishTraceId,
        lastPublishAttemptAt: new Date(),
        ghlLocationId: business.ghlLocationId,
      },
    });

    // ── Parse request body ───────────────────────────────────────────
    const body = await req.json().catch(() => ({}));
    const platforms = Array.isArray(body.platforms) ? body.platforms : post.platforms;
    const includeLandingPage = body.includeLandingPage === true;

    // ── Build final caption with landing page ────────────────────────
    let finalCaption = post.caption || '';
    let landingPageApplied = false;

    if (includeLandingPage && business.defaultSocialLandingPageEnabled && business.defaultSocialLandingPageUrl) {
      const block = buildLandingPageBlock(finalCaption, {
        url: business.defaultSocialLandingPageUrl,
        ctaText: business.defaultSocialCtaText || 'Learn more here:',
        enabled: true,
      }, {
        platform: platforms[0] || 'social',
        campaign: (post as any).patternType || 'social',
        contentId: post.id,
      });
      if (block) {
        finalCaption += block;
        landingPageApplied = true;
      }
    }
    trace.push(traceStep(
      landingPageApplied ? 'DEFAULT_LANDING_PAGE_APPLIED' : 'DEFAULT_LANDING_PAGE_SKIPPED',
      landingPageApplied ? business.defaultSocialLandingPageUrl || '' : 'not enabled or already present'
    ));

    // ── GHL Account Lookup ───────────────────────────────────────────
    trace.push(traceStep('GHL_ACCOUNTS_LOOKUP_REQUESTED'));
    const accountsResult = await listGhlSocialAccounts(
      business.ghlLocationId,
      business.ghlApiToken
    );

    if (!accountsResult.success) {
      return fail(
        publishTraceId, trace,
        `Could not load Launch CRM Social Planner accounts. ${accountsResult.error || ''}`,
        502, post.id
      );
    }
    trace.push(traceStep('GHL_ACCOUNTS_LOOKUP_SUCCEEDED', `${accountsResult.accounts.length} accounts found`));

    // ── Select the correct account ───────────────────────────────────
    const targetPlatform = platforms.includes('facebook') ? 'facebook'
      : platforms.includes('tiktok') ? 'tiktok'
      : platforms[0] || business.defaultGhlSocialPlatform || 'facebook';

    const selection = selectGhlAccount(accountsResult.accounts, {
      platform: targetPlatform,
      savedAccountId: business.defaultGhlSocialAccountId,
      savedOriginId: business.defaultGhlSocialOriginId,
      savedAccountName: business.defaultGhlSocialAccountName,
    });

    if (!selection.selected) {
      return fail(
        publishTraceId, trace,
        selection.error || 'No connected account/page found in Launch CRM Social Planner.',
        422, post.id
      );
    }

    const account = selection.selected;
    trace.push(traceStep('GHL_ACCOUNT_SELECTED', `name="${account.name}" platform=${account.platform} originId=${account.originId}`));

    // ── Cache/update the default account if not already saved ────────
    if (!business.defaultGhlSocialAccountId || business.defaultGhlSocialAccountId !== account.id) {
      await prisma.business.update({
        where: { id: business.id },
        data: {
          defaultGhlSocialAccountId: account.id,
          defaultGhlSocialAccountName: account.name,
          defaultGhlSocialPlatform: account.platform,
          defaultGhlSocialOriginId: account.originId,
        },
      }).catch(err => {
        console.warn('[post-now] Failed to cache default GHL account:', err.message);
      });
    }

    // ── Resolve + Upload images to GHL Media Library ──────────────
    // GHL accepts external URLs in post payloads but does NOT reliably
    // forward them to Facebook. Only GHL-hosted media (assets.cdn.filesafe.space)
    // consistently appears in final Facebook posts.
    // Flow: signed R2 URL → download → upload to GHL CDN → use GHL URL in post
    const rawMediaPaths: string[] = [];
    if (post.imageUrl) {
      rawMediaPaths.push(post.imageUrl);
    } else if (Array.isArray(carouselUrls) && carouselUrls.length > 0) {
      rawMediaPaths.push(...carouselUrls);
    }

    const media: GhlMediaItem[] = [];
    let mediaUploadFailed = false;
    let mediaFailureReason = '';

    for (let i = 0; i < rawMediaPaths.length; i++) {
      const rawPath = rawMediaPaths[i];
      const resolvedUrl = await resolveMediaUrl(rawPath);
      if (!resolvedUrl) {
        console.warn(`[post-now] [${publishTraceId}] Could not resolve media: ${rawPath}`);
        mediaUploadFailed = true;
        mediaFailureReason = `Could not resolve artifact path: ${rawPath}`;
        continue;
      }

      // Extract filename for GHL
      const fileName = rawPath.split('/').pop() || `post_${post.id}_${i}.png`;

      trace.push(traceStep('GHL_MEDIA_UPLOAD_REQUESTED', `file=${fileName}`));
      const uploadResult = await uploadMediaToGhl(business.ghlApiToken, resolvedUrl, fileName);

      if (!uploadResult.success || !uploadResult.url) {
        console.error(`[post-now] [${publishTraceId}] GHL media upload failed: ${uploadResult.error}`);
        trace.push(traceStep('GHL_MEDIA_UPLOAD_FAILED', uploadResult.error || 'unknown'));
        mediaUploadFailed = true;
        mediaFailureReason = uploadResult.error || 'GHL media upload returned no URL';
        continue;
      }

      trace.push(traceStep('GHL_MEDIA_UPLOAD_SUCCEEDED', `ghlUrl=${uploadResult.url}`));
      media.push({ url: uploadResult.url, type: inferMimeType(rawPath) });
    }

    trace.push(traceStep('MEDIA_RESOLVED', `${media.length}/${rawMediaPaths.length} uploaded to GHL CDN`));

    if (media.length === 0 && rawMediaPaths.length > 0) {
      return fail(publishTraceId, trace, `Could not upload any media to GHL. ${mediaFailureReason}`, 422, post.id);
    }

    // ── Resolve GHL userId ─────────────────────────────────────────
    // Priority: A) saved defaultGhlUserId  B) auto-discover via Users API
    let resolvedUserId: string | null = business.defaultGhlUserId || null;
    let resolvedUserName: string | null = business.defaultGhlUserName || null;

    if (resolvedUserId) {
      console.log('[post-now] Using cached publishing user', {
        businessId: business.id, ghlLocationId: business.ghlLocationId,
        userId: resolvedUserId, userName: resolvedUserName,
        email: business.defaultGhlUserEmail, source: 'cached',
      });
      trace.push(traceStep('GHL_USER_FROM_CACHE', `userId=${resolvedUserId} name=${resolvedUserName}`));
    } else {
      // Auto-discover: call Users API for THIS business's own location/token
      console.log('[post-now] No cached publishing user — auto-discovering via Users API', {
        businessId: business.id, ghlLocationId: business.ghlLocationId,
      });
      trace.push(traceStep('GHL_USER_AUTO_DISCOVER', `locationId=${business.ghlLocationId}`));
      const userLookup = await lookupGhlUserId(business.ghlLocationId, business.ghlApiToken);

      if (userLookup.userId) {
        resolvedUserId = userLookup.userId;
        resolvedUserName = userLookup.userName;
        console.log('[post-now] Auto-discovered publishing user', {
          businessId: business.id, ghlLocationId: business.ghlLocationId,
          userId: resolvedUserId, userName: resolvedUserName,
          email: userLookup.userEmail, status: 'auto_selected',
        });
        trace.push(traceStep('GHL_USER_AUTO_SELECTED', `userId=${resolvedUserId} name=${resolvedUserName} email=${userLookup.userEmail || ''}`));
        // Cache on this business row for future use
        await prisma.business.update({
          where: { id: business.id },
          data: {
            defaultGhlUserId: resolvedUserId,
            defaultGhlUserName: resolvedUserName,
            defaultGhlUserEmail: userLookup.userEmail,
            lastGhlUserVerifiedAt: new Date(),
          },
        }).catch(err => console.warn('[post-now] Failed to cache auto-discovered GHL user:', err.message));
      } else if (userLookup.errorCode === 'auth_failed') {
        console.warn('[post-now] Users API auth failed — manual fallback needed', {
          businessId: business.id, ghlLocationId: business.ghlLocationId, status: 'auth_failed',
        });
        trace.push(traceStep('GHL_USER_AUTH_FAILED', userLookup.error || ''));
        return fail(
          publishTraceId, trace,
          'Launch CRM connected, but staff user lookup is not available for this token. Add a default publishing user in Publish Options or reconnect with a token that includes staff user access.',
          422, post.id
        );
      } else if (userLookup.errorCode === 'no_users') {
        console.warn('[post-now] Users API returned no eligible users', {
          businessId: business.id, ghlLocationId: business.ghlLocationId, status: 'no_users',
        });
        trace.push(traceStep('GHL_USER_NO_USERS', userLookup.error || ''));
        return fail(publishTraceId, trace, 'No eligible Launch CRM staff user was returned for this location. Add a default publishing user in Publish Options.', 422, post.id);
      } else {
        console.warn('[post-now] Users API lookup failed', {
          businessId: business.id, ghlLocationId: business.ghlLocationId,
          status: 'network_error', error: userLookup.error,
        });
        trace.push(traceStep('GHL_USER_LOOKUP_FAILED', userLookup.error || ''));
        return fail(publishTraceId, trace, `Could not look up Launch CRM staff user. ${userLookup.error || ''}`, 422, post.id);
      }
    }

    // ── Build post payload ───────────────────────────────────────────
    const ghlPayload = {
      accountIds: [account.id],
      userId: resolvedUserId!,
      summary: finalCaption,
      media,
      type: 'post' as const,
    };

    trace.push(traceStep('POST_PAYLOAD_BUILT', `caption_len=${finalCaption.length} media_count=${media.length} account=${account.name}`));

    // Log the payload for diagnostics (no secrets)
    console.log(`[post-now] [${publishTraceId}] Creating GHL post:`, {
      businessId: business.id,
      businessName: business.businessName,
      ghlLocationId: business.ghlLocationId,
      accountId: account.id,
      accountName: account.name,
      platform: account.platform,
      captionLength: finalCaption.length,
      mediaCount: media.length,
      ghlUserId: resolvedUserId,
      landingPageApplied,
    });

    // ── Call GHL Create Post API ─────────────────────────────────────
    trace.push(traceStep('GHL_CREATE_POST_REQUESTED'));
    const createResult = await createGhlSocialPost(
      business.ghlLocationId,
      business.ghlApiToken,
      ghlPayload
    );

    if (!createResult.success) {
      console.error(`[post-now] [${publishTraceId}] GHL Create Post FAILED:`, createResult.error);
      trace.push(traceStep('GHL_CREATE_POST_FAILED', createResult.error));

      // Update post status to failed
      await prisma.socialPost.update({
        where: { id: post.id },
        data: {
          status: 'failed_to_publish',
          ghlSocialAccountId: account.id,
          ghlSocialAccountName: account.name,
          ghlSocialOriginId: account.originId,
          ghlStatus: 'error',
          publishResponseSummary: (createResult.error || '').slice(0, 1000),
          ...(finalCaption !== post.caption ? { caption: finalCaption } : {}),
        },
      });

      return NextResponse.json({
        success: false,
        error: createResult.error || 'Launch CRM rejected the post.',
        publishTraceId,
        diagnostics: buildDiagnostics(publishTraceId, business, account, landingPageApplied, null, createResult.error || null, trace),
      }, { status: 502 });
    }

    // ── Success! ─────────────────────────────────────────────────────
    trace.push(traceStep('GHL_CREATE_POST_SUCCEEDED', `postId=${createResult.postId || 'none'} status=${createResult.status}`));

    const textPublished = true;
    const mediaAttached = media.length > 0;
    const finalStatus = createResult.postId ? 'published_by_ghl' : 'published_unverified';

    const updated = await prisma.socialPost.update({
      where: { id: post.id },
      data: {
        status: finalStatus,
        publishedAt: new Date(),
        platforms,
        ghlPostId: createResult.postId || null,
        ghlSocialAccountId: account.id,
        ghlSocialAccountName: account.name,
        ghlSocialOriginId: account.originId,
        ghlStatus: createResult.status || 'success',
        publishResponseSummary: JSON.stringify({
          statusCode: createResult.statusCode,
          postId: createResult.postId,
          status: createResult.status,
          textPublished,
          mediaAttached,
          mediaCount: media.length,
          mediaUploadFailed: mediaUploadFailed && media.length > 0,
          mediaFailureReason: mediaUploadFailed ? mediaFailureReason : null,
          mediaHostedOnGhl: media.length > 0,
        }).slice(0, 1000),
        ...(finalCaption !== post.caption ? { caption: finalCaption } : {}),
      },
    });

    trace.push(traceStep('SOCIAL_POST_STATUS_UPDATED', `status=${finalStatus}`));
    trace.push(traceStep('POST_NOW_COMPLETED'));

    console.log(`[post-now] [${publishTraceId}] SUCCESS: post=${post.id} ghlPostId=${createResult.postId} status=${finalStatus}`);

    return NextResponse.json({
      success: true,
      post: {
        id: updated.id,
        status: updated.status,
        publishedAt: updated.publishedAt,
        platforms: updated.platforms,
        ghlPostId: createResult.postId,
      },
      mediaStatus: {
        textPublished,
        mediaAttached,
        mediaCount: media.length,
        mediaHostedOnGhl: media.length > 0,
        mediaUploadFailed: mediaUploadFailed && media.length > 0,
      },
      publishTraceId,
      diagnostics: buildDiagnostics(publishTraceId, business, account, landingPageApplied, createResult.postId || null, null, trace),
    });

  } catch (error: any) {
    console.error(`[post-now] [${publishTraceId}] Unhandled error:`, error);
    trace.push(traceStep('POST_NOW_FAILED', error.message));

    return NextResponse.json({
      success: false,
      error: 'An unexpected error occurred while publishing.',
      publishTraceId,
    }, { status: 500 });
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const TOMBSTONE_URL = process.env.TOMBSTONE_API_URL ?? 'https://tombstone-api-xjc4.onrender.com';

/** Infer MIME type from file path/extension for GHL media objects. */
function inferMimeType(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() || '';
  const map: Record<string, string> = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
    gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
    mp4: 'video/mp4', mov: 'video/quicktime', avi: 'video/x-msvideo',
  };
  return map[ext] || 'image/png';
}

/**
 * Resolves a relative artifact path (e.g. "renders/task_1735/...") to a full public URL.
 * If the path is already a full URL, returns it as-is.
 */
async function resolveMediaUrl(rawPath: string): Promise<string | null> {
  if (!rawPath) return null;
  if (rawPath.startsWith('http://') || rawPath.startsWith('https://')) return rawPath;

  // Strip r2:// prefix if present
  let cleanPath = rawPath;
  if (cleanPath.startsWith('r2://')) {
    const withoutScheme = cleanPath.slice(5);
    const slashIdx = withoutScheme.indexOf('/');
    cleanPath = slashIdx >= 0 ? withoutScheme.slice(slashIdx + 1) : withoutScheme;
  }

  try {
    const res = await fetch(
      `${TOMBSTONE_URL}/artifacts/resolve?artifact_path=${encodeURIComponent(cleanPath)}`,
      { cache: 'no-store' }
    );
    if (!res.ok) return null;
    const data = await res.json().catch(() => ({}));
    return data?.artifact_url ?? null;
  } catch {
    return null;
  }
}

function fail(
  traceId: string,
  trace: GhlTraceStep[],
  message: string,
  status: number,
  postId?: string
): NextResponse {
  trace.push(traceStep('POST_NOW_FAILED', message));
  console.warn(`[post-now] [${traceId}] FAILED: ${message}`);

  // Update post status if we have a postId
  if (postId) {
    prisma.socialPost.update({
      where: { id: postId },
      data: {
        status: 'failed_to_publish',
        publishTraceId: traceId,
        lastPublishAttemptAt: new Date(),
        publishResponseSummary: message.slice(0, 1000),
      },
    }).catch(err => {
      console.error(`[post-now] [${traceId}] Failed to update post status:`, err.message);
    });
  }

  return NextResponse.json({
    success: false,
    error: message,
    publishTraceId: traceId,
  }, { status });
}

function buildDiagnostics(
  traceId: string,
  business: { id: string; businessName: string | null; ghlLocationId: string | null },
  account: { id: string; name: string; platform: string; originId: string } | null,
  landingPageApplied: boolean,
  ghlPostId: string | null,
  errorSummary: string | null,
  trace: GhlTraceStep[]
) {
  return {
    publishTraceId: traceId,
    businessId: business.id,
    businessName: business.businessName,
    ghlLocationId: business.ghlLocationId,
    selectedAccount: account ? {
      name: account.name,
      platform: account.platform,
      originId: account.originId,
    } : null,
    landingPageApplied,
    ghlPostId,
    errorSummary,
    trace,
  };
}