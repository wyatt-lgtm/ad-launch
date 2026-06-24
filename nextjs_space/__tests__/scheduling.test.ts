/**
 * Tests for the scheduling utility module.
 * Covers schedule generation, cadence mapping, status labels,
 * business type → goal defaults, and schedule data building.
 */

import {
  generateRecommendedSchedule,
  buildScheduledPostsData,
  getNextAvailableSlots,
  getDefaultGoalForBusinessType,
  getStatusLabel,
  getPlatformLabel,
  getCadenceLabel,
  formatScheduleDate,
  POSTING_GOALS,
  APPROVAL_MODES,
  CADENCE_CONFIG,
  STATUS_LABELS,
  PLATFORM_CONFIG,
  type ScheduledPostInput,
  type Cadence,
  type ApprovalMode,
  type PostingGoal,
  type ScheduledPostStatus,
} from '@/lib/scheduling-utils';

describe('Scheduling Utils', () => {
  // ─── Constants / Config ──────────────────────────────

  describe('POSTING_GOALS', () => {
    test('has all 6 goals', () => {
      const goals: PostingGoal[] = ['more_calls', 'website_visits', 'reviews', 'repeat_customers', 'brand_awareness', 'recruiting'];
      for (const g of goals) {
        expect(POSTING_GOALS[g]).toBeDefined();
        expect(POSTING_GOALS[g].label).toBeTruthy();
        expect(POSTING_GOALS[g].description).toBeTruthy();
      }
    });
  });

  describe('APPROVAL_MODES', () => {
    test('has 3 modes with correct recommended/disabled flags', () => {
      expect(APPROVAL_MODES.review_first.recommended).toBe(false);
      expect(APPROVAL_MODES.review_first.disabled).toBe(false);
      expect(APPROVAL_MODES.auto_after_approval.recommended).toBe(true);
      expect(APPROVAL_MODES.auto_after_approval.disabled).toBe(false);
      expect(APPROVAL_MODES.full_autopilot.disabled).toBe(true);
    });
  });

  describe('CADENCE_CONFIG', () => {
    test('light = 2/wk, standard = 3/wk, growth = 5/wk', () => {
      expect(CADENCE_CONFIG.light.postsPerWeek).toBe(2);
      expect(CADENCE_CONFIG.standard.postsPerWeek).toBe(3);
      expect(CADENCE_CONFIG.growth.postsPerWeek).toBe(5);
    });

    test('standard slots are Tue 9AM, Thu 11:30AM, Sat 8:45AM', () => {
      const slots = CADENCE_CONFIG.standard.slots;
      expect(slots).toHaveLength(3);
      expect(slots[0]).toMatchObject({ dayOfWeek: 2, time: '09:00' });
      expect(slots[1]).toMatchObject({ dayOfWeek: 4, time: '11:30' });
      expect(slots[2]).toMatchObject({ dayOfWeek: 6, time: '08:45' });
    });

    test('custom cadence has 0 posts/week and empty slots', () => {
      expect(CADENCE_CONFIG.custom.postsPerWeek).toBe(0);
      expect(CADENCE_CONFIG.custom.slots).toHaveLength(0);
    });
  });

  describe('STATUS_LABELS', () => {
    test('all 9 statuses have customer-facing labels', () => {
      const statuses: ScheduledPostStatus[] = [
        'draft', 'needs_approval', 'approved', 'scheduled',
        'publishing', 'published', 'failed', 'paused', 'revision_requested',
      ];
      for (const s of statuses) {
        expect(STATUS_LABELS[s]).toBeDefined();
        expect(STATUS_LABELS[s].label).toBeTruthy();
        expect(STATUS_LABELS[s].color).toBeTruthy();
        expect(STATUS_LABELS[s].bgColor).toBeTruthy();
      }
    });

    test('approved shows "Ready"', () => {
      expect(STATUS_LABELS.approved.label).toBe('Ready');
    });

    test('failed shows "Needs Attention"', () => {
      expect(STATUS_LABELS.failed.label).toBe('Needs Attention');
    });
  });

  describe('PLATFORM_CONFIG', () => {
    test('facebook and google_business are recommended', () => {
      expect(PLATFORM_CONFIG.facebook.recommended).toBe(true);
      expect(PLATFORM_CONFIG.google_business.recommended).toBe(true);
    });

    test('tiktok is coming soon', () => {
      expect(PLATFORM_CONFIG.tiktok.comingSoon).toBe(true);
    });
  });

  // ─── Business Type → Goal ───────────────────────────

  describe('getDefaultGoalForBusinessType', () => {
    test('auto_repair → more_calls', () => {
      expect(getDefaultGoalForBusinessType('auto_repair')).toBe('more_calls');
    });

    test('restaurant → repeat_customers', () => {
      expect(getDefaultGoalForBusinessType('restaurant')).toBe('repeat_customers');
    });

    test('b2b → website_visits', () => {
      expect(getDefaultGoalForBusinessType('b2b')).toBe('website_visits');
    });

    test('unknown type → brand_awareness fallback', () => {
      expect(getDefaultGoalForBusinessType('underwater_basket_weaving')).toBe('brand_awareness');
    });

    test('undefined → brand_awareness', () => {
      expect(getDefaultGoalForBusinessType()).toBe('brand_awareness');
    });

    test('handles spaces and hyphens', () => {
      expect(getDefaultGoalForBusinessType('auto repair')).toBe('more_calls');
      expect(getDefaultGoalForBusinessType('auto-repair')).toBe('more_calls');
    });
  });

  // ─── Schedule Generation ───────────────────────────

  const mockPosts: ScheduledPostInput[] = [
    { socialPostId: '1', caption: 'Post 1', platforms: ['facebook'] },
    { socialPostId: '2', caption: 'Post 2', platforms: ['facebook'] },
    { socialPostId: '3', caption: 'Post 3', platforms: ['facebook'] },
  ];

  describe('generateRecommendedSchedule', () => {
    test('generates correct number of slots for standard cadence', () => {
      const schedule = generateRecommendedSchedule(mockPosts, 'standard');
      expect(schedule.length).toBe(3);
    });

    test('does not exceed post count', () => {
      const schedule = generateRecommendedSchedule([mockPosts[0]], 'growth');
      expect(schedule.length).toBe(1);
    });

    test('returns empty for custom cadence', () => {
      const schedule = generateRecommendedSchedule(mockPosts, 'custom');
      expect(schedule).toHaveLength(0);
    });

    test('all dates are in the future', () => {
      const now = new Date();
      const schedule = generateRecommendedSchedule(mockPosts, 'standard', now);
      for (const item of schedule) {
        expect(item.date.getTime()).toBeGreaterThan(now.getTime());
      }
    });

    test('each item has dayLabel and timeLabel', () => {
      const schedule = generateRecommendedSchedule(mockPosts, 'standard');
      for (const item of schedule) {
        expect(item.dayLabel).toBeTruthy();
        expect(item.timeLabel).toBeTruthy();
        expect(item.timeLabel).toMatch(/\d+:\d+ (AM|PM)/);
      }
    });
  });

  // ─── Build Scheduled Posts Data ────────────────────

  describe('buildScheduledPostsData', () => {
    test('review_first mode sets status to needs_approval', () => {
      const result = buildScheduledPostsData(
        mockPosts, 'standard', 'America/Denver', 'review_first', ['facebook']
      );
      for (const item of result) {
        expect(item.status).toBe('needs_approval');
        expect(item.approvalRequired).toBe(true);
      }
    });

    test('auto_after_approval mode sets status to needs_approval', () => {
      const result = buildScheduledPostsData(
        mockPosts, 'standard', 'America/Denver', 'auto_after_approval', ['facebook']
      );
      for (const item of result) {
        expect(item.status).toBe('needs_approval');
        expect(item.approvalRequired).toBe(true);
      }
    });

    test('full_autopilot mode sets status to scheduled', () => {
      const result = buildScheduledPostsData(
        mockPosts, 'standard', 'America/Denver', 'full_autopilot', ['facebook']
      );
      for (const item of result) {
        expect(item.status).toBe('scheduled');
        expect(item.approvalRequired).toBe(false);
      }
    });

    test('applies platform override when post has empty platforms', () => {
      const posts: ScheduledPostInput[] = [
        { socialPostId: '1', caption: 'Test', platforms: [] },
      ];
      const result = buildScheduledPostsData(
        posts, 'light', 'America/Denver', 'review_first', ['facebook', 'instagram']
      );
      expect(result[0].input.platforms).toEqual(['facebook', 'instagram']);
    });
  });

  // ─── Next Available Slots ───────────────────────────

  describe('getNextAvailableSlots', () => {
    test('returns requested number of slots', () => {
      const slots = getNextAvailableSlots('standard', [], 5);
      expect(slots.length).toBe(5);
    });

    test('skips dates that already have posts', () => {
      const baseSlots = getNextAvailableSlots('standard', [], 3);
      const existingDates = [baseSlots[0].date];
      const newSlots = getNextAvailableSlots('standard', existingDates, 3);
      // The first slot should be different since we excluded it
      expect(newSlots[0].date.getTime()).not.toBe(baseSlots[0].date.getTime());
    });
  });

  // ─── Helpers ───────────────────────────────────────

  describe('getStatusLabel', () => {
    test('returns correct label for known status', () => {
      expect(getStatusLabel('needs_approval').label).toBe('Needs Approval');
      expect(getStatusLabel('published').label).toBe('Published');
    });

    test('falls back to draft for unknown status', () => {
      expect(getStatusLabel('unknown_status').label).toBe('Draft');
    });
  });

  describe('getPlatformLabel', () => {
    test('returns correct label', () => {
      expect(getPlatformLabel('facebook')).toBe('Facebook');
      expect(getPlatformLabel('google_business')).toBe('Google Business');
    });

    test('returns raw string for unknown platform', () => {
      expect(getPlatformLabel('myspace')).toBe('myspace');
    });
  });

  describe('getCadenceLabel', () => {
    test('returns correct label', () => {
      expect(getCadenceLabel('standard')).toBe('Standard');
      expect(getCadenceLabel('growth')).toBe('Growth');
    });
  });

  describe('formatScheduleDate', () => {
    test('formats date with day name, month, day, and time', () => {
      // Use a known date: Tuesday June 24, 2025 at 9:00 AM
      const d = new Date(2025, 5, 24, 9, 0, 0);
      const formatted = formatScheduleDate(d);
      expect(formatted).toContain('Tuesday');
      expect(formatted).toContain('Jun');
      expect(formatted).toContain('24');
      expect(formatted).toContain('9:00 AM');
    });

    test('handles string dates', () => {
      const formatted = formatScheduleDate('2025-06-24T09:00:00');
      expect(formatted).toBeTruthy();
      expect(typeof formatted).toBe('string');
    });
  });
});
