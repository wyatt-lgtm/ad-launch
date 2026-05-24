export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { generateContentBrief } from '@/lib/rss/trade-area-feed';
import { generateInterestFeedBrief, type InterestFeedBrief } from '@/lib/rss/interest-feed-brief';
import { getUpcomingEvents } from '@/lib/social/upcoming-events';
import type { ContentBrief } from '@/lib/rss/trade-area-feed';
import { generateMagicToken } from '@/lib/magic-token';

/**
 * POST /api/scout/daily-run
 *
 * Admin-triggerable endpoint for the Daily Scout Report.
 * Can be called externally (e.g., cron, webhook) to process all enabled scout email configs.
 *
 * Auth: requires admin API key via Authorization header or query param.
 */

interface StoryItem {
  title: string;
  source: string;
  sourceType: 'local' | 'industry' | 'national';
  pubDate: string;
  summary: string;
  relevance: string;
  link: string;
  postAngle: string;
}

export async function POST(req: NextRequest) {
  const start = Date.now();

  // Simple auth: admin API key check
  const authHeader = req.headers.get('authorization') || '';
  const apiKey = authHeader.replace('Bearer ', '') || req.nextUrl.searchParams.get('key') || '';
  const expectedKey = process.env.ABACUSAI_API_KEY;
  if (!expectedKey || apiKey !== expectedKey) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Load all enabled scout email configs
    const configs = await prisma.scoutEmailSettings.findMany({
      where: { enabled: true, recipientEmail: { not: '' } },
      include: {
        business: {
          select: {
            id: true,
            businessName: true,
            businessCity: true,
            businessState: true,
            businessZip: true,
            contentSourceMode: true,
            userId: true,
          },
        },
      },
    });

    console.log(`[DailyScout] Processing ${configs.length} enabled configs`);
    const results: { businessId: string; businessName: string; sent: boolean; storiesSent: number; error?: string }[] = [];

    for (const config of configs) {
      const biz = config.business;
      if (!biz) {
        results.push({ businessId: config.businessId, businessName: '(unknown)', sent: false, storiesSent: 0, error: 'Business not found' });
        continue;
      }

      try {
        // Gather stories
        const stories = await gatherStories(config, biz);

        if (stories.length === 0) {
          console.log(`[DailyScout] No new stories for ${biz.businessName || biz.id}`);
          results.push({ businessId: biz.id, businessName: biz.businessName || '', sent: false, storiesSent: 0, error: 'No new stories' });
          continue;
        }

        // Deduplicate against recently sent stories (last 7 days)
        const recentlySent = await prisma.scoutEmailHistory.findMany({
          where: {
            businessId: biz.id,
            sentAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
          },
          select: { storyTitle: true },
        });
        const sentTitles = new Set(recentlySent.map(h => h.storyTitle.toLowerCase().trim()));
        const freshStories = stories.filter(s => !sentTitles.has(s.title.toLowerCase().trim()));

        if (freshStories.length === 0) {
          console.log(`[DailyScout] All stories already sent for ${biz.businessName || biz.id}`);
          results.push({ businessId: biz.id, businessName: biz.businessName || '', sent: false, storiesSent: 0, error: 'All stories already sent' });
          continue;
        }

        // Clamp to maxStories
        const finalStories = freshStories.slice(0, config.maxStories);

        // Create ScoutReport + ScoutStory records
        const reportExpiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000); // 72h
        const scoutReport = await prisma.scoutReport.create({
          data: {
            businessId: biz.id,
            userId: biz.userId,
            status: 'sent',
            storiesCount: finalStories.length,
            expiresAt: reportExpiresAt,
            stories: {
              create: finalStories.map(s => ({
                title: s.title,
                source: s.source,
                sourceUrl: s.link || '',
                sourceType: s.sourceType,
                pubDate: s.pubDate || '',
                summary: s.summary,
                relevance: s.relevance,
                suggestedAngle: s.postAngle,
              })),
            },
          },
          include: { stories: true },
        });
        console.log(`[DailyScout] Created ScoutReport ${scoutReport.id} with ${scoutReport.stories.length} stories`);

        // Generate magic tokens for each story
        const appUrl = process.env.NEXTAUTH_URL || 'https://connect.launchmarketing.com';
        const storyTokens: { storyId: string; token: string }[] = [];
        for (const story of scoutReport.stories) {
          const token = await generateMagicToken({
            userId: biz.userId,
            businessId: biz.id,
            scoutReportId: scoutReport.id,
            storyId: story.id,
            action: 'create_post',
            expiresInHours: 72,
          });
          storyTokens.push({ storyId: story.id, token });
        }

        // Generate review-all token
        const reviewToken = await generateMagicToken({
          userId: biz.userId,
          businessId: biz.id,
          scoutReportId: scoutReport.id,
          action: 'review_stories',
          expiresInHours: 72,
        });

        // Build and send email with magic links
        const htmlBody = buildScoutEmailHtml(
          biz.businessName || 'Your Business',
          finalStories,
          appUrl,
          scoutReport.stories,
          storyTokens,
          reviewToken,
          scoutReport.id,
        );
        const emailSent = await sendScoutEmail(config.recipientEmail, biz.businessName || 'Your Business', htmlBody);

        // Log sent stories
        if (emailSent) {
          await prisma.scoutEmailHistory.createMany({
            data: finalStories.map(s => ({
              businessId: biz.id,
              storyTitle: s.title,
              storyLink: s.link || '',
              storySource: s.source || '',
              sourceType: s.sourceType,
            })),
          });
        }

        results.push({
          businessId: biz.id,
          businessName: biz.businessName || '',
          sent: emailSent,
          storiesSent: emailSent ? finalStories.length : 0,
          error: emailSent ? undefined : 'Email send failed',
        });

        console.log(`[DailyScout] ${biz.businessName}: ${emailSent ? 'sent' : 'failed'} ${finalStories.length} stories to ${config.recipientEmail}`);
      } catch (bizErr: any) {
        console.error(`[DailyScout] Error for ${biz.id}:`, bizErr);
        results.push({ businessId: biz.id, businessName: biz.businessName || '', sent: false, storiesSent: 0, error: bizErr.message });
      }
    }

    return NextResponse.json({
      processed: configs.length,
      results,
      durationMs: Date.now() - start,
    });
  } catch (err: any) {
    console.error('[DailyScout] Fatal error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// ── Gather stories from existing scout logic ────────────────────────────────

async function gatherStories(
  config: { includeLocal: boolean; includeIndustry: boolean; includeNational: boolean; maxStories: number },
  biz: { id: string; businessCity: string | null; businessState: string | null; businessZip: string | null; contentSourceMode: string },
): Promise<StoryItem[]> {
  const stories: StoryItem[] = [];
  const tradeCity = biz.businessCity || '';

  // Local RSS stories
  if (config.includeLocal && biz.businessZip) {
    try {
      const rssBrief: ContentBrief | null = await generateContentBrief(biz.businessZip, 25, { days: 3, limit: 20 });
      if (rssBrief && rssBrief.headlines.length > 0) {
        for (const h of rssBrief.headlines.slice(0, 8)) {
          stories.push({
            title: h.title,
            source: h.source,
            sourceType: 'local',
            pubDate: h.pubDate || '',
            summary: `${h.sourceType === 'weather' ? 'Weather update' : 'Local news'} from ${h.source}`,
            relevance: tradeCity ? `Relevant to your ${tradeCity} trade area` : 'Local trade area news',
            link: h.link || '',
            postAngle: suggestPostAngle(h.title, h.sourceType || 'local_news'),
          });
        }
      }
    } catch (err) {
      console.error('[DailyScout] Local RSS error:', err);
    }
  }

  // Industry/interest stories
  if (config.includeIndustry) {
    try {
      const interestBrief: InterestFeedBrief | null = await generateInterestFeedBrief(biz.id, { days: 3 });
      if (interestBrief && interestBrief.categories.length > 0) {
        for (const cat of interestBrief.categories) {
          for (const h of (cat.headlines || []).slice(0, 3)) {
            stories.push({
              title: h.title,
              source: h.source,
              sourceType: 'industry',
              pubDate: h.pubDate || '',
              summary: `Industry news in ${cat.label}`,
              relevance: `Matches your selected interest: ${cat.label}`,
              link: h.link || '',
              postAngle: suggestPostAngle(h.title, 'industry'),
            });
          }
        }
      }
    } catch (err) {
      console.error('[DailyScout] Interest feed error:', err);
    }
  }

  // National/events
  if (config.includeNational) {
    try {
      const events = getUpcomingEvents();
      for (const e of events.slice(0, 4)) {
        stories.push({
          title: e.name,
          source: 'Holiday Calendar',
          sourceType: 'national',
          pubDate: e.date || '',
          summary: e.ideas || 'Upcoming holiday or event',
          relevance: 'Seasonal content opportunity for engagement',
          link: '',
          postAngle: `Tie ${e.name} into a seasonal promotion or community shout-out`,
        });
      }
    } catch (err) {
      console.error('[DailyScout] Events error:', err);
    }
  }

  return stories;
}

// ── Suggest a post angle from the story ─────────────────────────────────────

function suggestPostAngle(title: string, sourceType: string): string {
  const lower = title.toLowerCase();
  if (sourceType === 'weather' || lower.includes('weather') || lower.includes('storm') || lower.includes('forecast')) {
    return 'Share a weather-aware tip or check-in with your community';
  }
  if (lower.includes('open') || lower.includes('launch') || lower.includes('new')) {
    return 'Congratulate or welcome a new local development';
  }
  if (lower.includes('event') || lower.includes('festival') || lower.includes('celebration')) {
    return 'Highlight a local event and tie it to your business';
  }
  if (lower.includes('award') || lower.includes('honor') || lower.includes('recogni')) {
    return 'Celebrate community achievements and show local pride';
  }
  if (sourceType === 'government' || lower.includes('council') || lower.includes('vote') || lower.includes('meeting')) {
    return 'Share a local government update that affects your audience';
  }
  if (sourceType === 'industry') {
    return 'Share your expert take on this industry trend';
  }
  return 'Turn this news into a conversation-starter for your audience';
}

// ── Build the scout email HTML ──────────────────────────────────────────────

function buildScoutEmailHtml(
  businessName: string,
  stories: StoryItem[],
  appUrl: string,
  dbStories: { id: string; title: string; sourceType: string }[],
  storyTokens: { storyId: string; token: string }[],
  reviewToken: string,
  reportId: string,
): string {
  const tokenMap = new Map(storyTokens.map(t => [t.storyId, t.token]));
  const dbMap = new Map(dbStories.map(s => [s.title, s]));

  const localStories = stories.filter(s => s.sourceType === 'local');
  const industryStories = stories.filter(s => s.sourceType === 'industry');
  const nationalStories = stories.filter(s => s.sourceType === 'national');

  const storyRow = (s: StoryItem) => {
    const dbStory = dbMap.get(s.title);
    const token = dbStory ? tokenMap.get(dbStory.id) : null;
    const createPostUrl = token ? `${appUrl}/api/scout/create-post?token=${encodeURIComponent(token)}` : '';

    return `
    <tr>
      <td style="padding: 12px 16px; border-bottom: 1px solid #f1f5f9;">
        <div style="font-weight: 600; color: #1e293b; font-size: 14px; margin-bottom: 4px;">
          ${s.link ? `<a href="${s.link}" style="color: #2563eb; text-decoration: none;">${escHtml(s.title)}</a>` : escHtml(s.title)}
        </div>
        <div style="font-size: 12px; color: #64748b; margin-bottom: 4px;">
          ${escHtml(s.source)} · ${s.pubDate ? s.pubDate.split('T')[0] : 'Recent'}
        </div>
        <div style="font-size: 13px; color: #475569; margin-bottom: 4px;">${escHtml(s.summary)}</div>
        <div style="font-size: 12px; color: #2563eb; font-style: italic;">${escHtml(s.relevance)}</div>
        <div style="font-size: 12px; color: #059669; margin-top: 4px; font-weight: 500;">💡 Post angle: ${escHtml(s.postAngle)}</div>
        ${createPostUrl ? `
        <div style="margin-top: 8px;">
          <a href="${createPostUrl}" style="display: inline-block; background: #2563eb; color: white; padding: 6px 16px; border-radius: 6px; text-decoration: none; font-weight: 600; font-size: 12px;">
            ✨ Create Post
          </a>
        </div>` : ''}
      </td>
    </tr>
  `;
  };

  const section = (title: string, emoji: string, items: StoryItem[]) => {
    if (items.length === 0) return '';
    return `
      <div style="margin-bottom: 24px;">
        <h2 style="font-size: 16px; font-weight: 700; color: #1e293b; margin: 0 0 8px 0; padding: 8px 16px; background: #f8fafc; border-radius: 8px;">
          ${emoji} ${title}
        </h2>
        <table cellpadding="0" cellspacing="0" width="100%" style="border-collapse: collapse;">
          ${items.map(storyRow).join('')}
        </table>
      </div>
    `;
  };

  const reviewAllUrl = `${appUrl}/scout/review/${reportId}?token=${encodeURIComponent(reviewToken)}`;

  return `
    <div style="max-width: 600px; margin: 0 auto; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #ffffff;">
      <div style="background: #0f172a; color: white; padding: 24px; text-align: center; border-radius: 12px 12px 0 0;">
        <h1 style="margin: 0; font-size: 20px; font-weight: 700;">📰 Daily Scout Report</h1>
        <p style="margin: 8px 0 0 0; font-size: 14px; color: #94a3b8;">Story recommendations for ${escHtml(businessName)}</p>
        <p style="margin: 4px 0 0 0; font-size: 12px; color: #64748b;">${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
      </div>

      <div style="padding: 24px;">
        <p style="font-size: 14px; color: #475569; margin: 0 0 20px 0;">
          Here are today's top story recommendations. Click <strong>Create Post</strong> on any story to generate a ready-to-post social media package.
        </p>

        ${section('Local Stories', '📍', localStories)}
        ${section('Industry Stories', '🏢', industryStories)}
        ${section('National & Events', '🎉', nationalStories)}

        <div style="text-align: center; margin-top: 24px;">
          <a href="${reviewAllUrl}" style="display: inline-block; background: #0f172a; color: white; padding: 12px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 14px;">
            📋 Review All Stories
          </a>
        </div>
        <div style="text-align: center; margin-top: 10px;">
          <p style="font-size: 12px; color: #64748b;">Select up to 3 stories and create posts from the full review page.</p>
        </div>

        <p style="font-size: 11px; color: #94a3b8; text-align: center; margin-top: 20px;">
          You're receiving this because Daily Scout Report is enabled for ${escHtml(businessName)}.
          <br/>Links expire in 72 hours. Manage settings in Ad Launch → Content Sources.
        </p>
      </div>
    </div>
  `;
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Send the email via Abacus notification API ──────────────────────────────

async function sendScoutEmail(to: string, businessName: string, htmlBody: string): Promise<boolean> {
  try {
    const appHostname = (process.env.NEXTAUTH_URL || '').replace(/^https?:\/\//, '').split('/')[0];
    const res = await fetch('https://apps.abacus.ai/api/sendNotificationEmail', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deployment_token: process.env.ABACUSAI_API_KEY,
        app_id: process.env.WEB_APP_ID,
        notification_id: process.env.NOTIF_ID_DAILY_SCOUT_REPORT,
        subject: `📰 Daily Scout Report — ${businessName}`,
        body: htmlBody,
        is_html: true,
        recipient_email: to,
        sender_email: `noreply@${appHostname}`,
        sender_alias: 'Ad Launch Scout',
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!data?.success) {
      console.error('[DailyScout] Email send failed:', JSON.stringify(data));
      return false;
    }
    return true;
  } catch (err: any) {
    console.error('[DailyScout] Email send error:', err?.message);
    return false;
  }
}
