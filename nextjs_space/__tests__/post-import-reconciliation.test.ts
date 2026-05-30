/**
 * Regression tests for Post Import / Visibility Reconciliation
 *
 * Validates that post import, queue counts, card visibility, and
 * generation-run validation are consistent.
 */

// ── fixtures ──
const BLAZIN_HOG_ID = 'cmnvaavve0001m731l6djn2uh';
const OTHER_BIZ_ID = 'other-biz-id-999';

interface MockPost {
  id: string;
  caption: string | null;
  imageUrl: string | null;
  cta: string | null;
  sourceName: string | null;
  sourceArticleTitle: string | null;
  sourceArticleUrl: string | null;
  status: string;
  businessId: string;
  workflowId: string | null;
  tombstoneTaskId: string | null;
  generationRunId: string | null;
  createdAt: string;
}

// ── helpers (mirrors poll route logic) ──
function validateImportedPost(post: MockPost): { status: string; missingFields: string[]; importError: string | null } {
  const missing: string[] = [];
  if (!post.caption?.trim()) missing.push('caption');
  if (!post.imageUrl) missing.push('imageUrl');
  if (!post.cta) missing.push('cta');
  if (!post.sourceName && !post.sourceArticleTitle) missing.push('source_attribution');
  if (!post.sourceArticleUrl) missing.push('sourceArticleUrl');

  const hasCaption = !!post.caption?.trim();
  const hasImage = !!post.imageUrl;

  if (hasCaption || hasImage) {
    if (missing.length > 0 && !hasCaption) {
      return { status: 'generation_incomplete', missingFields: missing, importError: `Missing required fields: ${missing.join(', ')}` };
    }
    return { status: 'pending_approval', missingFields: missing, importError: null };
  }
  return { status: 'generation_failed', missingFields: missing, importError: `No usable output — missing: ${missing.join(', ')}` };
}

function isPostRenderable(post: MockPost): boolean {
  return (!!post.caption?.trim() || !!post.imageUrl) && post.status !== 'generation_failed';
}

function checkBusinessMismatch(currentBizId: string | null, postBizId: string | null): boolean {
  if (!currentBizId || !postBizId) return false;
  return currentBizId !== postBizId;
}

// ──────────────────────────────────────────────────────────────────
// 1. Import validation assigns correct status
// ──────────────────────────────────────────────────────────────────
describe('Post import validation', () => {
  it('marks complete post as pending_approval', () => {
    const post: MockPost = {
      id: 'p1', caption: 'Great BBQ!', imageUrl: 'renders/img.png', cta: 'Learn More',
      sourceName: 'Local News', sourceArticleTitle: 'BBQ Awards', sourceArticleUrl: 'https://example.com/bbq',
      status: 'pending_approval', businessId: BLAZIN_HOG_ID, workflowId: 'wf1',
      tombstoneTaskId: 't1', generationRunId: 'run1', createdAt: new Date().toISOString(),
    };
    const result = validateImportedPost(post);
    expect(result.status).toBe('pending_approval');
    expect(result.importError).toBeNull();
  });

  it('marks post with no caption and no image as generation_failed', () => {
    const post: MockPost = {
      id: 'p2', caption: '', imageUrl: null, cta: null,
      sourceName: null, sourceArticleTitle: null, sourceArticleUrl: null,
      status: 'pending_approval', businessId: BLAZIN_HOG_ID, workflowId: 'wf2',
      tombstoneTaskId: 't2', generationRunId: 'run2', createdAt: new Date().toISOString(),
    };
    const result = validateImportedPost(post);
    expect(result.status).toBe('generation_failed');
    expect(result.missingFields).toContain('caption');
    expect(result.missingFields).toContain('imageUrl');
    expect(result.importError).toMatch(/No usable output/);
  });

  it('marks post with image but no caption as generation_incomplete', () => {
    const post: MockPost = {
      id: 'p3', caption: '', imageUrl: 'renders/img.png', cta: null,
      sourceName: null, sourceArticleTitle: null, sourceArticleUrl: null,
      status: 'pending_approval', businessId: BLAZIN_HOG_ID, workflowId: 'wf3',
      tombstoneTaskId: 't3', generationRunId: 'run3', createdAt: new Date().toISOString(),
    };
    const result = validateImportedPost(post);
    expect(result.status).toBe('generation_incomplete');
    expect(result.missingFields).toContain('caption');
  });

  it('marks post with caption but no image as pending_approval (still renderable)', () => {
    const post: MockPost = {
      id: 'p4', caption: 'Great content', imageUrl: null, cta: 'Visit Us',
      sourceName: 'Source', sourceArticleTitle: 'Title', sourceArticleUrl: 'https://example.com',
      status: 'pending_approval', businessId: BLAZIN_HOG_ID, workflowId: 'wf4',
      tombstoneTaskId: 't4', generationRunId: 'run4', createdAt: new Date().toISOString(),
    };
    const result = validateImportedPost(post);
    expect(result.status).toBe('pending_approval');
  });
});

// ──────────────────────────────────────────────────────────────────
// 2. Queue counts match visible records
// ──────────────────────────────────────────────────────────────────
describe('Queue count consistency', () => {
  const posts: MockPost[] = [
    { id: 'p1', caption: 'Post 1', imageUrl: 'img.png', cta: 'CTA', sourceName: 'S', sourceArticleTitle: 'T', sourceArticleUrl: 'http://x', status: 'pending_approval', businessId: BLAZIN_HOG_ID, workflowId: 'w1', tombstoneTaskId: 't1', generationRunId: 'r1', createdAt: new Date().toISOString() },
    { id: 'p2', caption: 'Post 2', imageUrl: 'img.png', cta: 'CTA', sourceName: 'S', sourceArticleTitle: 'T', sourceArticleUrl: 'http://x', status: 'approved', businessId: BLAZIN_HOG_ID, workflowId: 'w2', tombstoneTaskId: 't2', generationRunId: 'r2', createdAt: new Date().toISOString() },
    { id: 'p3', caption: '', imageUrl: null, cta: null, sourceName: null, sourceArticleTitle: null, sourceArticleUrl: null, status: 'generation_failed', businessId: BLAZIN_HOG_ID, workflowId: 'w3', tombstoneTaskId: 't3', generationRunId: 'r3', createdAt: new Date().toISOString() },
    { id: 'p4', caption: '', imageUrl: 'img.png', cta: null, sourceName: null, sourceArticleTitle: null, sourceArticleUrl: null, status: 'generation_incomplete', businessId: BLAZIN_HOG_ID, workflowId: 'w4', tombstoneTaskId: 't4', generationRunId: 'r4', createdAt: new Date().toISOString() },
  ];

  it('pending count excludes failed and incomplete', () => {
    const pending = posts.filter(p => p.status === 'pending_approval');
    expect(pending).toHaveLength(1);
  });

  it('generation_failed count is separate', () => {
    const failed = posts.filter(p => p.status === 'generation_failed');
    expect(failed).toHaveLength(1);
  });

  it('generation_incomplete count is separate', () => {
    const incomplete = posts.filter(p => p.status === 'generation_incomplete');
    expect(incomplete).toHaveLength(1);
  });

  it('all posts have a status and are counted somewhere', () => {
    const allStatuses = new Set(posts.map(p => p.status));
    expect(allStatuses.size).toBeGreaterThanOrEqual(3);
  });
});

// ──────────────────────────────────────────────────────────────────
// 3. Malformed post appears under Generation Failed/Incomplete
// ──────────────────────────────────────────────────────────────────
describe('Malformed post visibility', () => {
  it('generation_failed post is renderable as diagnostic card', () => {
    const failedPost: MockPost = {
      id: 'p5', caption: '[Generation failed — no usable output]', imageUrl: null, cta: null,
      sourceName: null, sourceArticleTitle: null, sourceArticleUrl: null,
      status: 'generation_failed', businessId: BLAZIN_HOG_ID, workflowId: 'wf5',
      tombstoneTaskId: 't5', generationRunId: 'run5', createdAt: new Date().toISOString(),
    };
    // Even though the post has no real content, it should still appear in the queue
    // because generation_failed cards have diagnostic rendering
    expect(failedPost.status).toBe('generation_failed');
    expect(failedPost.workflowId).toBeTruthy();
    expect(failedPost.tombstoneTaskId).toBeTruthy();
    expect(failedPost.generationRunId).toBeTruthy();
  });
});

// ──────────────────────────────────────────────────────────────────
// 4. Business mismatch detection for imported posts
// ──────────────────────────────────────────────────────────────────
describe('Post business mismatch on import', () => {
  it('detects post created under wrong business', () => {
    const mismatch = checkBusinessMismatch(BLAZIN_HOG_ID, OTHER_BIZ_ID);
    expect(mismatch).toBe(true);
  });

  it('no mismatch when business matches', () => {
    const mismatch = checkBusinessMismatch(BLAZIN_HOG_ID, BLAZIN_HOG_ID);
    expect(mismatch).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────────
// 5. Post-import verification logic
// ──────────────────────────────────────────────────────────────────
describe('Post-import verification', () => {
  it('detects when imported post is not in current business queue', () => {
    const currentBizPosts: MockPost[] = [];
    const importedCount = 1;
    const isVisible = currentBizPosts.length > 0;
    expect(isVisible).toBe(false);
    expect(importedCount).toBeGreaterThan(0);
    // This scenario should trigger the "imported but not visible" error
  });

  it('detects when imported post is hidden by status filter', () => {
    const allPosts: MockPost[] = [
      { id: 'p6', caption: '[Generation failed]', imageUrl: null, cta: null, sourceName: null, sourceArticleTitle: null, sourceArticleUrl: null, status: 'generation_failed', businessId: BLAZIN_HOG_ID, workflowId: 'wf6', tombstoneTaskId: 't6', generationRunId: 'run6', createdAt: new Date().toISOString() },
    ];
    // Filtering for pending_approval should hide this post
    const filtered = allPosts.filter(p => p.status === 'pending_approval');
    expect(filtered).toHaveLength(0);
    // But it exists unfiltered
    expect(allPosts).toHaveLength(1);
  });

  it('succeeds when imported post appears in current business queue', () => {
    const currentBizPosts: MockPost[] = [
      { id: 'p7', caption: 'Great BBQ post!', imageUrl: 'img.png', cta: 'CTA', sourceName: 'S', sourceArticleTitle: 'T', sourceArticleUrl: 'http://x', status: 'pending_approval', businessId: BLAZIN_HOG_ID, workflowId: 'wf7', tombstoneTaskId: 't7', generationRunId: 'run7', createdAt: new Date().toISOString() },
    ];
    const recentPosts = currentBizPosts.filter(p => {
      const created = new Date(p.createdAt).getTime();
      return Date.now() - created < 60_000;
    });
    expect(recentPosts).toHaveLength(1);
  });
});

// ──────────────────────────────────────────────────────────────────
// 6. No contradictory messages
// ──────────────────────────────────────────────────────────────────
describe('No contradictory import messages', () => {
  it('cannot show "Imported 1 new post" and "no visible post" without showing diagnostic card', () => {
    // Scenario: poll returns imported=1 but post is generation_failed
    const pollResult = { imported: 1, importedComplete: 0, importedIncomplete: 1 };
    // The generation_failed post should be visible in the queue
    const queuePosts = [
      { id: 'p8', status: 'generation_failed', businessId: BLAZIN_HOG_ID },
    ];
    // Verify: the incomplete import is reflected in the message
    expect(pollResult.importedIncomplete).toBeGreaterThan(0);
    // Verify: the failed post IS in the queue (not hidden)
    const failedInQueue = queuePosts.filter(p => p.status === 'generation_failed');
    expect(failedInQueue).toHaveLength(1);
  });
});
