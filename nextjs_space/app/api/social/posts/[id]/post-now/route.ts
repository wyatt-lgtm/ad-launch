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
import { validateRequestedChannels } from '@/lib/ghl-channel-filter';

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
        ghlLinkedAccountIds: true,
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
    const requestedAccountIds: string[] = Array.isArray(body.accountIds) ? body.accountIds.filter((id: any) => typeof id === 'string' && id.trim()) : [];
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

    // ── Resolve target accounts ──────────────────────────────────────
    // Build an array of accounts to publish to — one per selected channel.
    // Each gets its own independent createGhlSocialPost call.
    type GhlAccount = typeof accountsResult.accounts[0];
    let targetAccounts: GhlAccount[] = [];

    if (requestedAccountIds.length > 0) {
      // Validate that requested account IDs belong to this business and resolve
      // a de-duplicated list (one independent publish attempt per channel).
      const validation = validateRequestedChannels(
        requestedAccountIds,
        accountsResult.accounts.map(a => a.id),
        business.ghlLinkedAccountIds || [],
      );

      if (!validation.ok) {
        console.warn(`[post-now] [${publishTraceId}] REJECTED channel=${validation.channelId}: ${validation.error}`);
        return fail(publishTraceId, trace, validation.error, validation.code, post.id);
      }

      // Map each resolved ID to the full account object
      for (const reqId of validation.resolvedIds) {
        const found = accountsResult.accounts.find(a => a.id === reqId);
        if (found) targetAccounts.push(found);
      }

      if (targetAccounts.length === 0) {
        return fail(publishTraceId, trace, 'None of the selected channels were found.', 422, post.id);
      }
      trace.push(traceStep('GHL_ACCOUNTS_SELECTED_BY_ID', `count=${targetAccounts.length} ids=${targetAccounts.map(a => a.id).join(',')}`));
    } else {
      // Legacy: platform-based lookup → single account
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
      targetAccounts = [selection.selected];
      trace.push(traceStep('GHL_ACCOUNT_SELECTED', `name="${selection.selected.name}" platform=${selection.selected.platform} originId=${selection.selected.originId}`));
    }

    // Cache the first selected account as default if not already saved
    const firstAccount = targetAccounts[0];
    if (!business.defaultGhlSocialAccountId || business.defaultGhlSocialAccountId !== firstAccount.id) {
      await prisma.business.update({
        where: { id: business.id },
        data: {
          defaultGhlSocialAccountId: firstAccount.id,
          defaultGhlSocialAccountName: firstAccount.name,
          defaultGhlSocialPlatform: firstAccount.platform,
          defaultGhlSocialOriginId: firstAccount.originId,
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

    // ── Publish to each channel independently ────────────────────────
    // Each target account gets its own createGhlSocialPost call.
    // Media + userId are shared — only the accountId changes per call.
    type ChannelResult = {
      accountId: string;
      accountName: string;
      platform: string;
      success: boolean;
      ghlPostId: string | null;
      ghlStatus: string | null;
      error: string | null;
      traceId: string;
    };

    const channelResults: ChannelResult[] = [];

    for (const account of targetAccounts) {
      const channelTraceId = targetAccounts.length > 1
        ? `${publishTraceId}-${account.platform.slice(0, 3)}`
        : publishTraceId;

      const ghlPayload = {
        accountIds: [account.id],
        userId: resolvedUserId!,
        summary: finalCaption,
        media,
        type: 'post' as const,
      };

      trace.push(traceStep('GHL_CREATE_POST_REQUESTED', `account=${account.name} platform=${account.platform} channelTrace=${channelTraceId}`));

      console.log(`[post-now] [${channelTraceId}] Creating GHL post for channel:`, {
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

      try {
        const createResult = await createGhlSocialPost(
          business.ghlLocationId,
          business.ghlApiToken,
          ghlPayload
        );

        if (!createResult.success) {
          console.error(`[post-now] [${channelTraceId}] GHL Create Post FAILED for ${account.name}:`, createResult.error);
          trace.push(traceStep('GHL_CREATE_POST_FAILED', `account=${account.name} error=${createResult.error}`));
          channelResults.push({
            accountId: account.id,
            accountName: account.name,
            platform: account.platform,
            success: false,
            ghlPostId: null,
            ghlStatus: 'error',
            error: createResult.error || 'Launch CRM rejected the post.',
            traceId: channelTraceId,
          });
        } else {
          trace.push(traceStep('GHL_CREATE_POST_SUCCEEDED', `account=${account.name} postId=${createResult.postId || 'none'} status=${createResult.status}`));
          channelResults.push({
            accountId: account.id,
            accountName: account.name,
            platform: account.platform,
            success: true,
            ghlPostId: createResult.postId || null,
            ghlStatus: createResult.status || 'success',
            error: null,
            traceId: channelTraceId,
          });
        }
      } catch (err: any) {
        console.error(`[post-now] [${channelTraceId}] Exception publishing to ${account.name}:`, err.message);
        trace.push(traceStep('GHL_CREATE_POST_EXCEPTION', `account=${account.name} error=${err.message}`));
        channelResults.push({
          accountId: account.id,
          accountName: account.name,
          platform: account.platform,
          success: false,
          ghlPostId: null,
          ghlStatus: 'error',
          error: err.message || 'Unexpected error during publishing.',
          traceId: channelTraceId,
        });
      }
    }

    // ── Persist per-channel audit records ─────────────────────────────
    // One row per (post, channel) so a Google success never hides a
    // Facebook failure. Wrapped so audit failures never break publishing.
    try {
      await prisma.socialPublishAttempt.createMany({
        data: channelResults.map(r => {
          const acct = targetAccounts.find(a => a.id === r.accountId);
          return {
            businessId: business.id,
            socialPostId: post.id,
            selectedChannelId: r.accountId,
            platform: r.platform,
            accountName: r.accountName,
            externalAccountId: acct?.originId || null,
            externalPostId: r.ghlPostId,
            traceId: r.traceId,
            status: r.success ? 'published' : 'failed',
            errorMessage: r.error ? r.error.slice(0, 1000) : null,
            requestSummary: JSON.stringify({
              accountIds: [r.accountId],
              platform: r.platform,
              accountName: r.accountName,
              captionLength: finalCaption.length,
              mediaCount: media.length,
            }).slice(0, 1000),
            responseSummary: JSON.stringify({
              success: r.success,
              ghlPostId: r.ghlPostId,
              ghlStatus: r.ghlStatus,
              error: r.error,
            }).slice(0, 1000),
          };
        }),
      });
      trace.push(traceStep('PUBLISH_AUDIT_WRITTEN', `records=${channelResults.length}`));
    } catch (auditErr: any) {
      console.warn(`[post-now] [${publishTraceId}] Failed to write publish audit:`, auditErr.message);
    }

    // ── Aggregate results ─────────────────────────────────────────────
    const succeeded = channelResults.filter(r => r.success);
    const failed = channelResults.filter(r => !r.success);
    const allSucceeded = failed.length === 0;
    const allFailed = succeeded.length === 0;
    const partialSuccess = succeeded.length > 0 && failed.length > 0;

    const textPublished = true;
    const mediaAttached = media.length > 0;

    // Pick primary result for backward-compatible DB fields
    const primaryResult = succeeded[0] || channelResults[0];
    const finalStatus = allFailed
      ? 'failed_to_publish'
      : primaryResult.ghlPostId
        ? 'published_by_ghl'
        : 'published_unverified';

    const updated = await prisma.socialPost.update({
      where: { id: post.id },
      data: {
        status: finalStatus,
        publishedAt: allFailed ? undefined : new Date(),
        platforms,
        ghlPostId: primaryResult.ghlPostId,
        ghlSocialAccountId: primaryResult.accountId,
        ghlSocialAccountName: primaryResult.accountName,
        ghlSocialOriginId: targetAccounts.find(a => a.id === primaryResult.accountId)?.originId || null,
        ghlStatus: primaryResult.ghlStatus || (allFailed ? 'error' : 'success'),
        publishResponseSummary: JSON.stringify({
          multiChannel: true,
          totalChannels: channelResults.length,
          succeededCount: succeeded.length,
          failedCount: failed.length,
          channels: channelResults.map(r => ({
            accountId: r.accountId,
            accountName: r.accountName,
            platform: r.platform,
            success: r.success,
            ghlPostId: r.ghlPostId,
            error: r.error,
          })),
          textPublished,
          mediaAttached,
          mediaCount: media.length,
          mediaUploadFailed: mediaUploadFailed && media.length > 0,
        }).slice(0, 1000),
        ...(finalCaption !== post.caption ? { caption: finalCaption } : {}),
      },
    });

    trace.push(traceStep('SOCIAL_POST_STATUS_UPDATED', `status=${finalStatus} succeeded=${succeeded.length} failed=${failed.length}`));
    trace.push(traceStep('POST_NOW_COMPLETED'));

    console.log(`[post-now] [${publishTraceId}] COMPLETED: post=${post.id} status=${finalStatus} succeeded=${succeeded.length}/${channelResults.length}`);

    const overallSuccess = !allFailed;
    const httpStatus = allFailed ? 502 : 200;

    return NextResponse.json({
      success: overallSuccess,
      partial_success: partialSuccess,
      results: channelResults,
      post: {
        id: updated.id,
        status: updated.status,
        publishedAt: updated.publishedAt,
        platforms: updated.platforms,
      },
      mediaStatus: {
        textPublished,
        mediaAttached,
        mediaCount: media.length,
        mediaHostedOnGhl: media.length > 0,
        mediaUploadFailed: mediaUploadFailed && media.length > 0,
      },
      publishTraceId,
    }, { status: httpStatus });

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