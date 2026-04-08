/**
 * Upcoming holidays & events for the next 90 days.
 * Extracted from mission-status buildPostingPlan for reuse by the social post generator.
 */

export interface UpcomingEvent {
  name: string;
  date: string;
  week: number;
  ideas: string;
}

export function getUpcomingEvents(): UpcomingEvent[] {
  const now = new Date();
  const end = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);

  const fixedHolidays: { name: string; month: number; day: number; ideas: string }[] = [
    { name: "New Year's Day", month: 0, day: 1, ideas: 'New year goals, fresh start promos, year-in-review' },
    { name: "Valentine's Day", month: 1, day: 14, ideas: 'Gift guides, couples/partner promos, love-themed content' },
    { name: "St. Patrick's Day", month: 2, day: 17, ideas: 'Green-themed posts, community celebration content, festive deals' },
    { name: 'Earth Day', month: 3, day: 22, ideas: 'Sustainability tips, eco-friendly practices, community cleanups' },
    { name: "Mother's Day", month: 4, day: 11, ideas: 'Gift guides, family celebration content, honor moms with special offers' },
    { name: 'Memorial Day', month: 4, day: 26, ideas: 'Patriotic content, summer kickoff promos, community BBQ/cookout themes' },
    { name: "Father's Day", month: 5, day: 15, ideas: 'Gift guides, dad-themed content, family gathering promos' },
    { name: 'Independence Day', month: 6, day: 4, ideas: 'Patriotic content, summer celebration promos, community events' },
    { name: 'Back to School', month: 7, day: 15, ideas: 'School supplies, fall prep, student specials, family content' },
    { name: 'Labor Day', month: 8, day: 1, ideas: 'End of summer promos, back-to-work content, fall transition' },
    { name: 'Halloween', month: 9, day: 31, ideas: 'Spooky-themed content, costume contests, fall festival promos' },
    { name: 'Veterans Day', month: 10, day: 11, ideas: 'Honor veterans, special discounts for military, community gratitude' },
    { name: 'Thanksgiving', month: 10, day: 27, ideas: 'Gratitude posts, family gathering content, Black Friday preview' },
    { name: 'Black Friday', month: 10, day: 28, ideas: 'Biggest deals of the year, limited-time offers, doorbusters' },
    { name: 'Small Business Saturday', month: 10, day: 29, ideas: 'Support local, shop small promos, community spotlight' },
    { name: 'Cyber Monday', month: 11, day: 1, ideas: 'Online-exclusive deals, digital promotions, flash sales' },
    { name: 'Christmas', month: 11, day: 25, ideas: 'Holiday specials, gift guides, year-end celebrations, family content' },
    { name: "New Year's Eve", month: 11, day: 31, ideas: 'Year-end wrap-up, countdown content, early-bird next year promos' },
  ];

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

  const events: UpcomingEvent[] = [];

  for (const h of fixedHolidays) {
    for (const year of [now.getFullYear(), now.getFullYear() + 1]) {
      const d = new Date(year, h.month, h.day);
      if (d >= now && d <= end) {
        const weekNum = Math.ceil((d.getTime() - now.getTime()) / (7 * 24 * 60 * 60 * 1000));
        events.push({
          name: h.name,
          date: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
          week: Math.max(1, Math.min(12, weekNum)),
          ideas: h.ideas,
        });
      }
    }
  }

  for (const year of [now.getFullYear(), now.getFullYear() + 1]) {
    const easter = computeEaster(year);
    if (easter >= now && easter <= end) {
      const weekNum = Math.ceil((easter.getTime() - now.getTime()) / (7 * 24 * 60 * 60 * 1000));
      events.push({
        name: 'Easter',
        date: easter.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
        week: Math.max(1, Math.min(12, weekNum)),
        ideas: 'Spring celebration, family gathering content, seasonal promos',
      });
    }
  }

  events.sort((a, b) => a.week - b.week);
  return events;
}
