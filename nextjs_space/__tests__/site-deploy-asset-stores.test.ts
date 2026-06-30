/**
 * Phase 4 — R2 asset-store + Cloudflare Pages readiness safety tests.
 *
 * Verifies the readiness layer surfaces ONLY bucket names + presence booleans
 * and NEVER leaks a credential/token value, regardless of env contents.
 */

import {
  getAssetStoreReadiness,
  getCloudflareReadiness,
  getDeploymentAssetReadiness,
  TOMBSTONE_R2_GENERATED_BUCKET_DEFAULT,
  TOMBSTONE_R2_CUSTOMER_ASSETS_BUCKET_DEFAULT,
} from '@/lib/site-deploy/asset-store-config';

// Assemble fake secret-looking values from fragments so the secret/url rewriter
// never substitutes them and they are obviously not real credentials.
const FAKE_CF_TOKEN = 'cf' + '_' + 'A'.repeat(40);
const FAKE_R2_KEY = 'R2' + 'ACCESSKEY' + '1234567890';
const FAKE_R2_SECRET = 's3cr3t' + '_' + 'X'.repeat(30);

const R2_ENV_KEYS = [
  'TOMBSTONE_R2_GENERATED_BUCKET',
  'TOMBSTONE_R2_CUSTOMER_ASSETS_BUCKET',
  'TOMBSTONE_R2_ENDPOINT',
  'R2_ENDPOINT',
  'AWS_ENDPOINT',
  'S3_ENDPOINT',
  'TOMBSTONE_R2_ACCOUNT_ID',
  'R2_ACCOUNT_ID',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_PROFILE',
  'AWS_BUCKET_NAME',
];
const CF_ENV_KEYS = [
  'CLOUDFLARE_ACCOUNT_ID',
  'CLOUDFLARE_PAGES_API_TOKEN',
  'CLOUDFLARE_DNS_API_TOKEN',
  'CLOUDFLARE_DEFAULT_ZONE_ID',
];

let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved = {};
  for (const k of [...R2_ENV_KEYS, ...CF_ENV_KEYS]) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of Object.keys(saved)) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe('getAssetStoreReadiness', () => {
  it('falls back to canonical bucket names and marks unconfigured when env unset', () => {
    const r = getAssetStoreReadiness();
    expect(r.generatedBucket.name).toBe(TOMBSTONE_R2_GENERATED_BUCKET_DEFAULT);
    expect(r.generatedBucket.configured).toBe(false);
    expect(r.customerAssetsBucket.name).toBe(TOMBSTONE_R2_CUSTOMER_ASSETS_BUCKET_DEFAULT);
    expect(r.customerAssetsBucket.configured).toBe(false);
    expect(r.r2Endpoint.configured).toBe(false);
    expect(r.r2Account.configured).toBe(false);
    expect(r.r2Credential.configured).toBe(false);
  });

  it('reports configured buckets with their explicit names', () => {
    process.env.TOMBSTONE_R2_GENERATED_BUCKET = 'tombstoner2';
    process.env.TOMBSTONE_R2_CUSTOMER_ASSETS_BUCKET = 'tombstoner2customerassets';
    const r = getAssetStoreReadiness();
    expect(r.generatedBucket).toEqual({ name: 'tombstoner2', configured: true });
    expect(r.customerAssetsBucket).toEqual({ name: 'tombstoner2customerassets', configured: true });
  });

  it('treats an AWS profile / bucket as a valid existing credential path', () => {
    process.env.AWS_PROFILE = 'hosted_storage';
    process.env.AWS_BUCKET_NAME = 'some-bucket';
    expect(getAssetStoreReadiness().r2Credential.configured).toBe(true);
  });

  it('exposes only the endpoint HOST, never a full url with query/credentials', () => {
    process.env.TOMBSTONE_R2_ENDPOINT =
      'https://acct123.r2.cloudflarestorage.com/bucket?X-Amz-Signature=' + FAKE_R2_SECRET;
    const r = getAssetStoreReadiness();
    expect(r.r2Endpoint.configured).toBe(true);
    expect(r.r2Endpoint.host).toBe('acct123.r2.cloudflarestorage.com');
    expect(r.r2Endpoint.host).not.toContain('?');
    expect(r.r2Endpoint.host).not.toContain(FAKE_R2_SECRET);
  });

  it('NEVER returns a raw credential value anywhere in the payload', () => {
    process.env.R2_ACCESS_KEY_ID = FAKE_R2_KEY;
    process.env.R2_SECRET_ACCESS_KEY = FAKE_R2_SECRET;
    process.env.TOMBSTONE_R2_ACCOUNT_ID = 'acct123';
    const serialized = JSON.stringify(getAssetStoreReadiness());
    expect(serialized).not.toContain(FAKE_R2_KEY);
    expect(serialized).not.toContain(FAKE_R2_SECRET);
    // Presence is still reported.
    expect(getAssetStoreReadiness().r2Credential.configured).toBe(true);
    expect(getAssetStoreReadiness().r2Account.configured).toBe(true);
  });
});

describe('getCloudflareReadiness', () => {
  it('is not ready and lists all missing refs when nothing is set', () => {
    const c = getCloudflareReadiness();
    expect(c.ready).toBe(false);
    expect(c.accountId.configured).toBe(false);
    expect(c.pagesApiToken.configured).toBe(false);
    expect(c.dnsApiToken.configured).toBe(false);
    expect(c.defaultZoneId.configured).toBe(false);
    expect(c.missing).toEqual([
      'CLOUDFLARE_ACCOUNT_ID',
      'CLOUDFLARE_PAGES_API_TOKEN',
      'CLOUDFLARE_DNS_API_TOKEN',
    ]);
  });

  it('is ready when account id + pages token are present', () => {
    process.env.CLOUDFLARE_ACCOUNT_ID = 'acct123';
    process.env.CLOUDFLARE_PAGES_API_TOKEN = FAKE_CF_TOKEN;
    const c = getCloudflareReadiness();
    expect(c.ready).toBe(true);
    expect(c.accountId.configured).toBe(true);
    expect(c.pagesApiToken.configured).toBe(true);
    expect(c.missing).toEqual(['CLOUDFLARE_DNS_API_TOKEN']);
  });

  it('NEVER returns the token values', () => {
    process.env.CLOUDFLARE_ACCOUNT_ID = 'acct123';
    process.env.CLOUDFLARE_PAGES_API_TOKEN = FAKE_CF_TOKEN;
    process.env.CLOUDFLARE_DNS_API_TOKEN = FAKE_CF_TOKEN;
    const serialized = JSON.stringify(getCloudflareReadiness());
    expect(serialized).not.toContain(FAKE_CF_TOKEN);
  });

  it('treats the optional default zone id as non-blocking for readiness', () => {
    process.env.CLOUDFLARE_ACCOUNT_ID = 'acct123';
    process.env.CLOUDFLARE_PAGES_API_TOKEN = FAKE_CF_TOKEN;
    process.env.CLOUDFLARE_DNS_API_TOKEN = FAKE_CF_TOKEN;
    // No default zone id.
    const c = getCloudflareReadiness();
    expect(c.ready).toBe(true);
    expect(c.defaultZoneId.configured).toBe(false);
    expect(c.missing).toEqual([]);
  });
});

describe('getDeploymentAssetReadiness', () => {
  it('always reports liveDeployEnabled=false and bundles both readiness blocks', () => {
    const all = getDeploymentAssetReadiness();
    expect(all.liveDeployEnabled).toBe(false);
    expect(all.assetStores).toBeDefined();
    expect(all.cloudflare).toBeDefined();
  });
});
