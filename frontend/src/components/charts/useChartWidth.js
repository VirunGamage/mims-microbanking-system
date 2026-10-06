// Measures how wide a chart's box is, so the chart is drawn at its real size and its text never shrinks on a phone.
// Owner: Rukshi. Used by every chart in this folder.
// This hook measures the available chart container width and updates it when the browser layout changes.
import { useEffect, useRef, useState } from 'react';

export function useChartWidth(fallback = 640) {
  const ref = useRef(null);
  const [width, setWidth] = useState(fallback);

  useEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    setWidth(element.clientWidth || fallback);
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width) || fallback));
    observer.observe(element);
    return () => observer.disconnect();
  }, [fallback]);

  return [ref, width];
}
