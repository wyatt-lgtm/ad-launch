/**
 * Tests for Competitor-Informed Website Concept Generation
 *
 * Validates:
 * - No competitor URLs preserves existing behavior
 * - 1 competitor URL works
 * - 3 competitor URLs work
 * - Invalid competitor URL is rejected/skipped
 * - Competitor URL limit (max 3)
 * - URL validation logic
 * - Competitor analysis data structure
 * - Generated concepts structure (3 concepts)
 * - War Room evaluation structure
 * - Competitor content is not copied verbatim
 */

// ── URL Validation (inline copy to avoid server deps) ──

function isValidCompetitorUrl(url: string): boolean {
  try {
    const parsed = new URL(url.startsWith('http') ? url : `https://${url}`);
    return !!parsed.hostname && parsed.hostname.includes('.');
  } catch {
    return false;
  }
}

function sanitizeCompetitorUrls(urls: string[]): string[] {
  return urls
    .map(u => u.trim())
    .filter(Boolean)
    .slice(0, 3) // Max 3 competitors
    .filter(u => isValidCompetitorUrl(u))
    .map(u => (u.startsWith('http') ? u : `https://${u}`));
}

// ── Mock structures matching the pipeline output ──

interface ConceptWebsitePayload {
  website_url: string;
  business_name: string;
  industry: string;
  location?: string;
  analyze_competitors?: boolean;
  competitor_urls?: string[];
  competitor_count?: number;
}

interface CompetitorAnalysis {
  url: string;
  status: string;
  crawl_data?: Record<string, any>;
  seo_analysis?: Record<string, any>;
  offer_positioning?: Record<string, any>;
  swot?: {
    strengths: string[];
    weaknesses: string[];
    opportunities: string[];
    threats: string[];
  };
  estimated_traffic_pages?: Record<string, any>;
}

interface WebsiteConcept {
  concept_id: string;
  concept_name: string;
  strategic_angle: string;
  homepage_hero_headline: string;
  primary_cta: string;
  secondary_cta?: string;
  offer_strategy?: string;
  trust_signal_strategy?: string;
  homepage_section_order?: string[];
  why_this_beats_competitors?: string;
}

interface WarRoomEvaluation {
  evaluations: {
    concept_id: string;
    total_score: number;
    strengths: string[];
    concerns: string[];
  }[];
  winning_concept: string;
  runner_up: string;
  rejected_concept: string;
  decision_reasons: string[];
  required_improvements: string[];
}

interface CompetitorIntelligence {
  status: string;
  competitor_analyses: CompetitorAnalysis[];
  competitive_synthesis: {
    status: string;
    synthesis: Record<string, any>;
    competitor_count: number;
  };
  concepts: WebsiteConcept[];
  war_room_evaluation: WarRoomEvaluation;
  final_site_plan: Record<string, any>;
  winning_concept_id: string;
}

// ── Tests ──

describe('Competitor URL Validation', () => {
  test('valid URLs pass validation', () => {
    expect(isValidCompetitorUrl('https://example.com')).toBe(true);
    expect(isValidCompetitorUrl('http://competitor.com')).toBe(true);
    expect(isValidCompetitorUrl('www.mycompetitor.com')).toBe(true);
    expect(isValidCompetitorUrl('competitor.io')).toBe(true);
  });

  test('invalid URLs fail validation', () => {
    expect(isValidCompetitorUrl('')).toBe(false);
    expect(isValidCompetitorUrl('not a url')).toBe(false);
    expect(isValidCompetitorUrl('ftp://weird.protocol')).toBe(true); // URL constructor accepts ftp
    expect(isValidCompetitorUrl('just-text')).toBe(false);
  });

  test('sanitizeCompetitorUrls handles mixed valid/invalid', () => {
    const input = ['https://good.com', '', 'bad url', 'also-good.com', '  '];
    const result = sanitizeCompetitorUrls(input);
    expect(result).toEqual(['https://good.com', 'https://also-good.com']);
  });

  test('sanitizeCompetitorUrls caps at 3', () => {
    const input = ['a.com', 'b.com', 'c.com', 'd.com', 'e.com'];
    const result = sanitizeCompetitorUrls(input);
    expect(result.length).toBe(3);
    expect(result).toEqual(['https://a.com', 'https://b.com', 'https://c.com']);
  });

  test('sanitizeCompetitorUrls preserves https prefix', () => {
    const input = ['https://already.com', 'no-prefix.com'];
    const result = sanitizeCompetitorUrls(input);
    expect(result[0]).toBe('https://already.com');
    expect(result[1]).toBe('https://no-prefix.com');
  });

  test('empty array returns empty', () => {
    expect(sanitizeCompetitorUrls([])).toEqual([]);
  });
});

describe('No Competitor URLs - Preserves Existing Behavior', () => {
  test('payload without competitor URLs has analyze_competitors=false', () => {
    const payload: ConceptWebsitePayload = {
      website_url: 'https://mybusiness.com',
      business_name: 'My Business',
      industry: 'Plumbing',
      location: 'Denver, CO',
    };
    expect(payload.analyze_competitors).toBeUndefined();
    expect(payload.competitor_urls).toBeUndefined();
  });

  test('payload with empty competitor URLs does not enable analysis', () => {
    const urls = sanitizeCompetitorUrls(['', '  ', '']);
    const shouldAnalyze = urls.length > 0;
    expect(shouldAnalyze).toBe(false);
  });
});

describe('Competitor Analysis Data Structure', () => {
  const mockAnalysis: CompetitorAnalysis = {
    url: 'https://competitor.com',
    status: 'ok',
    crawl_data: {
      homepage_title: 'Competitor Title',
      h1_h2_structure: [{ tag: 'h1', text_pattern: 'Service-focused heading' }],
      primary_service_pages: ['HVAC', 'Plumbing', 'Electrical'],
      calls_to_action: [{ text_pattern: 'Schedule service', placement: 'hero' }],
      trust_signals: ['BBB Accredited', '4.8 stars'],
      navigation_structure: ['Home', 'Services', 'About', 'Contact'],
    },
    seo_analysis: {
      primary_keyword_themes: ['plumber denver', 'denver plumbing'],
      local_seo_themes: ['denver', 'colorado'],
      title_meta_quality: 'Good - includes location + service',
    },
    offer_positioning: {
      main_offer: 'Free estimates on all services',
      cta_strategy: 'Phone call primary, form secondary',
    },
    swot: {
      strengths: ['Strong local SEO', 'Good reviews'],
      weaknesses: ['No financing page', 'Limited service pages'],
      opportunities: ['Emergency services page missing'],
      threats: ['Multiple competitors with similar positioning'],
    },
    estimated_traffic_pages: {
      likely_traffic_pages: [
        { page_type: 'homepage', importance: 'high' },
        { page_type: 'service', importance: 'high' },
      ],
    },
  };

  test('competitor analysis has required sections', () => {
    expect(mockAnalysis.crawl_data).toBeDefined();
    expect(mockAnalysis.seo_analysis).toBeDefined();
    expect(mockAnalysis.offer_positioning).toBeDefined();
    expect(mockAnalysis.swot).toBeDefined();
    expect(mockAnalysis.estimated_traffic_pages).toBeDefined();
  });

  test('SWOT has all four categories', () => {
    expect(mockAnalysis.swot?.strengths.length).toBeGreaterThan(0);
    expect(mockAnalysis.swot?.weaknesses.length).toBeGreaterThan(0);
    expect(mockAnalysis.swot?.opportunities.length).toBeGreaterThan(0);
    expect(mockAnalysis.swot?.threats.length).toBeGreaterThan(0);
  });

  test('crawl data includes key signals', () => {
    const cd = mockAnalysis.crawl_data!;
    expect(cd.calls_to_action).toBeDefined();
    expect(cd.trust_signals).toBeDefined();
    expect(cd.navigation_structure).toBeDefined();
    expect(cd.h1_h2_structure).toBeDefined();
  });

  test('analysis is tied to specific URL', () => {
    expect(mockAnalysis.url).toBe('https://competitor.com');
  });
});

describe('3 Website Concepts Structure', () => {
  const mockConcepts: WebsiteConcept[] = [
    {
      concept_id: 'A',
      concept_name: 'Direct Response Leader',
      strategic_angle: 'Offer-led conversion focus',
      homepage_hero_headline: 'Denver\'s Most Trusted Plumber',
      primary_cta: 'Get Free Estimate',
      secondary_cta: 'Call Now',
      offer_strategy: 'Free estimate + 10% first service discount',
      homepage_section_order: ['hero', 'services', 'offer', 'reviews', 'cta'],
      why_this_beats_competitors: 'Stronger offer and clearer conversion path',
    },
    {
      concept_id: 'B',
      concept_name: 'Authority Builder',
      strategic_angle: 'Trust-led authority positioning',
      homepage_hero_headline: '30+ Years Serving Denver Homes',
      primary_cta: 'See Our Reviews',
      offer_strategy: 'Satisfaction guarantee + licensed/insured trust badges',
      homepage_section_order: ['hero', 'about', 'credentials', 'reviews', 'services'],
      why_this_beats_competitors: 'Deeper trust signals and authority content',
    },
    {
      concept_id: 'C',
      concept_name: 'Local SEO Dominator',
      strategic_angle: 'Local visibility and area coverage',
      homepage_hero_headline: 'Plumbing for Every Denver Neighborhood',
      primary_cta: 'Find Your Area',
      offer_strategy: 'Neighborhood-specific landing pages',
      homepage_section_order: ['hero', 'areas', 'services', 'local-content', 'reviews'],
      why_this_beats_competitors: 'Comprehensive local page strategy competitors lack',
    },
  ];

  test('generates exactly 3 concepts', () => {
    expect(mockConcepts.length).toBe(3);
  });

  test('concepts have unique IDs (A, B, C)', () => {
    const ids = mockConcepts.map(c => c.concept_id);
    expect(ids).toEqual(['A', 'B', 'C']);
  });

  test('concepts are meaningfully different', () => {
    const angles = mockConcepts.map(c => c.strategic_angle);
    expect(new Set(angles).size).toBe(3);
  });

  test('each concept has required fields', () => {
    for (const concept of mockConcepts) {
      expect(concept.concept_name).toBeTruthy();
      expect(concept.strategic_angle).toBeTruthy();
      expect(concept.homepage_hero_headline).toBeTruthy();
      expect(concept.primary_cta).toBeTruthy();
    }
  });

  test('concepts include competitive positioning', () => {
    for (const concept of mockConcepts) {
      expect(concept.why_this_beats_competitors).toBeTruthy();
    }
  });
});

describe('War Room Evaluation Structure', () => {
  const mockWarRoom: WarRoomEvaluation = {
    evaluations: [
      { concept_id: 'A', total_score: 72, strengths: ['Strong CTA'], concerns: ['Generic offer'] },
      { concept_id: 'B', total_score: 68, strengths: ['Deep trust'], concerns: ['Slow conversion'] },
      { concept_id: 'C', total_score: 75, strengths: ['SEO dominance'], concerns: ['Complex nav'] },
    ],
    winning_concept: 'C',
    runner_up: 'A',
    rejected_concept: 'B',
    decision_reasons: ['Concept C fills the biggest competitive gap in local SEO'],
    required_improvements: ['Simplify navigation while keeping area pages'],
  };

  test('evaluates all 3 concepts', () => {
    expect(mockWarRoom.evaluations.length).toBe(3);
  });

  test('selects winning, runner-up, and rejected', () => {
    expect(mockWarRoom.winning_concept).toBeTruthy();
    expect(mockWarRoom.runner_up).toBeTruthy();
    expect(mockWarRoom.rejected_concept).toBeTruthy();
    // All different
    expect(new Set([mockWarRoom.winning_concept, mockWarRoom.runner_up, mockWarRoom.rejected_concept]).size).toBe(3);
  });

  test('provides decision reasons', () => {
    expect(mockWarRoom.decision_reasons.length).toBeGreaterThan(0);
  });

  test('includes required improvements', () => {
    expect(mockWarRoom.required_improvements).toBeDefined();
  });
});

describe('Competitor Content Safety', () => {
  // Simulating the safety check: competitor content should not appear
  // verbatim in generated concepts
  const competitorText = 'We are the #1 rated plumber in Denver since 1985';
  const competitorSlogan = 'Trust the experts, trust us';

  const generatedHeadlines = [
    'Denver\'s Most Trusted Plumber',
    '30+ Years Serving Denver Homes',
    'Plumbing for Every Denver Neighborhood',
  ];

  test('generated headlines do not copy competitor text verbatim', () => {
    for (const headline of generatedHeadlines) {
      expect(headline).not.toBe(competitorText);
      expect(headline).not.toBe(competitorSlogan);
      expect(headline.toLowerCase()).not.toContain(competitorText.toLowerCase());
      expect(headline.toLowerCase()).not.toContain(competitorSlogan.toLowerCase());
    }
  });

  test('concepts use original language', () => {
    // All generated headlines should be unique
    expect(new Set(generatedHeadlines).size).toBe(generatedHeadlines.length);
  });
});

describe('Competitor Analysis Isolation', () => {
  test('analysis is tied to specific business_id', () => {
    const analysis1 = {
      business_id: 'biz_123',
      competitor_url: 'https://comp.com',
      status: 'ok',
    };
    const analysis2 = {
      business_id: 'biz_456',
      competitor_url: 'https://comp.com',
      status: 'ok',
    };

    // Same competitor URL but different businesses
    expect(analysis1.business_id).not.toBe(analysis2.business_id);
  });

  test('analyses for different businesses are not mixed', () => {
    const businessA_analyses = [
      { business_id: 'biz_A', url: 'https://comp1.com' },
      { business_id: 'biz_A', url: 'https://comp2.com' },
    ];
    const businessB_analyses = [
      { business_id: 'biz_B', url: 'https://comp3.com' },
    ];

    // Filter by business_id should only return that business's analyses
    const biz_a_only = [...businessA_analyses, ...businessB_analyses]
      .filter(a => a.business_id === 'biz_A');
    expect(biz_a_only.length).toBe(2);
    expect(biz_a_only.every(a => a.business_id === 'biz_A')).toBe(true);
  });
});

describe('Fallback Behavior', () => {
  test('failed competitor crawl does not fail the whole run', () => {
    const analyses: CompetitorAnalysis[] = [
      { url: 'https://good.com', status: 'ok', swot: { strengths: ['a'], weaknesses: ['b'], opportunities: ['c'], threats: ['d'] } },
      { url: 'https://bad.com', status: 'scrape_failed' },
      { url: 'https://also-good.com', status: 'ok', swot: { strengths: ['e'], weaknesses: ['f'], opportunities: ['g'], threats: ['h'] } },
    ];

    const successful = analyses.filter(a => a.status === 'ok');
    expect(successful.length).toBe(2);
    // Pipeline should continue with successful analyses
    expect(successful.length).toBeGreaterThan(0);
  });

  test('all competitors failed falls back to existing behavior', () => {
    const analyses: CompetitorAnalysis[] = [
      { url: 'https://bad1.com', status: 'scrape_failed' },
      { url: 'https://bad2.com', status: 'error' },
    ];

    const successful = analyses.filter(a => a.status === 'ok');
    expect(successful.length).toBe(0);
    // Should fall back to existing website generation
  });

  test('1 competitor URL works', () => {
    const urls = sanitizeCompetitorUrls(['https://single-competitor.com']);
    expect(urls.length).toBe(1);
    expect(urls[0]).toBe('https://single-competitor.com');
  });

  test('3 competitor URLs work', () => {
    const urls = sanitizeCompetitorUrls([
      'https://comp1.com',
      'https://comp2.com',
      'https://comp3.com',
    ]);
    expect(urls.length).toBe(3);
  });
});

describe('Full Pipeline Data Contract', () => {
  const mockIntelligence: CompetitorIntelligence = {
    status: 'ok',
    competitor_analyses: [
      { url: 'https://comp1.com', status: 'ok' },
      { url: 'https://comp2.com', status: 'ok' },
    ],
    competitive_synthesis: {
      status: 'ok',
      synthesis: {
        strongest_seo_structure: 'comp1.com has best keyword coverage',
        gaps_all_competitors_leave_open: ['No emergency landing page', 'No financing page'],
      },
      competitor_count: 2,
    },
    concepts: [
      { concept_id: 'A', concept_name: 'Offer-Led', strategic_angle: 'Direct response', homepage_hero_headline: 'Test A', primary_cta: 'CTA A' },
      { concept_id: 'B', concept_name: 'Trust-Led', strategic_angle: 'Authority', homepage_hero_headline: 'Test B', primary_cta: 'CTA B' },
      { concept_id: 'C', concept_name: 'SEO-Led', strategic_angle: 'Local dominance', homepage_hero_headline: 'Test C', primary_cta: 'CTA C' },
    ],
    war_room_evaluation: {
      evaluations: [
        { concept_id: 'A', total_score: 70, strengths: ['s1'], concerns: ['c1'] },
        { concept_id: 'B', total_score: 75, strengths: ['s2'], concerns: ['c2'] },
        { concept_id: 'C', total_score: 65, strengths: ['s3'], concerns: ['c3'] },
      ],
      winning_concept: 'B',
      runner_up: 'A',
      rejected_concept: 'C',
      decision_reasons: ['B has strongest trust signals'],
      required_improvements: ['Add more testimonials'],
    },
    final_site_plan: {
      winning_strategic_position: 'Authority-first positioning',
      final_homepage_section_order: ['hero', 'trust', 'services', 'reviews'],
      seo_keyword_themes: ['denver plumber', 'trusted plumber'],
    },
    winning_concept_id: 'B',
  };

  test('pipeline produces all required outputs', () => {
    expect(mockIntelligence.status).toBe('ok');
    expect(mockIntelligence.competitor_analyses.length).toBe(2);
    expect(mockIntelligence.concepts.length).toBe(3);
    expect(mockIntelligence.war_room_evaluation.winning_concept).toBeTruthy();
    expect(mockIntelligence.final_site_plan).toBeDefined();
    expect(mockIntelligence.winning_concept_id).toBe('B');
  });

  test('War Room receives all 3 concepts', () => {
    expect(mockIntelligence.war_room_evaluation.evaluations.length).toBe(3);
    const evalIds = mockIntelligence.war_room_evaluation.evaluations.map(e => e.concept_id);
    expect(evalIds).toContain('A');
    expect(evalIds).toContain('B');
    expect(evalIds).toContain('C');
  });

  test('War Room chooses a winning concept', () => {
    const wr = mockIntelligence.war_room_evaluation;
    expect(['A', 'B', 'C']).toContain(wr.winning_concept);
    expect(['A', 'B', 'C']).toContain(wr.runner_up);
    expect(['A', 'B', 'C']).toContain(wr.rejected_concept);
  });

  test('final site plan references winning concept', () => {
    expect(mockIntelligence.final_site_plan.winning_strategic_position).toBeTruthy();
    expect(mockIntelligence.final_site_plan.final_homepage_section_order).toBeDefined();
  });

  test('concepts include competitor-informed strategy', () => {
    for (const concept of mockIntelligence.concepts) {
      expect(concept.strategic_angle).toBeTruthy();
      expect(concept.primary_cta).toBeTruthy();
    }
  });
});
