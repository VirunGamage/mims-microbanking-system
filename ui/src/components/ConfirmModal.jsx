// A "are you sure?" dialog for actions that can't be undone (closing an FD, running interest). Owner: Shanuja.
// It uses the browser's own <dialog>, which keeps keyboard focus inside and closes with Escape.
// TODO(Shanuja): add your own explanation of this file here.
import { useEffect, useId, useRef } from 'react';

export default function ConfirmModal({
  open,
  title,
  children,
  confirmLabel,
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
  busy = false,
  confirmDisabled = false,
  danger = false,
}) {
  const dialogRef = useRef(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      className="modal"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault(); // Escape: let the page decide, and never close while the action is running
        if (!busy) onCancel();
      }}
    >
      <h2 id={titleId}>{title}</h2>
      <div>{children}</div>
      <div className="modal__actions">
        <button type="button" className="button button--quiet" onClick={onCancel} disabled={busy}>
          {cancelLabel}
        </button>
        <button type="button" className={`button${danger ? ' button--danger' : ''}`} onClick={onConfirm} disabled={busy || confirmDisabled}>
          {busy ? 'Working…' : confirmLabel}
        </button>
      </div>
    </dialog>
  );
}

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