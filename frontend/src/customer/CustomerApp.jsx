// Online banking for a signed-in customer: the bank-style header, the menu and the five pages. The overview
// (GET /api/me/overview) is loaded once here and shared, and loaded again after every transfer or fixed deposit.
// Online banking has no opening hours: only transactions at a branch counter keep the business-hours rule.
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { Link, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { OVERVIEW_PATH } from '../api/me.js';
import { useApiData } from '../api/useApi.js';
import BrandMark from '../components/BrandMark.jsx';
import ErrorBanner from '../components/ErrorBanner.jsx';
import Loading from '../components/Loading.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import History from './History.jsx';
import MyFixedDeposits from './MyFixedDeposits.jsx';
import Overview from './Overview.jsx';
import Profile from './Profile.jsx';
import SendMoney from './SendMoney.jsx';
import '../styles/portal.css';

const PAGES = [
  { path: '/', title: 'Overview', Component: Overview },
  { path: '/send', title: 'Send money', Component: SendMoney },
  { path: '/fixed-deposits', title: 'Fixed deposits', Component: MyFixedDeposits },
  { path: '/history', title: 'History', Component: History },
  { path: '/profile', title: 'Profile', Component: Profile },
];

const BankingContext = createContext(null);

export function useBanking() {
  const context = useContext(BankingContext);
  if (!context) throw new Error('useBanking must be used inside <CustomerApp>');
  return context;
}

export default function CustomerApp() {
  const { user, signOut } = useAuth();
  const overview = useApiData(OVERVIEW_PATH);
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => setMenuOpen(false), [location.pathname]);

  return (
    <div className="portal">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="portal-header">
        <div className="portal-header__inner">
          <Link to="/" className="portal-brand">
            <BrandMark size={34} />
            <span>
              <span className="portal-brand__name">B-Trust</span>
              <span className="portal-brand__sub">Online banking</span>
            </span>
          </Link>
          <button
            type="button"
            className="menu-button portal-menu-button"
            aria-expanded={menuOpen}
            aria-controls="portal-menu"
            onClick={() => setMenuOpen((open) => !open)}
          >
            Menu
          </button>
          <nav id="portal-menu" aria-label="Online banking" className={`portal-nav${menuOpen ? ' is-open' : ''}`}>
            <ul>
              {PAGES.map((page) => (
                <li key={page.path}>
                  <NavLink to={page.path} end={page.path === '/'}>
                    {page.title}
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>
          <div className="portal-user">
            <span className="portal-user__name">{user.name}</span>
            <button type="button" className="button button--quiet button--small" onClick={signOut}>
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main id="main" tabIndex={-1} className="portal-main">
        {overview.loading && !overview.data && <Loading label="Loading your accounts…" />}
        {overview.error && !overview.data && <ErrorBanner error={overview.error} title="Your accounts could not be loaded" />}
        {overview.data && (
          <BankingContext.Provider value={{ ...overview.data, reload: overview.reload }}>
            <Routes>
              {PAGES.map((page) => (
                <Route key={page.path} path={page.path} element={<PortalPage page={page} />} />
              ))}
              <Route path="*" element={<PortalPage page={{ title: 'Page not found', Component: PortalNotFound }} />} />
            </Routes>
          </BankingContext.Provider>
        )}
      </main>

      <footer className="portal-footer">
        <p>B-Trust Microbanking · A Database Systems group project with sample data, not a real bank.</p>
      </footer>
    </div>
  );
}

function PortalPage({ page }) {
  const firstRender = useRef(true);
  useEffect(() => {
    document.title = `${page.title} · B-Trust Online banking`;
    if (firstRender.current) firstRender.current = false;
    else document.getElementById('main')?.focus({ preventScroll: true });
  }, [page]);
  const { Component } = page;
  return <Component />;
}

function PortalNotFound() {
  return (
    <div className="banner banner--info">
      <p className="banner__title">There is no page at this address</p>
      <p>
        <Link to="/">Go to your overview</Link>.
      </p>
    </div>
  );
}
