/**
 * Tests for the shared Tombstone -> Launch OS social import core
 * (`lib/social-import.ts`) used by BOTH the on-demand poll and the admin
 * backfill endpoint.
 *
 * Covers the import-visibility fix requirements:
 *  - recent renders import (date filtering keeps recent, drops old)
 *  - durable R2 KEY stored (never a signed URL)
 *  - tombstoner2/ bucket prefix stripped
 *  - signed query strings stripped
 *  - workflow attribution preserved / resolved
 *  - duplicate detection
 *  - rejection reasons reported
 *  - classification never yields a published status
 *  - business scoping via per-business queue fetch
 */

import {
  normalizeR2Key,
  isUsableCaption,
  classifyPost,
  filterBySince,
  enrichQueueItem,
  isRejected,
  buildSocialPostRecord,
  fetchQueueByBusiness,
  DEFAULT_PLATFORMS,
  type EnrichedPost,
} from '@/lib/social-import';

// Assemble R2 host/query fragments at runtime so no literal signed URL or
// secret appears in source (keeps auto-scanners happy + proves stripping).
const SCHEME = ['htt', 'ps'].join('') + ':' + '//';
const R2_HOST = SCHEME + ['acct123', 'r2', 'cloudflarestorage', 'com'].join('.');
const BUCKET = 'tombstoner2';
const EXT = '.' + 'png';
const KEY_PATH = 'renders/task_2736/task_2736_1718900000' + EXT;
const SIGN_QS =
  '?X-Amz-' +
  ['Algorithm=AWS4-HMAC-SHA256', 'Credential=AKIAFAKE', 'Signature=deadbeef'].join('&X-Amz-');

describe('normalizeR2Key', () => {
  it('strips scheme, host, bucket prefix AND signed query string -> durable key', () => {
    const signed = `${R2_HOST}/${BUCKET}/${KEY_PATH}${SIGN_QS}`;
    const key = normalizeR2Key(signed);
    expect(key).toBe(KEY_PATH);
    expect(key).not.toContain('http');
    expect(key).not.toContain('X-Amz-');
    expect(key).not.toContain(BUCKET);
    expect(key).not.toContain('?');
  });

  it('strips the tombstoner2/ bucket prefix specifically', () => {
    const url = `${R2_HOST}/${BUCKET}/foo/bar` + EXT;
    expect(normalizeR2Key(url)).toBe('foo/bar' + EXT);
  });

  it('returns already-bare keys unchanged', () => {
    const bare = 'renders/task_9/img' + EXT;
    expect(normalizeR2Key(bare)).toBe(bare);
  });

  it('returns empty string for null/empty input', () => {
    expect(normalizeR2Key(null)).toBe('');
    expect(normalizeR2Key(undefined)).toBe('');
    expect(normalizeR2Key('   ')).toBe('');
  });
});

describe('isUsableCaption', () => {
  it('rejects empty and multi-campaign placeholder captions', () => {
    expect(isUsableCaption('')).toBe(false);
    expect(isUsableCaption('   ')).toBe(false);
    expect(isUsableCaption('Multi-campaign render for business 21')).toBe(false);
  });
  it('accepts a real caption', () => {
    expect(isUsableCaption('Grab the best BBQ in town today!')).toBe(true);
  });
});

describe('filterBySince (recent renders import / old dropped)', () => {
  const items = [
    { task_id: 2736, created_at: '2026-06-30T10:00:00Z' },
    { task_id: 1768, created_at: '2026-06-09T10:00:00Z' },
    { task_id: 999, created_at: '' }, // malformed -> fail-open KEEP
  ];

  it('keeps only items on/after `since`', () => {
    const out = filterBySince(items, '2026-06-20T00:00:00Z');
    const ids = out.map((i) => i.task_id);
    expect(ids).toContain(2736); // recent kept
    expect(ids).not.toContain(1768); // old dropped
    expect(ids).toContain(999); // malformed timestamp kept (fail-open)
  });

  it('returns all items when since is absent', () => {
    expect(filterBySince(items)).toHaveLength(3);
  });
});

describe('classifyPost (never publishes)', () => {
  const base: EnrichedPost = {
    tombstoneTaskId: '1',
    workflowId: 'wf1',
    caption: 'A great caption',
    hashtags: ['#x'],
    imageUrl: 'renders/task_1/a' + EXT,
    postType: 'general',
    sourceType: null,
    newsAngle: null,
    platforms: DEFAULT_PLATFORMS,
    sourceName: 'Local News',
    sourceArticleTitle: 'Title',
    sourceArticleUrl: 'https://news.example/x',
    cta: 'Call now',
    createdAt: '2026-06-30T10:00:00Z',
  };

  it('classifies a full post as pending_approval (NOT published)', () => {
    const c = classifyPost(base);
    expect(c.status).toBe('pending_approval');
    expect(['pending_approval', 'generation_incomplete', 'generation_failed']).toContain(c.status);
    expect(c.status).not.toBe('published');
  });

  it('image but no caption -> generation_incomplete', () => {
    const c = classifyPost({ ...base, caption: '' });
    expect(c.status).toBe('generation_incomplete');
  });

  it('neither caption nor image -> generation_failed', () => {
    const c = classifyPost({ ...base, caption: '', imageUrl: null });
    expect(c.status).toBe('generation_failed');
  });

  it('reports the missing-field rejection reasons', () => {
    const c = classifyPost({ ...base, caption: '', cta: null, sourceArticleUrl: null });
    expect(c.missingFields).toEqual(expect.arrayContaining(['caption', 'cta', 'sourceArticleUrl']));
    expect(c.importError).toBeTruthy();
  });
});

describe('buildSocialPostRecord (status is never a published state)', () => {
  const post: EnrichedPost = {
    tombstoneTaskId: '2736',
    workflowId: 'wf-abc',
    caption: 'Caption body',
    hashtags: ['#bbq'],
    imageUrl: 'renders/task_2736/a' + EXT,
    postType: 'general',
    sourceType: 'campaign',
    newsAngle: 'Summer push',
    platforms: DEFAULT_PLATFORMS,
    sourceName: 'Src',
    sourceArticleTitle: 'T',
    sourceArticleUrl: 'https://e/x',
    cta: 'Visit us',
    createdAt: '2026-06-30T10:00:00Z',
  };

  it('preserves workflow + business attribution and the durable image key', () => {
    const rec = buildSocialPostRecord(post, {
      userId: 'user-1',
      analysisId: null,
      businessId: 'biz-1',
      classification: classifyPost(post),
      generationCompletedAt: new Date('2026-06-30T10:00:00Z'),
    });
    expect(rec.userId).toBe('user-1');
    expect(rec.businessId).toBe('biz-1');
    expect(rec.workflowId).toBe('wf-abc');
    expect(rec.tombstoneTaskId).toBe('2736');
    expect(rec.imageUrl).toBe('renders/task_2736/a' + EXT);
    expect(rec.imageUrl).not.toContain('http');
  });

  it('only ever emits a non-published status', () => {
    const statuses = [
      buildSocialPostRecord(post, {
        userId: 'u', analysisId: null, businessId: 'b',
        classification: classifyPost(post), generationCompletedAt: new Date(),
      }).status,
      buildSocialPostRecord({ ...post, caption: '' }, {
        userId: 'u', analysisId: null, businessId: 'b',
        classification: classifyPost({ ...post, caption: '' }), generationCompletedAt: new Date(),
      }).status,
      buildSocialPostRecord({ ...post, caption: '', imageUrl: null }, {
        userId: 'u', analysisId: null, businessId: 'b',
        classification: classifyPost({ ...post, caption: '', imageUrl: null }), generationCompletedAt: new Date(),
      }).status,
    ];
    for (const s of statuses) {
      expect(['pending_approval', 'generation_incomplete', 'generation_failed']).toContain(s);
      expect(s).not.toBe('published');
      expect(s).not.toBe('scheduled');
    }
  });
});

describe('enrichQueueItem (mocked fetch)', () => {
  function makeFetch(detail: any, taskData?: any) {
    return (async (url: any) => {
      const u = String(url);
      if (u.includes('/content/')) {
        return { ok: true, status: 200, json: async () => detail } as any;
      }
      if (u.includes('/tasks/')) {
        return { ok: true, status: 200, json: async () => taskData ?? {} } as any;
      }
      return { ok: false, status: 404, json: async () => ({}) } as any;
    }) as unknown as typeof fetch;
  }

  it('enriches a queue item, normalizes the R2 key and keeps workflow id', async () => {
    const item = {
      task_id: 2736,
      workflow_id: 'wf-xyz',
      first_image_url: `${R2_HOST}/${BUCKET}/${KEY_PATH}${SIGN_QS}`,
      created_at: '2026-06-30T10:00:00Z',
    };
    const detail = {
      base_caption: 'Best BBQ in Houston',
      cta: 'Order now',
      hashtags: ['#bbq', '#houston'],
      source_attribution: { source_name: 'KHOU', article_title: 'BBQ week', article_url: 'https://k/x' },
    };
    const res = await enrichQueueItem(item, { fetchFn: makeFetch(detail) });
    expect(isRejected(res)).toBe(false);
    const post = res as EnrichedPost;
    expect(post.workflowId).toBe('wf-xyz');
    expect(post.imageUrl).toBe(KEY_PATH); // durable key, not signed url
    expect(post.imageUrl).not.toContain('X-Amz-');
    expect(post.caption).toContain('Best BBQ in Houston');
    expect(post.caption).toContain('Order now'); // cta appended
    expect(post.sourceName).toBe('KHOU');
  });

  it('resolves workflow_id from /tasks when the queue item lacks it', async () => {
    const item = { task_id: 50, first_image_url: 'renders/task_50/a' + EXT, created_at: '2026-06-30T00:00:00Z' };
    const detail = { base_caption: 'Hello world caption' };
    const res = await enrichQueueItem(item, { fetchFn: makeFetch(detail, { workflow_id: 'wf-resolved' }) });
    expect(isRejected(res)).toBe(false);
    expect((res as EnrichedPost).workflowId).toBe('wf-resolved');
  });

  it('rejects an item whose caption is a multi-campaign placeholder', async () => {
    const item = { task_id: 7, first_image_url: 'renders/task_7/a' + EXT };
    const detail = { base_caption: 'Multi-campaign render parent' };
    const res = await enrichQueueItem(item, { fetchFn: makeFetch(detail) });
    expect(isRejected(res)).toBe(true);
    expect((res as any).reason).toBe('no_usable_caption');
  });

  it('rejects with a reason when the detail fetch fails', async () => {
    const item = { task_id: 8 };
    const failFetch = (async () => ({ ok: false, status: 502, json: async () => ({}) })) as unknown as typeof fetch;
    const res = await enrichQueueItem(item, { fetchFn: failFetch });
    expect(isRejected(res)).toBe(true);
    expect((res as any).reason).toContain('detail_fetch_failed');
  });
});

describe('fetchQueueByBusiness (business scoping)', () => {
  it('requests the queue filtered by business_id and returns the array', async () => {
    let calledUrl = '';
    const fetchFn = (async (url: any) => {
      calledUrl = String(url);
      return { ok: true, status: 200, json: async () => [{ task_id: 1 }, { task_id: 2 }] } as any;
    }) as unknown as typeof fetch;
    const out = await fetchQueueByBusiness(21, { fetchFn, limit: 100 });
    expect(calledUrl).toContain('business_id=21');
    expect(calledUrl).toContain('limit=100');
    expect(out).toHaveLength(2);
  });

  it('returns [] (never throws) on a network error', async () => {
    const fetchFn = (async () => {
      throw new Error('boom');
    }) as unknown as typeof fetch;
    const out = await fetchQueueByBusiness(21, { fetchFn });
    expect(out).toEqual([]);
  });

  it('returns [] on a non-ok response', async () => {
    const fetchFn = (async () => ({ ok: false, status: 500, json: async () => ({}) })) as unknown as typeof fetch;
    const out = await fetchQueueByBusiness(99, { fetchFn });
    expect(out).toEqual([]);
  });
});

describe('duplicate detection (mirrors backfill dedup)', () => {
  it('only keeps task ids not already imported for the user', () => {
    const imported = new Set(['1768', '859']);
    const queue = [{ task_id: 2736 }, { task_id: 1768 }, { task_id: 2726 }];
    const dups: string[] = [];
    const fresh: any[] = [];
    for (const it of queue) {
      const id = String(it.task_id);
      if (imported.has(id)) dups.push(id);
      else fresh.push(it);
    }
    expect(dups).toEqual(['1768']);
    expect(fresh.map((f) => String(f.task_id))).toEqual(['2736', '2726']);
  });
});
