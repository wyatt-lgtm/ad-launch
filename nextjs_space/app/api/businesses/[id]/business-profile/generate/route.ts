import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';
import { DOCUMENT_TYPES } from '@/lib/interview-data';
export const dynamic = 'force-dynamic';

function buildPromptContext(answersJson: Record<string, Record<string, string>>): string {
  const sections: string[] = [];
  for (const [sectionId, answers] of Object.entries(answersJson)) {
    const filled = Object.entries(answers).filter(([, v]) => v && v.trim());
    if (filled.length > 0) {
      sections.push(`[${sectionId}]\n${filled.map(([k, v]) => `${k}: ${v}`).join('\n')}`);
    }
  }
  return sections.join('\n\n');
}

/**
 * POST /api/businesses/[id]/business-profile/generate
 * Generates business profile documents from interview answers using LLM.
 * Supports full generation or section-level generation via `docTypes` parameter.
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
    const { interviewId, answersJson, docTypes, isQuickStart } = body;
    if (!answersJson || Object.keys(answersJson).length === 0) {
      return NextResponse.json({ error: 'No interview answers provided' }, { status: 400 });
    }

    const context = buildPromptContext(answersJson);
    const businessName = business.businessName || 'the business';

    const apiKey = process.env.ABACUSAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'LLM API not configured' }, { status: 500 });
    }

    // Filter to requested doc types, or generate all
    const targetDocTypes = Array.isArray(docTypes) && docTypes.length > 0
      ? DOCUMENT_TYPES.filter(d => docTypes.includes(d.type))
      : DOCUMENT_TYPES;

    const quickStartNote = isQuickStart
      ? '\n\nNote: This profile was generated from a Quick Start interview with limited information. Mark areas where more detail would improve accuracy. Be practical with what you have — don\'t pad with generic content.'
      : '';

    const documents: any[] = [];

    for (const docType of targetDocTypes) {
      try {
        const systemPrompt = `You are a professional business copywriter creating marketing documents for "${businessName}". Write in a professional but approachable tone. Use the information provided to create accurate, compelling content. Do not invent facts not supported by the provided information. If information is missing for a section, note that it should be added later. Output ONLY the document content, no headers like "Here is..." or meta-commentary.${quickStartNote}`;

        const userPrompt = `${docType.prompt} for "${businessName}" based on this business information:\n\n${context}\n\nWrite a complete, well-structured document. Use paragraphs, not bullet lists unless the content type specifically calls for them (like FAQs or lists of claims to avoid). Aim for 200-800 words depending on the document type.`;

        const llmRes = await fetch('https://apps.abacus.ai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: 'claude-sonnet-4-6',
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
          // Upsert: if a document of this type already exists for this business+interview, update it
          const existing = await prisma.generatedBusinessProfileDocument.findFirst({
            where: { businessId, documentType: docType.type, ...(interviewId ? { interviewId } : {}) },
          });

          let doc;
          if (existing) {
            doc = await prisma.generatedBusinessProfileDocument.update({
              where: { id: existing.id },
              data: {
                content: content.trim(),
                status: isQuickStart ? 'draft' : 'needs_review',
                requiresReview: true,
                // Keep existing approval state unless regenerating
                approvedForAI: false,
                publicUseAllowed: false,
              },
            });
          } else {
            doc = await prisma.generatedBusinessProfileDocument.create({
              data: {
                businessId,
                interviewId: interviewId || null,
                documentType: docType.type,
                title: docType.title,
                content: content.trim(),
                status: isQuickStart ? 'draft' : 'needs_review',
                approvedForAI: false,
                publicUseAllowed: docType.defaultPrivacy === 'public',
                requiresReview: true,
                source: 'guided_interview',
              },
            });
          }
          documents.push(doc);
        }
      } catch (docErr: any) {
        console.error(`[generate] Error generating ${docType.type}:`, docErr.message);
      }
    }

    // Mark interview status
    if (interviewId) {
      await prisma.businessProfileInterview.update({
        where: { id: interviewId },
        data: {
          status: isQuickStart ? 'draft' : 'completed',
          ...(isQuickStart ? {} : { completedAt: new Date() }),
        },
      });
    }

    return NextResponse.json({
      documents,
      count: documents.length,
      isQuickStart: !!isQuickStart,
      message: isQuickStart
        ? 'Draft generated from Quick Start. Add more details to improve accuracy.'
        : undefined,
    });
  } catch (err: any) {
    console.error('[business-profile/generate] POST error:', err);
    return NextResponse.json({ error: 'Document generation failed' }, { status: 500 });
  }
}
