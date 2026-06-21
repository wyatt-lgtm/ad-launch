export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';

const TOMBSTONE_URL = process.env.TOMBSTONE_API_URL || 'https://tombstone-api-xjc4.onrender.com';

/**
 * GET /api/workflow-progress?workflowId=...&includeArtifacts=true
 *
 * Proxies to Tombstone GET /workflows/{id}/progress
 * Returns progressive mission visibility data:
 *   - timeline stages with status/agent/elapsed
 *   - available artifacts
 *   - customer-safe activity messages
 *   - operator diagnostics (filtered by role on frontend)
 *   - artifact_details: parsed task outputs per completed stage (when includeArtifacts=true)
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const workflowId = searchParams.get('workflowId');
    const includeArtifacts = searchParams.get('includeArtifacts') === 'true';

    if (!workflowId) {
      return NextResponse.json({ error: 'workflowId is required' }, { status: 400 });
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);

    try {
      const res = await fetch(
        `${TOMBSTONE_URL}/workflows/${encodeURIComponent(workflowId)}/progress`,
        { cache: 'no-store', signal: controller.signal }
      );

      if (!res.ok) {
        if (res.status === 404) {
          return NextResponse.json({
            status: 'not_found',
            workflow_id: workflowId,
            activity_message: 'Preparing...',
            timeline: [],
            available_artifacts: [],
            still_working: [],
            completed_count: 0,
            total_count: 0,
            events: [],
            operator_diagnostics: [],
            artifact_details: {},
          });
        }
        const errText = await res.text().catch(() => 'Unknown error');
        console.error(`[workflow-progress] Tombstone returned ${res.status}: ${errText}`);
        return NextResponse.json({ error: 'Progress fetch failed' }, { status: 502 });
      }

      const data = await res.json();

      // If artifacts requested, fetch task outputs for completed tasks
      if (includeArtifacts && data.available_artifacts?.length > 0) {
        const artifactDetails: Record<string, any> = {};
        const fetchPromises = data.available_artifacts.map(async (art: any) => {
          if (!art.task_id) return;
          try {
            const outCtrl = new AbortController();
            const outTimer = setTimeout(() => outCtrl.abort(), 10000);
            const outRes = await fetch(
              `${TOMBSTONE_URL}/tasks/${art.task_id}/outputs`,
              { cache: 'no-store', signal: outCtrl.signal }
            );
            clearTimeout(outTimer);
            if (!outRes.ok) return;
            const outputs = await outRes.json().catch(() => []);
            if (!Array.isArray(outputs) || outputs.length === 0) return;

            // Parse the first output
            for (const out of outputs) {
              try {
                const parsed = typeof out.output === 'string' ? JSON.parse(out.output) : out.output;
                if (parsed) {
                  artifactDetails[art.type] = extractArtifactSummary(art.type, parsed);
                  break;
                }
              } catch { /* skip non-JSON */ }
            }
          } catch { /* non-critical */ }
        });

        await Promise.all(fetchPromises);
        data.artifact_details = artifactDetails;
      } else {
        data.artifact_details = {};
      }

      return NextResponse.json(data);
    } finally {
      clearTimeout(timer);
    }
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      return NextResponse.json({ error: 'Timeout fetching progress' }, { status: 504 });
    }
    console.error('[workflow-progress] Error:', err?.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

/**
 * Extract a customer-friendly summary from raw task output based on artifact type.
 * Returns structured data suitable for display in the production room.
 */
function extractArtifactSummary(type: string, raw: any): any {
  switch (type) {
    case 'business_research': {
      return {
        business_name: raw.business_name || raw.brand_name || raw.name || null,
        industry: raw.industry || raw.business_type || raw.category || null,
        products_services: raw.products_services || raw.services || raw.products || raw.service_taxonomy || null,
        brand_notes: raw.brand_notes || raw.brand_personality || raw.brand_voice || null,
        summary: raw.summary || raw.brand_asset_recon?.summary || raw.executive_summary || null,
        location: raw.location || raw.service_area || null,
        website_url: raw.website_url || raw.url || null,
        competitive_seo_recon: raw.competitive_seo_recon || null,
        competitor_intelligence: raw.competitor_intelligence || null,
      };
    }
    case 'strategy_brief': {
      const brief = raw.website_strategy_brief || raw.strategy_brief || raw;
      return {
        primary_business_type: brief.primary_business_type || null,
        target_customer: brief.target_customer || null,
        core_pain_points: brief.core_pain_points || null,
        primary_conversion_action: brief.primary_conversion_action || null,
        seo_sitemap: brief.seo_sitemap || null,
        service_taxonomy: brief.service_taxonomy || null,
        homepage_section_plan: brief.homepage_section_plan || null,
        positioning: brief.positioning || brief.value_proposition || null,
        seo_priorities: brief.seo_priorities || brief.seo_keywords || null,
      };
    }
    case 'copy_deck': {
      const deck = raw.website_copy_deck || raw.copy_deck || raw;
      return {
        section_contracts: raw.section_contracts || null,
        sections: deck.sections || deck.homepage_sections || null,
        cta_strategy: deck.cta_strategy || deck.primary_cta || null,
        meta_title: deck.meta_title || null,
        meta_description: deck.meta_description || null,
        headline: deck.headline || deck.hero_headline || null,
      };
    }
    case 'image_direction': {
      const strategy = raw.image_strategy || raw;
      if (Array.isArray(strategy)) {
        return {
          briefs: strategy.map((s: any) => ({
            section_id: s.section_id || s.section || null,
            image_purpose: s.image_purpose || null,
            visual_style: s.visual_style || null,
            must_show: s.must_show || null,
            must_avoid: s.must_avoid || null,
            composition: s.composition || null,
          })),
        };
      }
      return { briefs: strategy.briefs || strategy.sections || [strategy] };
    }
    case 'rendered_images': {
      return {
        image_count: Array.isArray(raw.renders) ? raw.renders.length : raw.image_url ? 1 : 0,
        renders: Array.isArray(raw.renders)
          ? raw.renders.map((r: any) => ({
              section: r.section_id || r.campaign_id || null,
              status: r.status || 'complete',
            }))
          : [],
      };
    }
    case 'website_preview': {
      return {
        has_html: !!raw.html,
        page_count: raw.page_count || 1,
      };
    }
    case 'qa_report': {
      return {
        verdict: raw.verdict || raw.overall_verdict || null,
        summary: raw.summary || raw.overall_summary || null,
        gates: Array.isArray(raw.gates)
          ? raw.gates.map((g: any) => ({
              gate_id: g.gate_id || g.id || null,
              status: g.status || null,
              reason: g.reason || g.note || null,
            }))
          : null,
        pass_count: Array.isArray(raw.gates) ? raw.gates.filter((g: any) => g.status === 'PASS').length : null,
        total_gates: Array.isArray(raw.gates) ? raw.gates.length : null,
      };
    }
    default:
      return { raw_keys: Object.keys(raw).slice(0, 10) };
  }
}
