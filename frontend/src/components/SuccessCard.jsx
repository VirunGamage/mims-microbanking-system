// A summary of what was just saved (reference number, new balance and so on), shown after a successful action.
// items: [{ label, value, mono }] where mono shows the value in the ledger typeface.
// A reusable confirmation card for after an action succeeds — I use it on the Fixed Deposits page to show the reference number and new balance.
// So every success screen in the app has the same shape instead of each page building its own.

export default function SuccessCard({ title, items = [], children }) {
  return (
    <section className="success-card" role="status" aria-live="polite">
      <h2 className="success-card__title">{title}</h2>
      {items.length > 0 && (
        <dl className="summary-list">
          {items.map(({ label, value, mono }) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd className={mono ? 'mono' : undefined}>{value}</dd>
            </div>
          ))}
        </dl>
      )}
      {children}
    </section>
  );
}
