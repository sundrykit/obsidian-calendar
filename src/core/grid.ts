/**
 * Pure calendar maths. NO Obsidian imports — so it can be tested in plain Node.
 *
 * Everything here works in UTC. Calendar grids are about calendar dates, not
 * instants, and mixing local time in is the single most common source of
 * off-by-one-day bugs in date code (DST transitions shift local midnight).
 */

export type WeekStart = 0 | 1 | 2 | 3 | 4 | 5 | 6; // 0 = Sunday

export interface DayCell {
  /** ISO date, YYYY-MM-DD */
  iso: string;
  year: number;
  /** 1-12, human month — NOT the JS 0-11 trap */
  month: number;
  day: number;
  /** 0 = Sunday */
  weekday: number;
  /** false for the leading/trailing days that pad the grid */
  inMonth: boolean;
  isToday: boolean;
}

export interface WeekRow {
  /** ISO 8601 week number */
  weekNumber: number;
  /** ISO week-numbering year — differs from the calendar year at boundaries */
  weekYear: number;
  days: DayCell[];
}

export interface MonthGrid {
  year: number;
  month: number;
  weeks: WeekRow[];
}

const DAY_MS = 86_400_000;

export function utc(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day));
}

export function toISO(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * DAY_MS);
}

export function daysInMonth(year: number, month: number): number {
  // Day 0 of the next month is the last day of this one. Handles leap years.
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * ISO 8601 week number.
 *
 * The rule: week 1 is the week containing the first Thursday of the year.
 * Implemented by shifting to the Thursday of the current week, then counting
 * weeks from January 1st of *that* Thursday's year. Getting this wrong at
 * year boundaries is the classic calendar bug — see the tests.
 */
export function isoWeek(d: Date): { week: number; year: number } {
  const t = new Date(d.getTime());
  // getUTCDay(): 0=Sun..6=Sat. ISO treats Monday as day 1, Sunday as day 7.
  const isoDay = t.getUTCDay() === 0 ? 7 : t.getUTCDay();
  t.setUTCDate(t.getUTCDate() + 4 - isoDay); // move to this week's Thursday
  const weekYear = t.getUTCFullYear();
  const jan1 = new Date(Date.UTC(weekYear, 0, 1));
  const week = Math.ceil(((t.getTime() - jan1.getTime()) / DAY_MS + 1) / 7);
  return { week, year: weekYear };
}

/**
 * Build a month grid padded to whole weeks.
 *
 * `todayISO` is injected rather than read from the clock so the output is
 * deterministic and testable.
 */
export function buildMonthGrid(
  year: number,
  month: number,
  weekStart: WeekStart = 1,
  todayISO?: string
): MonthGrid {
  const first = utc(year, month, 1);
  const firstWeekday = first.getUTCDay();

  // How many days of the previous month to show before the 1st.
  const lead = (firstWeekday - weekStart + 7) % 7;
  let cursor = addDays(first, -lead);

  const total = daysInMonth(year, month);
  const cellsNeeded = Math.ceil((lead + total) / 7) * 7;

  const weeks: WeekRow[] = [];
  for (let w = 0; w < cellsNeeded / 7; w++) {
    const days: DayCell[] = [];
    for (let i = 0; i < 7; i++) {
      const iso = toISO(cursor);
      days.push({
        iso,
        year: cursor.getUTCFullYear(),
        month: cursor.getUTCMonth() + 1,
        day: cursor.getUTCDate(),
        weekday: cursor.getUTCDay(),
        inMonth: cursor.getUTCMonth() + 1 === month && cursor.getUTCFullYear() === year,
        isToday: todayISO === iso,
      });
      cursor = addDays(cursor, 1);
    }
    // Week number is taken from a day guaranteed to be inside the week.
    const { week, year: wy } = isoWeek(utc(days[0].year, days[0].month, days[0].day));
    weeks.push({ weekNumber: week, weekYear: wy, days });
  }

  return { year, month, weeks };
}

/** Step a year/month pair by n months, rolling the year correctly. */
export function shiftMonth(year: number, month: number, n: number): { year: number; month: number } {
  const zero = year * 12 + (month - 1) + n;
  return { year: Math.floor(zero / 12), month: (((zero % 12) + 12) % 12) + 1 };
}

export const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** Weekday initials ordered for the configured week start. */
export function weekdayLabels(weekStart: WeekStart): string[] {
  const base = ["S", "M", "T", "W", "T", "F", "S"];
  return Array.from({ length: 7 }, (_, i) => base[(i + weekStart) % 7]);
}
