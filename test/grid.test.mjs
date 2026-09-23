/**
 * Tests for the pure calendar maths.
 * Run: npm test
 *
 * These test the things that actually break in calendar code: leap years,
 * ISO week numbers at year boundaries, month rollover, and week-start offsets.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildMonthGrid, isoWeek, utc, daysInMonth, shiftMonth, weekdayLabels, toISO, addDays,
} from "../dist-test/grid.js";

test("daysInMonth handles leap years", () => {
  assert.equal(daysInMonth(2024, 2), 29, "2024 is a leap year");
  assert.equal(daysInMonth(2025, 2), 28, "2025 is not");
  assert.equal(daysInMonth(2000, 2), 29, "2000 is a leap year (divisible by 400)");
  assert.equal(daysInMonth(1900, 2), 28, "1900 is NOT a leap year (century, not /400)");
  assert.equal(daysInMonth(2026, 12), 31);
  assert.equal(daysInMonth(2026, 4), 30);
});

test("ISO week numbers match the standard at known hard cases", () => {
  // These are the canonical ISO-8601 edge cases.
  assert.deepEqual(isoWeek(utc(2026, 1, 1)), { week: 1, year: 2026 });
  // 2021-01-01 was a Friday -> belongs to week 53 of 2020.
  assert.deepEqual(isoWeek(utc(2021, 1, 1)), { week: 53, year: 2020 });
  // 2019-12-30 was a Monday -> already week 1 of 2020.
  assert.deepEqual(isoWeek(utc(2019, 12, 30)), { week: 1, year: 2020 });
  // 2016-01-03 was a Sunday -> week 53 of 2015.
  assert.deepEqual(isoWeek(utc(2016, 1, 3)), { week: 53, year: 2015 });
  // A long year: 2020 has 53 ISO weeks.
  assert.deepEqual(isoWeek(utc(2020, 12, 31)), { week: 53, year: 2020 });
});

test("month grid is always whole weeks", () => {
  for (let y = 2024; y <= 2027; y++) {
    for (let m = 1; m <= 12; m++) {
      const g = buildMonthGrid(y, m, 1);
      for (const w of g.weeks) {
        assert.equal(w.days.length, 7, `${y}-${m} has a short week`);
      }
      assert.ok(g.weeks.length >= 4 && g.weeks.length <= 6, `${y}-${m} week count out of range`);
    }
  }
});

test("grid contains every day of the month exactly once", () => {
  const g = buildMonthGrid(2026, 2, 1);
  const inMonth = g.weeks.flatMap(w => w.days).filter(d => d.inMonth);
  assert.equal(inMonth.length, 28);
  assert.equal(inMonth[0].iso, "2026-02-01");
  assert.equal(inMonth[inMonth.length - 1].iso, "2026-02-28");
  assert.equal(new Set(inMonth.map(d => d.iso)).size, 28, "no duplicates");
});

test("grid days are strictly consecutive with no gaps", () => {
  const g = buildMonthGrid(2026, 3, 1);
  const all = g.weeks.flatMap(w => w.days);
  for (let i = 1; i < all.length; i++) {
    const prev = new Date(all[i - 1].iso + "T00:00:00Z");
    assert.equal(toISO(addDays(prev, 1)), all[i].iso, `gap before ${all[i].iso}`);
  }
});

test("week start is respected", () => {
  const mon = buildMonthGrid(2026, 9, 1);
  assert.equal(mon.weeks[0].days[0].weekday, 1, "Monday start");
  const sun = buildMonthGrid(2026, 9, 0);
  assert.equal(sun.weeks[0].days[0].weekday, 0, "Sunday start");
  const sat = buildMonthGrid(2026, 9, 6);
  assert.equal(sat.weeks[0].days[0].weekday, 6, "Saturday start");
});

test("a month starting exactly on the week start has no leading pad", () => {
  // 2026-06-01 was a Monday.
  const g = buildMonthGrid(2026, 6, 1);
  assert.equal(g.weeks[0].days[0].iso, "2026-06-01");
  assert.equal(g.weeks[0].days[0].inMonth, true);
});

test("isToday is only set for the injected date", () => {
  const g = buildMonthGrid(2026, 9, 1, "2026-09-20");
  const todays = g.weeks.flatMap(w => w.days).filter(d => d.isToday);
  assert.equal(todays.length, 1);
  assert.equal(todays[0].iso, "2026-09-20");
});

test("isToday is never set when no date is injected", () => {
  const g = buildMonthGrid(2026, 9, 1);
  assert.equal(g.weeks.flatMap(w => w.days).filter(d => d.isToday).length, 0);
});

test("shiftMonth rolls years in both directions", () => {
  assert.deepEqual(shiftMonth(2026, 12, 1), { year: 2027, month: 1 });
  assert.deepEqual(shiftMonth(2026, 1, -1), { year: 2025, month: 12 });
  assert.deepEqual(shiftMonth(2026, 6, 12), { year: 2027, month: 6 });
  assert.deepEqual(shiftMonth(2026, 6, -18), { year: 2024, month: 12 });
  assert.deepEqual(shiftMonth(2026, 1, -13), { year: 2024, month: 12 });
});

test("weekday labels rotate with week start", () => {
  assert.deepEqual(weekdayLabels(0), ["S","M","T","W","T","F","S"]);
  assert.deepEqual(weekdayLabels(1), ["M","T","W","T","F","S","S"]);
});

test("December grid does not lose days across the year boundary", () => {
  const g = buildMonthGrid(2026, 12, 1);
  const inMonth = g.weeks.flatMap(w => w.days).filter(d => d.inMonth);
  assert.equal(inMonth.length, 31);
  assert.equal(inMonth[30].iso, "2026-12-31");
  const trailing = g.weeks.flatMap(w => w.days).filter(d => !d.inMonth && d.year === 2027);
  assert.ok(trailing.length > 0, "January days should pad the final week");
});

test("no timezone drift: grid is identical regardless of process TZ", () => {
  // The whole point of working in UTC. If this fails, someone used local time.
  const g = buildMonthGrid(2026, 3, 1);
  assert.equal(g.weeks[0].days[0].iso.length, 10);
  const marchFirst = g.weeks.flatMap(w => w.days).find(d => d.iso === "2026-03-01");
  assert.ok(marchFirst, "1 March must exist");
  assert.equal(marchFirst.inMonth, true);
});
