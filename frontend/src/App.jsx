// The page frame (sidebar menu, "Acting as" bar, Agent/Tester switch, branch status) and the routes. Owner: Shanuja.
// Pages are found automatically: every file in src/pages that exports `meta` becomes a route and a menu entry,
// so each slice owner adds their page without editing this file. Uses GET /api/status for the branch light.
// This is the page frame of the app: the sidebar menu, the "Acting as" bar, the Agent/Tester switch and the branch open/closed light. 
// It also finds every page automatically and sets up its route.
import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { useBranchStatus } from './api/useApi.js';
import RequestPanel from './components/RequestPanel.jsx';
import { useAgent } from './context/AgentContext.jsx';

const pageModules = import.meta.glob('./pages/*.jsx', { eager: true });
const PAGES = Object.values(pageModules)
  .filter((module) => module.default && module.meta)
  .map((module) => ({ ...module.meta, Component: module.default }))
  .sort((a, b) => a.order - b.order);

export default function App() {
  const { isTester } = useAgent();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => setMenuOpen(false), [location.pathname]);

  const agentPages = PAGES.filter((page) => !page.testerOnly);
  const testerPages = PAGES.filter((page) => page.testerOnly);

  return (
    <div className="shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <aside className="sidebar">
        <div className="sidebar__inner">
          <Link to="/" className="brand">
            <span className="brand__name">B-Trust MIMS</span>
            <span className="brand__sub">Savings and fixed deposits</span>
          </Link>
          <button
            type="button"
            className="menu-button"
            aria-expanded={menuOpen}
            aria-controls="main-menu"
            onClick={() => setMenuOpen((open) => !open)}
          >
            Menu
          </button>
          <nav id="main-menu" aria-label="Main" className={menuOpen ? 'is-open' : undefined}>
            <ul className="nav-list">
              {agentPages.map((page) => (
                <li key={page.path}>
                  <NavLink to={page.path} end={page.path === '/'}>
                    {page.title}
                  </NavLink>
                </li>
              ))}
            </ul>
            {isTester && testerPages.length > 0 && (
              <ul className="nav-list nav-list__tester" aria-label="Tester pages">
                {testerPages.map((page) => (
                  <li key={page.path}>
                    <NavLink to={page.path}>{page.title}</NavLink>
                  </li>
                ))}
              </ul>
            )}
          </nav>
        </div>
      </aside>

      <div className="workspace">
        <TopBar />
        <main id="main" tabIndex={-1}>
          <Routes>
            {PAGES.map((page) => (
              <Route key={page.path} path={page.path} element={<PageFrame page={page} />} />
            ))}
            <Route path="*" element={<NotFound />} />
          </Routes>
          <RequestPanel />
        </main>
      </div>
    </div>
  );
}

function TopBar() {
  const { agents, agentsError, agentsLoading, agentId, setAgentId, viewMode, setViewMode } = useAgent();
  const status = useBranchStatus();

  const useTypedId = !agentsLoading && (agentsError || agents.length === 0);

  return (
    <div className="topbar">
      <div className="acting-as">
        <label htmlFor="acting-agent">Acting as</label>
        {useTypedId ? (
          <>
            <input
              id="acting-agent"
              type="text"
              inputMode="numeric"
              size={6}
              value={agentId ?? ''}
              placeholder="Agent ID"
              onChange={(event) => setAgentId(event.target.value.replace(/\D/g, ''))}
              aria-describedby="acting-agent-hint"
            />
            <span id="acting-agent-hint" className="acting-as__hint">
              Agent list unavailable, so type an agent ID.
            </span>
          </>
        ) : (
          <select
            id="acting-agent"
            value={agentId ?? ''}
            onChange={(event) => setAgentId(event.target.value)}
            disabled={agentsLoading}
          >
            {agentsLoading && <option value="">Loading agents…</option>}
            {agents.map((agent) => (
              <option key={agent.agentId} value={agent.agentId}>
                {agent.name}, {agent.branchName}
              </option>
            ))}
          </select>
        )}
      </div>

      <fieldset className="view-switch">
        <legend>View</legend>
        {['agent', 'tester'].map((mode) => (
          <label key={mode}>
            <input
              type="radio"
              name="view-mode"
              value={mode}
              checked={viewMode === mode}
              onChange={() => setViewMode(mode)}
            />
            {mode === 'agent' ? 'Agent' : 'Tester'}
          </label>
        ))}
      </fieldset>

      <BranchPill status={status} />
    </div>
  );
}

function BranchPill({ status }) {
  let text = 'Checking branch…';
  let tone = '';
  if (status.error) text = 'Branch status unknown';
  if (status.data) {
    text = status.data.branchOpen ? 'Branch open' : 'Branch closed';
    tone = status.data.branchOpen ? ' branch-pill--open' : ' branch-pill--closed';
  }
  return (
    <p className={`branch-pill${tone}`} role="status" aria-live="polite" title={status.data?.message ?? status.error?.message}>
      <span className="branch-pill__dot" aria-hidden="true" />
      {text}
    </p>
  );
}

function PageFrame({ page }) {
  const { isTester } = useAgent();
  const firstRender = useRef(true);

  useEffect(() => {
    document.title = page.path === '/' ? 'B-Trust MIMS' : `${page.title} · B-Trust MIMS`;
    // After moving to another page, put keyboard focus at the start of the content (not on the first load).
    if (firstRender.current) firstRender.current = false;
    else document.getElementById('main')?.focus({ preventScroll: true });
  }, [page]);

  if (page.testerOnly && !isTester) {
    return (
      <div className="banner banner--info">
        <p className="banner__title">{page.title} is part of the Tester view</p>
        <p>Switch the view to Tester in the bar at the top to use this page.</p>
      </div>
    );
  }
  const { Component } = page;
  return <Component />;
}

function NotFound() {
  useEffect(() => {
    document.title = 'Page not found · B-Trust MIMS';
  }, []);
  return (
    <div className="banner banner--info">
      <p className="banner__title">There is no page at this address</p>
      <p>
        It may not have been added yet. <Link to="/">Go to the Home page</Link>.
      </p>
    </div>
  );
}
