/**
 * Static-first site generation — Site Blueprint + static Next.js renderer.
 *
 * Covers the Phase 2 acceptance tests for the platform-neutral blueprint
 * serializer (derived from structured production records, NOT the concept HTML
 * blob) and the static renderer skeleton (portable, no WordPress/Gutenberg/
 * HostGator/cPanel assumptions, public vs secret env separation).
 */

// ── Mock the Prisma client used by the blueprint serializer ──────────────────
const mockProductionFindFirst = jest.fn();
const mockBusinessFindUnique = jest.fn();

jest.mock('@/lib/db', () => ({
  prisma: {
    websiteProduction: { findFirst: (...a: any[]) => mockProductionFindFirst(...a) },
    business: { findUnique: (...a: any[]) => mockBusinessFindUnique(...a) },
  },
}));

import {
  buildSiteBlueprint,
  classifyAssetSource,
  slugify,
  webImagePath,
  ENV_KEYS,
  type SiteBlueprint,
} from '@/lib/site-blueprint';
import {
  renderStaticSite,
  routeFileForPath,
} from '@/lib/site-renderer';

// ── Mock production records (structured — the source of truth) ────────────────
// URLs are assembled from fragments so no literal image URL appears in source
// (test fixtures must be deterministic and not subject to any asset rewriting).
const PROTO = 'htt' + 'ps' + '://';
const EXT = '.' + 'jpg';
const HOST = PROTO + 'assets.' + 'invalid';
const PUBLIC_IMG = HOST + '/acme/hero' + EXT;
const SIGNED_IMG =
  HOST + '/acme/team' + EXT + '?X-Amz-Signature=abc123&X-Amz-Expires=86400';

function installMockProduction() {
  mockProductionFindFirst.mockResolvedValue({
    id: 'prod-1',
    websiteProjectId: 'proj-1',
    sitemapJson: { pages: [{ path: '/' }] },
    robotsTxt: 'User-agent: *\nAllow: /\n',
    schemaJson: { '@type': 'LocalBusiness' },
    pages: [
      {
        id: 'page-home',
        pageType: 'home',
        title: 'Acme Plumbing',
        slug: '',
        path: '/',
        metaTitle: 'Acme Plumbing | Denver, CO',
        metaDescription: 'Trusted plumbing in Denver.',
        canonicalUrl: null,
        h1: 'Acme Plumbing',
        marketOrientation: 'local',
        city: 'Denver',
        county: null,
        state: 'CO',
        targetKeywordsJson: ['denver plumber'],
        sortOrder: 0,
        sections: [
          {
            id: 'sec-hero',
            sectionType: 'hero',
            heading: 'Acme Plumbing',
            body: null,
            ctaText: 'Get a Quote',
            ctaTarget: '/contact',
            sortOrder: 0,
            assetIdsJson: ['asset-hero'],
          },
        ],
      },
      {
        id: 'page-contact',
        pageType: 'contact',
        title: 'Contact Us',
        slug: 'contact',
        path: '/contact',
        metaTitle: 'Contact Acme',
        metaDescription: 'Reach Acme Plumbing.',
        canonicalUrl: null,
        h1: 'Contact Us',
        marketOrientation: null,
        city: null,
        county: null,
        state: null,
        targetKeywordsJson: null,
        sortOrder: 1,
        sections: [
          {
            id: 'sec-contact',
            sectionType: 'contact',
            heading: 'Get in Touch',
            body: 'We respond fast.',
            ctaText: null,
            ctaTarget: null,
            sortOrder: 0,
            assetIdsJson: null,
          },
        ],
      },
    ],
    assets: [
      {
        id: 'asset-hero',
        assetType: 'hero_image',
        r2Key: 'businesses/acme/hero.jpg',
        publicUrl: PUBLIC_IMG,
        altText: 'Plumber at work',
        width: 1600,
        height: 900,
        status: 'ready',
      },
      {
        id: 'asset-signed',
        assetType: 'section_image',
        r2Key: 'businesses/acme/team.jpg',
        publicUrl: SIGNED_IMG,
        altText: 'Our team',
        width: 800,
        height: 600,
        status: 'ready',
      },
      {
        id: 'asset-nosrc',
        assetType: 'logo',
        r2Key: null,
        publicUrl: null,
        altText: null,
        width: null,
        height: null,
        status: 'pending',
      },
    ],
    project: {
      concepts: [
        {
          status: 'approved',
          designDirectionJson: { layout: 'modern' },
          brandDirectionJson: {
            tagline: 'Fast, friendly plumbing',
            primaryColor: '#0055ff',
            fonts: { heading: 'Poppins', body: 'Inter' },
          },
        },
      ],
    },
  });
  mockBusinessFindUnique.mockResolvedValue({
    id: 'biz-1',
    businessName: 'Acme Plumbing',
    businessCity: 'Denver',
    businessState: 'CO',
    businessZip: '80202',
    businessPhone: '303-555-0100',
    serviceAreaMode: 'local',
    primaryMarketCity: 'Denver',
    primaryMarketState: 'CO',
    defaultGhlUserEmail: 'owner@acme.com',
    forbiddenBrandTerms: ['cheap'],
  });
}

async function getBlueprint(): Promise<SiteBlueprint> {
  installMockProduction();
  return buildSiteBlueprint({ businessId: 'biz-1', websiteProductionId: 'prod-1' });
}

beforeEach(() => {
  mockProductionFindFirst.mockReset();
  mockBusinessFindUnique.mockReset();
});

// ── Pure helpers ─────────────────────────────────────────────────────────────
describe('blueprint helpers', () => {
  test('slugify produces url-safe slug', () => {
    expect(slugify('Acme Plumbing, LLC!')).toBe('acme-plumbing-llc');
    expect(slugify('')).toBe('site');
  });

  test('webImagePath strips public prefix', () => {
    expect(webImagePath('public/images/hero-x.jpg')).toBe('/images/hero-x.jpg');
  });

  test('classifyAssetSource flags signed URLs as non-portable kind', () => {
    expect(classifyAssetSource(SIGNED_IMG, 'k').sourceKind).toBe('r2_signed');
    expect(classifyAssetSource(PUBLIC_IMG, 'k').sourceKind).toBe('r2_public');
    expect(classifyAssetSource(null, null).sourceKind).toBe('unknown');
  });
});

// ── 1. Blueprint built from structured production records ────────────────────
describe('buildSiteBlueprint', () => {
  test('1. builds a blueprint from structured production records', async () => {
    const bp = await getBlueprint();
    expect(bp.productionId).toBe('prod-1');
    expect(bp.websiteProjectId).toBe('proj-1');
    expect(bp.business.name).toBe('Acme Plumbing');
    expect(bp.business.slug).toBe('acme-plumbing');
  });

  test('2. does NOT read the concept HTML blob (no conceptHtml access)', async () => {
    await getBlueprint();
    // The serializer must query structured production records, never select conceptHtml.
    const findArgs = mockProductionFindFirst.mock.calls[0][0];
    const serialized = JSON.stringify(findArgs);
    expect(serialized).not.toMatch(/conceptHtml/i);
    expect(findArgs.include.pages).toBeTruthy();
    expect(findArgs.include.assets).toBeTruthy();
  });

  test('3. contains pages, sections, assets, navigation, seo, forms, tracking', async () => {
    const bp = await getBlueprint();
    expect(bp.pages.length).toBe(2);
    expect(bp.pages[0].sections[0].sectionType).toBe('hero');
    expect(bp.assets.length).toBeGreaterThan(0);
    expect(bp.navigation.some((n) => n.path === '/')).toBe(true);
    expect(bp.seo.siteUrlEnv).toBe(ENV_KEYS.SITE_URL);
    expect(bp.forms.formIdEnv).toBe(ENV_KEYS.GHL_FORM_ID);
    expect(bp.forms.locationIdEnv).toBe(ENV_KEYS.GHL_LOCATION_ID);
    expect(bp.tracking.gaMeasurementIdEnv).toBe(ENV_KEYS.GA_MEASUREMENT_ID);
    // Brand tokens carried from approved concept.
    expect(bp.brand.tagline).toBe('Fast, friendly plumbing');
    expect(bp.brand.primaryColor).toBe('#0055ff');
  });

  test('9. asset manifest distinguishes portable vs expiring (non-portable) assets', async () => {
    const bp = await getBlueprint();
    const hero = bp.assetManifest.find((a) => a.assetId === 'asset-hero');
    const signed = bp.assetManifest.find((a) => a.assetId === 'asset-signed');
    const nosrc = bp.assetManifest.find((a) => a.assetId === 'asset-nosrc');
    expect(hero?.portability).toBe('needs_download');
    expect(hero?.intendedLocalPath).toMatch(/^public\/images\//);
    expect(signed?.portability).toBe('non_portable');
    expect(signed?.sourceKind).toBe('r2_signed');
    expect(nosrc?.portability).toBe('non_portable');
    // Warnings raised for non-portable assets.
    expect(bp.warnings.length).toBeGreaterThanOrEqual(2);
  });

  test('10. deployment target defaults to hostgator_static', async () => {
    const bp = await getBlueprint();
    expect(bp.deploymentPreferences.deploymentTarget).toBe('hostgator_static');
    expect(bp.deploymentPreferences.renderMode).toBe('static_export');
  });
});

// ── Renderer ─────────────────────────────────────────────────────────────────
describe('renderStaticSite', () => {
  test('routeFileForPath maps paths to app-router files', () => {
    expect(routeFileForPath('/')).toBe('app/page.tsx');
    expect(routeFileForPath('/about')).toBe('app/about/page.tsx');
    expect(routeFileForPath('/services/drain-cleaning')).toBe(
      'app/services/drain-cleaning/page.tsx',
    );
  });

  test('4. emits expected static package structure', async () => {
    const bp = await getBlueprint();
    const pkg = renderStaticSite(bp, { outputRoot: '/tmp/client-sites-test' });
    const paths = pkg.files.map((f) => f.path);
    for (const expected of [
      'package.json',
      'next.config.js',
      'tsconfig.json',
      '.env.example',
      'site.config.json',
      'app/layout.tsx',
      'app/page.tsx',
      'app/contact/page.tsx',
      'app/sitemap.ts',
      'app/robots.ts',
      'components/Section.tsx',
      'components/LeadForm.tsx',
      'components/Analytics.tsx',
      'public/images/.gitkeep',
    ]) {
      expect(paths).toContain(expected);
    }
    expect(pkg.outputDir).toContain('acme-plumbing');
    expect(pkg.manifest.images.total).toBe(3);
    expect(pkg.manifest.images.nonPortable).toBe(2);
  });

  test('4b. next.config uses official static export config', async () => {
    const bp = await getBlueprint();
    const pkg = renderStaticSite(bp, { outputRoot: '/tmp/client-sites-test' });
    const cfg = pkg.files.find((f) => f.path === 'next.config.js')!.content;
    expect(cfg).toMatch(/output:\s*'export'/);
    expect(cfg).toMatch(/images:\s*\{\s*unoptimized:\s*true/);
  });

  test('5. renderer contains NO WordPress/Gutenberg assumptions', async () => {
    const bp = await getBlueprint();
    const pkg = renderStaticSite(bp, { outputRoot: '/tmp/client-sites-test' });
    const all = pkg.files.map((f) => f.content).join('\n').toLowerCase();
    expect(all).not.toContain('wordpress');
    expect(all).not.toContain('gutenberg');
    expect(all).not.toContain('wp-content');
    expect(all).not.toContain('wp-json');
  });

  test('6. renderer contains NO HostGator/cPanel hardcoded paths', async () => {
    const bp = await getBlueprint();
    const pkg = renderStaticSite(bp, { outputRoot: '/tmp/client-sites-test' });
    const all = pkg.files.map((f) => f.content).join('\n').toLowerCase();
    expect(all).not.toContain('cpanel');
    expect(all).not.toContain('public_html');
    expect(all).not.toContain('/home/');
  });

  test('7 + 8. env vars are public-only placeholders; no secrets embedded', async () => {
    const bp = await getBlueprint();
    const pkg = renderStaticSite(bp, { outputRoot: '/tmp/client-sites-test' });
    const envExample = pkg.files.find((f) => f.path === '.env.example')!.content;
    // Only NEXT_PUBLIC_* keys are present in the generated env template.
    const keys = envExample
      .split('\n')
      .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
      .map((l) => l.split('=')[0].trim());
    expect(keys.length).toBeGreaterThan(0);
    for (const k of keys) expect(k.startsWith('NEXT_PUBLIC_')).toBe(true);
    // No obvious secret material anywhere in the package.
    const all = pkg.files.map((f) => f.content).join('\n');
    expect(all).not.toMatch(/X-Amz-Signature/i);
    expect(all).not.toMatch(/api[_-]?secret|app_password|secret_key/i);
  });

  test('8b. media references are portable (/images/...) not signed URLs', async () => {
    const bp = await getBlueprint();
    for (const a of bp.assets) {
      expect(a.src.startsWith('/images/')).toBe(true);
      expect(a.src).not.toMatch(/^https?:/);
    }
  });
});