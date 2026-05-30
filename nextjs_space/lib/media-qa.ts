/**
 * Post-generation Media QA: reviews rendered media before it becomes
 * customer-visible.
 *
 * Generalised from `post-qa.ts` to support any media type.
 * Core hard-fail rules (1-10) for rendered images:
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
 * RSS / Story-based post rules (11-17):
 *  11. Story relevance (score 0-5, hard-fail < 4)
 *  12. Story-specific visual evidence (min 2 elements)
 *  13. Human/action match for people stories
 *  14. Product-as-bridge (product enables story, not replaces it)
 *  15. Generic image rejection (score 0-5, hard-fail < 3)
 *  16. Mobile format (portrait 4:5 default for RSS/social)
 *  17. Business-context mismatch (CTA/brand from wrong industry)
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
  storyVisualBrief?: {
    is_story_based?: boolean;
    story_subject?: string;
    story_people?: string;
    story_setting?: string;
    story_action?: string;
    story_emotional_theme?: string;
    brand_connection?: string;
    required_visual_elements?: string[];
    forbidden_generic_imagery?: string[];
  };
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

Evaluate the image against these seventeen rules (ten core + seven RSS/story). For each rule, output PASS or FAIL with a brief reason.

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

=== RSS / STORY-BASED POST RULES (11–16) ===
These rules apply ONLY when the story/topic context references an article, RSS source, trending topic, or news story. For non-story posts (direct brand/product ads), rules 11–16 auto-PASS.

11. STORY_RELEVANCE – Does the rendered image clearly communicate the article's actual subject? The viewer should understand what the story is about from the image alone. FAIL if the image shows generic rural internet equipment, WiFi symbols, or abstract connectivity when the story is about people, events, community, business, or leadership. Score 0–5; hard-fail if score < 4.
12. STORY_VISUAL_EVIDENCE – Does the rendered image include at least 2 visible elements directly tied to the specific story (e.g., a named event, a person in a relevant role, a described setting, an action from the article)? Generic elements (modem, router, antenna, WiFi arcs, fence post, rolling hills) do NOT count as story-specific. FAIL if fewer than 2 story-specific visual elements are visible. Score 0–5.
13. HUMAN_ACTION_MATCH – If the story is about people, leadership, work, events, family, community, or business, the image MUST show a relevant human/action scene — not only a product, landscape, modem, tower, or abstract WiFi symbol. FAIL if the story involves people but the image shows only equipment or scenery. Score 0–5.
14. PRODUCT_AS_BRIDGE – The advertiser's product (e.g., Blazing Hog modem, antenna, router) should appear as the enabler of the story, NOT replace the story. The product is the bridge, not the subject. FAIL if the product/equipment is the primary visual subject instead of the story. Score 0–5.
15. GENERIC_IMAGE_REJECTION – Hard fail any image that could be reused for almost any rural internet / connectivity post without changing the meaning. If you removed the headline and this image could run on any ISP's social feed, it fails. Score 0–5; hard-fail if score < 3.
16. MOBILE_FORMAT_RSS – RSS/social post images should be portrait (4:5) or vertical format. FAIL if the rendered image is landscape for an RSS/social post when portrait was expected. Score 0–5.
17. BUSINESS_CONTEXT_MISMATCH – For RSS/story-based posts: FAIL if any visible CTA, tagline, or brand language in the image comes from the story's industry instead of the business's actual industry. Example: an ISP business posting about a tavern event must NOT show "See What's On Tap" as CTA. Also check if product placement feels like the wrong industry. For non-story posts, this rule auto-PASSES. Score 0–5; hard-fail if score < 5.

After evaluating all seventeen rules, provide:
- Individual rule results with sub-scores for story rules (0–5)
- A story_scores object with: story_relevance (0–5), story_visual_evidence (0–5), blazing_hog_connection (0–5), human_action_clarity (0–5), mobile_readability (0–5), generic_stock_penalty (0–5)
- An overall quality score from 0 to 100
- ADDITIONAL HARD FAIL: If ANY of these conditions are true, the image FAILS regardless of other rules:
  - STORY_RELEVANCE score < 4
  - Fewer than 2 story-specific visual elements are visible
  - The image is generic rural internet equipment only (GENERIC_IMAGE_REJECTION score < 3)
  - The image does not visually connect the article to the advertiser
  - CTA or headline is unreadable on mobile
  - The image is landscape for an RSS/social post
  - CTA, tagline, or brand language visible in the image comes from the story's industry instead of the business's industry

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
    { "id": "STORY_RELEVANCE", "result": "PASS|FAIL", "reason": "...", "sub_score": 0 },
    { "id": "STORY_VISUAL_EVIDENCE", "result": "PASS|FAIL", "reason": "...", "sub_score": 0, "story_elements_found": ["element1", "element2"] },
    { "id": "HUMAN_ACTION_MATCH", "result": "PASS|FAIL", "reason": "...", "sub_score": 0 },
    { "id": "PRODUCT_AS_BRIDGE", "result": "PASS|FAIL", "reason": "...", "sub_score": 0 },
    { "id": "GENERIC_IMAGE_REJECTION", "result": "PASS|FAIL", "reason": "...", "sub_score": 0 },
    { "id": "MOBILE_FORMAT_RSS", "result": "PASS|FAIL", "reason": "...", "sub_score": 0 },
    { "id": "BUSINESS_CONTEXT_MISMATCH", "result": "PASS|FAIL", "reason": "...", "sub_score": 0 }
  ],
  "story_scores": { "story_relevance": 0, "story_visual_evidence": 0, "blazing_hog_connection": 0, "human_action_clarity": 0, "mobile_readability": 0, "generic_stock_penalty": 0 },
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
        ...(input.storyVisualBrief?.is_story_based ? [
          '',
          '=== STORY VISUAL BRIEF (RSS/article-based post) ===',
          `Story Subject: ${input.storyVisualBrief.story_subject || 'N/A'}`,
          `Story People: ${input.storyVisualBrief.story_people || 'N/A'}`,
          `Story Setting: ${input.storyVisualBrief.story_setting || 'N/A'}`,
          `Story Action: ${input.storyVisualBrief.story_action || 'N/A'}`,
          `Story Emotional Theme: ${input.storyVisualBrief.story_emotional_theme || 'N/A'}`,
          `Brand Connection: ${input.storyVisualBrief.brand_connection || 'N/A'}`,
          `Required Visual Elements: ${(input.storyVisualBrief.required_visual_elements || []).join(', ') || 'N/A'}`,
          `Forbidden Generic Imagery: ${(input.storyVisualBrief.forbidden_generic_imagery || []).join(', ') || 'N/A'}`,
          '=== END STORY VISUAL BRIEF ===',
        ] : []),
        '',
        'Evaluate the attached image against all seventeen rules (ten core + seven RSS/story rules).',
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
        max_tokens: 2500,
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