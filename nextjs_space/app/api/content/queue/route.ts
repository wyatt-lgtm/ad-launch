export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';

const TOMBSTONE_URL = process.env.TOMBSTONE_API_URL ?? 'https://tombstone-api-xjc4.onrender.com';

/**
 * Extract all Tombstone workflow IDs from a user's analyses.
 * missionId is stored as JSON: {"website": "uuid1", "news": "uuid2", ...}
 * or as a legacy comma-separated string of UUIDs.
 */
function extractWorkflowIds(analyses: { missionId: string | null }[]): string[] {
  const ids: Set<string> = new Set();
  for (const a of analyses) {
    if (!a.missionId) continue;
    try {
      const parsed = JSON.parse(a.missionId);
      if (typeof parsed === 'object' && !Array.isArray(parsed)) {
        for (const v of Object.values(parsed)) {
          if (typeof v === 'string' && v.trim()) ids.add(v.trim());
          else if (Array.isArray(v)) {
            for (const id of v) {
              if (typeof id === 'string' && id.trim()) ids.add(id.trim());
            }
          }
        }
      }
    } catch {
      // Legacy comma-separated format
      for (const part of a.missionId.split(',')) {
        const trimmed = part.trim();
        if (trimmed) ids.add(trimmed);
      }
    }
  }
  return Array.from(ids);
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = searchParams.get('limit') || '50';

    // Look up the current user's workflow IDs for siloing
    let workflowFilter = '';
    try {
      const session = await getServerSession(authOptions);
      const userId = (session?.user as any)?.id;
      if (userId) {
        const analyses = await prisma.analysis.findMany({
          where: { userId },
          select: { missionId: true },
        });
        const wfIds = extractWorkflowIds(analyses);
        if (wfIds.length > 0) {
          workflowFilter = `&workflow_ids=${encodeURIComponent(wfIds.join(','))}`;
        }
      }
    } catch (e: any) {
      // If session/DB lookup fails, fall through without filter (graceful degradation)
      console.warn('[content/queue] Could not resolve user workflow IDs:', e.message);
    }

    const res = await fetch(`${TOMBSTONE_URL}/content/queue?limit=${limit}${workflowFilter}`, {
      headers: { 'Accept': 'application/json' },
      cache: 'no-store',
    });
    if (!res.ok) {
      return NextResponse.json({ error: 'Failed to fetch content queue' }, { status: res.status });
    }
    const data = await res.json();

    // Enrich queue items with campaign_name from detail (parallel, lightweight)
    if (Array.isArray(data) && data.length > 0) {
      const enrichPromises = data.map(async (item: any) => {
        try {
          const detailRes = await fetch(`${TOMBSTONE_URL}/content/${item.task_id}`, {
            headers: { 'Accept': 'application/json' },
            cache: 'no-store',
          });
          if (!detailRes.ok) return item;
          const detail = await detailRes.json();

          // Extract campaign names from platform_variants
          const pv = detail.platform_variants;
          const campaignNames: string[] = [];
          if (Array.isArray(pv)) {
            for (const v of pv) {
              if (v?.campaign_name) campaignNames.push(v.campaign_name);
            }
          }

          // Extract base_caption or first campaign summary
          let captionPreview = detail.base_caption || '';
          if (!captionPreview && Array.isArray(pv)) {
            for (const v of pv) {
              if (v?.summary) { captionPreview = v.summary; break; }
            }
          }

          return {
            ...item,
            campaign_names: campaignNames,
            caption_preview: captionPreview ? captionPreview.slice(0, 120) : null,
          };
        } catch {
          return item;
        }
      });

      const enriched = await Promise.all(enrichPromises);
      return NextResponse.json(enriched);
    }

    return NextResponse.json(data);
  } catch (e: any) {
    console.error('[content/queue] Error:', e.message);
    return NextResponse.json({ error: 'Content queue unavailable' }, { status: 502 });
  }
}
