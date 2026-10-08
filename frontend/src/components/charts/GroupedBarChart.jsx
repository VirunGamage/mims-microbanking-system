// Horizontal bar chart with one or more series: one row per category (an agent, a customer, a plan), one thin bar per
// series in each row, bars growing from a single baseline. Owner: Rukshi. Used by the Reports page; BarChart.jsx is the
// one-series version with the value written at the end of each bar.
// This component draws responsive horizontal grouped bar charts for report categories and supports labels, tooltips, ticks, and multiple series.
import { useId, useRef } from 'react';
import { niceTicks, shortNumber } from './scale.js';
import { ChartTooltip, markEvents, useTooltip } from './Tooltip.jsx';
import { useChartWidth } from './useChartWidth.js';
import '../../styles/charts.css';

const AXIS_BAND = 24;
const RADIUS = 4;

// A bar from the baseline (square end) to its value (rounded end).
function barPath(x0, x1, y, height) {
  const r = Math.min(RADIUS, height / 2, x1 - x0);
  if (x1 - x0 <= 0) return '';
  return `M${x0},${y}H${x1 - r}A${r},${r} 0 0 1 ${x1},${y + r}V${y + height - r}A${r},${r} 0 0 1 ${x1 - r},${y + height}H${x0}Z`;
}

function fitLabel(text, maxChars) {
  return text.length > maxChars ? `${text.slice(0, Math.max(maxChars - 1, 1))}…` : text;
}

// categories: [{ key, label, values: { [seriesKey]: { value: Number, display: 'LKR 1,000.00' } } }]
// series: [{ key, label, color }]
export default function GroupedBarChart({ caption, categories, series, showValues = false, tickFormat = shortNumber, note }) {
  const [boxRef, width] = useChartWidth();
  const tooltip = useTooltip(boxRef);
  const captionId = useId();
  const svgRef = useRef(null);

  const longest = Math.max(...categories.map((c) => c.label.length), 4);
  const labelWidth = Math.min(Math.max(longest * 7.2 + 8, 70), Math.round(width * 0.38));
  const maxChars = Math.floor(labelWidth / 7.2);
  const valueReserve = showValues
    ? Math.max(...categories.flatMap((c) => series.map((s) => (c.values[s.key]?.display ?? '').length)), 4) * 7 + 12
    : 16;
  const plotLeft = labelWidth + 12;
  const plotWidth = Math.max(width - plotLeft - valueReserve, 60);
  const maxValue = Math.max(...categories.flatMap((c) => series.map((s) => c.values[s.key]?.value ?? 0)), 0);
  const ticks = niceTicks(maxValue);
  const top = ticks[ticks.length - 1];
  const x = (value) => plotLeft + (Math.max(value, 0) / top) * plotWidth;

  const thickness = series.length === 1 ? 16 : 12;
  const gap = 2;
  const groupHeight = series.length * thickness + (series.length - 1) * gap;
  const rowHeight = groupHeight + (series.length === 1 ? 16 : 18);
  const height = categories.length * rowHeight + AXIS_BAND + 4;

  return (
    <figure className="chart" ref={boxRef}>
      <figcaption id={captionId} className="visually-hidden">
        {caption}
      </figcaption>
      {series.length > 1 && (
        <ul className="chart__legend" aria-hidden="true">
          {series.map((s) => (
            <li key={s.key}>
              <span className="chart__key" style={{ background: s.color }} />
              {s.label}
            </li>
          ))}
        </ul>
      )}
      <svg ref={svgRef} width={width} height={height} role="group" aria-labelledby={captionId}>
        {ticks.map((tick) => (
          <g key={tick}>
            <line className={tick === 0 ? 'chart__baseline' : 'chart__grid'} x1={x(tick)} x2={x(tick)} y1={0} y2={height - AXIS_BAND} />
            <text x={x(tick)} y={height - 8} textAnchor="middle">
              {tickFormat(tick)}
            </text>
          </g>
        ))}
        {categories.map((category, row) => {
          const rowTop = row * rowHeight;
          const firstBar = rowTop + (rowHeight - groupHeight) / 2;
          const content = {
            title: category.label,
            rows: series.map((s) => ({ label: s.label, value: category.values[s.key]?.display ?? '—', color: series.length > 1 ? s.color : null })),
          };
          const spoken = `${category.label}: ${series.map((s) => `${s.label} ${category.values[s.key]?.display ?? 'none'}`).join(', ')}`;
          return (
            <g key={category.key} className="chart__mark" tabIndex={0} role="img" aria-label={spoken} {...markEvents(tooltip, content)}>
              <rect className="chart__hit" x={0} y={rowTop} width={width} height={rowHeight} />
              <text className="chart__label" x={labelWidth} y={rowTop + rowHeight / 2} dy="0.35em" textAnchor="end">
                {fitLabel(category.label, maxChars)}
              </text>
              {series.map((s, index) => {
                const item = category.values[s.key];
                const y = firstBar + index * (thickness + gap);
                const end = x(item?.value ?? 0);
                return (
                  <g key={s.key}>
                    <path className="chart__fill" d={barPath(plotLeft, end, y, thickness)} style={{ fill: s.color }} />
                    {showValues && (
                      <text className="chart__value" x={end + 6} y={y + thickness / 2} dy="0.35em">
                        {item?.display ?? ''}
                      </text>
                    )}
                  </g>
                );
              })}
            </g>
          );
        })}
      </svg>
      <ChartTooltip tip={tooltip.tip} width={width} />
      {note && <p className="chart__note">{note}</p>}
    </figure>
  );
}
