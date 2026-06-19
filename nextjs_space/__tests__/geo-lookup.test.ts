/**
 * Tests for lib/rss/geo-lookup.ts
 *
 * These are unit tests for the normalize helpers (pure functions)
 * and integration-style tests for the DB-backed lookup & FIPS functions.
 *
 * Run:  cd nextjs_space && npx jest __tests__/geo-lookup.test.ts
 *       (requires DATABASE_URL in .env or environment)
 */
import {
  normalizeZip,
  normalizeCity,
  normalizeCounty,
} from '../lib/rss/geo-lookup';

// ── Pure helpers (no DB needed) ──────────────────────────────────────────

describe('normalizeZip', () => {
  it('pads a short numeric string with leading zeros', () => {
    expect(normalizeZip('501')).toBe('00501');
    expect(normalizeZip('7087')).toBe('07087');
  });

  it('preserves a full 5-digit ZIP', () => {
    expect(normalizeZip('80903')).toBe('80903');
    expect(normalizeZip('00501')).toBe('00501');
  });

  it('handles numeric input', () => {
    expect(normalizeZip(501)).toBe('00501');
    expect(normalizeZip(80903)).toBe('80903');
  });

  it('trims whitespace', () => {
    expect(normalizeZip('  07087 ')).toBe('07087');
  });

  it('truncates to 5 chars if longer', () => {
    expect(normalizeZip('809031234')).toBe('80903');
  });
});

describe('normalizeCity', () => {
  it('uppercases and trims', () => {
    expect(normalizeCity('  Buffalo  ')).toBe('BUFFALO');
    expect(normalizeCity('new york')).toBe('NEW YORK');
  });
});

describe('normalizeCounty', () => {
  it('uppercases and trims', () => {
    expect(normalizeCounty(' Erie ')).toBe('ERIE');
    expect(normalizeCounty('el paso')).toBe('EL PASO');
  });
});
