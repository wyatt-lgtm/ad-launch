/**
 * Pre-generation War Room: creative concept review.
 *
 * Reviews a proposed media concept BEFORE expensive image/video/audio
 * generation. Returns approved / revise / reject with optional improved
 * prompts so that only strong creative enters the generation pipeline.
 *
 * Searchable log prefix: MEDIA_WAR_ROOM_*
 */

export type WarRoomDecision = 'approved' | 'revise' | 'reject';

export interface WarRoomInput {
  businessName: string;
  brandVoice?: string;
  platform?: string;
  postCopy: string;
  headline: string;
  cta: string;
  visualDirection: string;
  generationPrompt: string;
  storyContext?: string;
  restrictedClaims?: string[];
  mediaType?: 'image' | 'video' | 'audio';
}

export interface WarRoomResult {
  decision: WarRoomDecision;
  passed: boolean;
  score: number;
  failReasons: string[];
  improvementNotes: string[];
  revisedVisualDirection: string;
  revisedGenerationPrompt: string;
  revisedHeadline: string;
  revisedCta: string;
}

const SYSTEM_PROMPT = `You are a senior War Room creative director reviewing a media concept BEFORE expensive image/video generation.

You will receive a creative brief with: business profile, brand voice, platform, post copy, headline, CTA, visual direction, and the generation prompt that would be sent to the image model.

Evaluate the concept against these hard-fail rules. For each rule output PASS or FAIL with a brief reason.

Rules:
1. GENERIC_BORING – Reject if the concept is generic, uninspired, or interchangeable with any other business.
2. VISUAL_TOPIC_MISMATCH – Reject if the visual direction does not clearly support the post topic.
3. CTA_MISMATCH – Reject if the CTA does not match the approved conversion action or makes no sense for the business.
4. INSTANT_READ – Reject if the image concept cannot be understood by a viewer within ~2 seconds of seeing it.
5. FORCED_CONNECTION – Reject if the business/product connection to the topic feels forced or absent.
6. VAGUE_PROMPT – Reject if the generation prompt is too vague, ambiguous, or underspecified for reliable image output.
7. LEAKED_INTERNALS – Reject if the prompt exposes internal model names, provider names, or technical implementation details.
8. RESTRICTED_CLAIMS – Reject if the concept includes restricted or unverifiable claims.
9. STOCK_LIKELY – Reject if the prompt is likely to produce generic stock-like output with no brand specificity.
10. TEXT_OVERFLOW – Reject if text overlay instructions are too long or likely to be malformed/cropped.
11. WEAK_HOOK – Reject if the design lacks a strong visual hook that would stop a user from scrolling.

After evaluating all rules:
- If ALL rules pass: decision = "approved"
- If 1-3 rules fail but fixable: decision = "revise", provide improved versions
- If 4+ rules fail or concept is fundamentally flawed: decision = "reject"

Provide an overall quality score from 0 to 100.

For "revise" decisions, provide improved versions:
- revised_visual_direction: improved visual concept
- revised_generation_prompt: stronger, more specific prompt for the image model
- revised_headline: improved headline (or empty if headline is fine)
- revised_cta: improved CTA (or empty if CTA is fine)

Respond with raw JSON only (no markdown fences). Schema:
{
  "rules": [
    { "id": "GENERIC_BORING", "result": "PASS|FAIL", "reason": "..." },
    { "id": "VISUAL_TOPIC_MISMATCH", "result": "PASS|FAIL", "reason": "..." },
    { "id": "CTA_MISMATCH", "result": "PASS|FAIL", "reason": "..." },
    { "id": "INSTANT_READ", "result": "PASS|FAIL", "reason": "..." },
    { "id": "FORCED_CONNECTION", "result": "PASS|FAIL", "reason": "..." },
    { "id": "VAGUE_PROMPT", "result": "PASS|FAIL", "reason": "..." },
    { "id": "LEAKED_INTERNALS", "result": "PASS|FAIL", "reason": "..." },
    { "id": "RESTRICTED_CLAIMS", "result": "PASS|FAIL", "reason": "..." },
    { "id": "STOCK_LIKELY", "result": "PASS|FAIL", "reason": "..." },
    { "id": "TEXT_OVERFLOW", "result": "PASS|FAIL", "reason": "..." },
    { "id": "WEAK_HOOK", "result": "PASS|FAIL", "reason": "..." }
  ],
  "score": 72,
  "decision": "approved|revise|reject",
  "improvement_notes": ["..."],
  "revised_visual_direction": "",
  "revised_generation_prompt": "",
  "revised_headline": "",
  "revised_cta": ""
}
`;

/**
 * Review a media concept before generation.
 *
 * On transient LLM failure, returns a pass-through approved result (score=-1)
 * so the pipeline is not blocked.
 */
export async function reviewMediaConceptBeforeGeneration(
  input: WarRoomInput,
): Promise<WarRoomResult> {
  const apiKey = process.env.ABACUSAI_API_KEY;
  if (!apiKey) {
    console.error('[MEDIA_WAR_ROOM_REVIEW_STARTED] No ABACUSAI_API_KEY — pass-through');
    return passThrough();
  }

  const mediaType = input.mediaType || 'image';
  const logCtx = `business=${input.businessName} media=${mediaType}`;
  console.log(`[MEDIA_WAR_ROOM_REVIEW_STARTED] ${logCtx}`);

  const userContent = [
    `Business: ${input.businessName}`,
    input.brandVoice ? `Brand voice: ${input.brandVoice}` : '',
    input.platform ? `Target platform: ${input.platform}` : '',
    `Media type: ${mediaType}`,
    ``,
    `Post copy / caption:`,
    input.postCopy || '(none)',
    ``,
    `Headline: ${input.headline || '(none)'}`,
    `CTA: ${input.cta || '(none)'}`,
    ``,
    `Visual direction:`,
    input.visualDirection || '(none)',
    ``,
    `Generation prompt (what would be sent to the image model):`,
    input.generationPrompt || '(none)',
    ``,
    input.storyContext ? `Story/topic context:\n${input.storyContext}` : '',
    input.restrictedClaims?.length
      ? `Restricted claims (must NOT appear): ${input.restrictedClaims.join(', ')}`
      : '',
  ].filter(Boolean).join('\n');

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
        temperature: 0.15,
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '(unreadable)');
      console.error(`[MEDIA_WAR_ROOM_REVIEW_REJECTED] LLM API ${res.status}: ${text.slice(0, 300)} — pass-through`);
      return passThrough();
    }

    const json = await res.json();
    const raw = json?.choices?.[0]?.message?.content || '';

    let parsed: any;
    try {
      parsed = JSON.parse(raw);
    } catch {
      console.error(`[MEDIA_WAR_ROOM_REVIEW_REJECTED] Failed to parse LLM response — pass-through. Raw: ${raw.slice(0, 400)}`);
      return passThrough();
    }

    const rules = parsed.rules || [];
    const failReasons = rules
      .filter((r: any) => r.result === 'FAIL')
      .map((r: any) => `${r.id}: ${r.reason}`);

    const failCount = failReasons.length;
    const score = typeof parsed.score === 'number' ? parsed.score : (failCount === 0 ? 100 : 0);

    // Determine decision
    let decision: WarRoomDecision;
    if (parsed.decision === 'approved' || parsed.decision === 'revise' || parsed.decision === 'reject') {
      decision = parsed.decision;
    } else {
      decision = failCount === 0 ? 'approved' : failCount <= 3 ? 'revise' : 'reject';
    }

    const result: WarRoomResult = {
      decision,
      passed: decision !== 'reject',
      score,
      failReasons,
      improvementNotes: parsed.improvement_notes || [],
      revisedVisualDirection: parsed.revised_visual_direction || '',
      revisedGenerationPrompt: parsed.revised_generation_prompt || '',
      revisedHeadline: parsed.revised_headline || '',
      revisedCta: parsed.revised_cta || '',
    };

    if (decision === 'approved') {
      console.log(`[MEDIA_WAR_ROOM_REVIEW_PASSED] ${logCtx} score=${score}`);
    } else if (decision === 'revise') {
      console.log(`[MEDIA_WAR_ROOM_REVIEW_REVISED] ${logCtx} score=${score} fails=${failCount}\n  ${failReasons.join('\n  ')}`);
    } else {
      console.warn(`[MEDIA_WAR_ROOM_REVIEW_REJECTED] ${logCtx} score=${score} fails=${failCount}\n  ${failReasons.join('\n  ')}`);
    }

    return result;
  } catch (err: any) {
    console.error(`[MEDIA_WAR_ROOM_REVIEW_REJECTED] Exception — pass-through: ${err?.message}`);
    return passThrough();
  }
}

function passThrough(): WarRoomResult {
  return {
    decision: 'approved',
    passed: true,
    score: -1,
    failReasons: [],
    improvementNotes: [],
    revisedVisualDirection: '',
    revisedGenerationPrompt: '',
    revisedHeadline: '',
    revisedCta: '',
  };
}
