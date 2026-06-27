import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';
export const dynamic = 'force-dynamic';

const DOCUMENT_TYPES = [
  { type: 'owner_bio', title: 'Owner Bio', prompt: 'Write a professional owner/founder bio' },
  { type: 'founder_story', title: 'Founder Story', prompt: 'Write a compelling founder story narrative' },
  { type: 'company_profile', title: 'Company Profile', prompt: 'Write a comprehensive company profile' },
  { type: 'mission_statement', title: 'Mission Statement', prompt: 'Write a clear mission statement' },
  { type: 'service_area', title: 'Service Area Description', prompt: 'Write a service area description for local SEO' },
  { type: 'customer_profile', title: 'Customer Profile', prompt: 'Write an ideal customer profile' },
  { type: 'differentiators', title: 'Differentiators / Why Choose Us', prompt: 'Write a compelling "Why Choose Us" section' },
  { type: 'credentials', title: 'Credentials, Awards & Guarantees', prompt: 'Summarize credentials, awards, and guarantees' },
  { type: 'faq_source', title: 'Common Customer Questions / FAQ Source', prompt: 'Create a FAQ document from customer questions' },
  { type: 'objections_guide', title: 'Common Objections & Response Guide', prompt: 'Create an objections and response guide' },
  { type: 'brand_voice', title: 'Brand Voice Guide', prompt: 'Write a brand voice and tone guide' },
  { type: 'claims_avoid', title: 'Words / Claims to Avoid', prompt: 'List words, claims, and phrases to avoid' },
  { type: 'master_profile', title: 'Full Business Profile Master Document', prompt: 'Create a comprehensive master business profile document' },
];

function buildPromptContext(answersJson: Record<string, Record<string, string>>): string {
  const sections: string[] = [];
  for (const [sectionId, answers] of Object.entries(answersJson)) {
    const filled = Object.entries(answers).filter(([, v]) => v && v.trim());
    if (filled.length > 0) {
      sections.push(filled.map(([k, v]) => `${k}: ${v}`).join('\n'));
    }
  }
  return sections.join('\n\n');
}

/**
 * POST /api/businesses/[id]/business-profile/generate
 * Generates business profile documents from interview answers using LLM.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const userId = (session.user as any).id;
    const businessId = params.id;

    const business = await prisma.business.findFirst({ where: { id: businessId, userId }, select: { id: true, businessName: true } });
    if (!business) return NextResponse.json({ error: 'Business not found' }, { status: 404 });

    const body = await req.json();
    const { interviewId, answersJson } = body;
    if (!answersJson || Object.keys(answersJson).length === 0) {
      return NextResponse.json({ error: 'No interview answers provided' }, { status: 400 });
    }

    const context = buildPromptContext(answersJson);
    const businessName = business.businessName || 'the business';

    // Generate documents using LLM
    const apiKey = process.env.ABACUSAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'LLM API not configured' }, { status: 500 });
    }

    const documents: any[] = [];

    for (const docType of DOCUMENT_TYPES) {
      try {
        const systemPrompt = `You are a professional business copywriter creating marketing documents for "${businessName}". Write in a professional but approachable tone. Use the information provided to create accurate, compelling content. Do not invent facts not supported by the provided information. If information is missing for a section, note that it should be added later. Output ONLY the document content, no headers like "Here is..." or meta-commentary.`;

        const userPrompt = `${docType.prompt} for "${businessName}" based on this business information:\n\n${context}\n\nWrite a complete, well-structured document. Use paragraphs, not bullet lists unless the content type specifically calls for them (like FAQs or lists of claims to avoid). Aim for 200-800 words depending on the document type.`;

        const llmRes = await fetch('https://apps.abacus.ai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: 'claude-sonnet-4-20250514',
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt },
            ],
            max_tokens: 2000,
            temperature: 0.7,
          }),
        });

        if (!llmRes.ok) {
          console.error(`[generate] LLM error for ${docType.type}:`, await llmRes.text());
          continue;
        }

        const llmData = await llmRes.json();
        const content = llmData.choices?.[0]?.message?.content || '';

        if (content.trim()) {
          const doc = await prisma.generatedBusinessProfileDocument.create({
            data: {
              businessId,
              interviewId: interviewId || null,
              documentType: docType.type,
              title: docType.title,
              content: content.trim(),
              status: 'needs_review',
              approvedForAI: false,
              publicUseAllowed: false,
              requiresReview: true,
              source: 'guided_interview',
            },
          });
          documents.push(doc);
        }
      } catch (docErr: any) {
        console.error(`[generate] Error generating ${docType.type}:`, docErr.message);
      }
    }

    // Mark interview as completed
    if (interviewId) {
      await prisma.businessProfileInterview.update({
        where: { id: interviewId },
        data: { status: 'completed', completedAt: new Date() },
      });
    }

    return NextResponse.json({ documents, count: documents.length });
  } catch (err: any) {
    console.error('[business-profile/generate] POST error:', err);
    return NextResponse.json({ error: 'Document generation failed' }, { status: 500 });
  }
}
