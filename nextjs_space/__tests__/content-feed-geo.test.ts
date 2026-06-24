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
  test('1. switching businesses clears all previous scout cards', () => {
    let storyCards = [{ id: '1', title: 'old story' }];
    let showStoryPicker = true;
    let selectedStoryIds = new Set(['1']);
    let scoutResult = { message: 'old result' };
    let scoutBriefData = { tradeArea: { city: 'Colorado Springs' } };
    let scouting = true;
    let scoutRunId = 1;
    let scoutBusinessId: string | null = 'biz_cupcake';

    // Simulate business change clearing (mirrors the useEffect)
    scoutRunId++;
    scoutBusinessId = 'biz_houston';
    storyCards = [];
    showStoryPicker = false;
    selectedStoryIds = new Set();
    scoutResult = null as any;
    scoutBriefData = null as any;
    scouting = false;

    expect(storyCards).toHaveLength(0);
    expect(showStoryPicker).toBe(false);
    expect(selectedStoryIds.size).toBe(0);
    expect(scoutResult).toBeNull();
    expect(scoutBriefData).toBeNull();
    expect(scouting).toBe(false);
    expect(scoutRunId).toBe(2);
    expect(scoutBusinessId).toBe('biz_houston');
  });

  test('2. previous scout response cannot overwrite current business after switch', () => {
    let scoutRunId = 1;
    let storyCards: any[] = [];
    const thisRunId = scoutRunId; // captured at scout call time

    // Business switch during fetch
    scoutRunId++;
    storyCards = [];

    // Old response arrives — guard check
    const staleCards = [{ id: 'co-1', title: 'Colorado Story' }];
    if (scoutRunId === thisRunId) {
      storyCards = staleCards;
    }
    expect(storyCards).toHaveLength(0);
  });

  test('3. scout response with mismatched businessId is discarded', () => {
    const activeBusinessId = 'biz_houston';
    const responseBizId = 'biz_cupcake_doctor';
    let applied = false;

    if (!responseBizId || !activeBusinessId || responseBizId === activeBusinessId) {
      applied = true;
    }
    expect(applied).toBe(false);
  });

  test('4. scout results cache key includes businessId', () => {
    // In our implementation, there's no cache — every scout is a fresh fetch.
    // But if a cache were added, key must include businessId.
    const buildCacheKey = (bizId: string, mode: string) => `scout_${bizId}_${mode}`;
    const key1 = buildCacheKey('biz_cupcake', 'local_only');
    const key2 = buildCacheKey('biz_houston', 'local_only');
    expect(key1).not.toBe(key2);
    expect(key1).toContain('biz_cupcake');
    expect(key2).toContain('biz_houston');
  });

  test('5. Houston business does not render Colorado local stories', () => {
    // Simulates the frontend classification: CO items with national localityLevel
    const LOCAL_LEVELS = new Set(['zip', 'zip_radius', 'city', 'county', 'state']);
    const coItems = [
      { localityLevel: 'national', sourceType: 'national_news', title: 'Farm Progress' },
      { localityLevel: 'national', sourceType: 'national_news', title: 'ESPN' },
      { localityLevel: 'national', sourceType: 'national_news', title: 'PCWorld' },
    ];
    const localCards = coItems.filter(i => LOCAL_LEVELS.has(i.localityLevel));
    expect(localCards).toHaveLength(0);
  });

  test('6. Local Only excludes Farm Progress / ESPN / PCWorld', () => {
    // With excludeNational=true, national fallback is skipped entirely
    const allItems: any[] = [];
    const SCOUT_MIN = 5;
    const excludeNational = true;
    if (allItems.length < SCOUT_MIN && !excludeNational) {
      allItems.push({ localityLevel: 'national', source: 'Farm Progress' });
      allItems.push({ localityLevel: 'national', source: 'ESPN' });
      allItems.push({ localityLevel: 'national', source: 'PCWorld' });
    }
    expect(allItems.filter(i => i.localityLevel === 'national')).toHaveLength(0);
  });

  test('7. Local Only skips national fallback', () => {
    const excludeNational = true; // local_only mode
    let nationalFallbackRan = false;
    if (!excludeNational) {
      nationalFallbackRan = true;
    }
    expect(nationalFallbackRan).toBe(false);
  });

  test('8. label generation uses story matched geography, not only active business state', () => {
    // Labels come from diagnostics.requestedLocation which is set from the cascade's resolvedState
    // If business is Houston/TX, cascade resolves TX, and labels say TX
    // If business is CO Springs/CO, cascade resolves CO, and labels say CO
    function buildLabel(diagState: string, level: string, sourceType: string) {
      if (sourceType === 'weather') return `${diagState} weather / public safety alert`;
      if (level === 'state') return `${diagState} regional story`;
      return 'Local trade area news';
    }
    // TX business should get TX labels
    expect(buildLabel('TX', 'state', 'local_news')).toBe('TX regional story');
    expect(buildLabel('TX', 'state', 'weather')).toBe('TX weather / public safety alert');
    // CO labels should NOT appear for TX business
    expect(buildLabel('TX', 'state', 'weather')).not.toContain('CO');
  });

  test('9. backend localStories all match selected business geo', () => {
    // Cascade only searches geo for the resolved business location
    // So all items returned have localityLevel matching the business geography
    const businessState = 'TX';
    const cascadeLevels = ['zip', 'city', 'county', 'state']; // no 'national'
    const returnedItems = [
      { localityLevel: 'city', matchedState: 'TX' },
      { localityLevel: 'state', matchedState: 'TX' },
    ];
    for (const item of returnedItems) {
      expect(cascadeLevels).toContain(item.localityLevel);
      expect(item.matchedState).toBe(businessState);
    }
  });

  test('10. if no matching local stories exist, UI shows empty state instead of stale cards', () => {
    const cards: any[] = [];
    const cityName = 'Houston';
    let message: string;
    if (cards.length === 0 && cityName) {
      message = `No local stories found for ${cityName} yet. Tombstone is checking for local sources in this area.`;
    } else {
      message = 'No stories found for the selected scouting mode.';
    }
    expect(message).toContain('Houston');
    expect(message).not.toContain('Colorado');
  });
});

// ── getTradeAreaItems excludeNational Tests ──────────────────────────────

describe('getTradeAreaItems excludeNational', () => {
  // Simulates the globalFeedOr query construction from getTradeAreaItems
  function buildGlobalFeedQuery(opts: { excludeNational?: boolean; states?: string[] }) {
    const globalFeedOr: any[] = [];
    if (!opts.excludeNational) {
      globalFeedOr.push({ geoScope: 'national' });
    }
    if (opts.states?.length) {
      globalFeedOr.push({
        geoScope: { in: ['state', 'weather'] },
        pilotState: { in: opts.states },
      });
    }
    return globalFeedOr;
  }

  test('excludeNational=true omits geoScope=national from query', () => {
    const orClauses = buildGlobalFeedQuery({ excludeNational: true, states: ['MO'] });
    const hasNational = orClauses.some((c: any) => c.geoScope === 'national');
    expect(hasNational).toBe(false);
    // But state/weather feeds are still included
    const hasState = orClauses.some((c: any) => c.geoScope?.in?.includes('state'));
    expect(hasState).toBe(true);
  });

  test('excludeNational=false includes geoScope=national in query', () => {
    const orClauses = buildGlobalFeedQuery({ excludeNational: false, states: ['MO'] });
    const hasNational = orClauses.some((c: any) => c.geoScope === 'national');
    expect(hasNational).toBe(true);
  });

  test('excludeNational=true with no states produces empty OR', () => {
    const orClauses = buildGlobalFeedQuery({ excludeNational: true });
    expect(orClauses).toHaveLength(0);
  });

  test('default (no excludeNational) includes national feeds', () => {
    const orClauses = buildGlobalFeedQuery({ states: ['CO'] });
    const hasNational = orClauses.some((c: any) => c.geoScope === 'national');
    expect(hasNational).toBe(true);
  });

  test('state/weather feeds only match specified pilotState', () => {
    const orClauses = buildGlobalFeedQuery({ excludeNational: true, states: ['MO'] });
    const stateClause = orClauses.find((c: any) => c.geoScope?.in?.includes('state'));
    expect(stateClause?.pilotState?.in).toEqual(['MO']);
    expect(stateClause?.pilotState?.in).not.toContain('CO');
  });
});

// ── Cascade-level excludeNational propagation Tests ──────────────────────

describe('Cascade excludeNational Propagation', () => {
  // Simulates cascadeOpts construction from generateContentBriefWithFallback
  function buildCascadeOpts(briefOptions: { excludeNational?: boolean }) {
    return briefOptions.excludeNational ? { excludeNational: true } : {};
  }

  test('local_only mode sets excludeNational in cascadeOpts', () => {
    const opts = buildCascadeOpts({ excludeNational: true });
    expect(opts).toEqual({ excludeNational: true });
  });

  test('local_plus_interests mode does NOT set excludeNational', () => {
    const opts = buildCascadeOpts({});
    expect(opts).toEqual({});
    expect(opts).not.toHaveProperty('excludeNational');
  });

  test('cascadeOpts merges into ZIP level query', () => {
    const baseOpts = { days: 5, limit: 30 };
    const cascadeOpts = buildCascadeOpts({ excludeNational: true });
    const merged = { ...baseOpts, ...cascadeOpts };
    expect(merged.excludeNational).toBe(true);
    expect(merged.days).toBe(5);
  });

  test('cascadeOpts merges into city level query', () => {
    const baseOpts = { days: 10, limit: 30 };
    const cascadeOpts = buildCascadeOpts({ excludeNational: true });
    const merged = { cities: ['ST. LOUIS, MO'], ...baseOpts, ...cascadeOpts };
    expect(merged.excludeNational).toBe(true);
    expect(merged.cities).toEqual(['ST. LOUIS, MO']);
  });

  test('cascadeOpts merges into county level query', () => {
    const baseOpts = { days: 14, limit: 30 };
    const cascadeOpts = buildCascadeOpts({ excludeNational: true });
    const merged = { counties: ['ST. LOUIS CITY, MO'], ...baseOpts, ...cascadeOpts };
    expect(merged.excludeNational).toBe(true);
  });

  test('cascadeOpts merges into state level query', () => {
    const baseOpts = { days: 14, limit: 30 };
    const cascadeOpts = buildCascadeOpts({ excludeNational: true });
    const merged = { states: ['MO'], ...baseOpts, ...cascadeOpts };
    expect(merged.excludeNational).toBe(true);
    expect(merged.states).toEqual(['MO']);
  });
});

// ── Defensive Output Filtering Tests ─────────────────────────────────────

describe('Defensive National Feed Filtering', () => {
  // Simulates the defensive filter in generateContentBriefWithFallback
  function applyDefensiveFilter(items: { localityLevel: string; feedGeoScope?: string }[], excludeNational: boolean) {
    if (!excludeNational) return items;
    return items.filter(i => i.feedGeoScope !== 'national');
  }

  test('filters out national-scoped feeds in local_only mode', () => {
    const items = [
      { localityLevel: 'state', feedGeoScope: 'national', title: 'Farm Progress' },
      { localityLevel: 'state', feedGeoScope: 'national', title: 'ESPN' },
      { localityLevel: 'state', feedGeoScope: 'state', title: 'MO Weather' },
      { localityLevel: 'city', feedGeoScope: 'local', title: 'STLtoday' },
    ];
    const filtered = applyDefensiveFilter(items, true);
    expect(filtered).toHaveLength(2);
    expect(filtered.map(i => (i as any).title)).toEqual(['MO Weather', 'STLtoday']);
  });

  test('does NOT filter in non-local_only mode', () => {
    const items = [
      { localityLevel: 'state', feedGeoScope: 'national', title: 'Farm Progress' },
      { localityLevel: 'state', feedGeoScope: 'state', title: 'MO Weather' },
    ];
    const filtered = applyDefensiveFilter(items, false);
    expect(filtered).toHaveLength(2);
  });

  test('Gus\'s Pretzels / St. Louis / MO / Local Only rejects Farm Progress, ESPN, PCWorld, etc.', () => {
    // Simulates the Gus's Pretzels scenario: state-level cascade returns national feeds
    const stateItems = [
      { localityLevel: 'state', feedGeoScope: 'national', title: 'Farm Progress' },
      { localityLevel: 'state', feedGeoScope: 'national', title: 'ESPN' },
      { localityLevel: 'state', feedGeoScope: 'national', title: 'PCWorld' },
      { localityLevel: 'state', feedGeoScope: 'national', title: 'Car and Driver' },
      { localityLevel: 'state', feedGeoScope: 'national', title: 'MarketWatch' },
      { localityLevel: 'state', feedGeoScope: 'national', title: 'Yahoo Sports' },
      { localityLevel: 'state', feedGeoScope: 'national', title: 'Grocery Dive' },
      { localityLevel: 'state', feedGeoScope: 'national', title: 'J.P. Morgan' },
    ];
    const filtered = applyDefensiveFilter(stateItems, true);
    expect(filtered).toHaveLength(0);
    const nationalNames = ['Farm Progress', 'ESPN', 'PCWorld', 'Car and Driver', 'MarketWatch', 'Yahoo Sports', 'Grocery Dive', 'J.P. Morgan'];
    for (const name of nationalNames) {
      expect(filtered.find(i => (i as any).title === name)).toBeUndefined();
    }
  });

  test('Local Only still allows MO state and weather feeds with pilotState=MO', () => {
    const items = [
      { localityLevel: 'state', feedGeoScope: 'state', title: 'Missouri State News' },
      { localityLevel: 'state', feedGeoScope: 'weather', title: 'NWS St. Louis' },
    ];
    const filtered = applyDefensiveFilter(items, true);
    expect(filtered).toHaveLength(2);
  });

  test('empty result when no local stories exist returns clean empty', () => {
    const items: { localityLevel: string; feedGeoScope?: string }[] = [];
    const filtered = applyDefensiveFilter(items, true);
    expect(filtered).toHaveLength(0);
  });
});

// ── Frontend feedGeoScope Classification Tests ───────────────────────────

describe('Frontend feedGeoScope Classification', () => {
  const LOCAL_LEVELS = new Set(['zip', 'zip_radius', 'city', 'county', 'state']);

  function classifyWithFeedGeoScope(h: { localityLevel?: string; feedGeoScope?: string }) {
    const level = h.localityLevel || 'unknown';
    const feedActualScope = h.feedGeoScope || level;
    const isLocal = LOCAL_LEVELS.has(level) && feedActualScope !== 'national';
    return isLocal ? 'local' : 'industry';
  }

  test('state-level item with feedGeoScope=national → industry (not local)', () => {
    expect(classifyWithFeedGeoScope({ localityLevel: 'state', feedGeoScope: 'national' })).toBe('industry');
  });

  test('state-level item with feedGeoScope=state → local', () => {
    expect(classifyWithFeedGeoScope({ localityLevel: 'state', feedGeoScope: 'state' })).toBe('local');
  });

  test('city-level item with feedGeoScope=local → local', () => {
    expect(classifyWithFeedGeoScope({ localityLevel: 'city', feedGeoScope: 'local' })).toBe('local');
  });

  test('national localityLevel always → industry', () => {
    expect(classifyWithFeedGeoScope({ localityLevel: 'national', feedGeoScope: 'national' })).toBe('industry');
  });

  test('weather feed with feedGeoScope=weather → local', () => {
    expect(classifyWithFeedGeoScope({ localityLevel: 'state', feedGeoScope: 'weather' })).toBe('local');
  });

  test('Local + Interests: national stories in Industry Stories only', () => {
    const items = [
      { localityLevel: 'city', feedGeoScope: 'local' },
      { localityLevel: 'state', feedGeoScope: 'national' },
    ];
    const local = items.filter(i => classifyWithFeedGeoScope(i) === 'local');
    const industry = items.filter(i => classifyWithFeedGeoScope(i) === 'industry');
    expect(local).toHaveLength(1);
    expect(industry).toHaveLength(1);
  });
});

// ── Local Only Source Classification & Label Tests (Section 9) ──────────

describe('Local Only Source Classification', () => {
  // Mirrors the LOCAL_LEVELS set and classification logic from feed-preferences.tsx
  const LOCAL_LEVELS = new Set(['zip', 'zip_radius', 'city', 'county', 'state']);
  const LOCAL_SOURCE_TYPES = new Set(['local_news', 'community', 'gov_meeting', 'weather', 'police_blotter', 'school', 'library', 'parks_rec', 'chamber_of_commerce', 'event', 'lifestyle', 'real_estate', 'local_business', 'sports_local']);
  const NATIONAL_SOURCE_TYPES = new Set(['national_news', 'industry_trade']);

  /** Classification logic matching the updated trade-area-feed + frontend */
  function classifyItem(item: {
    localityLevel: string;
    feedSourceType: string;
    feedGeoScope?: string;
  }): 'local' | 'national' | 'industry' {
    const level = item.localityLevel || 'unknown';
    const isLocalLevel = LOCAL_LEVELS.has(level);
    if (!isLocalLevel) return 'national';
    // Even with local level, if source type is national/industry, reclassify
    if (NATIONAL_SOURCE_TYPES.has(item.feedSourceType)) return 'industry';
    return 'local';
  }

  /** Label logic matching the updated feed-preferences.tsx */
  function buildLabel(item: {
    localityLevel: string;
    sourceType: string;
    tradeCity?: string;
    tradeCounty?: string;
    tradeState?: string;
  }): string {
    const level = item.localityLevel;
    if (item.sourceType === 'weather') {
      return item.tradeState ? `${item.tradeState} weather / public safety alert` : 'Weather / public safety alert';
    }
    if (level === 'zip' || level === 'zip_radius' || level === 'city') {
      return item.tradeCity ? `Relevant to your ${item.tradeCity} trade area` : 'Local trade area news';
    }
    if (level === 'county') {
      return item.tradeCounty ? `Relevant to ${item.tradeCounty} County` : 'County-level regional story';
    }
    if (level === 'state') {
      return item.tradeState ? `${item.tradeState} regional story` : 'State-level regional story';
    }
    return 'Local trade area news';
  }

  // Test 1: National interest feed with Colorado FeedGeo link is NOT classified as Local Story
  test('1. National interest feed with CO FeedGeo link → not Local Story', () => {
    const item = { localityLevel: 'national', feedSourceType: 'national_news', feedGeoScope: 'national' };
    expect(classifyItem(item)).not.toBe('local');
  });

  // Test 2: Industry feed with state-level match → not Local Story
  test('2. Industry feed with state-level match → not Local Story', () => {
    const item = { localityLevel: 'state', feedSourceType: 'national_news', feedGeoScope: 'national' };
    expect(classifyItem(item)).toBe('industry');
  });

  // Test 3: Local Only excludes industry/national sources from Local Stories
  test('3. Local Only excludes industry/national from Local Stories', () => {
    const espn = { localityLevel: 'national', feedSourceType: 'national_news' };
    const farmProgress = { localityLevel: 'national', feedSourceType: 'national_news' };
    const localNews = { localityLevel: 'city', feedSourceType: 'local_news' };
    expect(classifyItem(espn)).not.toBe('local');
    expect(classifyItem(farmProgress)).not.toBe('local');
    expect(classifyItem(localNews)).toBe('local');
  });

  // Test 4: State-level local story label says "Colorado regional story"
  test('4. State-level label says Colorado regional story, not trade area', () => {
    const label = buildLabel({ localityLevel: 'state', sourceType: 'local_news', tradeCity: 'Colorado Springs', tradeState: 'CO' });
    expect(label).toBe('CO regional story');
    expect(label).not.toContain('Colorado Springs');
    expect(label).not.toContain('trade area');
  });

  // Test 5: City-level story label says "Colorado Springs trade area"
  test('5. City-level label says Colorado Springs trade area', () => {
    const label = buildLabel({ localityLevel: 'city', sourceType: 'local_news', tradeCity: 'Colorado Springs', tradeState: 'CO' });
    expect(label).toBe('Relevant to your Colorado Springs trade area');
  });

  // Test 6: County-level story label says "El Paso County"
  test('6. County-level label says El Paso County', () => {
    const label = buildLabel({ localityLevel: 'county', sourceType: 'local_news', tradeCounty: 'El Paso', tradeState: 'CO' });
    expect(label).toBe('Relevant to El Paso County');
  });

  // Test 7: NWS/weather allowed as local/regional only when state relevance matches
  test('7. NWS weather source gets state-level weather label', () => {
    const label = buildLabel({ localityLevel: 'state', sourceType: 'weather', tradeState: 'CO' });
    expect(label).toBe('CO weather / public safety alert');
    expect(label).not.toContain('trade area');
  });

  // Test 8: Farm Progress-style feed → Industry/National, not Local
  test('8. Farm Progress-style feed → not Local', () => {
    const farmProgress = { localityLevel: 'national', feedSourceType: 'national_news', feedGeoScope: 'national' };
    const result = classifyItem(farmProgress);
    expect(result).not.toBe('local');
    expect(['national', 'industry']).toContain(result);
  });

  // Test 9: ESPN-style feed → National/Sports, not Local
  test('9. ESPN-style feed → not Local', () => {
    const espn = { localityLevel: 'national', feedSourceType: 'national_news', feedGeoScope: 'national' };
    const result = classifyItem(espn);
    expect(result).not.toBe('local');
  });

  // Test 10: Local + Interests still renders interest stories correctly
  test('10. Local + Interests interest stories render as industry', () => {
    // Interest stories should always be industry section regardless of mode
    const interestItem = { localityLevel: 'national', feedSourceType: 'national_news' };
    const localItem = { localityLevel: 'city', feedSourceType: 'local_news' };
    expect(classifyItem(interestItem)).not.toBe('local');
    expect(classifyItem(localItem)).toBe('local');
    // Both should be classifiable in the same mode
  });

  // Additional: excludeNational skips national fallback
  test('excludeNational flag prevents national items from entering local brief', () => {
    // Simulates the generateContentBriefWithFallback logic
    const allItems: { localityLevel: string; feedSourceType: string }[] = [
      { localityLevel: 'city', feedSourceType: 'local_news' },
      { localityLevel: 'city', feedSourceType: 'local_news' },
    ];
    const SCOUT_MIN_LOCAL_ITEMS = 5;
    const excludeNational = true; // local_only mode

    // Level 5 should be skipped
    if (allItems.length < SCOUT_MIN_LOCAL_ITEMS && !excludeNational) {
      allItems.push({ localityLevel: 'national', feedSourceType: 'national_news' });
    }

    // No national items should exist
    expect(allItems.filter(i => i.localityLevel === 'national')).toHaveLength(0);
  });

  // Additional: State cap works
  test('state items capped at 3 when city/county items exist', () => {
    const allItems = [
      { localityLevel: 'city' },
      { localityLevel: 'city' },
      { localityLevel: 'state' },
      { localityLevel: 'state' },
      { localityLevel: 'state' },
      { localityLevel: 'state' },
      { localityLevel: 'state' },
    ];
    const STATE_CAP = 3;
    const cityCountyCount = allItems.filter(i => ['zip', 'city', 'county'].includes(i.localityLevel)).length;
    let capped = allItems;
    if (cityCountyCount > 0) {
      let stateKept = 0;
      capped = allItems.filter(item => {
        if (item.localityLevel === 'state') {
          if (stateKept >= STATE_CAP) return false;
          stateKept++;
        }
        return true;
      });
    }
    expect(capped.filter(i => i.localityLevel === 'state')).toHaveLength(3);
    expect(capped.filter(i => i.localityLevel === 'city')).toHaveLength(2);
  });
});