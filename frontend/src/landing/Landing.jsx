// The public start page: what B-Trust offers, its rates (read from the database, GET /api/rates) and the sign-in box
// for customers, agents and admins, with the demo accounts. After signing in, Root shows the pages for that login.
import { useEffect, useRef, useState } from 'react';
import { useApiData } from '../api/useApi.js';
import BrandMark from '../components/BrandMark.jsx';
import ErrorBanner from '../components/ErrorBanner.jsx';
import FormField from '../components/FormField.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { fdProjection } from '../utils/customerRules.js';
import { termLabel } from '../utils/fdRules.js';
import { formatPercent } from '../utils/format.js';
import { formatMoney } from '../utils/money.js';
import { DEMO_ACCOUNTS, DEMO_PASSWORD } from './demoAccounts.js';
import '../styles/landing.css';

// '3_YEAR' -> '3-year', for "a 3-year fixed deposit"
const TERM_ADJECTIVE = { '6_MONTH': '6-month', '1_YEAR': '1-year', '3_YEAR': '3-year' };

const TABS = [
  { role: 'CUSTOMER', label: 'Customer', intro: 'Online banking: your balances, history, transfers and fixed deposits.' },
  { role: 'AGENT', label: 'Agent', intro: 'The branch screens: customers, accounts, deposits, withdrawals and fixed deposits.' },
  { role: 'ADMIN', label: 'Admin', intro: 'Every screen, plus the Tester view: data checks, the interest run and what the database returned.' },
];

function planAges(planName, settings) {
  if (!settings) return '';
  switch (planName) {
    case 'Children':
      return `Up to age ${settings.ageChildMax}`;
    case 'Teen':
      return `Ages ${settings.ageTeenMin} to ${settings.ageTeenMax}`;
    case 'Adult':
      return `Ages ${settings.ageAdultMin} to ${Number(settings.ageSeniorMin) - 1}`;
    case 'Senior':
      return `Age ${settings.ageSeniorMin} and over`;
    case 'Joint':
      return 'Two holders, any adult ages';
    default:
      return '';
  }
}

export default function Landing() {
  const rates = useApiData('/rates');
  const signInRef = useRef(null);

  useEffect(() => {
    document.title = 'B-Trust Microbanking · Savings, fixed deposits and online banking';
  }, []);

  const settings = rates.data?.settings;
  const fds = rates.data?.fixedDeposits ?? [];
  const best = fds.reduce((top, fd) => (top === null || Number(fd.interestRate) > Number(top.interestRate) ? fd : top), null);
  const example = fds.find((fd) => fd.termName === '1_YEAR') ?? fds[0];
  const exampleProjection = example && settings
    ? fdProjection('100000.00', example.interestRate, example.durationDays, Number(settings.fdInterestCycleDays), Number(settings.interestDayCountBasis))
    : null;

  const goToSignIn = () => {
    signInRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    signInRef.current?.querySelector('input')?.focus({ preventScroll: true });
  };

  return (
    <div className="landing">
      <a className="skip-link" href="#sign-in">
        Skip to sign in
      </a>
      <div className="landing-utility">
        <div className="landing-wrap">
          <span>
            Branches open Monday to Friday
            {settings ? `, ${settings.businessDayStart} to ${settings.businessDayEnd}` : ''}
          </span>
          <span>Online banking open 24 hours, every day</span>
        </div>
      </div>

      <header className="landing-header">
        <div className="landing-wrap landing-header__inner">
          <a className="landing-brand" href="#top">
            <BrandMark size={40} />
            <span>
              <span className="landing-brand__name">B-Trust</span>
              <span className="landing-brand__sub">Microbanking</span>
            </span>
          </a>
          <nav aria-label="Sections" className="landing-nav">
            <a href="#savings">Savings</a>
            <a href="#fixed-deposits">Fixed deposits</a>
            <a href="#online">Online banking</a>
          </nav>
          <button type="button" className="button landing-header__cta" onClick={goToSignIn}>
            Sign in
          </button>
        </div>
      </header>

      <main id="top">
        <section className="landing-hero">
          <div className="landing-wrap landing-hero__inner">
            <div className="landing-hero__copy">
              <p className="landing-eyebrow">Banking that comes to your village</p>
              <h1>Savings that grow with your family.</h1>
              <p className="landing-hero__lead">
                An agent who knows you, a savings plan for every age, and fixed deposits that pay interest every
                {settings ? ` ${settings.fdInterestCycleDays}` : ' 30'} days. Check your balance, send money and open a
                fixed deposit online.
              </p>
              <ul className="landing-highlights">
                <li>
                  <strong>{best ? formatPercent(best.interestRate) : '—'}</strong>
                  <span>a year on a {best ? TERM_ADJECTIVE[best.termName] ?? termLabel(best.termName) : ''} fixed deposit</span>
                </li>
                <li>
                  <strong>{rates.data ? rates.data.savings.length : '—'}</strong>
                  <span>savings plans, from children to seniors</span>
                </li>
                <li>
                  <strong>{settings ? settings.fdInterestCycleDays : '30'} days</strong>
                  <span>between interest payouts</span>
                </li>
              </ul>
            </div>
            <div className="landing-hero__panel" ref={signInRef}>
              <SignIn />
            </div>
          </div>
        </section>

        <section id="savings" className="landing-section">
          <div className="landing-wrap">
            <h2>A savings plan for every stage of life</h2>
            <p className="landing-section__lead">
              The plan is chosen for you from the holder's age when the account is opened, so it always fits.
            </p>
            <ErrorBanner error={rates.error} title="The rates could not be loaded" />
            <div className="plan-grid">
              {(rates.data?.savings ?? []).map((plan) => (
                <article key={plan.planName} className="plan-card">
                  <h3>{plan.planName}</h3>
                  <p className="plan-card__ages">{planAges(plan.planName, settings)}</p>
                  <p className="plan-card__rate">
                    {formatPercent(plan.interestRate)}
                    <span> a year</span>
                  </p>
                  <p className="plan-card__min">
                    {Number(plan.minimumBalance) === 0 ? 'No minimum balance' : `Keep at least ${formatMoney(plan.minimumBalance)}`}
                  </p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="fixed-deposits" className="landing-section landing-section--tint">
          <div className="landing-wrap landing-split">
            <div>
              <h2>Fixed deposits that pay as you go</h2>
              <p className="landing-section__lead">
                Put money aside for a fixed term and receive the interest in your savings account every
                {settings ? ` ${settings.fdInterestCycleDays}` : ' 30'} days, not only at the end.
              </p>
              {exampleProjection && (
                <p className="landing-example">
                  For example, {formatMoney('100000.00')} for {termLabel(example.termName)} at {formatPercent(example.interestRate)}{' '}
                  pays <strong>{formatMoney(exampleProjection.perPayout)}</strong> every {settings.fdInterestCycleDays} days,{' '}
                  {formatMoney(exampleProjection.total)} in all.
                </p>
              )}
            </div>
            <table className="rate-table">
              <caption className="visually-hidden">Fixed deposit rates</caption>
              <thead>
                <tr>
                  <th scope="col">Term</th>
                  <th scope="col" className="num">Interest a year</th>
                </tr>
              </thead>
              <tbody>
                {fds.map((fd) => (
                  <tr key={fd.termName}>
                    <td>{termLabel(fd.termName)}</td>
                    <td className="num">{formatPercent(fd.interestRate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section id="online" className="landing-section">
          <div className="landing-wrap">
            <h2>Online banking, with the same care as the branch</h2>
            <div className="feature-grid">
              <article>
                <h3>See everything</h3>
                <p>Balances, your passbook line by line, fixed deposits and the next interest payout.</p>
              </article>
              <article>
                <h3>Send money, any time</h3>
                <p>To any B-Trust account, day or night, with the recipient's name shown before you confirm.</p>
              </article>
              <article>
                <h3>Open a fixed deposit</h3>
                <p>Choose a term, see what it earns, and open or close it yourself.</p>
              </article>
              <article>
                <h3>Safe by design</h3>
                <p>
                  Every rule is checked by the bank's database itself: minimum balances, a daily limit
                  {settings ? ` of ${formatMoney(settings.dailyWithdrawalLimit)}` : ''}, and records that can never be edited.
                </p>
              </article>
            </div>
          </div>
        </section>
      </main>

      <footer className="landing-footer">
        <div className="landing-wrap">
          <p>
            <strong>B-Trust Microbanking</strong> · A Database Systems group project. Sample data only; this is not a real bank.
          </p>
        </div>
      </footer>
    </div>
  );
}

function SignIn() {
  const { signIn } = useAuth();
  const [role, setRole] = useState('CUSTOMER');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const tab = TABS.find((t) => t.role === role);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signIn({ username: username.trim(), password, role });
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  function fillDemo(account) {
    setUsername(account.username);
    setPassword(DEMO_PASSWORD);
    setError(null);
  }

  return (
    <section id="sign-in" className="sign-in" aria-labelledby="sign-in-heading">
      <h2 id="sign-in-heading">Sign in</h2>
      <fieldset className="sign-in__tabs">
        <legend className="visually-hidden">Sign in as</legend>
        {TABS.map((t) => (
          <label key={t.role} className={role === t.role ? 'is-chosen' : undefined}>
            <input
              type="radio"
              name="sign-in-role"
              value={t.role}
              checked={role === t.role}
              onChange={() => {
                setRole(t.role);
                setError(null);
              }}
            />
            {t.label}
          </label>
        ))}
      </fieldset>
      <p className="sign-in__intro">{tab.intro}</p>

      <form onSubmit={submit} className="form" noValidate>
        <FormField id="username" label="Username" error={error?.field === 'username' ? error.message : null}>
          <input type="text" autoComplete="username" autoCapitalize="none" spellCheck="false" value={username} onChange={(event) => setUsername(event.target.value)} />
        </FormField>
        <FormField id="password" label="Password" error={error?.field === 'password' ? error.message : null}>
          <PasswordInput value={password} onChange={setPassword} shown={showPassword} onToggle={() => setShowPassword((show) => !show)} />
        </FormField>
        <ErrorBanner error={error && !error.field ? error : null} title="Could not sign in" />
        <button type="submit" className="button sign-in__submit" disabled={busy}>
          {busy ? 'Signing in…' : `Sign in as ${tab.label.toLowerCase()}`}
        </button>
      </form>

      <details className="demo-accounts">
        <summary>Demo accounts (sample data)</summary>
        <p>
          Every demo password is <code>{DEMO_PASSWORD}</code>. Choose one to fill in the form.
        </p>
        <ul>
          {DEMO_ACCOUNTS[role].map((account) => (
            <li key={account.username}>
              <button type="button" className="demo-accounts__use" onClick={() => fillDemo(account)}>
                <span className="mono">{account.username}</span>
                <span className="demo-accounts__who">
                  {account.who} · {account.note}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}

// FormField gives this its id and aria attributes; they belong on the input, not on the wrapper.
function PasswordInput({ value, onChange, shown, onToggle, ...inputProps }) {
  return (
    <div className="password-input">
      <input
        {...inputProps}
        type={shown ? 'text' : 'password'}
        autoComplete="current-password"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      <button type="button" className="password-input__toggle" aria-pressed={shown} onClick={onToggle}>
        {shown ? 'Hide' : 'Show'}
      </button>
    </div>
  );
}
