/**
 * Scheduling utilities for the Tombstone social post scheduler.
 * Handles schedule generation, cadence mapping, status labels,
 * and business type → goal defaults.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export type PostingGoal =
  | 'more_calls'
  | 'website_visits'
  | 'reviews'
  | 'repeat_customers'
  | 'brand_awareness'
  | 'recruiting';

export type ApprovalMode =
  | 'review_first'
  | 'auto_after_approval'
  | 'full_autopilot';

export type Cadence = 'light' | 'standard' | 'growth' | 'custom';

export type ScheduledPostStatus =
  | 'draft'
  | 'needs_approval'
  | 'approved'
  | 'scheduled'
  | 'publishing'
  | 'published'
  | 'failed'
  | 'paused'
  | 'revision_requested';

export type Platform =
  | 'facebook'
  | 'google_business'
  | 'instagram'
  | 'linkedin'
  | 'tiktok';

export interface ScheduleSlot {
  dayOfWeek: number; // 0=Sun ... 6=Sat
  time: string;       // HH:mm
  label: string;      // e.g. "Tuesday 9:00 AM"
}

export interface ScheduledPostInput {
  socialPostId?: string;
  caption: string;
  imageUrl?: string;
  hashtags?: string[];
  cta?: string;
  platforms: string[];
  lane?: string;
  sourceType?: string;
}

export interface GeneratedScheduleItem {
  date: Date;
  timeLabel: string;
  dayLabel: string;
  slot: ScheduleSlot;
}

// ─── Constants ───────────────────────────────────────────────────────────────

export const POSTING_GOALS: Record<PostingGoal, { label: string; description: string; icon: string }> = {
  more_calls:       { label: 'More Calls & Appointments', description: 'Drive phone calls and bookings', icon: 'phone' },
  website_visits:   { label: 'Website Visits', description: 'Send traffic to your website', icon: 'globe' },
  reviews:          { label: 'More Reviews', description: 'Encourage customers to leave reviews', icon: 'star' },
  repeat_customers: { label: 'Repeat Customers', description: 'Keep existing customers coming back', icon: 'repeat' },
  brand_awareness:  { label: 'Brand Awareness', description: 'Get your name out there', icon: 'megaphone' },
  recruiting:       { label: 'Recruiting', description: 'Attract new team members', icon: 'users' },
};

export const APPROVAL_MODES: Record<ApprovalMode, { label: string; description: string; recommended: boolean; disabled: boolean }> = {
  review_first:       { label: 'Review First', description: 'You review and approve every post before it goes out.', recommended: false, disabled: false },
  auto_after_approval: { label: 'Auto-Schedule After Approval', description: 'Approve the schedule once, then posts go out automatically on time.', recommended: true, disabled: false },
  full_autopilot:     { label: 'Full Autopilot', description: 'Your AI team handles everything — posts go out without review.', recommended: false, disabled: true },
};

export const CADENCE_CONFIG: Record<Cadence, { label: string; postsPerWeek: number; description: string; slots: ScheduleSlot[] }> = {
  light: {
    label: 'Light',
    postsPerWeek: 2,
    description: '2 posts per week — perfect for getting started',
    slots: [
      { dayOfWeek: 2, time: '09:00', label: 'Tuesday 9:00 AM' },
      { dayOfWeek: 5, time: '11:30', label: 'Friday 11:30 AM' },
    ],
  },
  standard: {
    label: 'Standard',
    postsPerWeek: 3,
    description: '3 posts per week — our recommended cadence',
    slots: [
      { dayOfWeek: 2, time: '09:00', label: 'Tuesday 9:00 AM' },
      { dayOfWeek: 4, time: '11:30', label: 'Thursday 11:30 AM' },
      { dayOfWeek: 6, time: '08:45', label: 'Saturday 8:45 AM' },
    ],
  },
  growth: {
    label: 'Growth',
    postsPerWeek: 5,
    description: '5 posts per week — aggressive visibility',
    slots: [
      { dayOfWeek: 1, time: '09:00', label: 'Monday 9:00 AM' },
      { dayOfWeek: 2, time: '11:30', label: 'Tuesday 11:30 AM' },
      { dayOfWeek: 3, time: '09:00', label: 'Wednesday 9:00 AM' },
      { dayOfWeek: 5, time: '10:00', label: 'Friday 10:00 AM' },
      { dayOfWeek: 6, time: '08:45', label: 'Saturday 8:45 AM' },
    ],
  },
  custom: {
    label: 'Custom',
    postsPerWeek: 0,
    description: 'Set your own days and times',
    slots: [],
  },
};

export const STATUS_LABELS: Record<ScheduledPostStatus, { label: string; color: string; bgColor: string }> = {
  draft:              { label: 'Draft',              color: 'text-gray-600',   bgColor: 'bg-gray-100' },
  needs_approval:     { label: 'Needs Approval',     color: 'text-amber-700',  bgColor: 'bg-amber-50' },
  approved:           { label: 'Ready',              color: 'text-green-700',  bgColor: 'bg-green-50' },
  scheduled:          { label: 'Scheduled',          color: 'text-blue-700',   bgColor: 'bg-blue-50' },
  publishing:         { label: 'Posting Now',        color: 'text-indigo-700', bgColor: 'bg-indigo-50' },
  published:          { label: 'Published',          color: 'text-emerald-700', bgColor: 'bg-emerald-50' },
  failed:             { label: 'Needs Attention',    color: 'text-red-700',    bgColor: 'bg-red-50' },
  paused:             { label: 'Paused',             color: 'text-gray-600',   bgColor: 'bg-gray-100' },
  revision_requested: { label: 'Revision Requested', color: 'text-orange-700', bgColor: 'bg-orange-50' },
};

export const PLATFORM_CONFIG: Record<Platform, { label: string; recommended: boolean; comingSoon: boolean; color: string; bgColor: string }> = {
  facebook:        { label: 'Facebook',         recommended: true,  comingSoon: false, color: 'text-blue-600',   bgColor: 'bg-blue-50' },
  google_business: { label: 'Google Business',  recommended: true,  comingSoon: false, color: 'text-green-600',  bgColor: 'bg-green-50' },
  instagram:       { label: 'Instagram',        recommended: false, comingSoon: false, color: 'text-pink-600',   bgColor: 'bg-pink-50' },
  linkedin:        { label: 'LinkedIn',         recommended: false, comingSoon: false, color: 'text-sky-700',    bgColor: 'bg-sky-50' },
  tiktok:          { label: 'TikTok',           recommended: false, comingSoon: true,  color: 'text-gray-400',   bgColor: 'bg-gray-50' },
};

// ─── Business type → goal defaults ───────────────────────────────────────────

const BUSINESS_TYPE_GOAL_MAP: Record<string, PostingGoal> = {
  'auto_repair':          'more_calls',
  'automotive':           'more_calls',
  'restaurant':           'repeat_customers',
  'food_service':         'repeat_customers',
  'bar':                  'repeat_customers',
  'cafe':                 'repeat_customers',
  'professional_services': 'more_calls',
  'legal':                'more_calls',
  'medical':              'more_calls',
  'dental':               'more_calls',
  'healthcare':           'more_calls',
  'retail':               'repeat_customers',
  'ecommerce':            'website_visits',
  'b2b':                  'website_visits',
  'saas':                 'website_visits',
  'real_estate':          'website_visits',
  'construction':         'more_calls',
  'home_services':        'more_calls',
  'beauty':               'repeat_customers',
  'fitness':              'repeat_customers',
};

export function getDefaultGoalForBusinessType(businessType?: string): PostingGoal {
  if (!businessType) return 'brand_awareness';
  const normalized = businessType.toLowerCase().replace(/[\s-]+/g, '_');
  return BUSINESS_TYPE_GOAL_MAP[normalized] ?? 'brand_awareness';
}

// ─── Schedule generation ─────────────────────────────────────────────────────

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function formatTime12h(time24: string): string {
  const [hStr, mStr] = time24.split(':');
  let h = parseInt(hStr, 10);
  const m = mStr || '00';
  const ampm = h >= 12 ? 'PM' : 'AM';
  if (h === 0) h = 12;
  else if (h > 12) h -= 12;
  return `${h}:${m} ${ampm}`;
}

/**
 * Generate a recommended 2-week schedule starting from a given date.
 * Distributes available posts across the cadence slots.
 */
export function generateRecommendedSchedule(
  posts: ScheduledPostInput[],
  cadence: Cadence,
  startDate: Date = new Date(),
  timezone: string = 'America/Denver'
): GeneratedScheduleItem[] {
  const config = CADENCE_CONFIG[cadence];
  if (!config || config.slots.length === 0) return [];

  const schedule: GeneratedScheduleItem[] = [];
  const twoWeeks = 14;

  // Start from next day to give at least 24h buffer
  const start = new Date(startDate);
  start.setDate(start.getDate() + 1);
  start.setHours(0, 0, 0, 0);

  for (let day = 0; day < twoWeeks && schedule.length < posts.length; day++) {
    const current = new Date(start);
    current.setDate(start.getDate() + day);
    const dow = current.getDay();

    for (const slot of config.slots) {
      if (slot.dayOfWeek === dow && schedule.length < posts.length) {
        const [h, m] = slot.time.split(':').map(Number);
        const scheduledDate = new Date(current);
        scheduledDate.setHours(h, m, 0, 0);

        schedule.push({
          date: scheduledDate,
          timeLabel: formatTime12h(slot.time),
          dayLabel: `${DAY_NAMES[dow]}, ${scheduledDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`,
          slot,
        });
      }
    }
  }

  return schedule;
}

/**
 * Map a cadence + schedule to concrete ScheduledPost creation data.
 * Pairs each post input with a schedule slot from the 2-week plan.
 */
export function buildScheduledPostsData(
  posts: ScheduledPostInput[],
  cadence: Cadence,
  timezone: string,
  approvalMode: ApprovalMode,
  platforms: string[],
  startDate?: Date
): Array<{
  input: ScheduledPostInput;
  scheduledFor: Date;
  status: ScheduledPostStatus;
  approvalRequired: boolean;
}> {
  const schedule = generateRecommendedSchedule(posts, cadence, startDate, timezone);

  return posts.slice(0, schedule.length).map((input, i) => {
    const slot = schedule[i];
    const status: ScheduledPostStatus =
      approvalMode === 'review_first' ? 'needs_approval' :
      approvalMode === 'auto_after_approval' ? 'needs_approval' :
      'scheduled'; // full_autopilot

    return {
      input: {
        ...input,
        platforms: input.platforms.length > 0 ? input.platforms : platforms,
      },
      scheduledFor: slot.date,
      status,
      approvalRequired: approvalMode !== 'full_autopilot',
    };
  });
}

/**
 * Get the next available schedule slots for a cadence,
 * skipping any that already have a scheduled post.
 */
export function getNextAvailableSlots(
  cadence: Cadence,
  existingDates: Date[],
  count: number,
  startDate: Date = new Date()
): GeneratedScheduleItem[] {
  const config = CADENCE_CONFIG[cadence];
  if (!config || config.slots.length === 0) return [];

  const existingSet = new Set(
    existingDates.map(d => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}-${d.getHours()}-${d.getMinutes()}`)
  );

  const results: GeneratedScheduleItem[] = [];
  const maxDays = 60; // Look ahead up to 60 days

  const start = new Date(startDate);
  start.setDate(start.getDate() + 1);
  start.setHours(0, 0, 0, 0);

  for (let day = 0; day < maxDays && results.length < count; day++) {
    const current = new Date(start);
    current.setDate(start.getDate() + day);
    const dow = current.getDay();

    for (const slot of config.slots) {
      if (slot.dayOfWeek === dow && results.length < count) {
        const [h, m] = slot.time.split(':').map(Number);
        const scheduledDate = new Date(current);
        scheduledDate.setHours(h, m, 0, 0);

        const key = `${scheduledDate.getFullYear()}-${scheduledDate.getMonth()}-${scheduledDate.getDate()}-${scheduledDate.getHours()}-${scheduledDate.getMinutes()}`;
        if (!existingSet.has(key)) {
          results.push({
            date: scheduledDate,
            timeLabel: formatTime12h(slot.time),
            dayLabel: `${DAY_NAMES[dow]}, ${scheduledDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`,
            slot,
          });
        }
      }
    }
  }

  return results;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function getStatusLabel(status: string): { label: string; color: string; bgColor: string } {
  return STATUS_LABELS[status as ScheduledPostStatus] ?? STATUS_LABELS.draft;
}

export function getPlatformLabel(platform: string): string {
  return PLATFORM_CONFIG[platform as Platform]?.label ?? platform;
}

export function getCadenceLabel(cadence: string): string {
  return CADENCE_CONFIG[cadence as Cadence]?.label ?? cadence;
}

export function formatScheduleDate(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return `${DAY_NAMES[d.getDay()]}, ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} at ${formatTime12h(`${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`)}`;  
}
