// One-series horizontal bar chart (an amount or a count per agent, per account, per plan) with the value written at
// the end of each bar. Owner: Rukshi. Built on GroupedBarChart, so both charts look and behave the same.
// This component converts simple report values into a single-series horizontal bar chart by reusing GroupedBarChart.
import GroupedBarChart from './GroupedBarChart.jsx';

// items: [{ key, label, value: Number (for drawing), display: 'LKR 1,000.00' (what is written) }]
export default function BarChart({ caption, items, seriesLabel, tickFormat, note }) {
  const series = [{ key: 'value', label: seriesLabel, color: 'var(--chart-1)' }];
  const categories = items.map((item) => ({
    key: item.key,
    label: item.label,
    values: { value: { value: item.value, display: item.display } },
  }));
  return <GroupedBarChart caption={caption} categories={categories} series={series} showValues tickFormat={tickFormat} note={note} />;
}
