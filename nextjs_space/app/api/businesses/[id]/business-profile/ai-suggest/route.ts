import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';
export const dynamic = 'force-dynamic';

/**
 * POST /api/businesses/[id]/business-profile/ai-suggest
 * Generates an AI-suggested answer for a specific question.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const userId = (session.user as any).id;
    const businessId = params.id;

    const business = await prisma.business.findFirst({
      where: { id: businessId, userId },
      select: { id: true, businessName: true, websiteUrl: true, businessAddr: true, businessCity: true },
    });
    if (!business) return NextResponse.json({ error: 'Business not found' }, { status: 404 });
    const address = [business.businessAddr, business.businessCity].filter(Boolean).join(', ') || null;

    const body = await req.json();
    const { questionKey, questionLabel, sectionTitle, existingAnswers, helper, example } = body;
    if (!questionLabel) {
      return NextResponse.json({ error: 'Question label required' }, { status: 400 });
    }

    const apiKey = process.env.ABACUSAI_API_KEY;
    if (!apiKey) return NextResponse.json({ error: 'LLM API not configured' }, { status: 500 });

    // Build context from business data + existing answers
    const contextParts: string[] = [];
    if (business.businessName) contextParts.push(`Business name: ${business.businessName}`);
    if (business.websiteUrl) contextParts.push(`Website: ${business.websiteUrl}`);
    if (address) contextParts.push(`Address: ${address}`);

    if (existingAnswers && typeof existingAnswers === 'object') {
      const filled = Object.entries(existingAnswers as Record<string, Record<string, string>>)
        .flatMap(([, sectionAnswers]) =>
          Object.entries(sectionAnswers as Record<string, string>)
            .filter(([, v]) => v && v.trim())
            .map(([k, v]) => `${k}: ${v}`)
        );
      if (filled.length > 0) {
        contextParts.push(`\nExisting interview answers:\n${filled.join('\n')}`);
      }
    }

    const systemPrompt = `You are a business profile assistant helping "${business.businessName || 'a local business'}" answer interview questions to build their marketing profile.

Your job: suggest a draft answer for the question below. The answer should be:
- Realistic and specific to the business
- Based on the context provided (business name, category, location, existing answers)
- Written in the business owner's voice (first person plural: "we", "our")
- 2–4 sentences, practical and concrete
- Clearly marked as a suggestion that the owner should edit

If you don't have enough context, write a reasonable template with [brackets] for details the owner should fill in.

Respond with ONLY the suggested answer text. No preamble, no "Here's a suggestion:" prefix.`;

    let userPrompt = `Question: ${questionLabel}\nSection: ${sectionTitle || 'General'}`;
    if (helper) userPrompt += `\nGuidance: ${helper}`;
    if (example) userPrompt += `\nExample answer: ${example}`;
    if (contextParts.length > 0) userPrompt += `\n\nBusiness context:\n${contextParts.join('\n')}`;

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
        temperature: 0.7,
      }),
    });

    if (!llmRes.ok) {
      console.error('[ai-suggest] LLM error:', await llmRes.text());
      return NextResponse.json({ error: 'Failed to generate suggestion' }, { status: 500 });
    }

    const data = await llmRes.json();
    const suggestion = data.choices?.[0]?.message?.content?.trim() || '';

    return NextResponse.json({ suggestion });
  } catch (err: any) {
    console.error('[ai-suggest] Error:', err);
    return NextResponse.json({ error: 'Failed to generate suggestion' }, { status: 500 });
  }
}
