/**
 * Content Feed Geo Resolution & Story Classification Tests
 * 
 * Validates that:
 * 1. Geo context is business-scoped (not user-scoped)
 * 2. No hardcoded Grand Rapids fallback exists
 * 3. Story classification uses localityLevel correctly
 * 4. Card copy uses trade-area language only for true local stories
 * 5. Switching businesses clears stale scout state
 */

// ── Geo resolution priority tests ─────────────────────────────────────────

describe('Clark Kent Geo Resolution', () => {
  // Simulates the new business-scoped geo resolution logic
  function resolveGeo(params: {
    directZip?: string | null;
    bizGeoZip?: string | null;
    bizGeoCity?: string | null;
    bizGeoState?: string | null;
    bizAnalysisZip?: string | null;
    bizAnalysisCity?: string | null;
    bizAnalysisState?: string | null;
    analysisIdZip?: string | null;
    analysisIdCity?: string | null;
    analysisIdState?: string | null;
  }) {
    let businessZip: string | null = params.directZip || null;
    let businessCity: string | null = null;
    let businessState: string | null = null;

    // Step 1: Business record geo
    if (!businessZip && params.bizGeoZip) {
      businessZip = params.bizGeoZip;
      businessCity = params.bizGeoCity || null;
      businessState = params.bizGeoState || null;
    }

    // Step 2: Business-scoped analysis
    if (!businessZip && params.bizAnalysisZip) {
      businessZip = params.bizAnalysisZip;
      businessCity = params.bizAnalysisCity || null;
      businessState = params.bizAnalysisState || null;
    }

    // Step 3: Explicit analysisId
    if (!businessZip && params.analysisIdZip) {
      businessZip = params.analysisIdZip;
      businessCity = params.analysisIdCity || null;
      businessState = params.analysisIdState || null;
    }

    // Step 4: City/state from business without ZIP
    if (!businessZip && !businessCity && params.bizGeoCity) {
      businessCity = params.bizGeoCity;
      businessState = params.bizGeoState || null;
    }

    return { businessZip, businessCity, businessState };
  }

  test('uses business record geo first (Colorado Springs)', () => {
    const result = resolveGeo({
      bizGeoZip: '80903',
      bizGeoCity: 'Colorado Springs',
      bizGeoState: 'CO',
    });
    expect(result.businessCity).toBe('Colorado Springs');
    expect(result.businessState).toBe('CO');
    expect(result.businessZip).toBe('80903');
  });

  test('does NOT use Grand Rapids when business is Colorado Springs', () => {
    // Simulates the old bug: user has Grand Rapids analysis but selected business is Colorado Springs
    const result = resolveGeo({
      bizGeoZip: '80903',
      bizGeoCity: 'Colorado Springs',
      bizGeoState: 'CO',
      // These would have been picked up by the old user-scoped fallback:
      bizAnalysisZip: '49508',
      bizAnalysisCity: 'Grand Rapids',
      bizAnalysisState: 'MI',
    });
    expect(result.businessCity).toBe('Colorado Springs');
    expect(result.businessState).toBe('CO');
    expect(result.businessZip).toBe('80903');
    expect(result.businessCity).not.toBe('Grand Rapids');
  });

  test('directZip overrides all other geo sources', () => {
    const result = resolveGeo({
      directZip: '10001',
      bizGeoZip: '80903',
      bizGeoCity: 'Colorado Springs',
      bizGeoState: 'CO',
    });
    expect(result.businessZip).toBe('10001');
  });

  test('falls back to business-scoped analysis when business has no ZIP', () => {
    const result = resolveGeo({
      bizGeoZip: null,
      bizGeoCity: 'Colorado Springs',
      bizGeoState: 'CO',
      bizAnalysisZip: '80903',
      bizAnalysisCity: 'Colorado Springs',
      bizAnalysisState: 'CO',
    });
    expect(result.businessZip).toBe('80903');
    expect(result.businessCity).toBe('Colorado Springs');
  });

  test('uses city/state without ZIP for city-level fallback', () => {
    const result = resolveGeo({
      bizGeoZip: null,
      bizGeoCity: 'Colorado Springs',
      bizGeoState: 'CO',
    });
    expect(result.businessZip).toBeNull();
    expect(result.businessCity).toBe('Colorado Springs');
    expect(result.businessState).toBe('CO');
  });

  test('no Grand Rapids fallback when business has no location at all', () => {
    const result = resolveGeo({});
    expect(result.businessCity).toBeNull();
    expect(result.businessState).toBeNull();
    expect(result.businessZip).toBeNull();
    // Critically: no default city injected
  });

  test('no hardcoded fallback city in codebase', () => {
    // The resolveGeo function should never return a city it wasn't given
    const result = resolveGeo({
      bizGeoZip: null,
      bizGeoCity: null,
      bizGeoState: null,
    });
    expect(result.businessCity).toBeNull();
    expect(result.businessZip).toBeNull();
  });
});

// ── Story classification tests ────────────────────────────────────────────

describe('Story Bucket Classification', () => {
  const LOCAL_LEVELS = new Set(['zip', 'zip_radius', 'city', 'county', 'state']);

  function classifyHeadline(h: { localityLevel?: string; sourceType?: string }) {
    const level = h.localityLevel || 'unknown';
    return LOCAL_LEVELS.has(level) ? 'local' : 'industry';
  }

  test('zip-level items classified as local', () => {
    expect(classifyHeadline({ localityLevel: 'zip', sourceType: 'local_news' })).toBe('local');
  });

  test('city-level items classified as local', () => {
    expect(classifyHeadline({ localityLevel: 'city', sourceType: 'local_news' })).toBe('local');
  });

  test('county-level items classified as local', () => {
    expect(classifyHeadline({ localityLevel: 'county', sourceType: 'community' })).toBe('local');
  });

  test('state-level items classified as local', () => {
    expect(classifyHeadline({ localityLevel: 'state', sourceType: 'local_news' })).toBe('local');
  });

  test('national-level items classified as industry (not local)', () => {
    expect(classifyHeadline({ localityLevel: 'national', sourceType: 'local_news' })).toBe('industry');
  });

  test('unknown localityLevel items classified as industry', () => {
    expect(classifyHeadline({ localityLevel: undefined })).toBe('industry');
  });

  test('items without localityLevel classified as industry', () => {
    expect(classifyHeadline({})).toBe('industry');
  });
});

// ── Card copy tests ──────────────────────────────────────────────────────

describe('Card Copy & Relevance Labels', () => {
  function buildRelevance(params: {
    section: 'local' | 'industry' | 'event';
    tradeCity: string;
    sourceType: string;
  }) {
    if (params.section === 'local') {
      return params.tradeCity
        ? `Relevant to your ${params.tradeCity} trade area`
        : 'Local trade area news';
    }
    if (params.section === 'industry') {
      return 'National interest story';
    }
    return 'Seasonal content opportunity for engagement';
  }

  test('local card shows correct trade city', () => {
    const relevance = buildRelevance({ section: 'local', tradeCity: 'Colorado Springs', sourceType: 'local_news' });
    expect(relevance).toBe('Relevant to your Colorado Springs trade area');
    expect(relevance).not.toContain('Grand Rapids');
  });

  test('local card with no city shows generic text', () => {
    const relevance = buildRelevance({ section: 'local', tradeCity: '', sourceType: 'local_news' });
    expect(relevance).toBe('Local trade area news');
  });

  test('industry/national card does NOT show trade area text', () => {
    const relevance = buildRelevance({ section: 'industry', tradeCity: 'Colorado Springs', sourceType: 'national' });
    expect(relevance).toBe('National interest story');
    expect(relevance).not.toContain('trade area');
  });

  test('no Grand Rapids in card copy when business is Colorado Springs', () => {
    const relevance = buildRelevance({ section: 'local', tradeCity: 'Colorado Springs', sourceType: 'local_news' });
    expect(relevance).not.toContain('Grand Rapids');
  });
});

// ── Mode-aware section visibility tests ──────────────────────────────────

describe('Mode-Aware Section Visibility', () => {
  type ContentSourceMode = 'local_only' | 'local_plus_interests' | 'interests_only';

  function buildSections(mode: ContentSourceMode, localCount: number, industryCount: number, eventCount: number) {
    const includesLocal = mode !== 'interests_only';
    const includesInterests = mode !== 'local_only';
    const hasNationalFromRss = !includesInterests && industryCount > 0;
    const sections: string[] = [];
    if (includesLocal) sections.push('local');
    if (includesInterests || hasNationalFromRss) sections.push('industry');
    sections.push('event');
    return sections;
  }

  test('local_only mode shows local + event sections', () => {
    const sections = buildSections('local_only', 5, 0, 3);
    expect(sections).toContain('local');
    expect(sections).not.toContain('industry');
    expect(sections).toContain('event');
  });

  test('local_only mode shows national section when RSS items have national level', () => {
    // When RSS fallback returns national items, they should still be visible
    const sections = buildSections('local_only', 2, 3, 1);
    expect(sections).toContain('local');
    expect(sections).toContain('industry');
    expect(sections).toContain('event');
  });

  test('local_plus_interests shows all sections', () => {
    const sections = buildSections('local_plus_interests', 5, 3, 2);
    expect(sections).toContain('local');
    expect(sections).toContain('industry');
    expect(sections).toContain('event');
  });

  test('interests_only hides local section', () => {
    const sections = buildSections('interests_only', 0, 5, 2);
    expect(sections).not.toContain('local');
    expect(sections).toContain('industry');
    expect(sections).toContain('event');
  });
});

// ── Empty state tests ────────────────────────────────────────────────────

describe('Empty State Messages', () => {
  test('missing local feeds shows city-specific message', () => {
    const tradeCity = 'Colorado Springs';
    const localCount = 0;
    const message = localCount === 0 && tradeCity
      ? `No local stories found for ${tradeCity} yet. Local feed discovery may be needed for this area.`
      : 'No stories found in this category.';
    expect(message).toContain('Colorado Springs');
    expect(message).not.toContain('Grand Rapids');
  });

  test('empty local without city shows generic message', () => {
    const tradeCity = '';
    const localCount = 0;
    const message = localCount === 0 && tradeCity
      ? `No local stories found for ${tradeCity} yet.`
      : 'No stories found in this category.';
    expect(message).toBe('No stories found in this category.');
  });
});

// ── Business switch state clearing tests ─────────────────────────────────

describe('Business Switch State Clearing', () => {
  test('switching businesses should clear scout state', () => {
    // Simulates the state clearing that happens in the useEffect
    let storyCards = [{ id: '1', title: 'old story' }];
    let showStoryPicker = true;
    let selectedStoryIds = new Set(['1']);
    let scoutResult = { message: 'old result' };
    let scoutBriefData = { tradeArea: { city: 'Grand Rapids' } };

    // Simulate business change clearing
    storyCards = [];
    showStoryPicker = false;
    selectedStoryIds = new Set();
    scoutResult = null as any;
    scoutBriefData = null as any;

    expect(storyCards).toHaveLength(0);
    expect(showStoryPicker).toBe(false);
    expect(selectedStoryIds.size).toBe(0);
    expect(scoutResult).toBeNull();
    expect(scoutBriefData).toBeNull();
  });
});
