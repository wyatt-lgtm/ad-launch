/**
 * Post-production QA gate for social-post images.
 *
 * Uses LLM vision (Abacus AI) to evaluate a rendered image against
 * the post's copy, headline, CTA, and business context.
 *
 * Hard-fail rules:
 *  1. >~15 % blank / unused canvas space
 *  2. Image CTA doesn't match approved CTA
 *  3. Image subject doesn't visibly support the post topic
 *  4. Headline / text is cropped or malformed
 *  5. Image lacks clear connection to business / product
 *  6. Image uses generic stock-like imagery with no specificity
 */

export interface QaInput {
  imageUrl: string;
  postCopy: string;
  headline: string;
  cta: string;
  businessName: string;
  storyTitle: string;
}

export interface QaResult {
  passed: boolean;
  failReasons: string[];
  /** 0–100, where 100 = perfect */
  score: number;
}

const SYSTEM_PROMPT = `You are a senior creative quality-assurance reviewer for social-media ad images.
You will receive an image and contextual metadata (post copy, headline, CTA, business name, story title).

Evaluate the image against these SIX hard-fail rules. For each rule, output PASS or FAIL with a brief reason.

Rules:
1. BLANK_SPACE – Reject if roughly more than 15 % of the canvas is blank, solid-colour filler, or otherwise unused.
2. CTA_MISMATCH – If a CTA (call to action) is visible in the image, reject if it doesn't match the approved CTA supplied in the metadata. If no CTA is rendered in the image, PASS this rule.
3. SUBJECT_RELEVANCE – Reject if the primary visual subject of the image does not clearly support the post topic described in the headline / story title.
4. TEXT_INTEGRITY – Reject if any headline, overlay text, or CTA text in the image is cropped, truncated, overlapping, unreadable, or malformed.
5. BUSINESS_CONNECTION – Reject if the image has no clear visual or textual tie to the business or its product/service.
6. STOCK_GENERIC – Reject if the image appears to be unmodified generic stock photography with no brand, product, or contextual specificity.

After evaluating all six rules, provide an overall quality score from 0 to 100.

Respond with raw JSON only (no markdown fences). Schema:
{
  "rules": [
    { "id": "BLANK_SPACE",        "result": "PASS|FAIL", "reason": "..." },
    { "id": "CTA_MISMATCH",        "result": "PASS|FAIL", "reason": "..." },
    { "id": "SUBJECT_RELEVANCE",   "result": "PASS|FAIL", "reason": "..." },
    { "id": "TEXT_INTEGRITY",      "result": "PASS|FAIL", "reason": "..." },
    { "id": "BUSINESS_CONNECTION", "result": "PASS|FAIL", "reason": "..." },
    { "id": "STOCK_GENERIC",       "result": "PASS|FAIL", "reason": "..." }
  ],
  "score": 72
}
`;

/**
 * Run visual QA on a rendered post image.
 *
 * Returns a structured result with pass/fail per rule.
 * On transient LLM failure the function returns a *passing* result
 * so the pipeline does not block — the failure is logged for observability.
 */
export async function runPostQa(input: QaInput): Promise<QaResult> {
  const { imageUrl, postCopy, headline, cta, businessName, storyTitle } = input;

  if (!imageUrl) {
    return { passed: false, failReasons: ['No image URL provided'], score: 0 };
  }

  const apiKey = process.env.ABACUSAI_API_KEY;
  if (!apiKey) {
    console.error('[post-qa] ABACUSAI_API_KEY not set — skipping QA (pass-through)');
    return { passed: true, failReasons: [], score: -1 };
  }

  const userContent = [
    {
      type: 'text' as const,
      text: [
        `Business: ${businessName}`,
        `Story / Topic: ${storyTitle}`,
        `Headline: ${headline}`,
        `CTA (approved): ${cta || '(none provided)'}`,
        `Post copy: ${postCopy}`,
        '',
        'Evaluate the attached image against the six hard-fail rules.',
      ].join('\n'),
    },
    {
      type: 'image_url' as const,
      image_url: { url: imageUrl },
    },
  ];

  try {
    const res = await fetch('https://apps.abacus.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-5.4-mini',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userContent },
        ],
        response_format: { type: 'json_object' },
        max_tokens: 1200,
        temperature: 0.1,
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '(unreadable)');
      console.error(`[post-qa] LLM API ${res.status}: ${text} — pass-through`);
      return { passed: true, failReasons: [], score: -1 };
    }

    const json = await res.json();
    const raw = json?.choices?.[0]?.message?.content || '';

    let parsed: { rules?: { id: string; result: string; reason: string }[]; score?: number };
    try {
      parsed = JSON.parse(raw);
    } catch {
      console.error(`[post-qa] Failed to parse LLM response — pass-through. Raw: ${raw.slice(0, 500)}`);
      return { passed: true, failReasons: [], score: -1 };
    }

    const rules = parsed.rules || [];
    const failReasons = rules
      .filter((r) => r.result === 'FAIL')
      .map((r) => `${r.id}: ${r.reason}`);

    const score = typeof parsed.score === 'number' ? parsed.score : (failReasons.length === 0 ? 100 : 0);
    const passed = failReasons.length === 0;

    console.log(
      `[post-qa] Image QA: score=${score}, passed=${passed}, fails=${failReasons.length}`,
      passed ? '' : `\n  ${failReasons.join('\n  ')}`,
    );

    return { passed, failReasons, score };
  } catch (err: any) {
    console.error(`[post-qa] Exception during QA — pass-through: ${err?.message}`);
    return { passed: true, failReasons: [], score: -1 };
  }
}
