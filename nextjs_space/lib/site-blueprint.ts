/**
 * Site Blueprint — platform-neutral intermediate representation of a generated
 * website, derived from the STRUCTURED production records
 * (WebsiteProduction / WebsitePage / WebsiteSection / WebsiteAsset) — NOT from
 * the single concept HTML blob.
 *
 * The blueprint is the single source of truth handed to a renderer (e.g. the
 * static Next.js renderer) and, later, to a deployment adapter. It is
 * deliberately free of any platform-specific assumptions (no WordPress, no
 * HostGator, no cPanel) and never embeds secrets — integrations such as
 * GoHighLevel forms and analytics are expressed as NEXT_PUBLIC_* env
 * placeholders that a build step resolves.
 *
 * This module is read-only: it queries Prisma records and returns a plain
 * serializable object. It performs NO publishing and NO deploy.
 */

import { prisma } from '@/lib/db';

// ── Env placeholder keys (resolved at build time, never inlined here) ──────
export const ENV_KEYS = {
  SITE_URL: 'NEXT_PUBLIC_SITE_URL',
  GA_MEASUREMENT_ID: 'NEXT_PUBLIC_GA_MEASUREMENT_ID',
  GHL_FORM_ID: 'NEXT_PUBLIC_GHL_FORM_ID',
  GHL_LOCATION_ID: 'NEXT_PUBLIC_GHL_LOCATION_ID',
} as const;

// ── Blueprint types ────────────────────────────────────────────────────────
export interface BlueprintBusiness {
  id: string;
  name: string;
  slug: string;
  city?: string;
  state?: string;
  zip?: string;
  phone?: string;
  email?: string;
  serviceAreaMode?: string;
  primaryMarketCity?: string;
  primaryMarketState?: string;
}

export interface BlueprintBrand {
  // Captured from the approved concept's creative direction when present.
  tagline?: string;
  primaryColor?: string;
  secondaryColor?: string;
  accentColor?: string;
  fontHeading?: string;
  fontBody?: string;
  // Raw direction JSON carried through for the renderer to interpret.
  designDirection?: unknown;
  brandDirection?: unknown;
}

export interface BlueprintAssetRef {
  id: string;
  /** Portable, build-local path the renderer should emit, e.g. public/images/hero-xxx.jpg */
  src: string;
  assetType: string;
  alt?: string;
  width?: number;
  height?: number;
}

export interface BlueprintSection {
  id: string;
  sectionType: string;
  heading?: string;
  body?: string;
  ctaText?: string;
  ctaTarget?: string;
  sortOrder: number;
  assetRefs: BlueprintAssetRef[];
}

export interface BlueprintPage {
  id: string;
  pageType: string;
  title?: string;
  slug?: string;
  path: string;
  metaTitle?: string;
  metaDescription?: string;
  canonicalUrl?: string;
  h1?: string;
  marketOrientation?: string;
  city?: string;
  county?: string;
  state?: string;
  targetKeywords?: string[];
  sortOrder: number;
  sections: BlueprintSection[];
  /** In-page related links (e.g. services hub -> each service page). */
  internalLinks?: BlueprintNavItem[];
}

export interface BlueprintNavItem {
  label: string;
  path: string;
}

export interface BlueprintAssetManifestEntry {
  /** WebsiteAsset.id */
  assetId: string;
  assetType: string;
  /** Original source URL/key as stored in the record. */
  source: string | null;
  sourceKind: 'r2_public' | 'r2_signed' | 'external' | 'unknown';
  /** Intended portable local path inside the static package. */
  intendedLocalPath: string;
  alt?: string;
  width?: number;
  height?: number;
  /** portable | needs_download | non_portable */
  portability: 'portable' | 'needs_download' | 'non_portable';
  /** Human-readable reason when not portable. */
  note?: string;
}

export interface BlueprintForms {
  provider: 'gohighlevel';
  // Resolved from env at build time — never inlined.
  formIdEnv: string;
  locationIdEnv: string;
  enabled: boolean;
}

export interface BlueprintTracking {
  gaMeasurementIdEnv: string;
  enabled: boolean;
}

export interface BlueprintSeo {
  siteUrlEnv: string;
  sitemap?: unknown;
  robotsTxt?: string;
  schema?: unknown;
}

export interface BlueprintDeploymentPreferences {
  /** Default deployment target type. */
  deploymentTarget: string;
  /** Static export is the default rendering mode. */
  renderMode: 'static_export';
}

export interface BlueprintCompliance {
  forbiddenBrandTerms: string[];
}

export interface SiteBlueprint {
  blueprintVersion: number;
  generatedAt: string;
  productionId: string;
  websiteProjectId: string;
  business: BlueprintBusiness;
  brand: BlueprintBrand;
  pages: BlueprintPage[];
  navigation: BlueprintNavItem[];
  footer: { navigation: BlueprintNavItem[] };
  assets: BlueprintAssetRef[];
  assetManifest: BlueprintAssetManifestEntry[];
  forms: BlueprintForms;
  tracking: BlueprintTracking;
  seo: BlueprintSeo;
  deploymentPreferences: BlueprintDeploymentPreferences;
  compliance: BlueprintCompliance;
  warnings: string[];
}

export const BLUEPRINT_VERSION = 1;

// ── Helpers ────────────────────────────────────────────────────────────────
export function slugify(input: string): string {
  return (
    (input || '')
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'site'
  );
}

/** Classify an asset source URL/key for portability decisions. */
export function classifyAssetSource(
  publicUrl: string | null | undefined,
  r2Key: string | null | undefined,
): { source: string | null; sourceKind: BlueprintAssetManifestEntry['sourceKind'] } {
  const source = publicUrl || r2Key || null;
  if (!source) return { source: null, sourceKind: 'unknown' };
  // A signed R2/S3 URL carries an expiring signature — NOT portable as-is.
  if (/[?&]X-Amz-(Signature|Credential|Expires)=/i.test(source)) {
    return { source, sourceKind: 'r2_signed' };
  }
  if (r2Key && !publicUrl) return { source, sourceKind: 'r2_public' };
  if (/^https?:\/\//i.test(source)) {
    // A stable public URL (no signature) is downloadable at build time.
    return { source, sourceKind: 'r2_public' };
  }
  return { source, sourceKind: 'external' };
}

/** Pick a file extension from a source URL, defaulting to .jpg. */
function extFromSource(source: string | null): string {
  if (!source) return '.jpg';
  const m = source.split('?')[0].match(/\.(jpe?g|png|webp|gif|svg|avif)$/i);
  return m ? `.${m[1].toLowerCase()}` : '.jpg';
}

function localImagePath(assetId: string, assetType: string, source: string | null): string {
  return `public/images/${assetType || 'asset'}-${assetId}${extFromSource(source)}`;
}

/** The path the renderer references in <img src> (web path, not file path). */
export function webImagePath(localPath: string): string {
  return localPath.replace(/^public/, '');
}

// ── Main serializer ──────────────────────────────────────────────────────
export async function buildSiteBlueprint(opts: {
  businessId: string;
  websiteProductionId: string;
}): Promise<SiteBlueprint> {
  const { businessId, websiteProductionId } = opts;
  const warnings: string[] = [];

  const production = await prisma.websiteProduction.findFirst({
    where: { id: websiteProductionId, businessId },
    include: {
      pages: {
        orderBy: { sortOrder: 'asc' },
        include: { sections: { orderBy: { sortOrder: 'asc' } } },
      },
      assets: true,
      project: { include: { concepts: true } },
    },
  });
  if (!production) {
    throw new Error(
      `WebsiteProduction ${websiteProductionId} not found for business ${businessId}`,
    );
  }

  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: {
      id: true,
      businessName: true,
      businessCity: true,
      businessState: true,
      businessZip: true,
      businessPhone: true,
      serviceAreaMode: true,
      primaryMarketCity: true,
      primaryMarketState: true,
      defaultGhlUserEmail: true,
      forbiddenBrandTerms: true,
    },
  });
  if (!business) throw new Error(`Business ${businessId} not found`);

  const bizName = business.businessName || 'Your Business';

  // Brand direction — pulled from the approved concept when available.
  const approvedConcept =
    production.project?.concepts?.find((c) => c.status === 'approved') ||
    production.project?.concepts?.[0];
  const brand: BlueprintBrand = {
    designDirection: approvedConcept?.designDirectionJson ?? undefined,
    brandDirection: approvedConcept?.brandDirectionJson ?? undefined,
  };
  const bd = (approvedConcept?.brandDirectionJson ?? {}) as Record<string, any>;
  if (bd && typeof bd === 'object') {
    brand.tagline = bd.tagline || bd.slogan || undefined;
    brand.primaryColor = bd.primaryColor || bd.colors?.primary || undefined;
    brand.secondaryColor = bd.secondaryColor || bd.colors?.secondary || undefined;
    brand.accentColor = bd.accentColor || bd.colors?.accent || undefined;
    brand.fontHeading = bd.fontHeading || bd.fonts?.heading || undefined;
    brand.fontBody = bd.fontBody || bd.fonts?.body || undefined;
  }

  // Index assets by id and by their linkage (section/page) for reference.
  const assetById = new Map<string, (typeof production.assets)[number]>();
  for (const a of production.assets) assetById.set(a.id, a);

  // Build the portable asset manifest.
  const assetManifest: BlueprintAssetManifestEntry[] = [];
  const assetRefById = new Map<string, BlueprintAssetRef>();
  for (const a of production.assets) {
    const { source, sourceKind } = classifyAssetSource(a.publicUrl, a.r2Key);
    const intendedLocalPath = localImagePath(a.id, a.assetType, source);
    let portability: BlueprintAssetManifestEntry['portability'];
    let note: string | undefined;
    if (!source) {
      portability = 'non_portable';
      note = 'Asset has no source URL or key; cannot be made portable.';
      warnings.push(`Asset ${a.id} (${a.assetType}) has no source and is non-portable.`);
    } else if (sourceKind === 'r2_signed') {
      portability = 'non_portable';
      note =
        'Source is a time-limited signed URL (expires ~24h); a stable/public URL is required to bundle this asset.';
      warnings.push(
        `Asset ${a.id} (${a.assetType}) uses an expiring signed URL and is non-portable until re-issued as a public URL.`,
      );
    } else {
      portability = 'needs_download';
      note = 'Will be downloaded and copied into the static package at build time.';
    }
    assetManifest.push({
      assetId: a.id,
      assetType: a.assetType,
      source,
      sourceKind,
      intendedLocalPath,
      alt: a.altText || undefined,
      width: a.width || undefined,
      height: a.height || undefined,
      portability,
      note,
    });
    assetRefById.set(a.id, {
      id: a.id,
      src: webImagePath(intendedLocalPath),
      assetType: a.assetType,
      alt: a.altText || undefined,
      width: a.width || undefined,
      height: a.height || undefined,
    });
  }

  // Build pages + sections.
  const pages: BlueprintPage[] = production.pages.map((p) => {
    const sections: BlueprintSection[] = p.sections.map((s) => {
      const assetIds = Array.isArray(s.assetIdsJson)
        ? (s.assetIdsJson as unknown[]).filter((x): x is string => typeof x === 'string')
        : [];
      const assetRefs = assetIds
        .map((id) => assetRefById.get(id))
        .filter((x): x is BlueprintAssetRef => Boolean(x));
      return {
        id: s.id,
        sectionType: s.sectionType,
        heading: s.heading || undefined,
        body: s.body || undefined,
        ctaText: s.ctaText || undefined,
        ctaTarget: s.ctaTarget || undefined,
        sortOrder: s.sortOrder,
        assetRefs,
      };
    });
    const targetKeywords = Array.isArray(p.targetKeywordsJson)
      ? (p.targetKeywordsJson as unknown[]).filter((x): x is string => typeof x === 'string')
      : undefined;
    return {
      id: p.id,
      pageType: p.pageType,
      title: p.title || undefined,
      slug: p.slug || undefined,
      path: p.path || '/',
      metaTitle: p.metaTitle || undefined,
      metaDescription: p.metaDescription || undefined,
      canonicalUrl: p.canonicalUrl || undefined,
      h1: p.h1 || undefined,
      marketOrientation: p.marketOrientation || undefined,
      city: p.city || undefined,
      county: p.county || undefined,
      state: p.state || undefined,
      targetKeywords,
      sortOrder: p.sortOrder,
      sections,
    };
  });

  // Navigation — primary pages only (home, services, about, contact, locations).
  const navOrder = ['home', 'service', 'city', 'county', 'about', 'contact'];
  const navigation: BlueprintNavItem[] = pages
    .filter((p) => p.pageType !== 'home')
    .sort((a, b) => navOrder.indexOf(a.pageType) - navOrder.indexOf(b.pageType))
    .map((p) => ({ label: p.title || p.h1 || p.path, path: p.path }));
  navigation.unshift({ label: 'Home', path: '/' });

  const footerNav: BlueprintNavItem[] = pages
    .filter((p) => ['about', 'contact'].includes(p.pageType))
    .map((p) => ({ label: p.title || p.path, path: p.path }));

  if (pages.length === 0) warnings.push('Production has no pages.');

  return {
    blueprintVersion: BLUEPRINT_VERSION,
    generatedAt: new Date().toISOString(),
    productionId: production.id,
    websiteProjectId: production.websiteProjectId,
    business: {
      id: business.id,
      name: bizName,
      slug: slugify(bizName),
      city: business.businessCity || undefined,
      state: business.businessState || undefined,
      zip: business.businessZip || undefined,
      phone: business.businessPhone || undefined,
      email: business.defaultGhlUserEmail || undefined,
      serviceAreaMode: business.serviceAreaMode || undefined,
      primaryMarketCity: business.primaryMarketCity || undefined,
      primaryMarketState: business.primaryMarketState || undefined,
    },
    brand,
    pages,
    navigation,
    footer: { navigation: footerNav },
    assets: Array.from(assetRefById.values()),
    assetManifest,
    forms: {
      provider: 'gohighlevel',
      formIdEnv: ENV_KEYS.GHL_FORM_ID,
      locationIdEnv: ENV_KEYS.GHL_LOCATION_ID,
      enabled: true,
    },
    tracking: {
      gaMeasurementIdEnv: ENV_KEYS.GA_MEASUREMENT_ID,
      enabled: true,
    },
    seo: {
      siteUrlEnv: ENV_KEYS.SITE_URL,
      sitemap: production.sitemapJson ?? undefined,
      robotsTxt: production.robotsTxt || undefined,
      schema: production.schemaJson ?? undefined,
    },
    deploymentPreferences: {
      deploymentTarget: 'hostgator_static',
      renderMode: 'static_export',
    },
    compliance: {
      forbiddenBrandTerms: business.forbiddenBrandTerms || [],
    },
    warnings,
  };
}
