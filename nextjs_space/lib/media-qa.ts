/**
 * Post-generation Media QA: reviews rendered media before it becomes
 * customer-visible.
 *
 * Generalised from `post-qa.ts` to support any media type.
 * Hard-fail rules for rendered images:
 *  1.  >~15% blank / unused canvas space
 *  2.  Image CTA doesn't match approved CTA
 *  3.  Image subject doesn't visibly support the post topic
 *  4.  Headline / text is cropped or malformed
 *  5.  Image lacks clear connection to business / product
 *  6.  Image uses generic stock-like imagery with no specificity
 *  7.  Poor composition (subject too small, off-centre, cluttered)
 *  8.  Incorrect aspect ratio for the intended platform
 *  9.  Unreadable overlay text (contrast, size, font issues)
 *  10. Off-brand or misleading imagery
 *
 * Searchable log prefix: MEDIA_FINAL_QA_*
 */

export interface MediaQaInput {
  imageUrl: string;
  postCopy: string;
  headline: string;
  cta: string;
  businessName: string;
  storyTitle: string;
  mediaType?: 'image' | 'video' | 'audio';
  platform?: string;
}

export interface MediaQaResult {
  passed: boolean;
  failReasons: string[];
  /** 0–100, where 100 = perfect. -1 = LLM failure (pass-through) */
  score: number;
}

const SYSTEM_PROMPT = `You are a senior creative quality-assurance reviewer for social-media ad images.
You will receive an image and contextual metadata (post copy, headline, CTA, business name, story title).

Evaluate the image against these TEN hard-fail rules. For each rule, output PASS or FAIL with a brief reason.

Rules:
1. BLANK_SPACE – Reject if roughly more than 15% of the canvas is blank, solid-colour filler, or otherwise unused.
2. CTA_MISMATCH – If a CTA is visible in the image, reject if it doesn't match the approved CTA. If no CTA rendered, PASS.
3. SUBJECT_RELEVANCE – Reject if the primary visual subject does not clearly support the post topic.
4. TEXT_INTEGRITY – Reject if any headline, overlay text, or CTA text is cropped, truncated, overlapping, unreadable, or malformed.
5. BUSINESS_CONNECTION – Reject if the image has no clear visual or textual tie to the business/product.
6. STOCK_GENERIC – Reject if the image appears to be unmodified generic stock photography with no specificity.
7. COMPOSITION – Reject if the primary subject is too small, off-frame, or the layout is cluttered/confusing.
8. ASPECT_RATIO_MISMATCH – Reject if the image is landscape/horizontal when the expected output is portrait/mobile-first for a social media feed. RSS/social feed creative should default to portrait (4:5) format. Landscape images for social feed posts are a hard fail unless landscape was explicitly requested. Failure message: "RSS social creative should default to portrait/mobile-first format unless landscape was explicitly requested."
9. TEXT_READABILITY – Reject if any overlay text has poor contrast, is too small, uses illegible fonts, or is obscured by the background.
10. BRAND_ALIGNMENT – Reject if the imagery is off-brand, misleading, or contradicts the business's identity/values.
11. STORY_VISUAL_RELEVANCE – For RSS/story-based posts: Reject if the rendered image shows generic category imagery instead of story-specific visuals. The image must visually communicate the article's subject. If the image could be reused for any generic post in the same category, it fails. For non-story posts, this rule auto-PASSES.

After evaluating all eleven rules, provide an overall quality score from 0 to 100.

Respond with raw JSON only (no markdown fences). Schema:
{
  "rules": [
    { "id": "BLANK_SPACE",        "result": "PASS|FAIL", "reason": "..." },
    { "id": "CTA_MISMATCH",        "result": "PASS|FAIL", "reason": "..." },
    { "id": "SUBJECT_RELEVANCE",   "result": "PASS|FAIL", "reason": "..." },
    { "id": "TEXT_INTEGRITY",      "result": "PASS|FAIL", "reason": "..." },
    { "id": "BUSINESS_CONNECTION", "result": "PASS|FAIL", "reason": "..." },
    { "id": "STOCK_GENERIC",       "result": "PASS|FAIL", "reason": "..." },
    { "id": "COMPOSITION",         "result": "PASS|FAIL", "reason": "..." },
    { "id": "ASPECT_RATIO_MISMATCH", "result": "PASS|FAIL", "reason": "..." },
    { "id": "TEXT_READABILITY",     "result": "PASS|FAIL", "reason": "..." },
    { "id": "BRAND_ALIGNMENT",     "result": "PASS|FAIL", "reason": "..." },
    { "id": "STORY_VISUAL_RELEVANCE", "result": "PASS|FAIL", "reason": "..." }
  ],
  "score": 72
}
`;

/**
 * Run visual QA on rendered media.
 *
 * On transient LLM failure returns a *passing* result (score = -1)
 * so the pipeline is not permanently blocked.
 */
export async function reviewRenderedMediaBeforeReady(
  input: MediaQaInput,
): Promise<MediaQaResult> {
  const { imageUrl, postCopy, headline, cta, businessName, storyTitle } = input;

  if (!imageUrl) {
    return { passed: false, failReasons: ['No image URL provided'], score: 0 };
  }

  const apiKey = process.env.ABACUSAI_API_KEY;
  if (!apiKey) {
    console.error('[MEDIA_FINAL_QA_ERROR_PASS_THROUGH] ABACUSAI_API_KEY not set — skipping QA');
    return { passed: true, failReasons: [], score: -1 };
  }

  const logCtx = `business=${businessName} media=${input.mediaType || 'image'}`;
  console.log(`[MEDIA_FINAL_QA_STARTED] ${logCtx}`);

  const userContent = [
    {
      type: 'text' as const,
      text: [
        `Business: ${businessName}`,
        `Story / Topic: ${storyTitle}`,
        `Headline: ${headline}`,
        `CTA (approved): ${cta || '(none provided)'}`,
        `Post copy: ${postCopy}`,
        input.platform ? `Target platform: ${input.platform}` : '',
        '',
        'Evaluate the attached image against the ten hard-fail rules.',
      ].filter(Boolean).join('\n'),
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
        max_tokens: 1500,
        temperature: 0.1,
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '(unreadable)');
      console.error(`[MEDIA_FINAL_QA_ERROR_PASS_THROUGH] LLM API ${res.status}: ${text.slice(0, 300)} — pass-through`);
      return { passed: true, failReasons: [], score: -1 };
    }

    const json = await res.json();
    const raw = json?.choices?.[0]?.message?.content || '';

    let parsed: { rules?: { id: string; result: string; reason: string }[]; score?: number };
    try {
      parsed = JSON.parse(raw);
    } catch {
      console.error(`[MEDIA_FINAL_QA_ERROR_PASS_THROUGH] Failed to parse LLM response. Raw: ${raw.slice(0, 400)}`);
      return { passed: true, failReasons: [], score: -1 };
    }

    const rules = parsed.rules || [];
    const failReasons = rules
      .filter((r) => r.result === 'FAIL')
      .map((r) => `${r.id}: ${r.reason}`);

    const score = typeof parsed.score === 'number' ? parsed.score : (failReasons.length === 0 ? 100 : 0);
    const passed = failReasons.length === 0;

    if (passed) {
      console.log(`[MEDIA_FINAL_QA_PASSED] ${logCtx} score=${score}`);
    } else {
      console.warn(`[MEDIA_FINAL_QA_REJECTED] ${logCtx} score=${score} fails=${failReasons.length}\n  ${failReasons.join('\n  ')}`);
    }

    return { passed, failReasons, score };
  } catch (err: any) {
    console.error(`[MEDIA_FINAL_QA_ERROR_PASS_THROUGH] Exception: ${err?.message}`);
    return { passed: true, failReasons: [], score: -1 };
  }
}