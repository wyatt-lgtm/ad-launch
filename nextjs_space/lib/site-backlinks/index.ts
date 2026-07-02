/**
 * Milestone 10 — backlink preservation layer (pure logic barrel).
 *
 * Preserves SEO equity when a new website is generated: inventory existing
 * backlinked URLs, classify their value, map them against the newly proposed
 * sitemap, and produce a redirect plan (preserve same URL / 301 / rebuild /
 * ignore). NEVER scrapes Google, NEVER deploys/publishes, NEVER mutates DNS.
 */

export * from '@/lib/site-backlinks/types';
export * from '@/lib/site-backlinks/url-normalize';
export * from '@/lib/site-backlinks/priority';
export * from '@/lib/site-backlinks/mapping';
export * from '@/lib/site-backlinks/redirect-plan';
export * from '@/lib/site-backlinks/inventory';
export { crawlExistingSite, parseSitemapXml, parseInternalLinks, parseRobotsSitemaps } from '@/lib/site-backlinks/crawl';
export type { CrawlResult } from '@/lib/site-backlinks/crawl';
