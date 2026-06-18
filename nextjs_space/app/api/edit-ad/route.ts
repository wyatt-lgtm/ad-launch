export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';

const TOMBSTONE_URL = process.env.TOMBSTONE_API_URL ?? 'https://tombstone-api-xjc4.onrender.com';

/**
 * POST /api/edit-ad
 *
 * Two-phase creative edit workflow through Tombstone:
 *
 * Phase 1 — "create" (default when no workflow_id):
 *   Input:  { prompt, headline, caption, angle, businessId, assetId?, currentImageUrl? }
 *   Output: { workflow_id, original_instruction, don_draper_prompt }
 *   Tombstone creates a creative edit workflow and Don Draper converts
 *   the customer instruction into a structured edit/render prompt.
 *
 * Phase 2 — "execute" (when workflow_id is present):
 *   Input:  { workflow_id, selected_prompt, use_don_draper: boolean }
 *   Output: { imageUrl }
 *   Frontend sends the selected prompt (original or Don Draper's).
 *   Andy Warhol executes the edit/render, Tombstone saves to Cloudflare,
 *   and returns the asset URL.
 *
 * Legacy mode — single-step (when phase is not specified and Tombstone
 * doesn't support the two-phase flow yet): falls back to the existing
 * single-call proxy pattern.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const {
      prompt,
      headline,
      caption,
      angle,
      businessId,
      assetId,
      currentImageUrl,
      // Phase 2 fields
      workflow_id,
      selected_prompt,
      use_don_draper,
    } = body ?? {};

    // ── Phase 2: Execute with selected prompt ──
    if (workflow_id) {
      console.log(`[edit-ad] Phase 2: executing workflow ${workflow_id}`);
      const res = await fetch(`${TOMBSTONE_URL}/creative-edit/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workflow_id,
          selected_prompt: selected_prompt ?? prompt ?? '',
          use_don_draper: use_don_draper ?? false,
        }),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        console.error(`[edit-ad] Phase 2 Tombstone error ${res.status}:`, errText.slice(0, 300));
        return NextResponse.json(
          { error: res.status === 422 ? 'Creative concept needs improvement. Please refine your edit request.' : 'Image generation failed' },
          { status: res.status >= 400 && res.status < 500 ? res.status : 500 },
        );
      }

      const data = await res.json();
      return NextResponse.json({ imageUrl: data?.imageUrl ?? data?.image_url ?? null });
    }

    // ── Phase 1: Create creative edit workflow ──
    if (!prompt) {
      return NextResponse.json({ error: 'Edit prompt is required' }, { status: 400 });
    }

    console.log(`[edit-ad] Phase 1: creating creative edit workflow`);
    const res = await fetch(`${TOMBSTONE_URL}/creative-edit/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        business_id: businessId ?? null,
        asset_id: assetId ?? null,
        current_image_url: currentImageUrl ?? null,
        original_instruction: prompt,
        headline: headline ?? '',
        caption: caption ?? '',
        angle: angle ?? 'General',
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.error(`[edit-ad] Phase 1 Tombstone error ${res.status}:`, errText.slice(0, 300));

      // If Tombstone doesn't support the two-phase flow yet, fall back to
      // the legacy single-call pattern with /edit-ad-image
      if (res.status === 404) {
        console.log('[edit-ad] Tombstone /creative-edit/create not found, falling back to /edit-ad-image');
        const fallbackRes = await fetch(`${TOMBSTONE_URL}/edit-ad-image`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt,
            headline: headline ?? '',
            caption: caption ?? '',
            angle: angle ?? 'General',
            business_id: businessId ?? null,
          }),
        });

        if (!fallbackRes.ok) {
          const fbErr = await fallbackRes.text().catch(() => '');
          console.error(`[edit-ad] Fallback error ${fallbackRes.status}:`, fbErr.slice(0, 300));
          return NextResponse.json(
            { error: 'Image generation failed' },
            { status: fallbackRes.status >= 400 && fallbackRes.status < 500 ? fallbackRes.status : 500 },
          );
        }

        const fbData = await fallbackRes.json();
        return NextResponse.json({ imageUrl: fbData?.imageUrl ?? fbData?.image_url ?? null });
      }

      return NextResponse.json(
        { error: 'Failed to create creative edit workflow' },
        { status: res.status >= 400 && res.status < 500 ? res.status : 500 },
      );
    }

    const data = await res.json();
    return NextResponse.json({
      workflow_id: data.workflow_id,
      original_instruction: prompt,
      don_draper_prompt: data.don_draper_prompt ?? data.suggested_prompt ?? null,
    });
  } catch (err: any) {
    console.error('[edit-ad] Error:', err?.message ?? err);
    return NextResponse.json({ error: 'Failed to process edit request' }, { status: 500 });
  }
}
