/**
 * Interview Prefill — gathers data from all available sources and maps to interview questions.
 *
 * Sources (priority order):
 *   1. Owner-confirmed prior interview answers
 *   2. Approved generated business profile documents
 *   3. Verified business record fields
 *   4. Website crawl / content profile
 *   5. Jim Bridger research (savedAnalysis.rawRecon)
 *   6. Creative asset metadata
 *   7. AI inference (lowest confidence)
 */

import { prisma } from '@/lib/db';
import { INTERVIEW_SECTIONS } from '@/lib/interview-data';

// ── Types ────────────────────────────────────────────────────────────────────

export type PrefillSource =
  | 'owner_confirmed'
  | 'prior_answer'
  | 'generated_document'
  | 'business_record'
  | 'website'
  | 'jim_bridger'
  | 'content_profile'
  | 'creative_asset'
  | 'gbp'
  | 'unknown';

export type PrefillConfidence = 'high' | 'medium' | 'low';

export interface PrefillItem {
  sectionId: string;
  questionKey: string;
  value: string;
  source: PrefillSource;
  confidence: PrefillConfidence;
  needsOwnerConfirmation: boolean;
  ownerConfirmed: boolean;
  notes?: string;
  updatedAt?: string;
}

export interface PrefillResult {
  items: PrefillItem[];
  sources: { source: PrefillSource; label: string; count: number }[];
  hasResearch: boolean;
  hasOwnerData: boolean;
  totalPrefilled: number;
  totalQuestions: number;
  conflictsFound: PrefillConflict[];
}

export interface PrefillConflict {
  questionKey: string;
  sectionId: string;
  values: { value: string; source: PrefillSource; confidence: PrefillConfidence }[];
  resolvedValue: string;
  resolvedSource: PrefillSource;
}

// ── Source priority (higher = wins in conflict) ──────────────────────────────

const SOURCE_PRIORITY: Record<PrefillSource, number> = {
  owner_confirmed: 100,
  prior_answer: 90,
  generated_document: 70,
  business_record: 60,
  website: 40,
  gbp: 35,
  content_profile: 30,
  jim_bridger: 25,
  creative_asset: 20,
  unknown: 0,
};

const SOURCE_LABELS: Record<PrefillSource, string> = {
  owner_confirmed: 'Owner confirmed',
  prior_answer: 'Prior interview answer',
  generated_document: 'Approved business profile document',
  business_record: 'Verified business record',
  website: 'Website crawl',
  gbp: 'Google Business Profile',
  content_profile: 'Content profile',
  jim_bridger: 'Jim Bridger research',
  creative_asset: 'Creative asset',
  unknown: 'Unknown source',
};

// ── Main function ────────────────────────────────────────────────────────────

export async function buildBusinessProfileInterviewPrefill(
  businessId: string,
): Promise<PrefillResult> {
  // Gather all data in parallel
  const [business, interview, documents, contentProfile, assets] = await Promise.all([
    prisma.business.findUnique({
      where: { id: businessId },
      select: {
        id: true,
        businessName: true,
        websiteUrl: true,
        businessAddr: true,
        businessCity: true,
        businessState: true,
        businessZip: true,
        businessPhone: true,
        serviceAreaMode: true,
        hqCity: true,
        hqState: true,
        primaryMarketCity: true,
        primaryMarketState: true,
        targetMarkets: true,
        savedAnalysis: true,
        analysisRefreshedAt: true,
        forbiddenBrandTerms: true,
        locations: {
          where: { isConfirmed: true },
          select: {
            locationName: true, address1: true, city: true, state: true,
            postalCode: true, county: true, isPrimary: true, source: true, phone: true,
          },
          orderBy: { isPrimary: 'desc' },
        },
      },
    }),
    // Get most recent interview
    prisma.businessProfileInterview.findFirst({
      where: { businessId },
      orderBy: { updatedAt: 'desc' },
      select: { id: true, answersJson: true, status: true, updatedAt: true },
    }),
    // Get approved generated documents
    prisma.generatedBusinessProfileDocument.findMany({
      where: {
        businessId,
        OR: [{ status: 'approved' }, { approvedForAI: true }],
      },
      select: { documentType: true, content: true, title: true, updatedAt: true },
      orderBy: { updatedAt: 'desc' },
    }),
    // Get content profile
    prisma.businessContentProfile.findUnique({
      where: { businessId },
      select: {
        contentPillars: true,
        audienceSegments: true,
        brandVoiceSummary: true,
        restrictedTopics: true,
        industry: true,
        evergreenTopics: true,
        faqTopics: true,
      },
    }),
    // Get creative assets (text-based: claims, disclaimers, etc.)
    prisma.businessAsset.findMany({
      where: {
        businessId,
        approvalStatus: 'approved',
        textContent: { not: null },
      },
      select: {
        assetType: true, category: true, textContent: true, title: true,
      },
    }),
  ]);

  if (!business) {
    return {
      items: [],
      sources: [],
      hasResearch: false,
      hasOwnerData: false,
      totalPrefilled: 0,
      totalQuestions: INTERVIEW_SECTIONS.reduce((s, sec) => s + sec.questions.length, 0),
      conflictsFound: [],
    };
  }

  // Parse Jim Bridger research
  const savedProfile = business.savedAnalysis as any;
  const rawRecon = savedProfile?.rawRecon || savedProfile || null;
  const hasResearch = !!rawRecon && Object.keys(rawRecon).length > 0;

  // Parse prior interview answers
  const priorAnswers = (interview?.answersJson as Record<string, Record<string, string>>) || {};
  const interviewUpdatedAt = interview?.updatedAt?.toISOString();

  // Collect all candidate values per question (may have multiple sources)
  const candidates: Record<string, { value: string; source: PrefillSource; confidence: PrefillConfidence; notes?: string; updatedAt?: string }[]> = {};

  const addCandidate = (
    sectionId: string,
    questionKey: string,
    value: string | null | undefined,
    source: PrefillSource,
    confidence: PrefillConfidence,
    notes?: string,
    updatedAt?: string,
  ) => {
    if (!value || !value.trim()) return;
    const key = `${sectionId}::${questionKey}`;
    if (!candidates[key]) candidates[key] = [];
    candidates[key].push({ value: value.trim(), source, confidence, notes, updatedAt });
  };

  // ── 1. Prior interview answers (owner-confirmed if interview was completed/approved) ──
  const isOwnerConfirmed = interview?.status === 'approved' || interview?.status === 'completed';
  for (const section of INTERVIEW_SECTIONS) {
    const sectionAnswers = priorAnswers[section.id];
    if (!sectionAnswers) continue;
    for (const q of section.questions) {
      if (sectionAnswers[q.key]?.trim()) {
        addCandidate(
          section.id, q.key, sectionAnswers[q.key],
          isOwnerConfirmed ? 'owner_confirmed' : 'prior_answer',
          isOwnerConfirmed ? 'high' : 'medium',
          isOwnerConfirmed ? 'From completed interview' : 'From draft interview',
          interviewUpdatedAt,
        );
      }
    }
  }

  // ── 2. Business record fields (owner-confirmed via registration) ──
  // These are verified business fields
  addCandidate('basics', 'officialName', business.businessName, 'business_record', 'high', 'Confirmed business name');
  addCandidate('basics', 'contactInfo',
    [business.businessPhone, business.websiteUrl].filter(Boolean).join(' | ') || null,
    'business_record', 'high', 'From business registration',
  );

  // Build location string from confirmed locations or business fields
  const primaryLoc = business.locations?.[0];
  if (primaryLoc) {
    const locParts = [primaryLoc.address1, primaryLoc.city, primaryLoc.state, primaryLoc.postalCode].filter(Boolean);
    addCandidate('basics', 'location', locParts.join(', '), 'owner_confirmed', 'high', 'Owner-confirmed location');
    if (primaryLoc.phone) {
      addCandidate('basics', 'contactInfo',
        [primaryLoc.phone, business.websiteUrl].filter(Boolean).join(' | '),
        'owner_confirmed', 'high', 'From confirmed location',
      );
    }
  } else if (business.businessAddr || business.businessCity) {
    const locParts = [business.businessAddr, business.businessCity, business.businessState, business.businessZip].filter(Boolean);
    addCandidate('basics', 'location', locParts.join(', '), 'business_record', 'high', 'From business record');
  }

  // Service area from confirmed locations and settings
  if (business.locations && business.locations.length > 0) {
    const cities = [...new Set(business.locations.map(l => l.city).filter(Boolean))];
    const states = [...new Set(business.locations.map(l => l.state).filter(Boolean))];
    const counties = [...new Set(business.locations.map(l => l.county).filter(Boolean))];
    if (cities.length > 0) {
      addCandidate('serviceArea', 'areasServed', cities.join(', '), 'owner_confirmed', 'high', 'From confirmed locations');
    }
    if (business.locations.length > 1) {
      const locDescs = business.locations.map(l =>
        [l.locationName || l.city, l.state].filter(Boolean).join(', ')
      );
      addCandidate('serviceArea', 'serviceModel',
        `Multiple locations: ${locDescs.join('; ')}`,
        'owner_confirmed', 'high', `${business.locations.length} confirmed locations`,
      );
    }
  }

  if (business.targetMarkets && business.targetMarkets.length > 0) {
    addCandidate('serviceArea', 'priorityMarkets', business.targetMarkets.join(', '), 'owner_confirmed', 'high', 'Owner-set target markets');
  }

  if (business.serviceAreaMode) {
    const modeLabels: Record<string, string> = {
      local: 'Local service area',
      regional: 'Regional coverage',
      national: 'Nationwide service',
      multi_location: 'Multiple locations',
    };
    addCandidate('serviceArea', 'serviceModel',
      modeLabels[business.serviceAreaMode] || business.serviceAreaMode,
      'owner_confirmed', 'high', 'Owner-selected service mode',
    );
  }

  // ── 3. Jim Bridger research (savedAnalysis.rawRecon) ──
  if (rawRecon) {
    // Map recon fields to interview questions
    const reconMappings: { sectionId: string; questionKey: string; fields: string[]; confidence: PrefillConfidence; notes?: string }[] = [
      // Business Basics
      { sectionId: 'basics', questionKey: 'officialName', fields: ['business_name', 'businessName', 'company_name'], confidence: 'medium', notes: 'From business research' },
      { sectionId: 'basics', questionKey: 'oneSentence', fields: ['business_summary', 'summary', 'overview', 'tagline', 'description'], confidence: 'medium', notes: 'From business research' },
      { sectionId: 'basics', questionKey: 'mainServices', fields: ['services_offered', 'services', 'products_services', 'core_services', 'service_list'], confidence: 'medium', notes: 'From website + business research' },
      { sectionId: 'basics', questionKey: 'yearsOperating', fields: ['years_in_business', 'founded', 'established', 'year_founded', 'since'], confidence: 'medium' },
      { sectionId: 'basics', questionKey: 'location', fields: ['location', 'address', 'service_area', 'headquarters'], confidence: 'medium' },
      { sectionId: 'basics', questionKey: 'ownerLeader', fields: ['owner', 'founder', 'ceo', 'principal', 'leadership'], confidence: 'low', notes: 'From public research — verify' },
      { sectionId: 'basics', questionKey: 'contactInfo', fields: ['phone', 'contact_phone', 'email', 'contact_email', 'contact_info'], confidence: 'medium' },

      // Owner / Founder
      { sectionId: 'founder', questionKey: 'founderName', fields: ['owner', 'founder', 'ceo', 'principal', 'owner_name'], confidence: 'low', notes: 'Needs owner verification' },
      { sectionId: 'founder', questionKey: 'credibility', fields: ['credentials', 'certifications', 'experience_summary', 'qualifications'], confidence: 'medium' },

      // History
      { sectionId: 'history', questionKey: 'whenStarted', fields: ['founded', 'established', 'year_founded', 'since', 'years_in_business'], confidence: 'medium' },

      // Services & Customers
      { sectionId: 'services', questionKey: 'coreServices', fields: ['services_offered', 'services', 'products_services', 'core_services', 'service_list', 'service_categories'], confidence: 'medium', notes: 'From website research' },
      { sectionId: 'services', questionKey: 'idealCustomer', fields: ['target_audience', 'target_customers', 'ideal_customer', 'customer_persona'], confidence: 'medium' },
      { sectionId: 'services', questionKey: 'customerTypes', fields: ['customer_segments', 'customer_types', 'market_segments'], confidence: 'low' },
      { sectionId: 'services', questionKey: 'triggerToCall', fields: ['pain_points', 'customer_problems', 'trigger_events'], confidence: 'low' },

      // Service Area
      { sectionId: 'serviceArea', questionKey: 'areasServed', fields: ['service_area', 'service_areas', 'coverage_area', 'cities_served', 'areas_served'], confidence: 'medium', notes: 'From public research' },
      { sectionId: 'serviceArea', questionKey: 'localTerms', fields: ['local_landmarks', 'local_terms', 'neighborhood_names', 'community_names'], confidence: 'low' },

      // Differentiators
      { sectionId: 'differentiators', questionKey: 'whyChoose', fields: ['unique_selling_points', 'differentiators', 'competitive_advantages', 'usp', 'why_choose_us'], confidence: 'medium', notes: 'From website claims' },
      { sectionId: 'differentiators', questionKey: 'whatBetter', fields: ['strengths', 'advantages', 'competitive_edge'], confidence: 'low' },
      { sectionId: 'differentiators', questionKey: 'proof', fields: ['proof_points', 'social_proof', 'testimonials_summary', 'review_count', 'rating'], confidence: 'medium' },

      // Credentials
      { sectionId: 'credentials', questionKey: 'licenses', fields: ['licenses', 'certifications', 'credentials', 'accreditations'], confidence: 'medium', notes: 'From public listings' },
      { sectionId: 'credentials', questionKey: 'awardsRatings', fields: ['awards', 'ratings', 'review_score', 'bbb_rating', 'google_rating', 'review_count'], confidence: 'medium', notes: 'From public profiles' },
      { sectionId: 'credentials', questionKey: 'guarantees', fields: ['guarantees', 'warranty', 'promises', 'offers'], confidence: 'low', notes: 'Needs verification — may be outdated' },

      // Brand Voice
      { sectionId: 'voice', questionKey: 'tone', fields: ['brand_voice', 'brand_personality', 'tone', 'writing_style'], confidence: 'low', notes: 'Inferred from website copy' },
    ];

    for (const mapping of reconMappings) {
      for (const field of mapping.fields) {
        const val = extractReconValue(rawRecon, field);
        if (val) {
          addCandidate(
            mapping.sectionId, mapping.questionKey, val,
            'jim_bridger', mapping.confidence,
            mapping.notes || 'From Jim Bridger research',
          );
          break; // Use first found field
        }
      }
    }

    // Extract approved/restricted claims
    const approvedClaims = rawRecon.approved_claims || rawRecon.approvedClaims;
    if (Array.isArray(approvedClaims) && approvedClaims.length > 0) {
      addCandidate('differentiators', 'proof', approvedClaims.join('; '), 'jim_bridger', 'medium', 'Research-identified claims');
    }

    const restrictedClaims = rawRecon.restricted_claims || rawRecon.restrictedClaims;
    if (Array.isArray(restrictedClaims) && restrictedClaims.length > 0) {
      addCandidate('compliance', 'cannotPromise', restrictedClaims.join('; '), 'jim_bridger', 'medium', 'Research-identified restrictions');
    }

    const ctaRules = rawRecon.cta_rules || rawRecon.default_cta;
    if (ctaRules) {
      addCandidate('voice', 'useOften', ctaRules, 'jim_bridger', 'low', 'CTA patterns from research');
    }
  }

  // ── 4. Content profile ──
  if (contentProfile) {
    if (contentProfile.brandVoiceSummary) {
      addCandidate('voice', 'soundLike', contentProfile.brandVoiceSummary, 'content_profile', 'medium', 'From content profile');
    }
    if (contentProfile.industry) {
      addCandidate('basics', 'oneSentence', contentProfile.industry, 'content_profile', 'low', 'Industry from content profile');
    }
    const faqTopics = contentProfile.faqTopics as any[];
    if (Array.isArray(faqTopics) && faqTopics.length > 0) {
      const faqStr = faqTopics.map((t: any) => typeof t === 'string' ? t : t?.topic || t?.question || '').filter(Boolean).join('; ');
      if (faqStr) addCandidate('questions', 'faqCandidates', faqStr, 'content_profile', 'low', 'From content profile FAQ topics');
    }
    const restricted = contentProfile.restrictedTopics as any[];
    if (Array.isArray(restricted) && restricted.length > 0) {
      const restrictedStr = restricted.map((t: any) => typeof t === 'string' ? t : t?.topic || '').filter(Boolean).join('; ');
      if (restrictedStr) addCandidate('compliance', 'competitorClaimsAvoid', restrictedStr, 'content_profile', 'medium', 'From content profile restricted topics');
    }
  }

  // ── 5. Creative assets (text-based) ──
  if (assets && assets.length > 0) {
    for (const asset of assets) {
      if (!asset.textContent) continue;
      if (asset.assetType === 'approved_claim') {
        addCandidate('differentiators', 'proof', asset.textContent, 'creative_asset', 'high', `Approved claim: ${asset.title}`);
      } else if (asset.assetType === 'forbidden_claim') {
        addCandidate('compliance', 'cannotPromise', asset.textContent, 'creative_asset', 'high', `Forbidden claim: ${asset.title}`);
      } else if (asset.assetType === 'disclaimer') {
        addCandidate('credentials', 'disclaimers', asset.textContent, 'creative_asset', 'high', `Disclaimer: ${asset.title}`);
      } else if (asset.assetType === 'color_palette') {
        // Not directly mapped to interview but useful context
      }
    }
  }

  // ── 6. Generated documents ──
  if (documents && documents.length > 0) {
    for (const doc of documents) {
      const updatedAt = doc.updatedAt?.toISOString();
      // Extract key info from approved documents to fill gaps
      if (doc.documentType === 'service_area' && doc.content) {
        addCandidate('serviceArea', 'areasServed', extractFirstParagraph(doc.content), 'generated_document', 'medium', 'From approved service area document', updatedAt);
      }
      if (doc.documentType === 'customer_profile' && doc.content) {
        addCandidate('services', 'idealCustomer', extractFirstParagraph(doc.content), 'generated_document', 'medium', 'From approved customer profile', updatedAt);
      }
      if (doc.documentType === 'differentiators' && doc.content) {
        addCandidate('differentiators', 'whyChoose', extractFirstParagraph(doc.content), 'generated_document', 'medium', 'From approved differentiators doc', updatedAt);
      }
      if (doc.documentType === 'brand_voice' && doc.content) {
        addCandidate('voice', 'soundLike', extractFirstParagraph(doc.content), 'generated_document', 'medium', 'From approved brand voice guide', updatedAt);
      }
      if (doc.documentType === 'claims_avoid' && doc.content) {
        addCandidate('compliance', 'regulatedClaims', extractFirstParagraph(doc.content), 'generated_document', 'medium', 'From approved claims-to-avoid doc', updatedAt);
      }
    }
  }

  // ── 7. Forbidden brand terms from business record ──
  if (business.forbiddenBrandTerms && business.forbiddenBrandTerms.length > 0) {
    addCandidate('voice', 'avoidWords', business.forbiddenBrandTerms.join(', '), 'owner_confirmed', 'high', 'Owner-set forbidden terms');
    addCandidate('compliance', 'competitorClaimsAvoid', business.forbiddenBrandTerms.join(', '), 'owner_confirmed', 'high', 'Owner-set forbidden terms');
  }

  // ── Resolve conflicts and build final prefill ──
  const items: PrefillItem[] = [];
  const conflicts: PrefillConflict[] = [];

  for (const section of INTERVIEW_SECTIONS) {
    for (const q of section.questions) {
      const key = `${section.id}::${q.key}`;
      const cands = candidates[key];
      if (!cands || cands.length === 0) continue;

      // Sort by priority (higher = wins)
      cands.sort((a, b) => SOURCE_PRIORITY[b.source] - SOURCE_PRIORITY[a.source]);

      // Check for conflicts (different values from different sources)
      if (cands.length > 1) {
        const uniqueValues = new Set(cands.map(c => c.value.toLowerCase().trim()));
        if (uniqueValues.size > 1) {
          conflicts.push({
            questionKey: q.key,
            sectionId: section.id,
            values: cands.map(c => ({ value: c.value, source: c.source, confidence: c.confidence })),
            resolvedValue: cands[0].value,
            resolvedSource: cands[0].source,
          });
        }
      }

      const winner = cands[0];
      const isOwnerData = winner.source === 'owner_confirmed' || winner.source === 'prior_answer';
      const isSensitive = q.sensitive || section.id === 'compliance';

      items.push({
        sectionId: section.id,
        questionKey: q.key,
        value: winner.value,
        source: winner.source,
        confidence: winner.confidence,
        needsOwnerConfirmation: !isOwnerData || isSensitive,
        ownerConfirmed: isOwnerData,
        notes: winner.notes,
        updatedAt: winner.updatedAt,
      });
    }
  }

  // Compute source counts
  const sourceCounts = new Map<PrefillSource, number>();
  for (const item of items) {
    sourceCounts.set(item.source, (sourceCounts.get(item.source) || 0) + 1);
  }
  const sources = Array.from(sourceCounts.entries()).map(([source, count]) => ({
    source, label: SOURCE_LABELS[source], count,
  })).sort((a, b) => b.count - a.count);

  const totalQuestions = INTERVIEW_SECTIONS.reduce((s, sec) => s + sec.questions.length, 0);

  return {
    items,
    sources,
    hasResearch,
    hasOwnerData: items.some(i => i.ownerConfirmed),
    totalPrefilled: items.length,
    totalQuestions,
    conflictsFound: conflicts,
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function extractReconValue(recon: Record<string, any>, field: string): string | null {
  const val = recon[field];
  if (!val) return null;
  if (typeof val === 'string') return val.trim() || null;
  if (Array.isArray(val)) {
    const joined = val.map(v => typeof v === 'string' ? v : JSON.stringify(v)).join(', ');
    return joined.trim() || null;
  }
  if (typeof val === 'number') return String(val);
  if (typeof val === 'object') {
    // Try common nested patterns
    const text = val.text || val.value || val.description || val.summary;
    if (typeof text === 'string') return text.trim() || null;
    return JSON.stringify(val);
  }
  return null;
}

function extractFirstParagraph(content: string): string {
  // Get first meaningful paragraph from a document
  const lines = content.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#') && !l.startsWith('---'));
  const para = lines.slice(0, 3).join(' ');
  return para.length > 500 ? para.slice(0, 497) + '...' : para;
}

// ── Section status computation (enhanced for prefill) ────────────────────────

export type EnhancedSectionStatus =
  | 'confirmed'
  | 'needs_review'
  | 'missing_key_details'
  | 'low_confidence'
  | 'skipped'
  | 'requires_manual_review';

export const ENHANCED_STATUS_CONFIG: Record<EnhancedSectionStatus, { label: string; color: string; bgColor: string; icon: string }> = {
  confirmed: { label: 'Confirmed', color: 'text-green-700', bgColor: 'bg-green-50', icon: '✓' },
  needs_review: { label: 'Needs Review', color: 'text-amber-700', bgColor: 'bg-amber-50', icon: '⚠' },
  missing_key_details: { label: 'Missing Key Details', color: 'text-red-700', bgColor: 'bg-red-50', icon: '✕' },
  low_confidence: { label: 'Low Confidence', color: 'text-orange-700', bgColor: 'bg-orange-50', icon: '?' },
  skipped: { label: 'Skipped', color: 'text-gray-500', bgColor: 'bg-gray-50', icon: '—' },
  requires_manual_review: { label: 'Requires Manual Review', color: 'text-purple-700', bgColor: 'bg-purple-50', icon: '👁' },
};

export function getEnhancedSectionStatus(
  section: { id: string; questions: { key: string; sensitive?: boolean }[] },
  prefillItems: PrefillItem[],
  confirmedKeys: Set<string>,
): EnhancedSectionStatus {
  const sectionItems = prefillItems.filter(i => i.sectionId === section.id);
  const totalQs = section.questions.length;
  const isCompliance = section.id === 'compliance';

  // Count statuses
  const confirmed = section.questions.filter(q => confirmedKeys.has(`${section.id}::${q.key}`)).length;
  const prefilled = sectionItems.length;
  const lowConf = sectionItems.filter(i => i.confidence === 'low').length;
  const needsReview = sectionItems.filter(i => i.needsOwnerConfirmation && !confirmedKeys.has(`${section.id}::${i.questionKey}`)).length;

  if (isCompliance) return 'requires_manual_review';
  if (confirmed === totalQs) return 'confirmed';
  if (confirmed >= totalQs * 0.7 && needsReview === 0) return 'confirmed';
  if (prefilled === 0) return 'missing_key_details';
  if (lowConf > prefilled * 0.5) return 'low_confidence';
  if (needsReview > 0) return 'needs_review';
  if (prefilled < totalQs * 0.3) return 'missing_key_details';
  return 'needs_review';
}
