// A scrollable table with a sticky header and right-aligned money columns. Owner: Shanuja.
// columns: [{ key, header, align: 'right' for numbers, render(row) for custom cells }].
// This is the reusable table. The page gives it the column list and the rows and it draws a table with a sticky header, right-aligned number columns and an empty message when there are no rows.
import EmptyState from './EmptyState.jsx';

export default function DataTable({ columns, rows, caption, hideCaption = false, rowKey, emptyTitle = 'Nothing to show yet.', emptyHint }) {
  if (!rows || rows.length === 0) {
    return <EmptyState title={emptyTitle}>{emptyHint && <p>{emptyHint}</p>}</EmptyState>;
  }
  return (
    // tabIndex lets keyboard users scroll a wide table sideways
    <div className="table-wrap" tabIndex={0} role="region" aria-label={caption ?? 'Table'}>
      <table className="data-table">
        {/* hideCaption: a heading above already names the table, so the caption is kept for screen readers only */}
        {caption && <caption className={hideCaption ? 'visually-hidden' : undefined}>{caption}</caption>}
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key} scope="col" className={column.align === 'right' ? 'num' : undefined}>
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={rowKey ? rowKey(row) : index}>
              {columns.map((column) => (
                <td key={column.key} className={column.align === 'right' ? 'num' : undefined}>
                  {column.render ? column.render(row) : row[column.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
