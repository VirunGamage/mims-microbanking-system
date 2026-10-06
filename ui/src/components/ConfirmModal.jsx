// A "are you sure?" dialog for actions that can't be undone (closing an FD, running interest). Owner: Shanuja.
// It uses the browser's own <dialog>, which keeps keyboard focus inside and closes with Escape.
// This is the reusable confirmation popup. The page passes in the title, the message and what the buttons do and it blocks the action until the user confirms or cancels.
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

