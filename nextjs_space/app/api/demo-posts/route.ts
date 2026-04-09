export const dynamic = 'force-dynamic';

import { NextRequest } from 'next/server';

/**
 * POST /api/demo-posts
 * Generates 9 sample social media posts from a website URL.
 * Streams results via SSE for progressive reveal.
 * No auth required — this is the landing page demo.
 *
 * Body: { websiteUrl: string }
 * SSE events:
 *   { type: 'phase', message: string }
 *   { type: 'post', post: DemoPost }
 *   { type: 'error', message: string }
 */

interface DemoPost {
  id: string;
  lane: 'website' | 'news' | 'holiday';
  headline: string;
  caption: string;
  imageUrl?: string;
  hashtags?: string[];
}

const ABACUS_URL = 'https://apps.abacus.ai/v1/chat/completions';

function sseEvent(data: Record<string, unknown>): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

async function fetchWebsiteContext(url: string): Promise<string> {
  try {
    const normalizedUrl = url.startsWith('http') ? url : `https://${url}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(normalizedUrl, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    });
    clearTimeout(timeout);
    if (!res.ok) return `Website: ${url} (could not fetch, status ${res.status})`;
    const html = await res.text();
    // Extract useful text content (strip tags, limit length)
    const text = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 3000);
    return `Website: ${url}\n\nContent from website:\n${text}`;
  } catch {
    return `Website: ${url} (could not fetch content)`;
  }
}

async function generatePostsBatch(
  apiKey: string,
  lane: 'website' | 'news' | 'holiday',
  websiteContext: string,
  url: string,
): Promise<DemoPost[]> {
  const lanePrompts = {
    website: `You are a social media manager. Based on this business website, create 3 promotional social media posts.
Each post should highlight a different aspect: services/products, brand story/values, special offers or differentiators.
Make them sound authentic and engaging, not generic. Use the actual business name and details from the website.

${websiteContext}`,
    news: `You are a social media manager for the business at ${url}. Create 3 social media posts that tie the business to LOCAL community news topics.
Think: "[Business] supports local [event/cause]" or "What [trending local topic] means for [industry]".
Make them feel newsy and timely but connected to the business. Invent plausible local news hooks.

${websiteContext}`,
    holiday: `You are a social media manager for the business at ${url}. Create 3 social media posts for UPCOMING holidays or seasonal moments.
Use the nearest upcoming holidays (think next 2-3 months). Each post should tie the holiday to the business naturally.
Avoid generic "Happy [Holiday]" — make them promotional and engaging with a business angle.

${websiteContext}`,
  };

  const systemPrompt = `You generate social media posts. Respond ONLY with a JSON array of exactly 3 objects.
Each object must have: headline (short catchy title, max 8 words), caption (engaging post text, 2-3 sentences), hashtags (array of 3-5 relevant hashtags without # symbol).
Respond with raw JSON only. No markdown, no code blocks, no explanation.`;

  const resp = await fetch(ABACUS_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4.1-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: lanePrompts[lane] },
      ],
      response_format: { type: 'json_object' },
      max_tokens: 1500,
    }),
  });

  if (!resp.ok) {
    console.error(`[demo-posts] LLM error for ${lane}: ${resp.status}`);
    return [];
  }

  const data = await resp.json();
  const content = data?.choices?.[0]?.message?.content || '';

  try {
    const parsed = JSON.parse(content);
    const arr = Array.isArray(parsed) ? parsed : parsed.posts || parsed.items || Object.values(parsed).find(Array.isArray) || [];
    return (arr as any[]).slice(0, 3).map((p: any, i: number) => ({
      id: `${lane}-${i}-${Date.now()}`,
      lane,
      headline: p.headline || p.title || 'Untitled Post',
      caption: p.caption || p.text || p.content || '',
      hashtags: Array.isArray(p.hashtags) ? p.hashtags : [],
    }));
  } catch (e) {
    console.error(`[demo-posts] Parse error for ${lane}:`, e, content.slice(0, 200));
    return [];
  }
}

async function generatePostImage(
  apiKey: string,
  post: DemoPost,
  businessUrl: string,
): Promise<string | null> {
  try {
    const prompt = `Create a professional social media post image for a business (${businessUrl}).
Post headline: "${post.headline}"
Post context: ${post.caption.slice(0, 200)}
Category: ${post.lane === 'website' ? 'business promotional' : post.lane === 'news' ? 'community news' : 'holiday seasonal'}

Design a visually striking image that would work as a social media post. Make it eye-catching, professional, and relevant to the content. Include the headline text "${post.headline}" rendered beautifully into the image with proper typography. Aspect ratio 4:5.`;

    const resp = await fetch(ABACUS_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-5.1',
        messages: [{ role: 'user', content: prompt }],
        modalities: ['image'],
        image_config: { aspect_ratio: '3:4', quality: 'high', num_images: 1 },
      }),
    });

    if (!resp.ok) return null;
    const data = await resp.json();

    for (const choice of data?.choices || []) {
      for (const img of choice?.message?.images || []) {
        const imgUrl = typeof img === 'string' ? img
          : img?.image_url?.url || img?.url || '';
        if (imgUrl) return imgUrl;
      }
    }
    return null;
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  const apiKey = process.env.ABACUSAI_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'API not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let body: { websiteUrl?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid request' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const url = body.websiteUrl?.trim();
  if (!url) {
    return new Response(JSON.stringify({ error: 'Website URL is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: Record<string, unknown>) => {
        try { controller.enqueue(encoder.encode(sseEvent(data))); } catch {}
      };

      try {
        // Phase 1: Fetch website
        send({ type: 'phase', message: 'Scanning your website...' });
        const websiteContext = await fetchWebsiteContext(url);

        // Phase 2: Generate text for all 3 lanes in parallel
        send({ type: 'phase', message: 'Crafting posts from your brand, local news & holidays...' });
        const lanes: Array<'website' | 'news' | 'holiday'> = ['website', 'news', 'holiday'];
        const allBatches = await Promise.all(
          lanes.map(lane => generatePostsBatch(apiKey, lane, websiteContext, url))
        );

        // Flatten and send text posts first (fast reveal)
        const allPosts: DemoPost[] = [];
        for (const batch of allBatches) {
          for (const post of batch) {
            allPosts.push(post);
          }
        }

        // Send text-only posts immediately for fast reveal
        for (const post of allPosts) {
          send({ type: 'post', post });
        }

        // Phase 3: Generate images in parallel (4 at a time max)
        send({ type: 'phase', message: 'Generating images for your posts...' });

        // Generate images in batches of 4 for parallelism
        const BATCH_SIZE = 4;
        for (let i = 0; i < allPosts.length; i += BATCH_SIZE) {
          const batch = allPosts.slice(i, i + BATCH_SIZE);
          const imageResults = await Promise.all(
            batch.map(post => generatePostImage(apiKey, post, url))
          );
          for (let j = 0; j < batch.length; j++) {
            if (imageResults[j]) {
              batch[j].imageUrl = imageResults[j]!;
              // Re-send the post with image attached
              send({ type: 'post', post: batch[j] });
            }
          }
        }

        send({ type: 'phase', message: '' });
      } catch (err: any) {
        console.error('[demo-posts] Stream error:', err);
        send({ type: 'error', message: 'Failed to generate posts' });
      } finally {
        try {
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
        } catch {}
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
