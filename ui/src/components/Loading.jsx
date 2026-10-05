// A quiet "loading" line that screen readers announce. Owner: Shanuja.
// This is the small "Loading…" message shown while a page waits for data. Screen readers announce it and the page can pass its own wording.
export default function Loading({ label = 'Loading…' }) {
  return (
    <p className="loading" role="status" aria-live="polite">
      {label}
    </p>
  );
}
