/**
 * Milestone 6 — sitemap-first Site Blueprint assembler.
 *
 * Produces the SAME platform-neutral `SiteBlueprint` shape as the production
 * assembler (lib/site-blueprint.ts), but sourced ENTIRELY from the approved
 * sitemap-first artifacts (WebsiteSitemap + WebsitePageCopy +
 * WebsiteGeneratedImageAsset), NOT from WebsiteProduction/WebsitePage records
 * and NOT from any concept HTML blob.
 *
 * Because it emits the identical shape, the existing renderer, asset
 * materializer and artifact-manifest builder are reused unchanged.
 *
 * READ-ONLY: no generation, no upload, no publish, no deploy. Never embeds a
 * signed URL or credential — generated images are referenced by durable R2
 * bucket+key and materialized into local /images/... paths downstream.
 */

import {
  ENV_KEYS,
  BLUEPRINT_VERSION,
  slugify,
  type SiteBlueprint,
  type BlueprintPage,
  type BlueprintSection,
  type BlueprintAssetRef,
  type BlueprintAssetManifestEntry,
  type BlueprintNavItem,
} from '@/lib/site-blueprint';
import type { SitemapPage, WebsiteSitemapArtifact } from '@/lib/website-sitemap';
import type { PageCopy, PageCopySection } from '@/lib/website-copy';
import {
  type ResolvedBuildInputs,
  type ResolvedImageAsset,
  sectionAssetKey,
} from '@/lib/site-builder/sitemap-build-inputs';

/** A durable image source used by the bucket-aware fetcher (never signed). */
export interface DurableAssetSource {
  assetId: string;
  bucket: string;
  key: string;
}

export interface SitemapBlueprintResult {
  blueprint: SiteBlueprint;
  /** assetId -> durable {bucket,key} for materialization (never a signed URL). */
  assetSources: DurableAssetSource[];
}

function extFromKeyOrMime(key: string | null, mime: string | null): string {
  const fromKey = (key || '').split('?')[0].match(/\.(jpe?g|png|webp|gif|svg|avif)$/i);
  if (fromKey) return `.${fromKey[1].toLowerCase()}`;
  if (mime) {
    const m = mime.split('/')[1];
    if (m) return `.${m.replace('jpeg', 'jpg')}`;
  }
  return '.png';
}

function assetTypeFor(img: ResolvedImageAsset): string {
  return img.assetRole === 'hero_image' ? 'hero' : 'section';
}

function intendedLocalPath(img: ResolvedImageAsset): string {
  return `public/images/${assetTypeFor(img)}-${img.id}${extFromKeyOrMime(img.r2Key, img.mimeType)}`;
}

function webPathFor(localPath: string): string {
  return localPath.replace(/^public/, '');
}

/** Map a copy section name to a renderer section type. */
function sectionTypeForName(name: string): string {
  const n = (name || '').toLowerCase();
  if (/contact|get in touch|reach us|quote|estimate/.test(n)) return 'contact';
  if (/hero/.test(n)) return 'hero';
  if (/faq/.test(n)) return 'faq';
  if (/about/.test(n)) return 'about';
  return 'content';
}

/**
 * Derive the in-page related links for a page. Prefers the copy artifact's
 * internalLinks; guarantees the two critical links: home -> services hub and
 * services hub -> each buildable service detail page.
 */
function deriveInternalLinks(
  page: SitemapPage,
  buildablePages: SitemapPage[],
  copy: PageCopy | null,
): BlueprintNavItem[] {
  const out = new Map<string, BlueprintNavItem>();
  const push = (path: string, label: string) => {
    if (!path || out.has(path) || path === page.slug) return;
    out.set(path, { path, label });
  };

  // 1) Copy-provided internal links (slug + label).
  for (const l of copy?.internalLinks || []) {
    if (l?.slug && l?.label) push(l.slug, l.label);
  }

  const hub = buildablePages.find((p) => p.pageType === 'service_hub');
  const serviceDetails = buildablePages.filter((p) => p.pageType === 'service_detail');

  // 2) Services hub -> every service detail page.
  if (page.pageType === 'service_hub') {
    for (const svc of serviceDetails) push(svc.slug, svc.title);
  }
  // 3) Home -> services hub.
  if (page.pageType === 'home' && hub) {
    push(hub.slug, hub.title);
  }
  return [...out.values()];
}

function buildAssetRef(img: ResolvedImageAsset): BlueprintAssetRef {
  const localPath = intendedLocalPath(img);
  return {
    id: img.id,
    src: webPathFor(localPath),
    assetType: assetTypeFor(img),
    alt: img.altText || undefined,
    width: img.width || undefined,
    height: img.height || undefined,
  };
}

function buildManifestEntry(img: ResolvedImageAsset): BlueprintAssetManifestEntry {
  return {
    assetId: img.id,
    assetType: assetTypeFor(img),
    // Durable bucket-relative R2 KEY only — never a signed URL.
    source: img.r2Key,
    sourceKind: 'r2_public',
    intendedLocalPath: intendedLocalPath(img),
    alt: img.altText || undefined,
    width: img.width || undefined,
    height: img.height || undefined,
    portability: 'needs_download',
    note: `Generated image — will be copied from R2 bucket "${img.r2Bucket}" into the static package.`,
  };
}

/**
 * Assemble a SiteBlueprint from resolved sitemap-first inputs. The caller is
 * responsible for having passed the static-build gate first.
 */
export function assembleSitemapBlueprint(
  inputs: ResolvedBuildInputs,
): SitemapBlueprintResult {
  const warnings: string[] = [];
  const sitemap = inputs.sitemap as WebsiteSitemapArtifact;
  if (!sitemap) throw new Error('Cannot assemble blueprint: no sitemap resolved.');
  if (!inputs.business) throw new Error('Cannot assemble blueprint: business not found.');

  const business = inputs.business;
  const bizName = business.businessName || sitemap.businessName || 'Your Business';

  const assetManifest: BlueprintAssetManifestEntry[] = [];
  const assetRefById = new Map<string, BlueprintAssetRef>();
  const assetSources: DurableAssetSource[] = [];
  const seenAsset = new Set<string>();

  const registerAsset = (img: ResolvedImageAsset): BlueprintAssetRef => {
    if (!seenAsset.has(img.id)) {
      seenAsset.add(img.id);
      assetManifest.push(buildManifestEntry(img));
      assetRefById.set(img.id, buildAssetRef(img));
      if (img.r2Bucket && img.r2Key) {
        assetSources.push({ assetId: img.id, bucket: img.r2Bucket, key: img.r2Key });
      }
    }
    return assetRefById.get(img.id)!;
  };

  // ── Pages ────────────────────────────────────────────────────────────────
  const pages: BlueprintPage[] = inputs.buildablePages.map((page, idx) => {
    const copyRow = inputs.copyBySlug.get(page.slug);
    const copy: PageCopy | null = copyRow?.copy || null;
    const sections: BlueprintSection[] = [];

    // Hero section (always first) with the page hero image if present.
    const hero = inputs.heroBySlug.get(page.slug);
    const heroRefs: BlueprintAssetRef[] = hero ? [registerAsset(hero)] : [];
    sections.push({
      id: `${page.slug}-hero`,
      sectionType: 'hero',
      heading: copy?.heroHeadline || page.h1,
      body: copy?.heroSubheadline || copy?.serviceAreaLine || undefined,
      ctaText: copy?.primaryCta || undefined,
      ctaTarget: '/contact',
      sortOrder: 0,
      assetRefs: heroRefs,
    });

    // Body sections from the copy artifact.
    const copySections: PageCopySection[] = copy?.sections || [];
    copySections.forEach((s, i) => {
      const sType = sectionTypeForName(s.name);
      const sectionImg = inputs.sectionAssetByKey.get(sectionAssetKey(page.slug, s.name));
      const refs = sectionImg ? [registerAsset(sectionImg)] : [];
      sections.push({
        id: `${page.slug}-s${i}`,
        sectionType: sType,
        heading: s.heading || undefined,
        body: s.body || undefined,
        sortOrder: i + 1,
        assetRefs: refs,
      });
    });

    // Guarantee a contact section so the lead form renders somewhere sensible.
    const hasContact = sections.some((s) => s.sectionType === 'contact');
    if (!hasContact && (page.pageType === 'home' || page.pageType === 'service_hub')) {
      sections.push({
        id: `${page.slug}-contact`,
        sectionType: 'contact',
        heading: copy?.primaryCta || 'Contact us',
        body: copy?.serviceAreaLine || undefined,
        ctaText: copy?.primaryCta || undefined,
        ctaTarget: '/contact',
        sortOrder: sections.length,
        assetRefs: [],
      });
    }

    if (!copy) warnings.push(`Page ${page.slug} has no copy artifact; rendered with sitemap data only.`);
    if (!hero) warnings.push(`Page ${page.slug} has no usable hero image.`);

    return {
      id: page.slug,
      pageType: page.pageType,
      title: page.title,
      slug: page.slug,
      path: page.slug,
      metaTitle: copy?.metaTitle || page.title,
      metaDescription: copy?.metaDescription || page.purpose || undefined,
      h1: page.h1,
      sortOrder: page.sortOrder ?? idx,
      sections,
      internalLinks: deriveInternalLinks(page, inputs.buildablePages, copy),
    };
  });

  // ── Navigation (top-level pages only) ─────────────────────────────────────
  const NAV_ORDER = ['home', 'service_hub', 'location', 'comparison', 'custom', 'other'];
  const topLevel = pages.filter(
    (p) => p.pageType !== 'home' && p.pageType !== 'service_detail',
  );
  const navigation: BlueprintNavItem[] = [{ label: 'Home', path: '/' }];
  topLevel
    .sort((a, b) => NAV_ORDER.indexOf(a.pageType) - NAV_ORDER.indexOf(b.pageType))
    .forEach((p) => navigation.push({ label: p.title || p.h1 || p.path, path: p.path }));

  // Footer: keep minimal (hub + home).
  const hubPage = pages.find((p) => p.pageType === 'service_hub');
  const footerNav: BlueprintNavItem[] = [{ label: 'Home', path: '/' }];
  if (hubPage) footerNav.push({ label: hubPage.title || 'Services', path: hubPage.path });

  // ── SEO ───────────────────────────────────────────────────────────────────
  const area = sitemap.primaryServiceArea || {};
  const schema = {
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    name: bizName,
    address: {
      '@type': 'PostalAddress',
      addressLocality: business.businessCity || area.city || undefined,
      addressRegion: business.businessState || area.state || undefined,
      postalCode: business.businessZip || undefined,
    },
    telephone: business.businessPhone || undefined,
  };

  const blueprint: SiteBlueprint = {
    blueprintVersion: BLUEPRINT_VERSION,
    generatedAt: new Date().toISOString(),
    // Source is the sitemap (no production record). Traceable ref.
    productionId: inputs.sitemapId || 'sitemap',
    websiteProjectId: inputs.websiteProjectId || '',
    business: {
      id: business.id,
      name: bizName,
      slug: slugify(bizName),
      city: business.businessCity || area.city || undefined,
      state: business.businessState || area.state || undefined,
      zip: business.businessZip || undefined,
      phone: business.businessPhone || undefined,
      email: business.defaultGhlUserEmail || undefined,
      serviceAreaMode: business.serviceAreaMode || sitemap.serviceAreaMode || undefined,
      primaryMarketCity: business.primaryMarketCity || area.city || undefined,
      primaryMarketState: business.primaryMarketState || area.state || undefined,
    },
    brand: {},
    pages,
    navigation,
    footer: { navigation: footerNav },
    assets: [...assetRefById.values()],
    assetManifest,
    forms: {
      provider: 'gohighlevel',
      formIdEnv: ENV_KEYS.GHL_FORM_ID,
      locationIdEnv: ENV_KEYS.GHL_LOCATION_ID,
      enabled: true,
    },
    tracking: { gaMeasurementIdEnv: ENV_KEYS.GA_MEASUREMENT_ID, enabled: true },
    seo: {
      siteUrlEnv: ENV_KEYS.SITE_URL,
      sitemap: { pages: pages.map((p) => p.path) },
      robotsTxt: 'User-agent: *\nAllow: /\n',
      schema,
    },
    deploymentPreferences: { deploymentTarget: 'hostgator_static', renderMode: 'static_export' },
    compliance: { forbiddenBrandTerms: business.forbiddenBrandTerms || [] },
    warnings,
  };

  return { blueprint, assetSources };
}
