/**
 * Static Next.js site renderer (skeleton).
 *
 * Consumes a platform-neutral SiteBlueprint and produces a portable static
 * Next.js package as an in-memory file map. The package is a standalone
 * project (separate from the Launch OS app) that statically exports to a plain
 * `out/` directory deployable to any static host.
 *
 * Scope (Phase 2): emit the package FILE TREE + a render manifest. Actual
 * binary image download/copy into public/images is intentionally deferred —
 * the asset manifest records what each image needs. NO build is executed here
 * and NOTHING is deployed.
 */

import fs from 'fs';
import path from 'path';
import type { SiteBlueprint } from '@/lib/site-blueprint';
import * as T from '@/lib/site-renderer/templates';

export interface RenderedFile {
  /** Package-relative path, e.g. "app/about/page.tsx". */
  path: string;
  content: string;
}

export interface RenderManifest {
  businessSlug: string;
  outputDir: string;
  blueprintVersion: number;
  productionId: string;
  fileCount: number;
  pageRoutes: { path: string; routeFile: string }[];
  images: {
    total: number;
    portable: number;
    needsDownload: number;
    nonPortable: number;
  };
  warnings: string[];
}

export interface RenderedSitePackage {
  outputDir: string;
  files: RenderedFile[];
  manifest: RenderManifest;
}

/** Convert a page path ("/services/foo") to its app-router route file. */
export function routeFileForPath(pagePath: string): string {
  const clean = (pagePath || '/').split('?')[0].replace(/^\/+|\/+$/g, '');
  if (clean === '') return 'app/page.tsx';
  return `app/${clean}/page.tsx`;
}

/**
 * Strip expiring/secret query credentials (e.g. AWS/R2 signed-URL params) from
 * a source URL before it is embedded into the shipped package. Keeps the URL
 * path for human reference but removes anything that could be a live secret.
 */
export function redactSource(source: string | null): string | null {
  if (!source) return source;
  const qIdx = source.indexOf('?');
  if (qIdx === -1) return source;
  const base = source.slice(0, qIdx);
  const query = source.slice(qIdx + 1);
  if (/X-Amz-(Signature|Credential|Expires|Security-Token)|Signature=|token=/i.test(query)) {
    return `${base}?[redacted]`;
  }
  return source;
}

/**
 * Render the blueprint into a portable static package (in-memory).
 * @param outputRoot Base directory under which `client-sites/{slug}/` is placed.
 *                   Defaults to PROJECT generated dir; never a hardcoded host path.
 */
export function renderStaticSite(
  bp: SiteBlueprint,
  opts?: { outputRoot?: string },
): RenderedSitePackage {
  const slug = bp.business.slug;
  const outputRoot =
    opts?.outputRoot ||
    process.env.CLIENT_SITES_DIR ||
    path.join(process.cwd(), 'generated', 'client-sites');
  const outputDir = path.join(outputRoot, slug);

  const files: RenderedFile[] = [];
  const add = (p: string, content: string) => files.push({ path: p, content });

  // ── Project scaffolding ─────────────────────────────────────────────────
  add('package.json', T.packageJson(bp));
  add('next.config.js', T.nextConfig());
  add('tsconfig.json', T.tsConfig());
  add('.env.example', T.envExample());
  add('next-env.d.ts', '/// <reference types="next" />\n/// <reference types="next/image-types/global" />\n');
  add('README.md', T.readme(bp));

  // ── site.config.json (blueprint snapshot consumed by components) ─────────
  // SECURITY: the shipped package must never carry live/expiring credentials.
  // Signed R2 URLs (X-Amz-*) are an expiring secret, so we redact the query
  // string from every embedded source before serialisation. The internal
  // render manifest (kept server-side, not part of the package) retains the
  // full source for the deferred download phase.
  const shippedAssetManifest = bp.assetManifest.map((a) => ({
    ...a,
    source: redactSource(a.source),
  }));
  const siteConfig = {
    business: bp.business,
    brand: bp.brand,
    navigation: bp.navigation,
    footer: bp.footer,
    footerYear: new Date(bp.generatedAt).getUTCFullYear(),
    assetManifest: shippedAssetManifest,
    deploymentPreferences: bp.deploymentPreferences,
    seo: bp.seo,
  };
  add('site.config.json', JSON.stringify(siteConfig, null, 2) + '\n');

  // ── Shared components ─────────────────────────────────────────────────
  add('app/layout.tsx', T.rootLayout(bp));
  add('components/SiteNav.tsx', T.siteNav(bp));
  add('components/SiteFooter.tsx', T.siteFooter());
  add('components/Analytics.tsx', T.analyticsComponent());
  add('components/LeadForm.tsx', T.leadFormComponent());
  add('components/Section.tsx', T.sectionComponent());

  // ── SEO routes ───────────────────────────────────────────────────────
  add('app/sitemap.ts', T.sitemapTs(bp));
  add('app/robots.ts', T.robotsTs());

  // ── Page routes ───────────────────────────────────────────────────
  const pageRoutes: { path: string; routeFile: string }[] = [];
  for (const page of bp.pages) {
    const routeFile = routeFileForPath(page.path);
    add(routeFile, T.pageRoute(page));
    pageRoutes.push({ path: page.path, routeFile });
  }

  // ── public/images placeholder (binary copy deferred to a later phase) ─────
  add('public/images/.gitkeep', '');
  add('public/assets/.gitkeep', '');
  add('public/robots-static.txt', T.robotsTxt(bp));

  const images = {
    total: bp.assetManifest.length,
    portable: bp.assetManifest.filter((a) => a.portability === 'portable').length,
    needsDownload: bp.assetManifest.filter((a) => a.portability === 'needs_download').length,
    nonPortable: bp.assetManifest.filter((a) => a.portability === 'non_portable').length,
  };

  const manifest: RenderManifest = {
    businessSlug: slug,
    outputDir,
    blueprintVersion: bp.blueprintVersion,
    productionId: bp.productionId,
    fileCount: files.length,
    pageRoutes,
    images,
    warnings: bp.warnings,
  };

  return { outputDir, files, manifest };
}

/**
 * Persist a rendered package to disk. Writes only text files; image binaries
 * are NOT downloaded in this phase (see asset manifest). Returns the absolute
 * output directory. This NEVER deploys or publishes.
 */
export function writeSitePackage(pkg: RenderedSitePackage): string {
  for (const f of pkg.files) {
    const dest = path.join(pkg.outputDir, f.path);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, f.content, 'utf8');
  }
  fs.writeFileSync(
    path.join(pkg.outputDir, 'render-manifest.json'),
    JSON.stringify(pkg.manifest, null, 2) + '\n',
    'utf8',
  );
  return pkg.outputDir;
}
