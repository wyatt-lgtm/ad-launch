export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';

const ABACUS_API = 'https://apps.abacus.ai/v1/chat/completions';

interface AdBrief {
  businessName: string;
  industry: string;
  headline: string;
  subheadline: string;
  cta: string;
  brandColors: string;
  socialProof: string;
  logoDescription: string;
  websiteUrl: string;
}

const PROMPT_STRATEGIES: Record<string, (brief: AdBrief) => { model: string; prompt: string; imageConfig?: any }> = {
  // Strategy 1: Simple direct prompt (baseline)
  simple_gpt_image: (brief) => ({
    model: 'gpt_image15',
    prompt: `Create a professional Facebook ad image for ${brief.businessName}. Headline: "${brief.headline}". Subheadline: "${brief.subheadline}". CTA button: "${brief.cta}". Brand colors: ${brief.brandColors}. Include the headline text, subheadline, and a CTA button in the image. Make it look like a real Facebook ad creative. Portrait orientation 4:5 ratio.`,
    imageConfig: {},
  }),

  // Strategy 2: Detailed layout specification with gpt-5.1
  layout_gpt5: (brief) => ({
    model: 'gpt-5.1',
    prompt: [
      `Design a complete Facebook ad creative for ${brief.businessName} (${brief.industry}).`,
      '',
      'LAYOUT STRUCTURE (top to bottom):',
      `1. TOP BANNER: Solid ${brief.brandColors} background bar with the headline "${brief.headline}" in large bold white text`,
      `2. SUBHEADLINE: Below headline, smaller white text: "${brief.subheadline}"`,
      `3. SOCIAL PROOF: "${brief.socialProof}" with star icons in gold/orange`,
      '4. HERO IMAGE: A lifestyle photograph showing the product/service in action, occupying the middle 50% of the ad',
      `5. CTA BUTTON: Large rounded button with text "${brief.cta}" in contrasting color`,
      '',
      'STYLE REQUIREMENTS:',
      '- Professional marketing design, not a stock photo with text overlay',
      '- Clean typography, bold impactful headline',
      '- The brand colors should dominate the design palette',
      '- The overall look should resemble a professionally designed Facebook sponsored post',
      `- Include ${brief.logoDescription} subtly in the design`,
      '- Mobile-optimized 4:5 aspect ratio',
    ].join('\n'),
    imageConfig: { image_size: '1024x1536', quality: 'high' },
  }),

  // Strategy 3: Graphic designer brief with gpt-5.1
  designer_brief_gpt5: (brief) => ({
    model: 'gpt-5.1',
    prompt: [
      `You are a senior graphic designer at a top advertising agency. Create a Facebook ad creative.`,
      '',
      `CLIENT: ${brief.businessName}`,
      `INDUSTRY: ${brief.industry}`,
      `WEBSITE: ${brief.websiteUrl}`,
      '',
      'CREATIVE BRIEF:',
      `- Primary message: "${brief.headline}"`,
      `- Supporting copy: "${brief.subheadline}"`,
      `- Call to action: "${brief.cta}"`,
      `- Social proof: ${brief.socialProof}`,
      `- Brand palette: ${brief.brandColors}`,
      `- Brand identity: ${brief.logoDescription}`,
      '',
      'DESIGN DIRECTION:',
      '- Create a polished, multi-layered ad composition (NOT just a photo with text)',
      '- Use distinct visual zones: branded header, copy area, lifestyle imagery, CTA bar',
      '- Typography should be bold, modern, and highly legible',
      '- Include subtle graphic elements (icons, patterns, gradients)',
      '- The final output should look like it was made in Figma/Photoshop by a professional',
      '- This should look like a real ad you would see scrolling Facebook on your phone',
    ].join('\n'),
    imageConfig: { image_size: '1024x1536', quality: 'high' },
  }),

  // Strategy 4: Spectra-style structured composition
  spectra_style: (brief) => ({
    model: 'gpt-5.1',
    prompt: [
      `Generate a complete Facebook sponsored ad image. This must look EXACTLY like a real Facebook ad creative, not an AI art piece.`,
      '',
      'EXACT COMPOSITION (follow this precisely):',
      '',
      `SECTION 1 - BRAND HEADER (top 15% of image):`,
      `- Solid ${brief.brandColors} background`,
      `- "${brief.headline}" in large, bold, white Impact/Helvetica-style font`,
      `- "${brief.subheadline}" in smaller white text below`,
      `- "${brief.socialProof}" with gold star rating icons`,
      '',
      'SECTION 2 - HERO PHOTO (middle 55% of image):',
      `- A warm, authentic lifestyle photograph related to ${brief.industry}`,
      '- Realistic people (if applicable), natural lighting, genuine setting',
      '- No text on this section',
      '',
      `SECTION 3 - CTA BAR (bottom 15% of image):`,
      `- Solid ${brief.brandColors} background`,
      `- Large rounded button: "${brief.cta}" in contrasting bright color (orange/yellow)`,
      '',
      'CRITICAL RULES:',
      '- Each section must be CLEARLY distinct with hard edges between them',
      '- Text must be PERFECTLY readable - crisp, high contrast',
      '- This is a DESIGNED ad layout, not a photograph with overlaid text',
      '- Aspect ratio: 4:5 (portrait, mobile-optimized)',
    ].join('\n'),
    imageConfig: { image_size: '1024x1536', quality: 'high' },
  }),

  // Strategy 5: Flux Pro (pure image gen, cleaner text potential)
  flux_pro: (brief) => ({
    model: 'flux_pro',
    prompt: [
      `A professional Facebook advertisement for ${brief.businessName}.`,
      `The ad has a structured layout with a ${brief.brandColors} branded header containing the text "${brief.headline}" in bold white letters.`,
      `Below the header is the subtext "${brief.subheadline}" and social proof "${brief.socialProof}" with gold stars.`,
      `The middle section shows a lifestyle photo related to ${brief.industry}.`,
      `At the bottom is a CTA button reading "${brief.cta}" on an orange/coral background.`,
      `Professional graphic design, clean typography, multi-section layout, mobile ad format.`,
    ].join(' '),
    imageConfig: {},
  }),

  // Strategy 6: Flux Kontext (newer Flux with better text)
  flux_kontext: (brief) => ({
    model: 'flux_kontext',
    prompt: [
      `Professional Facebook sponsored advertisement for "${brief.businessName}" - ${brief.industry}.`,
      `Top section: dark ${brief.brandColors} banner with bold white text "${brief.headline}".`,
      `Below: "${brief.subheadline}".`,
      `Middle: photo of a happy family using internet devices at home in a rural setting.`,
      `Bottom: large orange button "${brief.cta}".`,
      `Clean graphic design layout, marketing poster style, sharp text, mobile ad format 4:5.`,
    ].join(' '),
    imageConfig: {},
  }),

  // Strategy 7: Nano Banana Pro (alternative model)
  nano_banana: (brief) => ({
    model: 'nano_banana_pro',
    prompt: [
      `Facebook ad design for ${brief.businessName}: structured layout with ${brief.brandColors} branded sections.`,
      `Header text: "${brief.headline}". Subtext: "${brief.subheadline}".`,
      `Center: lifestyle photography of rural family using internet. CTA button: "${brief.cta}".`,
      `Professional marketing creative, clean typography, multi-section ad composition.`,
    ].join(' '),
    imageConfig: {},
  }),

  // Strategy 9: Gemini 3 Pro Image
  gemini_pro: (brief) => ({
    model: 'gemini-3-pro-image-preview',
    prompt: [
      `Design a complete, professional Facebook ad creative for ${brief.businessName} (${brief.industry}).`,
      '',
      `The ad must have this EXACT structure:`,
      `- TOP: Brand header with ${brief.brandColors} background, showing logo area and "${brief.headline}" in large white bold text`,
      `- Below headline: "${brief.subheadline}" in smaller white text`,
      `- SOCIAL PROOF: "${brief.socialProof}" with gold star icons`,
      `- MIDDLE: A warm, authentic lifestyle photo of a rural family using internet devices (laptop, tablet, phone) together on a couch`,
      `- BOTTOM: Large rounded CTA button "${brief.cta}" in contrasting orange color on ${brief.brandColors} background`,
      '',
      `This must look like a professionally designed Facebook sponsored post creative. Multi-layered graphic design with distinct sections. Not a photograph with text overlay.`,
    ].join('\n'),
    imageConfig: {},
  }),

  // Strategy 10: Ideogram (known for text rendering)
  ideogram_text: (brief) => ({
    model: 'ideogram',
    prompt: [
      `A Facebook advertisement with clear readable text. Layout has three sections:`,
      `TOP: Dark ${brief.brandColors} banner with bold white text "${brief.headline}" and smaller text "${brief.subheadline}".`,
      `MIDDLE: Lifestyle photograph for ${brief.industry} business.`,
      `BOTTOM: Call-to-action button "${brief.cta}" on ${brief.brandColors} background.`,
      `Social proof: "${brief.socialProof}" with star rating. Professional marketing design, crisp typography.`,
    ].join(' '),
    imageConfig: {},
  }),
};

async function generateWithStrategy(
  strategyName: string,
  brief: AdBrief,
  apiKey: string
): Promise<{ strategy: string; imageUrl: string | null; error: string | null; model: string; prompt: string }> {
  const strategyFn = PROMPT_STRATEGIES[strategyName];
  if (!strategyFn) {
    return { strategy: strategyName, imageUrl: null, error: 'Unknown strategy', model: '', prompt: '' };
  }

  const { model, prompt, imageConfig } = strategyFn(brief);

  try {
    console.log(`[test-ad-gen] Starting ${strategyName} with model ${model}...`);
    const startTime = Date.now();

    const res = await fetch(ABACUS_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        modalities: ['image'],
        ...(imageConfig ? { image_config: imageConfig } : {}),
      }),
    });

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    if (!res.ok) {
      const errText = await res.text().catch(() => 'Unknown error');
      console.error(`[test-ad-gen] ${strategyName} API error (${elapsed}s):`, res.status, errText.slice(0, 300));
      return { strategy: strategyName, imageUrl: null, error: `API ${res.status}: ${errText.slice(0, 200)}`, model, prompt };
    }

    const data = await res.json();
    const images = data?.choices?.[0]?.message?.images ?? data?.data ?? [];

    let imageUrl: string | null = null;
    if (images.length > 0) {
      const img = images[0];
      if (img?.image_url?.url) imageUrl = img.image_url.url;
      else if (img?.url) imageUrl = img.url;
      else if (img?.b64_json) imageUrl = `data:image/png;base64,${img.b64_json}`;
    }

    console.log(`[test-ad-gen] ${strategyName} completed in ${elapsed}s, hasImage=${!!imageUrl}`);
    return { strategy: strategyName, imageUrl, error: imageUrl ? null : 'No image in response', model, prompt };
  } catch (err: any) {
    console.error(`[test-ad-gen] ${strategyName} error:`, err?.message);
    return { strategy: strategyName, imageUrl: null, error: err?.message ?? 'Unknown error', model, prompt };
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const {
      strategies,
      businessName = 'Blazing Hog',
      industry = 'Rural Internet Service Provider',
      headline = 'Blazing-Fast Rural Internet. No Data Caps.',
      subheadline = 'Up to 100 Mbps where cable can\'t reach',
      cta = 'Check Availability',
      brandColors = 'dark maroon/burgundy (#5B1A18)',
      socialProof = '4.8 ★★★★★ | 2,000+ Rural Customers',
      logoDescription = 'A hog/pig mascot with flames, in orange/brown colors',
      websiteUrl = 'https://blazinghog.com',
    } = body ?? {};

    const apiKey = process.env.ABACUSAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'API key not configured' }, { status: 500 });
    }

    const brief: AdBrief = {
      businessName, industry, headline, subheadline, cta,
      brandColors, socialProof, logoDescription, websiteUrl,
    };

    // Default: run all strategies. Or run specific ones.
    const strategiesToRun: string[] = strategies && strategies.length > 0
      ? strategies
      : Object.keys(PROMPT_STRATEGIES);

    // Run strategies sequentially to avoid rate limits
    const results = [];
    for (const s of strategiesToRun) {
      const result = await generateWithStrategy(s, brief, apiKey);
      results.push(result);
    }

    return NextResponse.json({ brief, results });
  } catch (err: any) {
    console.error('[test-ad-gen] Error:', err?.message);
    return NextResponse.json({ error: err?.message ?? 'Failed' }, { status: 500 });
  }
}