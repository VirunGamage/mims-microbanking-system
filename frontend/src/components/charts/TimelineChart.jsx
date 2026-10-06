// Timeline of the active fixed deposits: each FD's term from start to maturity, a dot on its next payout, and a line for
// today. Owner: Rukshi. Used by the Reports page for VW_ACTIVE_FD_PAYOUT_SCHEDULE.
// This component visualizes each active fixed deposit from its start date to maturity and marks its next payout date on a timeline.
import { useId } from 'react';
import { ChartTooltip, markEvents, useTooltip } from './Tooltip.jsx';
import { useChartWidth } from './useChartWidth.js';
import '../../styles/charts.css';

const DAY = 86400000;
const ROW = 30;
const TOP = 22; // room for the "Today" label
const AXIS_BAND = 24;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// 'YYYY-MM-DD' -> whole days since 1970 (UTC), so no time zone can move a date.
function dayNumber(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / DAY;
}

// Tick marks on the 1st of a month: every year for long spans, every 3 months otherwise.
function timeTicks(first, last) {
  const yearly = last - first > 2.5 * 365;
  const start = new Date(first * DAY);
  let year = start.getUTCFullYear();
  let month = yearly ? 0 : Math.floor(start.getUTCMonth() / 3) * 3;
  const ticks = [];
  for (;;) {
    const day = Date.UTC(year, month, 1) / DAY;
    if (day > last) break;
    if (day >= first) ticks.push({ day, label: yearly || month === 0 ? String(year) : `${MONTHS[month]} ${year}` });
    month += yearly ? 12 : 3;
    if (month >= 12) {
      year += Math.floor(month / 12);
      month %= 12;
    }
  }
  return ticks;
}

// items: [{ key, label, start, end, marker, details: [{ label, value }] }]  (dates as YYYY-MM-DD)
export default function TimelineChart({ caption, items, today, note }) {
  const [boxRef, width] = useChartWidth();
  const tooltip = useTooltip(boxRef);
  const captionId = useId();

  const days = items.flatMap((item) => [item.start, item.end]).concat(today).map(dayNumber);
  const first = Math.min(...days) - 30;
  const last = Math.max(...days) + 30;
  const labelWidth = Math.min(Math.max(...items.map((item) => item.label.length), 6) * 7.2 + 8, Math.round(width * 0.4));
  const plotLeft = labelWidth + 12;
  const plotWidth = Math.max(width - plotLeft - 12, 60);
  const x = (iso) => plotLeft + ((dayNumber(iso) - first) / (last - first)) * plotWidth;
  const xDay = (day) => plotLeft + ((day - first) / (last - first)) * plotWidth;
  const height = TOP + items.length * ROW + AXIS_BAND;
  const todayX = x(today);

  return (
    <figure className="chart" ref={boxRef}>
      <figcaption id={captionId} className="visually-hidden">
        {caption}
      </figcaption>
      <ul className="chart__legend" aria-hidden="true">
        <li>
          <span className="chart__key chart__key--line" style={{ background: 'var(--chart-span)' }} />
          Term, from start to maturity
        </li>
        <li>
          <span className="chart__key chart__key--dot" style={{ background: 'var(--chart-1)' }} />
          Next payout
        </li>
      </ul>
      <svg width={width} height={height} role="group" aria-labelledby={captionId}>
        {timeTicks(first, last).map((tick) => (
          <g key={tick.day}>
            <line className="chart__grid" x1={xDay(tick.day)} x2={xDay(tick.day)} y1={TOP} y2={height - AXIS_BAND} />
            <text x={xDay(tick.day)} y={height - 8} textAnchor="middle">
              {tick.label}
            </text>
          </g>
        ))}
        <line className="chart__today" x1={todayX} x2={todayX} y1={TOP - 4} y2={height - AXIS_BAND} />
        <text x={todayX} y={12} textAnchor="middle">
          Today
        </text>
        {items.map((item, row) => {
          const middle = TOP + row * ROW + ROW / 2;
          const content = { title: item.label, rows: item.details.map((d) => ({ label: d.label, value: d.value })) };
          const spoken = `${item.label}: ${item.details.map((d) => `${d.label} ${d.value}`).join(', ')}`;
          return (
            <g key={item.key} className="chart__mark" tabIndex={0} role="img" aria-label={spoken} {...markEvents(tooltip, content)}>
              <rect className="chart__hit" x={0} y={middle - ROW / 2} width={width} height={ROW} />
              <text className="chart__label" x={labelWidth} y={middle} dy="0.35em" textAnchor="end">
                {item.label}
              </text>
              <rect
                className="chart__fill"
                x={x(item.start)}
                y={middle - 3}
                width={Math.max(x(item.end) - x(item.start), 2)}
                height={6}
                rx={3}
                style={{ fill: 'var(--chart-span)' }}
              />
              {item.marker && (
                <circle cx={x(item.marker)} cy={middle} r={5} style={{ fill: 'var(--chart-1)', stroke: 'var(--surface)', strokeWidth: 2 }} />
              )}
            </g>
          );
        })}
      </svg>
      <ChartTooltip tip={tooltip.tip} width={width} />
      {note && <p className="chart__note">{note}</p>}
    </figure>
  );
}

