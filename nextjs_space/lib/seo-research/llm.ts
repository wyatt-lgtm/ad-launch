/**
 * SEO Research — shared LLM JSON helper (Abacus.AI RouteLLM, OpenAI-compatible).
 */
const LLM_URL = 'https://apps.abacus.ai/v1/chat/completions';
const MODEL = 'claude-sonnet-4-6';

export function isLlmConfigured(): boolean {
  return Boolean(process.env.ABACUSAI_API_KEY);
}

export async function callLlmJson(
  systemPrompt: string,
  userPrompt: string,
  maxTokens = 3000,
): Promise<any | null> {
  const apiKey = process.env.ABACUSAI_API_KEY;
  if (!apiKey) throw new Error('LLM API not configured');
  let res: Response;
  try {
    res = await fetch(LLM_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        max_tokens: maxTokens,
        temperature: 0.4,
        response_format: { type: 'json_object' },
      }),
    });
  } catch (err) {
    console.error('[seo-research] LLM fetch failed:', err);
    return null;
  }
  if (!res.ok) {
    console.error('[seo-research] LLM error:', await res.text().catch(() => ''));
    return null;
  }
  const data = await res.json().catch(() => null);
  const content = data?.choices?.[0]?.message?.content || '';
  try {
    return JSON.parse(content);
  } catch {
    const m = content.match(/\{[\s\S]*\}/);
    if (m) {
      try { return JSON.parse(m[0]); } catch { return null; }
    }
    return null;
  }
}
