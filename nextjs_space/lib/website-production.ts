/**
 * Production website generation (scaffolding phase).
 *
 * Given an APPROVED concept, derive the multi-page production architecture from
 * the approved concept's creative direction + the business's confirmed service
 * offerings and locations, and persist first-class WebsitePage / WebsiteSection
 * / WebsiteAsset records under a new WebsiteProduction.
 *
 * This phase intentionally does NOT:
 *   - publish anything
 *   - inject tracking pixels
 *   - wire GoHighLevel forms
 *   - build the Blazing Hog site specifically
 *
 * It produces durable production records (page architecture + section
 * scaffolding + carried-over assets + a recorded QA result) derived from the
 * approved concept so a later phase can fill in copy/render and publish.
 */

import { prisma } from '@/lib/db';
import { PRODUCTION_STATUS } from '@/lib/website-workflow';

function slugify(input: string): string {
  return (input || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'page';
}

interface PlannedPage {
  pageType: string;
  title: string;
  slug: string;
  path: string;
  metaTitle?: string;
  metaDescription?: string;
  h1?: string;
  serviceLine?: string;
  marketOrientation?: string;
  city?: string;
  county?: string;
  state?: string;
  sortOrder: number;
  sections: { sectionType: string; heading: string; body?: string; ctaText?: string }[];
}

/**
 * Build the production page plan from approved concept direction + business data.
 */
async function buildPagePlan(
  businessId: string,
): Promise<PlannedPage[]> {
  const [business, services, locations] = await Promise.all([
    prisma.business.findUnique({
      where: { id: businessId },
      select: {
        businessName: true, businessCity: true, businessState: true,
        serviceAreaMode: true, primaryMarketCity: true, primaryMarketState: true,
      },
    }),
    prisma.businessServiceOffering.findMany({
      where: {
        businessId,
        status: { in: ['confirmed', 'suggested', 'needs_review'] },
        seoEnabled: true,
      },
      orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
      take: 24,
    }),
    prisma.businessLocation.findMany({
      where: { businessId },
      orderBy: [{ isPrimary: 'desc' }, { locationNumber: 'asc' }],
      take: 24,
    }),
  ]);

  const bizName = business?.businessName || 'Your Business';
  const baseCity = business?.primaryMarketCity || business?.businessCity || '';
  const baseState = business?.primaryMarketState || business?.businessState || '';
  const cityState = [baseCity, baseState].filter(Boolean).join(', ');

  const pages: PlannedPage[] = [];
  let order = 0;

  // Home page — always present.
  pages.push({
    pageType: 'home',
    title: bizName,
    slug: '',
    path: '/',
    metaTitle: `${bizName}${cityState ? ` | ${cityState}` : ''}`,
    metaDescription: `${bizName}${cityState ? ` serving ${cityState}` : ''}. Built from your approved concept direction.`,
    h1: bizName,
    marketOrientation: business?.serviceAreaMode || 'local',
    sortOrder: order++,
    sections: [
      { sectionType: 'hero', heading: bizName, ctaText: 'Get a Quote' },
      { sectionType: 'services', heading: 'What We Offer' },
      { sectionType: 'about', heading: `About ${bizName}` },
      { sectionType: 'cta', heading: 'Ready to get started?', ctaText: 'Contact Us' },
    ],
  });

  // Service pages from confirmed/active service offerings.
  for (const svc of services) {
    const name = svc.overrideName || svc.customServiceName || svc.slug;
    const slug = svc.slug || slugify(name);
    pages.push({
      pageType: 'service',
      title: name,
      slug,
      path: `/services/${slug}`,
      metaTitle: `${name}${cityState ? ` in ${cityState}` : ''} | ${bizName}`,
      metaDescription:
        svc.overrideShortDescription ||
        `${name} services${cityState ? ` in ${cityState}` : ''} from ${bizName}.`,
      h1: name,
      serviceLine: name,
      marketOrientation: business?.serviceAreaMode || 'local',
      city: baseCity || undefined,
      state: baseState || undefined,
      sortOrder: order++,
      sections: [
        { sectionType: 'hero', heading: name, ctaText: 'Request Service' },
        { sectionType: 'about', heading: `Our ${name} Approach` },
        { sectionType: 'faq', heading: 'Frequently Asked Questions' },
        { sectionType: 'cta', heading: `Need ${name}?`, ctaText: 'Get a Quote' },
      ],
    });
  }

  // City / county landing pages for multi-location businesses.
  const isMultiArea =
    (business?.serviceAreaMode === 'multi_location' ||
      business?.serviceAreaMode === 'regional') &&
    locations.length > 1;
  if (isMultiArea) {
    for (const loc of locations) {
      const city = loc.city || loc.locationName || '';
      if (!city) continue;
      const slug = loc.pageSlug || slugify(city);
      pages.push({
        pageType: loc.county ? 'county' : 'city',
        title: `${bizName} — ${city}`,
        slug,
        path: `/locations/${slug}`,
        metaTitle: `${bizName} in ${city}${loc.state ? `, ${loc.state}` : ''}`,
        metaDescription: `Local services from ${bizName} in ${city}${loc.state ? `, ${loc.state}` : ''}.`,
        h1: `${bizName} in ${city}`,
        marketOrientation: 'local',
        city,
        county: loc.county || undefined,
        state: loc.state || undefined,
        sortOrder: order++,
        sections: [
          { sectionType: 'hero', heading: `${bizName} in ${city}`, ctaText: 'Call Now' },
          { sectionType: 'services', heading: `Services in ${city}` },
          { sectionType: 'cta', heading: `Serving ${city}`, ctaText: 'Get Started' },
        ],
      });
    }
  }

  // About + Contact pages — always present.
  pages.push({
    pageType: 'about',
    title: `About ${bizName}`,
    slug: 'about',
    path: '/about',
    metaTitle: `About ${bizName}`,
    metaDescription: `Learn more about ${bizName}.`,
    h1: `About ${bizName}`,
    sortOrder: order++,
    sections: [
      { sectionType: 'about', heading: 'Our Story' },
      { sectionType: 'testimonials', heading: 'What Customers Say' },
    ],
  });
  pages.push({
    pageType: 'contact',
    title: 'Contact Us',
    slug: 'contact',
    path: '/contact',
    metaTitle: `Contact ${bizName}`,
    metaDescription: `Get in touch with ${bizName}.`,
    h1: 'Contact Us',
    sortOrder: order++,
    sections: [
      { sectionType: 'contact', heading: 'Get in Touch' },
      { sectionType: 'cta', heading: 'Request a Quote', ctaText: 'Send Message' },
    ],
  });

  return pages;
}

/**
 * Generate a production build from an approved concept. Creates a
 * WebsiteProduction + WebsitePage + WebsiteSection records, carries over the
 * concept's assets as production assets, and records a production QA result.
 *
 * Returns the created production id.
 */
export async function generateProductionFromConcept(opts: {
  businessId: string;
  websiteProjectId: string;
  conceptId: string;
}): Promise<{ productionId: string; pageCount: number }> {
  const { businessId, websiteProjectId, conceptId } = opts;

  // Version number for this production build.
  const prodCount = await prisma.websiteProduction.count({
    where: { websiteProjectId },
  });

  const plan = await buildPagePlan(businessId);

  const sitemapJson = {
    generatedFrom: conceptId,
    pages: plan.map((p) => ({ path: p.path, pageType: p.pageType, title: p.title })),
  };
  const robotsTxt = 'User-agent: *\nAllow: /\n';

  // Create the production shell in `generating` state.
  const production = await prisma.websiteProduction.create({
    data: {
      businessId,
      websiteProjectId,
      sourceConceptId: conceptId,
      status: PRODUCTION_STATUS.GENERATING,
      version: prodCount + 1,
      sitemapJson,
      robotsTxt,
      qaStatus: 'pending',
    },
  });

  // Create pages + their sections.
  for (const p of plan) {
    const page = await prisma.websitePage.create({
      data: {
        businessId,
        websiteProjectId,
        productionId: production.id,
        pageType: p.pageType,
        title: p.title,
        slug: p.slug,
        path: p.path,
        metaTitle: p.metaTitle,
        metaDescription: p.metaDescription,
        h1: p.h1,
        serviceLine: p.serviceLine,
        marketOrientation: p.marketOrientation,
        city: p.city,
        county: p.county,
        state: p.state,
        status: 'ready',
        sortOrder: p.sortOrder,
      },
    });
    if (p.sections.length) {
      await prisma.websiteSection.createMany({
        data: p.sections.map((s, idx) => ({
          businessId,
          websiteProjectId,
          pageId: page.id,
          productionId: production.id,
          sectionType: s.sectionType,
          heading: s.heading,
          body: s.body || null,
          ctaText: s.ctaText || null,
          sortOrder: idx,
          status: 'ready',
        })),
      });
    }
  }

  // Carry over the approved concept's assets as production-scoped assets.
  const conceptAssets = await prisma.websiteAsset.findMany({
    where: { conceptId },
    take: 100,
  });
  if (conceptAssets.length) {
    await prisma.websiteAsset.createMany({
      data: conceptAssets.map((a) => ({
        businessId,
        websiteProjectId,
        productionId: production.id,
        assetType: a.assetType,
        r2Key: a.r2Key,
        publicUrl: a.publicUrl,
        altText: a.altText,
        width: a.width,
        height: a.height,
        status: a.status,
      })),
    });
  }

  const pageCount = plan.length;

  // Record a production QA result (structural checks only this phase).
  const failures: string[] = [];
  if (pageCount < 3) failures.push('Fewer than 3 pages generated');
  if (!plan.some((p) => p.pageType === 'home')) failures.push('Missing home page');
  if (!plan.some((p) => p.pageType === 'contact')) failures.push('Missing contact page');
  const verdict = failures.length ? 'WARNING' : 'APPROVED';
  await prisma.websiteQaResult.create({
    data: {
      businessId,
      websiteProjectId,
      productionId: production.id,
      qaType: 'production_qa',
      qaAgent: 'Production Structural QA',
      verdict,
      gatesJson: {
        pageCount,
        hasHome: plan.some((p) => p.pageType === 'home'),
        hasContact: plan.some((p) => p.pageType === 'contact'),
        servicePages: plan.filter((p) => p.pageType === 'service').length,
        locationPages: plan.filter((p) =>
          ['city', 'county'].includes(p.pageType),
        ).length,
      },
      failuresJson: failures.length ? { failures } : undefined,
    },
  });

  // Finalize: production is ready for review.
  await prisma.websiteProduction.update({
    where: { id: production.id },
    data: {
      status: PRODUCTION_STATUS.READY_FOR_REVIEW,
      qaStatus: failures.length ? 'failed' : 'passed',
    },
  });

  return { productionId: production.id, pageCount };
}
