// The title block at the top of every page — a heading, one line saying what the page is for and room for extra content like a status pill.
export default function PageHeader({ title, intro, children }) {
  return (
    <header className="page-header">
      <h1>{title}</h1>
      {intro && <p className="page-header__intro">{intro}</p>}
      {children}
    </header>
  );
}
