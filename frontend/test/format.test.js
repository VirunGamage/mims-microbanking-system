// Tests for src/utils/format.js: dates, ages, counts and percentages. Owner: Virun. Run with: npm test
// Checks the date, time, age, count and percentage formatting, including month ends and birthdays.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ageOn, formatCount, formatDate, formatDateTime, formatPercent, formatTime, todayIso } from '../src/utils/format.js';

test('dates are shown as day, short month, year', () => {
  assert.equal(formatDate('2026-10-05'), '5 Oct 2026');
  assert.equal(formatDate('2026-10-05 10:00:00'), '5 Oct 2026');
  assert.equal(formatDate('2024-02-29'), '29 Feb 2024');
  assert.equal(formatDate(''), '—');
  assert.equal(formatDate('2026-13-01'), '—');
});

test('date-times keep hours and minutes', () => {
  assert.equal(formatDateTime('2026-10-05 10:07:30'), '5 Oct 2026, 10:07');
  assert.equal(formatDateTime('2026-10-05'), '5 Oct 2026');
  assert.equal(formatTime('2026-10-05 16:00:00'), '16:00');
});

test('ages count full years, like the database', () => {
  assert.equal(ageOn('2008-10-03', '2026-10-02'), 17);
  assert.equal(ageOn('2008-10-02', '2026-10-02'), 18);
  assert.equal(ageOn('bad', '2026-10-02'), null);
  assert.equal(todayIso(new Date(2026, 0, 9)), '2026-01-09');
});

test('counts and percentages', () => {
  assert.equal(formatCount(1234567), '1,234,567');
  assert.equal(formatCount('230'), '230');
  assert.equal(formatPercent('12.00'), '12%');
  assert.equal(formatPercent('13.50'), '13.5%');
  assert.equal(formatPercent('7'), '7%');
  assert.equal(formatPercent(null), '—');
});
