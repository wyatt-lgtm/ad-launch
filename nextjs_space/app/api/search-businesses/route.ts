export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: process.env.ABACUSAI_API_KEY ?? '',
  baseURL: 'https://api.abacus.ai/v1',
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const { businessType, location } = body;

    if (!businessType || !location) {
      return NextResponse.json({ error: 'Business type and location are required' }, { status: 400 });
    }

    const prompt = `Find 6 real ${businessType} businesses in or near ${location}. For each business, provide:
- name: The actual business name
- address: Full street address
- phone: Phone number in (XXX) XXX-XXXX format
- website: Their website URL (best guess based on business name, use format like www.businessname.com)
- description: A brief 1-2 sentence description of what they offer

Return ONLY a valid JSON array of objects with those exact keys. No markdown, no explanation, just the JSON array. Make the businesses realistic and varied — include both well-known local businesses and smaller independent ones. Use realistic addresses for the ${location} area.`;

    const completion = await client.chat.completions.create({
      model: 'claude-3-5-sonnet',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
      max_tokens: 2000,
    });

    const text = completion.choices?.[0]?.message?.content ?? '';

    // Parse JSON from response
    let businesses = [];
    try {
      // Try to extract JSON array from response
      const jsonMatch = text.match(/\[\s*\{[\s\S]*\}\s*\]/);
      if (jsonMatch) {
        businesses = JSON.parse(jsonMatch[0]);
      } else {
        businesses = JSON.parse(text);
      }
    } catch {
      console.error('[search-businesses] Failed to parse LLM response:', text.slice(0, 200));
      return NextResponse.json({ error: 'Failed to parse search results' }, { status: 500 });
    }

    // Validate and clean
    businesses = businesses
      .filter((b: any) => b?.name)
      .map((b: any) => ({
        name: b.name ?? '',
        address: b.address ?? '',
        phone: b.phone ?? '',
        website: b.website ?? '',
        description: b.description ?? '',
      }))
      .slice(0, 8);

    return NextResponse.json({ businesses });
  } catch (err: any) {
    console.error('[search-businesses] Error:', err?.message);
    return NextResponse.json({ error: 'Search failed' }, { status: 500 });
  }
}
