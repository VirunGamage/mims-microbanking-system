// Axis maths shared by the charts: round tick values and short tick labels. Owner: Rukshi.
// Amounts are turned into ordinary numbers here only to work out where to draw things; every amount the user reads
// (labels, tooltips, tables) is still formatted from the exact text the database sent.
// This file contains shared chart-axis helpers for generating readable tick values and compact numeric labels.

// Round, evenly spaced ticks from 0 that cover `max`: niceTicks(1253029.59) -> 0, 500000, 1000000, 1500000.
export function niceTicks(max, wanted = 4) {
  if (!(max > 0)) return [0, 1];
  const rough = max / wanted;
  const power = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * power).find((candidate) => candidate >= rough);
  const ticks = [];
  for (let value = 0; value < max + step / 2; value += step) ticks.push(Number(value.toPrecision(12)));
  if (ticks[ticks.length - 1] < max) ticks.push(Number((ticks[ticks.length - 1] + step).toPrecision(12)));
  return ticks;
}

// Short labels for axis ticks: 0, 750, 25K, 1.5M. The exact amounts are in the table and the tooltips.
export function shortNumber(value) {
  const abs = Math.abs(value);
  const sign = value < 0 ? '−' : '';
  const trim = (n) => String(Number(n.toFixed(2)));
  if (abs >= 1e9) return `${sign}${trim(abs / 1e9)}B`;
  if (abs >= 1e6) return `${sign}${trim(abs / 1e6)}M`;
  if (abs >= 1e3) return `${sign}${trim(abs / 1e3)}K`;
  return `${sign}${trim(abs)}`;
}

// '1253029.59' -> 1253029.59, for drawing only.
export function toNumber(text) {
  const number = Number(text);
  return Number.isFinite(number) ? number : 0;
}
