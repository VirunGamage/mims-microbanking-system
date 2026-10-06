// What a list or table shows when there is nothing in it yet, with a hint about what to do next. Owner: Shanuja.
// This is the small message shown in place of a list or table when it has no rows. The page gives it a title and an optional hint about what to do next.
export default function EmptyState({ title, children }) {
  return (
    <div className="empty-state">
      <p className="empty-state__title">{title}</p>
      {children && <div className="empty-state__body">{children}</div>}
    </div>
  );
}
