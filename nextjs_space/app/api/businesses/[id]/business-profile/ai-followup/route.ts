import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';
export const dynamic = 'force-dynamic';

/**
 * POST /api/businesses/[id]/business-profile/ai-followup
 * Generates 1–3 AI follow-up questions based on answers in a section.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const userId = (session.user as any).id;
    const businessId = params.id;

    const business = await prisma.business.findFirst({ where: { id: businessId, userId }, select: { id: true, businessName: true } });
    if (!business) return NextResponse.json({ error: 'Business not found' }, { status: 404 });

    const body = await req.json();
    const { sectionId, sectionTitle, answers } = body;
    if (!sectionId || !answers || Object.keys(answers).length === 0) {
      return NextResponse.json({ error: 'Section ID and answers required' }, { status: 400 });
    }

    const apiKey = process.env.ABACUSAI_API_KEY;
    if (!apiKey) return NextResponse.json({ error: 'LLM API not configured' }, { status: 500 });

    const answersText = Object.entries(answers)
      .filter(([, v]) => v && (v as string).trim())
      .map(([k, v]) => `${k}: ${v}`)
      .join('\n');

    if (!answersText.trim()) {
      return NextResponse.json({ followUps: [] });
    }

    const systemPrompt = `You are a business profile interviewer helping "${business.businessName || 'a business'}" build their marketing profile.

Your job: review the answers given for the "${sectionTitle}" section and generate 1–3 targeted follow-up questions ONLY when the answers are vague, incomplete, or missing important details.

Rules:
- Ask NO follow-up questions if the answers are already detailed and complete.
- Ask at most 3 follow-up questions.
- Each question should be specific to what the user already wrote — not generic.
- Follow-ups should help extract concrete facts, examples, numbers, or proof points.
- Keep questions short and conversational.

Respond in JSON format:
{"followUps": ["question 1", "question 2"]}

If no follow-ups are needed, respond:
{"followUps": []}`;

    const userPrompt = `Here are the answers for the "${sectionTitle}" section:\n\n${answersText}\n\nGenerate specific follow-up questions if the answers need more detail. Remember: no more than 3, and NONE if the answers are already good.`;

    const llmRes = await fetch('https://apps.abacus.ai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        max_tokens: 500,
        temperature: 0.5,
        response_format: { type: 'json_object' },
      }),
    });

    if (!llmRes.ok) {
      console.error('[ai-followup] LLM error:', await llmRes.text());
      return NextResponse.json({ followUps: [] });
    }

    const data = await llmRes.json();
    const content = data.choices?.[0]?.message?.content || '';

    try {
      let cleaned = content.trim();
      if (cleaned.startsWith('```')) cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
      const parsed = JSON.parse(cleaned);
      const followUps = Array.isArray(parsed.followUps)
        ? parsed.followUps.filter((q: any) => typeof q === 'string').slice(0, 3)
        : [];
      return NextResponse.json({ followUps });
    } catch {
      return NextResponse.json({ followUps: [] });
    }
  } catch (err: any) {
    console.error('[ai-followup] Error:', err);
    return NextResponse.json({ error: 'Failed to generate follow-ups' }, { status: 500 });
  }
}
