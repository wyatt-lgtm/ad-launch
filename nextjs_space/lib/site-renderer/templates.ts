/**
 * Static-site renderer templates.
 *
 * Pure string builders for the files emitted into a portable static Next.js
 * package. These templates are platform-neutral: they contain NO secrets, NO
 * HostGator/cPanel URLs and NO absolute local paths. Third-party integrations
 * (GoHighLevel lead form, Google Analytics) are wired exclusively through
 * NEXT_PUBLIC_* environment variables resolved at the generated site's build
 * time — never inlined here.
 */

import type { SiteBlueprint, BlueprintPage } from '@/lib/site-blueprint';
import { ENV_KEYS } from '@/lib/site-blueprint';

/** package.json for the standalone static site. */
export function packageJson(bp: SiteBlueprint): string {
  return (
    JSON.stringify(
      {
        name: bp.business.slug,
        version: '0.1.0',
        private: true,
        scripts: {
          dev: 'next dev',
          build: 'next build',
          start: 'next start',
        },
        dependencies: {
          next: '14.2.28',
          react: '18.2.0',
          'react-dom': '18.2.0',
        },
        devDependencies: {
          '@types/node': '20.6.2',
          '@types/react': '18.2.22',
          '@types/react-dom': '18.2.7',
          typescript: '5.2.2',
        },
      },
      null,
      2,
    ) + '\n'
  );
}

/** next.config.js — static export (Next 14 `output: 'export'`). */
export function nextConfig(): string {
  return `/** @type {import('next').NextConfig} */
// Static export: produces a fully static \`out/\` directory deployable to any
// static host (HostGator, Cloudflare Pages, Vercel, manual upload).
const nextConfig = {
  output: 'export',
  // Static export cannot use the Next.js image optimizer.
  images: { unoptimized: true },
  trailingSlash: true,
};

module.exports = nextConfig;
`;
}

export function tsConfig(): string {
  return (
    JSON.stringify(
      {
        compilerOptions: {
          target: 'es2017',
          lib: ['dom', 'dom.iterable', 'esnext'],
          allowJs: true,
          skipLibCheck: true,
          strict: true,
          noEmit: true,
          esModuleInterop: true,
          module: 'esnext',
          moduleResolution: 'bundler',
          resolveJsonModule: true,
          isolatedModules: true,
          jsx: 'preserve',
          incremental: true,
          plugins: [{ name: 'next' }],
          paths: { '@/*': ['./*'] },
        },
        include: ['next-env.d.ts', '**/*.ts', '**/*.tsx', '.next/types/**/*.ts'],
        exclude: ['node_modules'],
      },
      null,
      2,
    ) + '\n'
  );
}

/** .env.example documenting required NEXT_PUBLIC_* placeholders (no values). */
export function envExample(): string {
  return `# Public configuration for the generated static site.
# These are resolved at build time. Do NOT put secrets here — anything with the
# NEXT_PUBLIC_ prefix is embedded in the public client bundle.

# Canonical site URL (used for sitemap, canonical tags, schema).
${ENV_KEYS.SITE_URL}=

# Google Analytics 4 measurement id (optional). Leave blank to disable.
${ENV_KEYS.GA_MEASUREMENT_ID}=

# GoHighLevel lead form embed (optional). Leave blank to disable the form.
${ENV_KEYS.GHL_FORM_ID}=
${ENV_KEYS.GHL_LOCATION_ID}=
`;
}

export function robotsTxt(bp: SiteBlueprint): string {
  return bp.seo.robotsTxt || 'User-agent: *\nAllow: /\n';
}

/** Root layout: includes nav, footer and the analytics placeholder. */
export function rootLayout(bp: SiteBlueprint): string {
  return `import type { Metadata } from 'next';
import SiteNav from '@/components/SiteNav';
import SiteFooter from '@/components/SiteFooter';
import Analytics from '@/components/Analytics';

export const metadata: Metadata = {
  title: ${JSON.stringify(bp.business.name)},
  description: ${JSON.stringify(
    bp.pages.find((p) => p.pageType === 'home')?.metaDescription || bp.business.name,
  )},
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Analytics />
        <SiteNav />
        <main>{children}</main>
        <SiteFooter />
      </body>
    </html>
  );
}
`;
}

export function siteNav(bp: SiteBlueprint): string {
  return `import Link from 'next/link';
import config from '@/site.config.json';

export default function SiteNav() {
  const nav = (config as any).navigation as { label: string; path: string }[];
  return (
    <header>
      <nav aria-label="Primary">
        <Link href="/">{(config as any).business.name}</Link>
        <ul>
          {nav.map((item) => (
            <li key={item.path}>
              <Link href={item.path}>{item.label}</Link>
            </li>
          ))}
        </ul>
      </nav>
    </header>
  );
}
`;
}

export function siteFooter(): string {
  return `import Link from 'next/link';
import config from '@/site.config.json';

export default function SiteFooter() {
  const business = (config as any).business;
  const footerNav = (config as any).footer.navigation as { label: string; path: string }[];
  const year = (config as any).footerYear as number;
  return (
    <footer>
      <nav aria-label="Footer">
        {footerNav.map((item) => (
          <Link key={item.path} href={item.path}>{item.label}</Link>
        ))}
      </nav>
      <p>&copy; {year} {business.name}. All rights reserved.</p>
    </footer>
  );
}
`;
}

/** Analytics placeholder — only renders when the GA env var is provided. */
export function analyticsComponent(): string {
  return `import Script from 'next/script';

// Renders the GA4 tag ONLY when ${ENV_KEYS.GA_MEASUREMENT_ID} is set at build
// time. No measurement id is hard-coded here.
export default function Analytics() {
  const id = process.env.${ENV_KEYS.GA_MEASUREMENT_ID};
  if (!id) return null;
  return (
    <>
      <Script src={\`https://www.googletagmanager.com/gtag/js?id=\${id}\`} strategy="afterInteractive" />
      <Script id="ga-init" strategy="afterInteractive">
        {\`window.dataLayer = window.dataLayer || [];
 function gtag(){dataLayer.push(arguments);}
 gtag('js', new Date());
 gtag('config', '\${id}');\`}
      </Script>
    </>
  );
}
`;
}

/** GoHighLevel lead form placeholder — renders only when env ids are present. */
export function leadFormComponent(): string {
  return `'use client';

// GoHighLevel lead form. Renders the embed ONLY when both
// ${ENV_KEYS.GHL_FORM_ID} and ${ENV_KEYS.GHL_LOCATION_ID} are configured at
// build time. No form id, location id or secret is hard-coded here.
export default function LeadForm() {
  const formId = process.env.${ENV_KEYS.GHL_FORM_ID};
  const locationId = process.env.${ENV_KEYS.GHL_LOCATION_ID};
  if (!formId || !locationId) {
    return (
      <div data-lead-form="disabled">
        <p>Contact form not configured.</p>
      </div>
    );
  }
  const src = \`https://api.leadconnectorhq.com/widget/form/\${formId}?locationId=\${locationId}\`;
  return (
    <iframe
      title="Contact form"
      src={src}
      style={{ width: '100%', minHeight: 600, border: 0 }}
    />
  );
}
`;
}

/** Section renderer — maps section types to simple semantic markup. */
export function sectionComponent(): string {
  return `import Image from 'next/image';
import LeadForm from '@/components/LeadForm';

export interface SectionAsset {
  id: string;
  src: string;
  assetType: string;
  alt?: string;
  width?: number;
  height?: number;
}
export interface SectionData {
  id: string;
  sectionType: string;
  heading?: string;
  body?: string;
  ctaText?: string;
  ctaTarget?: string;
  assetRefs: SectionAsset[];
}

export default function Section({ section }: { section: SectionData }) {
  const hero = section.assetRefs[0];
  return (
    <section data-section-type={section.sectionType}>
      {section.heading ? <h2>{section.heading}</h2> : null}
      {hero ? (
        <div style={{ position: 'relative', aspectRatio: '16 / 9', background: '#f1f5f9' }}>
          <Image src={hero.src} alt={hero.alt || section.heading || ''} fill style={{ objectFit: 'cover' }} />
        </div>
      ) : null}
      {section.body ? <p>{section.body}</p> : null}
      {section.sectionType === 'contact' ? <LeadForm /> : null}
      {section.ctaText ? (
        <a href={section.ctaTarget || '/contact'} data-cta>{section.ctaText}</a>
      ) : null}
    </section>
  );
}
`;
}

/** A page route file. Renders the page's sections from inlined data. */
export function pageRoute(page: BlueprintPage): string {
  const sectionsJson = JSON.stringify(page.sections, null, 2);
  const metaTitle = page.metaTitle || page.title || '';
  const metaDescription = page.metaDescription || '';
  const links = (page.internalLinks || []).filter((l) => l && l.path && l.label);
  const linksJson = JSON.stringify(links, null, 2);
  return `import type { Metadata } from 'next';
import Link from 'next/link';
import Section, { type SectionData } from '@/components/Section';

export const metadata: Metadata = {
  title: ${JSON.stringify(metaTitle)},
  description: ${JSON.stringify(metaDescription)},
};

const sections: SectionData[] = ${sectionsJson};
const relatedLinks: { label: string; path: string }[] = ${linksJson};

export default function Page() {
  return (
    <article>
      ${page.h1 ? `<h1>${escapeJsxText(page.h1)}</h1>` : ''}
      {sections.map((s) => (
        <Section key={s.id} section={s} />
      ))}
      {relatedLinks.length ? (
        <nav aria-label="Related pages" data-related-links>
          <ul>
            {relatedLinks.map((l) => (
              <li key={l.path}>
                <Link href={l.path}>{l.label}</Link>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}
    </article>
  );
}
`;
}

function escapeJsxText(s: string): string {
  return s.replace(/[{}<>]/g, (c) => `{'${c}'}`);
}

/** app/sitemap.ts driven by NEXT_PUBLIC_SITE_URL. */
export function sitemapTs(bp: SiteBlueprint): string {
  const paths = JSON.stringify(bp.pages.map((p) => p.path));
  return `import type { MetadataRoute } from 'next';

export const dynamic = 'force-static';

export default function sitemap(): MetadataRoute.Sitemap {
  const base = (process.env.${ENV_KEYS.SITE_URL} || '').replace(/\\/$/, '');
  const paths: string[] = ${paths};
  return paths.map((p) => ({ url: base + p, changeFrequency: 'monthly', priority: p === '/' ? 1 : 0.7 }));
}
`;
}

export function robotsTs(): string {
  return `import type { MetadataRoute } from 'next';

export const dynamic = 'force-static';

export default function robots(): MetadataRoute.Robots {
  const base = (process.env.${ENV_KEYS.SITE_URL} || '').replace(/\\/$/, '');
  return {
    rules: { userAgent: '*', allow: '/' },
    sitemap: base ? base + '/sitemap.xml' : undefined,
  };
}
`;
}

export function readme(bp: SiteBlueprint): string {
  return `# ${bp.business.name} — Static Site Package

Generated by the Launch OS static-first site renderer (blueprint v${bp.blueprintVersion}).

This is a **standalone, portable static site**. It is NOT part of the Launch OS
application build — it is a self-contained project that exports to a plain
\`out/\` directory deployable to any static host.

## Build

\`\`\`bash
npm install
npm run build   # produces ./out (static export)
\`\`\`

## Configuration

Copy \`.env.example\` to \`.env\` and fill in the public values. None of these
are secrets — anything prefixed \`NEXT_PUBLIC_\` is embedded in the client bundle.

| Variable | Purpose |
| --- | --- |
| \`${ENV_KEYS.SITE_URL}\` | Canonical site URL (sitemap, canonical tags) |
| \`${ENV_KEYS.GA_MEASUREMENT_ID}\` | Google Analytics 4 id (optional) |
| \`${ENV_KEYS.GHL_FORM_ID}\` | GoHighLevel form id (optional) |
| \`${ENV_KEYS.GHL_LOCATION_ID}\` | GoHighLevel location id (optional) |

## Images

Images referenced by pages live in \`public/images/\`. See
\`site.config.json → assetManifest\` for the source of each image and its
portability status. Assets flagged \`non_portable\` (e.g. expiring signed URLs)
must be re-issued as stable public URLs before this package can be built with
all images present.

## Default deployment target

\`${bp.deploymentPreferences.deploymentTarget}\` (static export). Deployment is
NOT performed by this package; a deployment adapter handles publishing in a
later, gated step.
`;
}
