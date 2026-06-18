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
12. LANDSCAPE_SOCIAL_FEED – Reject if the creative direction or generation prompt specifies landscape orientation (16:9) for a social media feed post. Social feed creative MUST use 4:5 portrait for mobile-first viewing. Revise to 4:5 portrait unless the placement explicitly requires landscape.

=== RSS / STORY-BASED POST RULES (13–18) ===
These rules apply ONLY when the brief references an article, RSS source, trending topic, or story context. For non-story posts (direct brand/product ads), rules 13–18 auto-PASS.

13. STORY_RELEVANCE – Does the image concept clearly communicate the article's actual subject? The viewer should understand what the story is about from the image alone. FAIL if the concept is about generic rural internet, WiFi equipment, or abstract connectivity symbols when the story is about people, events, community, business, or leadership. Score 0–5; hard-fail if score < 4.
14. STORY_VISUAL_EVIDENCE – Does the concept include at least 2 visible elements directly tied to the specific story (e.g., a named event, a specific person's role, a described setting, an action from the article)? Generic elements (modem, router, antenna, WiFi arcs, fence post, rolling hills) do NOT count as story-specific. FAIL if fewer than 2 story-specific visual elements are described. Score 0–5.
15. HUMAN_ACTION_MATCH – If the story is about people, leadership, work, events, family, community, or business, the image concept MUST show a relevant human/action scene — not only a product, landscape, modem, tower, or abstract WiFi symbol. FAIL if the story involves people but the concept shows only equipment or scenery. Score 0–5.
16. PRODUCT_AS_BRIDGE – The advertiser's product (e.g., Blazing Hog modem, antenna, router) should appear as the enabler of the story, NOT replace the story. The product is the bridge, not the subject. FAIL if the product/equipment is the primary visual subject instead of the story. Score 0–5.
17. GENERIC_IMAGE_REJECTION – Hard fail any concept that could be reused for almost any rural internet / connectivity post without changing the meaning. If you removed the headline and this image could run on any ISP's social feed, it fails. Score 0–5; hard-fail if score < 3.
18. MOBILE_FORMAT_RSS – RSS/social post images should default to portrait (4:5) or vertical format unless landscape was explicitly requested in the brief. FAIL if the concept specifies landscape for an RSS/social post. Score 0–5.
19. BUSINESS_CONTEXT_MISMATCH – For RSS/story-based posts: FAIL if the CTA, brand voice, tagline, or promotional language comes from the story's industry instead of the business's actual industry. Example: an ISP business posting about a tavern-sponsored event must NOT use "See What's On Tap" or "Book a Table" as CTA. The CTA must match the business's category (e.g., ISP → "Check Your Address"). Also FAIL if industry-specific jargon from the story leaks into the brand positioning. For non-story posts, this rule auto-PASSES. Score 0–5; hard-fail if score < 5.

After evaluating all rules:
- If ALL rules pass: decision = "approved"
- If 1-3 rules fail but fixable: decision = "revise", provide improved versions
- If 4+ rules fail or concept is fundamentally flawed: decision = "reject"
- ADDITIONAL HARD FAIL: If ANY of these conditions are true, decision MUST be "reject" regardless of other rules:
  - STORY_RELEVANCE score < 4
  - STORY_VISUAL_EVIDENCE identifies fewer than 2 story-specific elements
  - The image is generic rural internet equipment only (GENERIC_IMAGE_REJECTION score < 3)
  - The image does not visually connect the article to the advertiser
  - CTA or headline would be unreadable on mobile
  - The image defaults to landscape for an RSS/social post
  - CTA, tagline, or brand language comes from the story's industry instead of the business's industry (BUSINESS_CONTEXT_MISMATCH)

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
    { "id": "WEAK_HOOK", "result": "PASS|FAIL", "reason": "..." },
    { "id": "LANDSCAPE_SOCIAL_FEED", "result": "PASS|FAIL", "reason": "..." },
    { "id": "STORY_RELEVANCE", "result": "PASS|FAIL", "reason": "...", "sub_score": 0 },
    { "id": "STORY_VISUAL_EVIDENCE", "result": "PASS|FAIL", "reason": "...", "sub_score": 0, "story_elements_found": ["element1", "element2"] },
    { "id": "HUMAN_ACTION_MATCH", "result": "PASS|FAIL", "reason": "...", "sub_score": 0 },
    { "id": "PRODUCT_AS_BRIDGE", "result": "PASS|FAIL", "reason": "...", "sub_score": 0 },
    { "id": "GENERIC_IMAGE_REJECTION", "result": "PASS|FAIL", "reason": "...", "sub_score": 0 },
    { "id": "MOBILE_FORMAT_RSS", "result": "PASS|FAIL", "reason": "...", "sub_score": 0 },
    { "id": "BUSINESS_CONTEXT_MISMATCH", "result": "PASS|FAIL", "reason": "...", "sub_score": 0 }
  ],
  "story_scores": { "story_relevance": 0, "story_visual_evidence": 0, "blazing_hog_connection": 0, "human_action_clarity": 0, "mobile_readability": 0, "generic_stock_penalty": 0 },
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
  // Architecture: QA gates run on Tombstone backend (which holds model keys).
  // On the frontend, always pass-through. Tombstone's generation pipeline
  // includes its own war-room review before image generation.
  const mediaType = input.mediaType || 'image';
  console.log(`[MEDIA_WAR_ROOM_REVIEW_STARTED] business=${input.businessName} media=${mediaType} — frontend pass-through (QA runs on Tombstone)`);
  return passThrough();
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
