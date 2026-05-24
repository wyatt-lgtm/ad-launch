/**
 * Upcoming holidays & events for the next 90 days.
 * All floating holidays (Mother's Day, Father's Day, etc.) are computed
 * dynamically so they never go stale.
 *
 * Events are excluded once their date has passed (the day after).
 */

export interface UpcomingEvent {
  name: string;
  date: string;   // human-readable, e.g. "Jun 15, 2026"
  iso: string;    // ISO date string for machine comparison
  week: number;
  ideas: string;
}

/* ── Helpers ────────────────────────────────────────────────────────────── */

/** Nth weekday of a month (1-based). e.g. nthWeekday(2026, 4, 0, 2) = 2nd Sunday of May */
function nthWeekday(year: number, month: number, weekday: number, n: number): Date {
  const first = new Date(year, month, 1);
  let day = 1 + ((weekday - first.getDay() + 7) % 7);
  day += (n - 1) * 7;
  return new Date(year, month, day);
}

/** Last Monday of a month */
function lastMonday(year: number, month: number): Date {
  const last = new Date(year, month + 1, 0); // last day of month
  const diff = (last.getDay() - 1 + 7) % 7;
  return new Date(year, month, last.getDate() - diff);
}

/** Compute Easter Sunday (Computus algorithm) */
function computeEaster(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31) - 1;
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month, day);
}

/* ── Fixed-date holidays ───────────────────────────────────────────────── */

const FIXED_HOLIDAYS: { name: string; month: number; day: number; ideas: string }[] = [
  { name: "New Year's Day",        month: 0,  day: 1,  ideas: 'New year goals, fresh start promos, year-in-review' },
  { name: "Valentine's Day",       month: 1,  day: 14, ideas: 'Gift guides, couples/partner promos, love-themed content' },
  { name: "St. Patrick's Day",     month: 2,  day: 17, ideas: 'Green-themed posts, community celebration content, festive deals' },
  { name: 'Earth Day',             month: 3,  day: 22, ideas: 'Sustainability tips, eco-friendly practices, community cleanups' },
  { name: 'Independence Day',      month: 6,  day: 4,  ideas: 'Patriotic content, summer celebration promos, community events' },
  { name: 'Back to School',        month: 7,  day: 15, ideas: 'School supplies, fall prep, student specials, family content' },
  { name: 'Halloween',             month: 9,  day: 31, ideas: 'Spooky-themed content, costume contests, fall festival promos' },
  { name: 'Veterans Day',          month: 10, day: 11, ideas: 'Honor veterans, special discounts for military, community gratitude' },
  { name: 'Black Friday',          month: 10, day: 28, ideas: 'Biggest deals of the year, limited-time offers, doorbusters' },
  { name: 'Small Business Saturday', month: 10, day: 29, ideas: 'Support local, shop small promos, community spotlight' },
  { name: 'Cyber Monday',          month: 11, day: 1,  ideas: 'Online-exclusive deals, digital promotions, flash sales' },
  { name: 'Christmas',             month: 11, day: 25, ideas: 'Holiday specials, gift guides, year-end celebrations, family content' },
  { name: "New Year's Eve",        month: 11, day: 31, ideas: 'Year-end wrap-up, countdown content, early-bird next year promos' },
];

/* ── Floating holidays (computed per-year) ─────────────────────────────── */

function getFloatingHolidays(year: number): { name: string; date: Date; ideas: string }[] {
  return [
    {
      name: "Mother's Day",
      date: nthWeekday(year, 4, 0, 2),  // 2nd Sunday of May
      ideas: 'Gift guides, family celebration content, honor moms with special offers',
    },
    {
      name: 'Memorial Day',
      date: lastMonday(year, 4),         // Last Monday of May
      ideas: 'Patriotic content, summer kickoff promos, community BBQ/cookout themes',
    },
    {
      name: "Father's Day",
      date: nthWeekday(year, 5, 0, 3),  // 3rd Sunday of June
      ideas: 'Gift guides, dad-themed content, family gathering promos',
    },
    {
      name: 'Labor Day',
      date: nthWeekday(year, 8, 1, 1),  // 1st Monday of September
      ideas: 'End of summer promos, back-to-work content, fall transition',
    },
    {
      name: 'Thanksgiving',
      date: nthWeekday(year, 10, 4, 4), // 4th Thursday of November
      ideas: 'Gratitude posts, family gathering content, Black Friday preview',
    },
    {
      name: 'Easter',
      date: computeEaster(year),
      ideas: 'Spring celebration, family gathering content, seasonal promos',
    },
  ];
}

/* ── Main export ───────────────────────────────────────────────────────── */

export function getUpcomingEvents(): UpcomingEvent[] {
  const now = new Date();
  // Start of today (midnight) so events ON today still appear
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(today.getTime() + 90 * 24 * 60 * 60 * 1000);

  const events: UpcomingEvent[] = [];

  const addEvent = (name: string, d: Date, ideas: string) => {
    // Only include events that haven't passed yet (today or future)
    if (d >= today && d <= end) {
      const weekNum = Math.ceil((d.getTime() - today.getTime()) / (7 * 24 * 60 * 60 * 1000));
      events.push({
        name,
        date: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
        iso: d.toISOString().slice(0, 10),
        week: Math.max(1, Math.min(12, weekNum)),
        ideas,
      });
    }
  };

  const years = [now.getFullYear(), now.getFullYear() + 1];

  // Fixed-date holidays
  for (const h of FIXED_HOLIDAYS) {
    for (const year of years) {
      addEvent(h.name, new Date(year, h.month, h.day), h.ideas);
    }
  }

  // Floating holidays
  for (const year of years) {
    for (const fh of getFloatingHolidays(year)) {
      addEvent(fh.name, fh.date, fh.ideas);
    }
  }

  events.sort((a, b) => a.iso.localeCompare(b.iso));
  return events;
}
