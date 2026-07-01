/**
 * Milestone 5C hardening — the website image render timeout is configurable and
 * SCOPED to the render provider only (not a global fetch timeout). Verifies the
 * default, env override, and clamp bounds of `websiteRenderTimeoutMs`.
 */
import { websiteRenderTimeoutMs } from '@/lib/website-image-render-provider';

const ORIGINAL = process.env.WEBSITE_RENDER_TIMEOUT_MS;

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.WEBSITE_RENDER_TIMEOUT_MS;
  else process.env.WEBSITE_RENDER_TIMEOUT_MS = ORIGINAL;
});

describe('websiteRenderTimeoutMs', () => {
  it('defaults to 240000ms (>= the 240s minimum required for a cold render)', () => {
    delete process.env.WEBSITE_RENDER_TIMEOUT_MS;
    expect(websiteRenderTimeoutMs()).toBe(240000);
  });

  it('honours a valid env override', () => {
    process.env.WEBSITE_RENDER_TIMEOUT_MS = '300000';
    expect(websiteRenderTimeoutMs()).toBe(300000);
  });

  it('clamps to the 300000ms ceiling', () => {
    process.env.WEBSITE_RENDER_TIMEOUT_MS = '999999';
    expect(websiteRenderTimeoutMs()).toBe(300000);
  });

  it('clamps to the 30000ms floor', () => {
    process.env.WEBSITE_RENDER_TIMEOUT_MS = '1000';
    expect(websiteRenderTimeoutMs()).toBe(30000);
  });

  it('falls back to the default for non-numeric / non-positive values', () => {
    process.env.WEBSITE_RENDER_TIMEOUT_MS = 'not-a-number';
    expect(websiteRenderTimeoutMs()).toBe(240000);
    process.env.WEBSITE_RENDER_TIMEOUT_MS = '0';
    expect(websiteRenderTimeoutMs()).toBe(240000);
  });
});
