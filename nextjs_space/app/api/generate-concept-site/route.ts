export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';

const LLM_URL = 'https://apps.abacus.ai/v1/chat/completions';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const { sections, colorPalette, businessName } = body;

    if (!sections?.length) {
      return NextResponse.json({ error: 'No website concept data provided' }, { status: 400 });
    }

    // Build a structured brief for the LLM
    const colors = (colorPalette ?? []).map((c: any) => `${c.name ?? 'color'}: ${c.hex}`).join(', ');
    const sectionBrief = (sections as any[]).map((s: any, i: number) => {
      let brief = `Section ${i + 1}: "${s.title}"\n`;
      if (s.headline) brief += `  Headline: ${s.headline}\n`;
      if (s.description) brief += `  Description: ${s.description}\n`;
      if (s.cta) brief += `  CTA Button: ${s.cta}\n`;
      if (s.items?.length) brief += `  Key Points: ${s.items.join('; ')}\n`;
      return brief;
    }).join('\n');

    const prompt = `Generate a complete, modern, responsive single-page website as a SINGLE HTML file for "${businessName ?? 'the business'}".

Use this exact content for the sections:
${sectionBrief}

Color palette: ${colors || '#2563EB (Primary), #1E293B (Dark), #F8FAFC (Light), #0EA5E9 (Accent), #10B981 (Success)'}

Requirements:
- Single self-contained HTML file with embedded CSS and no external dependencies except Google Fonts (Inter)
- Modern, professional design with smooth scroll behavior
- Responsive layout that works on mobile and desktop
- Use the provided color palette for styling
- Include a sticky navigation header with the business name and smooth-scroll links to each section
- Each section should be visually distinct with appropriate spacing, backgrounds, and typography
- The Hero section should be full-viewport height with a gradient background
- CTA buttons should be styled prominently with hover effects
- Add subtle CSS animations (fade-in on scroll using Intersection Observer)
- Include a simple footer with the business name and copyright year
- The page should look polished and production-ready
- Do NOT include any placeholder images or external image URLs
- Use CSS gradients, shapes, or icons as decorative elements instead of images

Return ONLY the complete HTML code. No markdown, no explanation, no code fences. Start with <!DOCTYPE html> and end with </html>.`;

    const llmRes = await fetch(LLM_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.ABACUSAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-4.1',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.7,
        max_tokens: 8000,
      }),
    });

    if (!llmRes.ok) {
      const errText = await llmRes.text().catch(() => '');
      console.error('[generate-concept-site] LLM error:', llmRes.status, errText.slice(0, 200));
      return NextResponse.json({ error: 'AI generation failed' }, { status: 500 });
    }

    const llmData = await llmRes.json();
    let html = llmData?.choices?.[0]?.message?.content ?? '';

    // Strip markdown code fences if present
    html = html.replace(/^```html\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/, '');

    // Ensure it starts with DOCTYPE
    if (!html.trim().toLowerCase().startsWith('<!doctype')) {
      const idx = html.indexOf('<!DOCTYPE');
      const idx2 = html.indexOf('<!doctype');
      const start = idx >= 0 ? idx : idx2;
      if (start > 0) html = html.slice(start);
    }

    if (!html.trim()) {
      return NextResponse.json({ error: 'Failed to generate website' }, { status: 500 });
    }

    return NextResponse.json({ html });
  } catch (err: any) {
    console.error('[generate-concept-site] Error:', err?.message);
    return NextResponse.json({ error: 'Generation failed' }, { status: 500 });
  }
}
