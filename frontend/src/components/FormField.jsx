// One labelled form field: label, optional hint, the input itself, and the error message beside it. Owner: Shanuja.
// It hands the input its id and the aria attributes, so screen readers read the hint and the error with the field.
// This is the reusable form field. It puts the label, a small hint, the input and any error message together and connects them so screen readers read them with the field.
import { cloneElement } from 'react';

export default function FormField({ id, label, hint, error, optional = false, children }) {
  const hintId = hint ? `${id}-hint` : null;
  const errorId = error ? `${id}-error` : null;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;

  return (
    <div className="field">
      <label htmlFor={id}>
        {label}
        {optional && <span className="optional"> (optional)</span>}
      </label>
      {hint && (
        <p id={hintId} className="field-hint">
          {hint}
        </p>
      )}
      {cloneElement(children, { id, 'aria-describedby': describedBy, 'aria-invalid': error ? 'true' : undefined })}
      {error && (
        <p id={errorId} className="field-error">
          {error}
        </p>
      )}
    </div>
  );
}
