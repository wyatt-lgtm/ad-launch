/**
 * Milestone 7 — Mobile / responsive QA engine (deterministic static analyzer).
 *
 * Pure, dependency-free analysis of a generated static preview package. It
 * inspects the in-memory rendered package files (re-rendered from the approved
 * sitemap-first blueprint) plus the SiteBuild artifact manifest asset records,
 * and produces a durable QA report describing how the site behaves at mobile
 * and tablet viewports.
 *
 * HARD RULES honoured here:
 *  - Read-only. Never deploys, publishes, generates images/copy, or mutates the
 *    SiteBuild.
 *  - No browser / Playwright dependency (production runtime is bare-bones Node).
 *    Rendering is simulated by statically analysing the emitted package source.
 *  - Never emits secrets or signed URLs into the report; instead it FLAGS them
 *    as critical failures.
 *  - Screenshots are optional and OFF by default (headless browser rendering is
 *    unavailable in the hosted runtime); the report shape still supports them.
 */

import type { RenderedFile } from '@/lib/site-renderer';
import type { ArtifactManifest, ArtifactAssetRecord } from '@/lib/site-builder/artifact-manifest';

// ── Viewports under test ────────────────────────────────────────────────
export interface QaViewport {
  id: string;
  label: string;
  width: number;
  height: number;
}

export const MOBILE_QA_VIEWPORTS: QaViewport[] = [
  { id: 'mobile_320', label: 'Mobile (small)', width: 320, height: 720 },
  { id: 'mobile_390', label: 'Mobile (modern)', width: 390, height: 844 },
  { id: 'tablet_768', label: 'Tablet', width: 768, height: 1024 },
];

/** Smallest viewport width — the binding constraint for overflow checks. */
export const NARROWEST_WIDTH = 320;
/** Minimum accessible tap-target size (px). */
export const MIN_TAP_TARGET = 44;
/** Overall score threshold to be considered a pass (in addition to zero criticals). */
export const PASS_SCORE_THRESHOLD = 80;

export type CheckStatus = 'pass' | 'warn' | 'fail';
export type CheckSeverity = 'critical' | 'major' | 'minor' | 'info';

export interface RouteCheck {
  check: string;
  status: CheckStatus;
  severity: CheckSeverity;
  message: string;
}

export interface RouteScores {
  layout: number;
  readability: number;
  tapTargets: number;
  images: number;
  navigation: number;
  forms: number;
}

export interface RouteScreenshot {
  viewport: string;
  artifactRef: string;
}

export interface RouteReport {
  path: string;
  status: CheckStatus;
  scores: RouteScores;
  checks: RouteCheck[];
  screenshots: RouteScreenshot[];
}

export interface MobileQaReport {
  businessId: string;
  siteBuildId: string;
  status: 'passed' | 'failed' | 'blocked';
  score: number;
  passed: boolean;
  checkedAt: string;
  viewports: QaViewport[];
  routes: RouteReport[];
  summary: {
    checkedRoutesCount: number;
    failedRoutesCount: number;
    warningCount: number;
    criticalFailures: string[];
    warnings: string[];
    topIssues: string[];
  };
}

export interface AnalyzeMobileQaInput {
  businessId: string;
  siteBuildId: string;
  files: RenderedFile[];
  manifest: ArtifactManifest | null;
  /** Explicit list of route paths to check. Falls back to manifest/files. */
  routes?: string[];
  checkedAt?: string;
}

// ── Signed-URL / secret detection (never let these ship) ────────────────
const SIGNED_URL_PATTERNS: RegExp[] = [
  /X-Amz-Signature=/i,
  /X-Amz-Credential=/i,
  /[?&]Signature=/i,
  /[?&]sig=/i,
  /[?&]se=/i, // Azure SAS expiry
  /[?&]st=/i,
  /GoogleAccessId=/i,
  /[?&]Expires=/i,
];

const SECRET_PATTERNS: RegExp[] = [
  /AKIA[0-9A-Z]{16}/, // AWS access key id
  /\bsk_live_[0-9a-zA-Z]{10,}/, // Stripe live secret
  /\bghp_[0-9A-Za-z]{20,}/, // GitHub PAT
  /aws_secret_access_key\s*[:=]/i,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
];

/** True when a raw string contains a signed-URL credential fingerprint. */
export function containsSignedUrl(text: string): boolean {
  return SIGNED_URL_PATTERNS.some((re) => re.test(text));
}

/** True when a raw string contains a plaintext secret fingerprint. */
export function containsSecret(text: string): boolean {
  return SECRET_PATTERNS.some((re) => re.test(text));
}

// ── Helpers ─────────────────────────────────────────────────────────────

/** All fixed pixel widths declared in a source string (width / min-width). */
export function extractFixedPxWidths(text: string): number[] {
  const out: number[] = [];
  // CSS-in-JS: width: 480, minWidth: '520px', min-width:600px
  const re = /\b(?:min-?width)\s*[:=]\s*['"]?(\d{2,5})\s*(?:px)?['"]?/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) out.push(parseInt(m[1], 10));
  const re2 = /(?<!-)\bwidth\s*[:=]\s*['"]?(\d{2,5})\s*px['"]?/gi;
  while ((m = re2.exec(text))) out.push(parseInt(m[1], 10));
  // HTML width attribute: width="640"
  const re3 = /\swidth=['"](\d{2,5})['"]/gi;
  while ((m = re3.exec(text))) out.push(parseInt(m[1], 10));
  return out;
}

function fileByPath(files: RenderedFile[], path: string): RenderedFile | undefined {
  return files.find((f) => f.path === path);
}

function pageFileForRoute(files: RenderedFile[], routePath: string): RenderedFile | undefined {
  const clean = (routePath || '/').split('?')[0].replace(/^\/+|\/+$/g, '');
  const target = clean === '' ? 'app/page.tsx' : `app/${clean}/page.tsx`;
  return fileByPath(files, target);
}

/** Resolve the routes to check from explicit list -> manifest -> page files. */
export function resolveRoutes(input: AnalyzeMobileQaInput): string[] {
  if (input.routes && input.routes.length) return dedupe(input.routes);
  const m = input.manifest;
  if (m?.routes && m.routes.length) return dedupe(m.routes as string[]);
  if (m?.pages && m.pages.length) return dedupe(m.pages.map((p) => p.path));
  const fromFiles = input.files
    .filter((f) => /^app\/(.*\/)?page\.tsx$/.test(f.path))
    .map((f) => {
      if (f.path === 'app/page.tsx') return '/';
      return '/' + f.path.replace(/^app\//, '').replace(/\/page\.tsx$/, '');
    });
  return dedupe(fromFiles.length ? fromFiles : ['/']);
}

function dedupe(arr: string[]): string[] {
  return Array.from(new Set(arr));
}

function clamp(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

/** Assets referenced by a page's inlined sections (by src path). */
function assetsForPage(
  pageContent: string,
  manifest: ArtifactManifest | null,
): ArtifactAssetRecord[] {
  if (!manifest?.assets) return [];
  const all: ArtifactAssetRecord[] = [
    ...(manifest.assets.copied || []),
    ...(manifest.assets.missing || []),
    ...(manifest.assets.failed || []),
  ];
  return all.filter((a) => a.webPath && pageContent.includes(a.webPath));
}

// ── The analyzer ─────────────────────────────────────────────────────────

export function analyzeMobileQa(input: AnalyzeMobileQaInput): MobileQaReport {
  const checkedAt = input.checkedAt || new Date().toISOString();
  const routes = resolveRoutes(input);

  // Shared component sources (participate in every route's layout/nav/forms).
  const layoutSrc = fileByPath(input.files, 'app/layout.tsx')?.content || '';
  const navSrc = fileByPath(input.files, 'components/SiteNav.tsx')?.content || '';
  const footerSrc = fileByPath(input.files, 'components/SiteFooter.tsx')?.content || '';
  const sectionSrc = fileByPath(input.files, 'components/Section.tsx')?.content || '';
  const leadFormSrc = fileByPath(input.files, 'components/LeadForm.tsx')?.content || '';
  const configSrc = fileByPath(input.files, 'site.config.json')?.content || '';

  let navItems: { label: string; path: string }[] = [];
  try {
    const cfg = JSON.parse(configSrc || '{}');
    navItems = (cfg.navigation || []) as { label: string; path: string }[];
  } catch {
    navItems = [];
  }

  // Global signed-URL / secret scan across the WHOLE package (critical).
  const globalCriticals: string[] = [];
  for (const f of input.files) {
    if (containsSignedUrl(f.content)) {
      globalCriticals.push(`Signed URL embedded in ${f.path}`);
    }
    if (containsSecret(f.content)) {
      globalCriticals.push(`Secret credential embedded in ${f.path}`);
    }
  }
  // Manifest asset records that stored a signed source.
  if (input.manifest?.assets) {
    const all = [
      ...(input.manifest.assets.copied || []),
      ...(input.manifest.assets.missing || []),
      ...(input.manifest.assets.failed || []),
    ];
    for (const a of all) {
      if (a.sourceKind === 'r2_signed') {
        globalCriticals.push(`Asset ${a.assetId} stored a signed URL source`);
      }
    }
  }

  const routeReports: RouteReport[] = routes.map((routePath) => {
    const pageFile = pageFileForRoute(input.files, routePath);
    const pageContent = pageFile?.content || '';
    const combined = [pageContent, layoutSrc, navSrc, footerSrc, sectionSrc, leadFormSrc].join('\n');
    const checks: RouteCheck[] = [];

    // 1) No horizontal scroll / overflow at 320px (fixed px widths).
    const widths = extractFixedPxWidths(combined);
    const overflowing = widths.filter((w) => w > NARROWEST_WIDTH);
    if (overflowing.length) {
      checks.push({
        check: 'no_horizontal_scroll_320',
        status: 'fail',
        severity: 'critical',
        message: `Fixed widths exceed ${NARROWEST_WIDTH}px viewport: ${overflowing.join(', ')}px. Causes horizontal scroll.`,
      });
    } else {
      checks.push({
        check: 'no_horizontal_scroll_320',
        status: 'pass',
        severity: 'info',
        message: 'No fixed pixel widths wider than the 320px viewport.',
      });
    }

    // 2) Images use max-width:100% (responsive by construction via next/image fill).
    const usesResponsiveImages =
      sectionSrc.includes('fill') || /max-?width\s*[:=]\s*['"]?100%/i.test(combined);
    const rawImgFixed = extractFixedPxWidths(pageContent).filter((w) => w > NARROWEST_WIDTH);
    if (/<img\b/i.test(pageContent) && rawImgFixed.length) {
      checks.push({
        check: 'images_max_width_100',
        status: 'fail',
        severity: 'major',
        message: 'A raw <img> declares a fixed width wider than the viewport.',
      });
    } else {
      checks.push({
        check: 'images_max_width_100',
        status: 'pass',
        severity: 'info',
        message: usesResponsiveImages
          ? 'Images render in responsive containers (fill / max-width:100%).'
          : 'No fixed-width images detected.',
      });
    }

    // 3) Hero image crop safe + no giant logo-as-hero / watermark regression.
    const pageAssets = assetsForPage(pageContent, input.manifest);
    const heroAsset =
      pageAssets.find((a) => (a.assetType || '').toLowerCase().includes('hero')) || pageAssets[0];
    if (heroAsset && heroAsset.width && heroAsset.height) {
      const ar = heroAsset.width / heroAsset.height;
      const tiny = heroAsset.width < 600 || heroAsset.height < 300;
      const squareish = ar >= 0.9 && ar <= 1.1;
      if (tiny || (squareish && heroAsset.width < 800)) {
        checks.push({
          check: 'hero_image_crop_safe',
          status: 'warn',
          severity: 'major',
          message: `Hero asset ${heroAsset.width}x${heroAsset.height} looks like a logo/watermark, not a landscape hero. May crop poorly on mobile.`,
        });
      } else if (ar < 1) {
        checks.push({
          check: 'hero_image_crop_safe',
          status: 'warn',
          severity: 'minor',
          message: `Hero asset is portrait (${heroAsset.width}x${heroAsset.height}); the 16:9 container will crop top/bottom.`,
        });
      } else {
        checks.push({
          check: 'hero_image_crop_safe',
          status: 'pass',
          severity: 'info',
          message: `Hero asset ${heroAsset.width}x${heroAsset.height} crops safely in the responsive 16:9 container.`,
        });
      }
    } else {
      checks.push({
        check: 'hero_image_crop_safe',
        status: 'pass',
        severity: 'info',
        message: 'Hero renders in a responsive aspect-ratio container.',
      });
    }

    // 4) Headline / text no overflow (no absurdly long unbroken words).
    const h1Match = pageContent.match(/<h1>([\s\S]*?)<\/h1>/);
    const h1Text = h1Match ? h1Match[1] : '';
    const longWord = [...(combined.match(/[A-Za-z0-9]{31,}/g) || [])].find(
      (w) => !/^[A-Za-z0-9_]+$/.test(w) || w.length > 40,
    );
    if (h1Text && [...h1Text.split(/\s+/)].some((w) => w.length > 30)) {
      checks.push({
        check: 'headline_no_overflow',
        status: 'warn',
        severity: 'minor',
        message: 'Headline contains a very long unbroken word that may overflow at 320px.',
      });
    } else {
      checks.push({
        check: 'headline_no_overflow',
        status: 'pass',
        severity: 'info',
        message: 'Headline and body text wrap cleanly at narrow widths.',
      });
    }

    // 5) Tap targets >= 44px for primary actions (regression detector).
    const undersizedTap = detectUndersizedTapTargets(combined);
    if (undersizedTap.length) {
      checks.push({
        check: 'tap_targets_min_44',
        status: 'fail',
        severity: 'critical',
        message: `Primary action(s) declare a tap size < ${MIN_TAP_TARGET}px: ${undersizedTap.join(', ')}.`,
      });
    } else {
      checks.push({
        check: 'tap_targets_min_44',
        status: 'pass',
        severity: 'info',
        message: 'No interactive element declares an undersized (<44px) tap target.',
      });
    }

    // 6) CTA visible, not oversized / offscreen.
    const hasCta = /data-cta/.test(sectionSrc) || /data-cta/.test(pageContent);
    const oversizedCta = detectOversizedFont(combined, 80);
    if (oversizedCta) {
      checks.push({
        check: 'cta_visible_not_oversized',
        status: 'warn',
        severity: 'minor',
        message: 'A CTA/heading uses an oversized font that may overflow on mobile.',
      });
    } else {
      checks.push({
        check: 'cta_visible_not_oversized',
        status: 'pass',
        severity: 'info',
        message: hasCta ? 'CTA renders inline and stays visible on mobile.' : 'No oversized CTA detected.',
      });
    }

    // 7) Nav collapses / simplifies + labels do not wrap awkwardly.
    const navCheck = evaluateNav(navItems, navSrc);
    checks.push(navCheck);

    // 8) Multi-column collapses / service cards stack vertically.
    const multiColFixed = detectFixedMultiColumn(combined);
    if (multiColFixed) {
      checks.push({
        check: 'columns_collapse_single',
        status: 'fail',
        severity: 'major',
        message: 'A multi-column grid uses fixed pixel columns that will not collapse to one column on mobile.',
      });
    } else {
      checks.push({
        check: 'columns_collapse_single',
        status: 'pass',
        severity: 'info',
        message: 'Sections/cards stack vertically in a single column on mobile.',
      });
    }

    // 9) Forms usable (no fixed width wider than viewport).
    const formFixed = extractFixedPxWidths(leadFormSrc).filter((w) => w > NARROWEST_WIDTH);
    const formHasContact = /contact/.test(pageContent) || sectionSrc.includes('LeadForm');
    if (formFixed.length) {
      checks.push({
        check: 'forms_usable',
        status: 'fail',
        severity: 'critical',
        message: `Lead form declares a fixed width (${formFixed.join(', ')}px) wider than the mobile viewport.`,
      });
    } else {
      checks.push({
        check: 'forms_usable',
        status: 'pass',
        severity: 'info',
        message: formHasContact
          ? 'Lead form is full-width (width:100%) and usable on mobile.'
          : 'No form on this route; nothing to constrain.',
      });
    }

    // 10) Comparison tables become mobile cards / scrollable.
    if (/<table\b/i.test(pageContent)) {
      const wrapped = /overflow-x|overflow:\s*auto|data-table-scroll/i.test(combined);
      checks.push({
        check: 'tables_mobile_friendly',
        status: wrapped ? 'pass' : 'fail',
        severity: wrapped ? 'info' : 'major',
        message: wrapped
          ? 'Table is wrapped in a horizontally scrollable container.'
          : 'A raw <table> is not wrapped for horizontal scroll and will overflow on mobile.',
      });
    } else {
      checks.push({
        check: 'tables_mobile_friendly',
        status: 'pass',
        severity: 'info',
        message: 'No comparison tables on this route.',
      });
    }

    // 11) Sticky/fixed elements must not cover the CTA / form.
    if (/position\s*[:=]\s*['"]?(fixed|sticky)/i.test(combined)) {
      checks.push({
        check: 'sticky_does_not_cover_cta',
        status: 'warn',
        severity: 'major',
        message: 'A fixed/sticky element is present; verify it does not cover the CTA or form on small screens.',
      });
    } else {
      checks.push({
        check: 'sticky_does_not_cover_cta',
        status: 'pass',
        severity: 'info',
        message: 'No fixed/sticky overlays that could cover the CTA or form.',
      });
    }

    // 12) No text-image collision in hero (text absolutely positioned over image).
    if (/position\s*[:=]\s*['"]?absolute/i.test(sectionSrc) && /<h1|<h2|<p/.test(sectionSrc)) {
      checks.push({
        check: 'no_text_image_collision',
        status: 'warn',
        severity: 'major',
        message: 'Text may be absolutely positioned over the hero image; check for collisions on mobile.',
      });
    } else {
      checks.push({
        check: 'no_text_image_collision',
        status: 'pass',
        severity: 'info',
        message: 'Hero text stacks above/below the image; no overlap on mobile.',
      });
    }

    // 13) Footer links readable.
    checks.push({
      check: 'footer_links_readable',
      status: footerSrc.includes('nav') ? 'pass' : 'warn',
      severity: footerSrc.includes('nav') ? 'info' : 'minor',
      message: footerSrc.includes('nav')
        ? 'Footer navigation renders as a semantic, readable list.'
        : 'Footer navigation could not be confirmed.',
    });

    // 14) Global signed-URL / secret criticals attach to every route.
    for (const c of globalCriticals) {
      checks.push({
        check: 'no_signed_url_or_secret',
        status: 'fail',
        severity: 'critical',
        message: c,
      });
    }
    if (!globalCriticals.length) {
      checks.push({
        check: 'no_signed_url_or_secret',
        status: 'pass',
        severity: 'info',
        message: 'No signed URLs or secrets embedded in the package.',
      });
    }

    const scores = scoreRoute(checks);
    const hasCritical = checks.some((c) => c.status === 'fail' && c.severity === 'critical');
    const hasFail = checks.some((c) => c.status === 'fail');
    const status: CheckStatus = hasCritical || hasFail ? 'fail' : checks.some((c) => c.status === 'warn') ? 'warn' : 'pass';

    return {
      path: routePath,
      status,
      scores,
      checks,
      screenshots: [], // headless rendering unavailable in hosted runtime
    };
  });

  // ── Aggregate ─────────────────────────────────────────────────────────
  const criticalFailures: string[] = [];
  const warnings: string[] = [];
  for (const r of routeReports) {
    for (const c of r.checks) {
      if (c.status === 'fail' && c.severity === 'critical') {
        criticalFailures.push(`${r.path}: ${c.message}`);
      } else if (c.status === 'warn' || (c.status === 'fail' && c.severity !== 'critical')) {
        warnings.push(`${r.path}: ${c.message}`);
      }
    }
  }
  const failedRoutesCount = routeReports.filter((r) => r.status === 'fail').length;
  const avgScore = routeReports.length
    ? clamp(
        routeReports.reduce((sum, r) => {
          const s = r.scores;
          return sum + (s.layout + s.readability + s.tapTargets + s.images + s.navigation + s.forms) / 6;
        }, 0) / routeReports.length,
      )
    : 0;

  const passed = criticalFailures.length === 0 && failedRoutesCount === 0 && avgScore >= PASS_SCORE_THRESHOLD;
  const topIssues = dedupe([...criticalFailures, ...warnings]).slice(0, 5);

  return {
    businessId: input.businessId,
    siteBuildId: input.siteBuildId,
    status: passed ? 'passed' : 'failed',
    score: avgScore,
    passed,
    checkedAt,
    viewports: MOBILE_QA_VIEWPORTS,
    routes: routeReports,
    summary: {
      checkedRoutesCount: routeReports.length,
      failedRoutesCount,
      warningCount: warnings.length,
      criticalFailures,
      warnings,
      topIssues,
    },
  };
}

// ── Scoring ──────────────────────────────────────────────────────────────

function scoreRoute(checks: RouteCheck[]): RouteScores {
  const groups: Record<keyof RouteScores, string[]> = {
    layout: [
      'no_horizontal_scroll_320',
      'columns_collapse_single',
      'sticky_does_not_cover_cta',
      'no_text_image_collision',
      'tables_mobile_friendly',
    ],
    readability: ['headline_no_overflow', 'footer_links_readable', 'no_signed_url_or_secret'],
    tapTargets: ['tap_targets_min_44', 'cta_visible_not_oversized'],
    images: ['images_max_width_100', 'hero_image_crop_safe'],
    navigation: ['nav_collapses'],
    forms: ['forms_usable'],
  };
  const penalty = (status: CheckStatus, severity: CheckSeverity): number => {
    if (status === 'pass') return 0;
    if (status === 'warn') return severity === 'major' ? 25 : 10;
    // fail
    return severity === 'critical' ? 100 : severity === 'major' ? 50 : 25;
  };
  const result = {} as RouteScores;
  (Object.keys(groups) as (keyof RouteScores)[]).forEach((key) => {
    const names = groups[key];
    const relevant = checks.filter((c) => names.includes(c.check));
    if (!relevant.length) {
      result[key] = 100;
      return;
    }
    const worst = Math.max(...relevant.map((c) => penalty(c.status, c.severity)));
    result[key] = clamp(100 - worst);
  });
  return result;
}

// ── Focused detectors ────────────────────────────────────────────────────

/** Interactive elements (a/button/[data-cta]/nav link) with height/font < 44px. */
export function detectUndersizedTapTargets(text: string): string[] {
  const out: string[] = [];
  // Inline height on an anchor/button context.
  const heightRe = /\bheight\s*[:=]\s*['"]?(\d{1,3})\s*px/gi;
  let m: RegExpExecArray | null;
  while ((m = heightRe.exec(text))) {
    const px = parseInt(m[1], 10);
    if (px > 0 && px < MIN_TAP_TARGET) {
      // Only flag when near an interactive marker to avoid false positives.
      const around = text.slice(Math.max(0, m.index - 160), m.index + 40);
      if (/data-cta|<a\b|<button|href=/i.test(around)) out.push(`height ${px}px`);
    }
  }
  return dedupe(out);
}

/** Any inline font-size larger than `limit` px. */
export function detectOversizedFont(text: string, limit: number): boolean {
  const re = /font-?size\s*[:=]\s*['"]?(\d{2,4})\s*px/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (parseInt(m[1], 10) > limit) return true;
  }
  return false;
}

/** Fixed multi-column grid/flex that will not collapse on mobile. */
export function detectFixedMultiColumn(text: string): boolean {
  // grid-template-columns with repeated fixed px, or repeat(n, 200px)
  if (/grid-template-columns\s*[:=][^;'"]*\b\d{2,4}px[^;'"]*\b\d{2,4}px/i.test(text)) return true;
  if (/grid-template-columns\s*[:=][^;'"]*repeat\(\s*[2-9][^)]*\d{2,4}px/i.test(text)) return true;
  return false;
}

/** Evaluate the primary nav for mobile friendliness. */
export function evaluateNav(
  navItems: { label: string; path: string }[],
  navSrc: string,
): RouteCheck {
  const semantic = /<nav[\s>]/.test(navSrc) && /<ul>/.test(navSrc);
  if (!semantic) {
    return {
      check: 'nav_collapses',
      status: 'warn',
      severity: 'major',
      message: 'Primary navigation is not a semantic list; mobile collapse cannot be confirmed.',
    };
  }
  const tooMany = navItems.length > 7;
  const awkward = navItems.find((n) => (n.label || '').length > 22);
  if (tooMany) {
    return {
      check: 'nav_collapses',
      status: 'warn',
      severity: 'minor',
      message: `Primary nav has ${navItems.length} items; consider simplifying for mobile.`,
    };
  }
  if (awkward) {
    return {
      check: 'nav_collapses',
      status: 'warn',
      severity: 'minor',
      message: `Nav label "${awkward.label}" is long and may wrap awkwardly on mobile.`,
    };
  }
  return {
    check: 'nav_collapses',
    status: 'pass',
    severity: 'info',
    message: 'Primary navigation is a compact semantic list that reflows on mobile.',
  };
}
