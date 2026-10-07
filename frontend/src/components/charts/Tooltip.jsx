// The hover/focus tooltip shared by the charts: the value first, then what it is. Owner: Rukshi.
// It only repeats what the table under each chart already shows, so nothing is hidden behind a hover.
// This file provides the shared hover and keyboard-focus tooltip behavior used by the report charts.
import { useCallback, useState } from 'react';

export function useTooltip(boxRef) {
  const [tip, setTip] = useState(null);

  const fromPointer = useCallback(
    (event, content) => {
      const box = boxRef.current?.getBoundingClientRect();
      if (box) setTip({ x: event.clientX - box.left, y: event.clientY - box.top, content });
    },
    [boxRef],
  );

  // Keyboard focus: place the tooltip above the middle of the focused mark.
  const fromElement = useCallback(
    (element, content) => {
      const box = boxRef.current?.getBoundingClientRect();
      const mark = element.getBoundingClientRect();
      if (box) setTip({ x: mark.left + mark.width / 2 - box.left, y: mark.top - box.top, content });
    },
    [boxRef],
  );

  const hide = useCallback(() => setTip(null), []);
  return { tip, fromPointer, fromElement, hide };
}

// content = { title, rows: [{ label, value, color }] }
export function ChartTooltip({ tip, width }) {
  if (!tip) return null;
  const left = Math.min(Math.max(tip.x, 90), Math.max(width - 90, 90)); // keep the box inside the chart
  return (
    <div className="chart-tooltip" style={{ left, top: tip.y }} aria-hidden="true">
      <p className="chart-tooltip__title">{tip.content.title}</p>
      {tip.content.rows.map((row) => (
        <p key={row.label} className="chart-tooltip__row">
          {row.color && <span className="chart-tooltip__key" style={{ background: row.color }} />}
          <strong>{row.value}</strong> <span>{row.label}</span>
        </p>
      ))}
    </div>
  );
}

// Props that make one chart mark show the tooltip on hover and on keyboard focus.
export function markEvents(tooltip, content) {
  return {
    onPointerMove: (event) => tooltip.fromPointer(event, content),
    onPointerLeave: tooltip.hide,
    onFocus: (event) => tooltip.fromElement(event.currentTarget, content),
    onBlur: tooltip.hide,
  };
}
