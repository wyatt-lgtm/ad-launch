export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';

const TOMBSTONE_URL = process.env.TOMBSTONE_API_URL ?? 'https://tombstone-api-xjc4.onrender.com';

/**
 * GET /api/site-diagnostics?workflowId=xxx
 * Fetch workflow task outputs to expose strategy brief, section contracts,
 * image briefs, and QA gate results.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const workflowId = searchParams.get('workflowId');
    if (!workflowId) {
      return NextResponse.json({ error: 'workflowId required' }, { status: 400 });
    }

    // Fetch all tasks for this workflow from Tombstone
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    let tasks: any[] = [];
    try {
      const res = await fetch(`${TOMBSTONE_URL}/tasks`, { cache: 'no-store', signal: controller.signal });
      const allTasks = await res.json().catch(() => []);
      tasks = Array.isArray(allTasks)
        ? allTasks.filter((t: any) => t?.workflow_id === workflowId)
        : [];
    } finally {
      clearTimeout(timer);
    }

    if (tasks.length === 0) {
      return NextResponse.json({ error: 'Workflow not found' }, { status: 404 });
    }

    // Extract diagnostics from each step
    const diagnostics: any = {
      workflowId,
      steps: [],
      strategyBrief: null,
      sectionContracts: null,
      copyDeck: null,
      imageStrategy: null,
      qaGates: null,
    };

    // Sort by step_order
    tasks.sort((a: any, b: any) => (a.step_order ?? 0) - (b.step_order ?? 0));

    for (const task of tasks) {
      const dept = (task.department ?? '').toLowerCase();
      const status = (task.status ?? '').toLowerCase();
      const stepInfo = {
        stepOrder: task.step_order,
        department: task.department,
        status,
        lastError: task.last_error ?? null,
      };
      diagnostics.steps.push(stepInfo);

      // Only parse completed task outputs
      if (status !== 'complete' && status !== 'completed') continue;

      // Fetch task output
      try {
        const outRes = await fetch(`${TOMBSTONE_URL}/tasks/${task.id}/outputs`, { cache: 'no-store' });
        const outputs = await outRes.json().catch(() => []);
        if (!Array.isArray(outputs) || outputs.length === 0) continue;

        for (const out of outputs) {
          let parsed: any = null;
          try {
            parsed = typeof out.output === 'string' ? JSON.parse(out.output) : out.output;
          } catch { continue; }
          if (!parsed) continue;

          // Step 2 (Marketing) — strategy brief
          if (dept.includes('marketing')) {
            diagnostics.strategyBrief = parsed.website_strategy_brief
              ?? parsed.strategy_brief
              ?? parsed;
          }

          // Step 3 (Creative Strategy) — section contracts + copy deck
          if (dept.includes('creative strategy')) {
            diagnostics.sectionContracts = parsed.section_contracts ?? null;
            diagnostics.copyDeck = parsed.website_copy_deck ?? parsed.copy_deck ?? parsed;
          }

          // Step 4 (Creative Direction) — image strategy
          if (dept.includes('creative direction')) {
            diagnostics.imageStrategy = parsed.image_strategy ?? parsed;
          }

          // Step 8 (Strategy & Intelligence) — QA gates
          if (dept.includes('strategy') && dept.includes('intelligence')) {
            diagnostics.qaGates = parsed;
          }
        }
      } catch { /* non-critical */ }
    }

    return NextResponse.json(diagnostics);
  } catch (err: any) {
    console.error('[site-diagnostics] GET error:', err?.message);
    return NextResponse.json({ error: 'Failed to load diagnostics' }, { status: 500 });
  }
}
