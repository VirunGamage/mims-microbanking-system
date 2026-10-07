// Tests for csv.js (quoting, the byte-order mark, the formula guard) and the chart axis maths. Owner: Rukshi.
// Run with: npm test  (no server or database needed)
// These tests check CSV formatting, safe spreadsheet values, file naming, and the shared chart-axis helpers.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { niceTicks, shortNumber } from '../src/components/charts/scale.js';
import { csvCell, csvFileName, toCsv } from '../src/utils/csv.js';

test('cells are quoted only when they need it (RFC 4180)', () => {
  assert.equal(csvCell('Central Branch'), 'Central Branch');
  assert.equal(csvCell('12 Galle Rd, Colombo'), '"12 Galle Rd, Colombo"');
  assert.equal(csvCell('She said "hi"'), '"She said ""hi"""');
  assert.equal(csvCell('line one\nline two'), '"line one\nline two"');
  assert.equal(csvCell(null), '');
  assert.equal(csvCell(42), '42');
});

test('text that a spreadsheet would run as a formula is neutralised, numbers are not', () => {
  assert.equal(csvCell('=HYPERLINK("http://x")'), `"'=HYPERLINK(""http://x"")"`);
  assert.equal(csvCell('+94 77 123'), "'+94 77 123");
  assert.equal(csvCell('@SUM(A1)'), "'@SUM(A1)");
  assert.equal(csvCell('-1651.00'), '-1651.00'); // a real negative amount stays a number
  assert.equal(csvCell('-2+3'), "'-2+3");
});

test('a CSV file starts with the byte-order mark and uses CRLF line ends', () => {
  const text = toCsv([{ key: 'name', header: 'Agent' }, { key: 'value', header: 'Value (LKR)' }], [
    { name: 'Alice Smith', value: '90500.00' },
    { name: 'Bob, Jr', value: '0.00' },
  ]);
  assert.equal(text, '﻿Agent,Value (LKR)\r\nAlice Smith,90500.00\r\n"Bob, Jr",0.00\r\n');
  assert.equal(csvFileName('Agent activity', '2026-10-05'), 'mims-agent-activity-2026-10-05.csv');
});

test('axis ticks are round numbers that cover the largest value', () => {
  assert.deepEqual(niceTicks(1253029.59), [0, 500000, 1000000, 1500000]);
  assert.deepEqual(niceTicks(90500), [0, 25000, 50000, 75000, 100000]);
  assert.deepEqual(niceTicks(4), [0, 1, 2, 3, 4]);
  assert.deepEqual(niceTicks(0), [0, 1]);
  assert.equal(shortNumber(1500000), '1.5M');
  assert.equal(shortNumber(25000), '25K');
  assert.equal(shortNumber(750), '750');
});
