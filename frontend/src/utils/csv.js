// CSV export for the reports: RFC 4180 quoting, a UTF-8 byte-order mark so Excel reads the text correctly, and a guard
// against spreadsheet formula injection. Owner: Rukshi. Used by the Download CSV button on the Reports page.
// This file creates safe CSV exports for report data, including Excel-compatible UTF-8 output and protection against spreadsheet formulas.

const PLAIN_NUMBER = /^-?\d+(\.\d+)?$/;
const FORMULA_START = /^[=+\-@\t\r]/;

// One cell. Text that a spreadsheet could run as a formula (=, +, -, @, tab, carriage return at the start) gets a
// leading ' so it is shown as text; plain numbers such as -1651.00 are left alone. Then RFC 4180 quoting.
export function csvCell(value) {
  if (value === null || value === undefined) return '';
  let text = String(value);
  if (FORMULA_START.test(text) && !PLAIN_NUMBER.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

// columns: [{ key, header }]; rows: plain objects. Lines end with CRLF, as RFC 4180 asks.
export function toCsv(columns, rows) {
  const lines = [columns.map((column) => csvCell(column.header)).join(',')];
  for (const row of rows) lines.push(columns.map((column) => csvCell(row[column.key])).join(','));
  return `\uFEFF${lines.join('\r\n')}\r\n`; // \uFEFF (byte-order mark) tells Excel the file is UTF-8
}

// 'Agent activity', '2026-10-05' -> 'mims-agent-activity-2026-10-05.csv'
export function csvFileName(reportName, isoDate) {
  const slug = reportName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `mims-${slug}-${isoDate}.csv`;
}

// Starts the download in the browser.
export function downloadCsv(fileName, csvText) {
  const url = URL.createObjectURL(new Blob([csvText], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
