// The customer's first page: a greeting, the money held in savings and in fixed deposits, each account with what can
// still be sent today, the active fixed deposits, and the latest movements on all their accounts.
import { Link } from 'react-router-dom';
import { availableToday, greeting } from '../utils/customerRules.js';
import { termLabel } from '../utils/fdRules.js';
import { formatDate, formatDateTime, formatPercent } from '../utils/format.js';
import { describe } from '../utils/ledger.js';
import { addAmounts, formatMoney } from '../utils/money.js';
import { useBanking } from './CustomerApp.jsx';

export default function Overview() {
  const { profile, accounts, fixedDeposits, recent, dailyWithdrawalLimit } = useBanking();
  const active = fixedDeposits.filter((fd) => fd.status === 'ACTIVE');
  const savingsTotal = accounts.reduce((sum, account) => addAmounts(sum, account.balance), '0.00');
  const fdTotal = active.reduce((sum, fd) => addAmounts(sum, fd.amount), '0.00');

  return (
    <>
      <header className="portal-hello">
        <div>
          <p className="portal-hello__eyebrow">{greeting(new Date().getHours())},</p>
          <h1>{profile.firstName} {profile.lastName}</h1>
        </div>
        <dl className="portal-totals">
          <div>
            <dt>In savings</dt>
            <dd className="mono">{formatMoney(savingsTotal)}</dd>
          </div>
          <div>
            <dt>In fixed deposits</dt>
            <dd className="mono">{formatMoney(fdTotal)}</dd>
          </div>
        </dl>
      </header>

      <section className="portal-section" aria-labelledby="accounts-heading">
        <div className="portal-section__head">
          <h2 id="accounts-heading">Your accounts</h2>
          <Link className="button button--small" to="/send">
            Send money
          </Link>
        </div>
        <div className="card-grid">
          {accounts.map((account) => (
            <article key={account.accountId} className="account-card">
              <header className="account-card__head">
                <span className="account-card__plan">{account.planName} savings</span>
                <span className={`status-tag status-tag--${account.status.toLowerCase()}`}>{account.status}</span>
              </header>
              <p className="account-card__no mono">{account.accountNo}</p>
              <p className="account-card__balance mono">{formatMoney(account.balance)}</p>
              <dl className="account-card__facts">
                <div>
                  <dt>Can send today</dt>
                  <dd className="mono">{formatMoney(availableToday(account, dailyWithdrawalLimit))}</dd>
                </div>
                <div>
                  <dt>Interest</dt>
                  <dd>{formatPercent(account.interestRate)} a year</dd>
                </div>
                <div>
                  <dt>Minimum balance</dt>
                  <dd className="mono">{formatMoney(account.minimumBalance)}</dd>
                </div>
                {account.otherHolders && (
                  <div>
                    <dt>Joint with</dt>
                    <dd>{account.otherHolders}</dd>
                  </div>
                )}
              </dl>
              <footer className="account-card__links">
                <Link to={`/history?account=${account.accountId}`}>History</Link>
                <Link to={`/send?from=${account.accountId}`}>Send from this account</Link>
              </footer>
            </article>
          ))}
        </div>
      </section>

      <section className="portal-section" aria-labelledby="fd-heading">
        <div className="portal-section__head">
          <h2 id="fd-heading">Fixed deposits</h2>
          <Link className="button button--quiet button--small" to="/fixed-deposits">
            {active.length ? 'Manage' : 'Open a fixed deposit'}
          </Link>
        </div>
        {active.length === 0 ? (
          <p className="portal-empty">No active fixed deposit. A fixed deposit pays interest into your savings every 30 days.</p>
        ) : (
          <div className="card-grid">
            {active.map((fd) => (
              <article key={fd.fdId} className="fd-card">
                <p className="fd-card__title">
                  {termLabel(fd.termName)} at {formatPercent(fd.interestRate)} · <span className="mono">{fd.accountNo}</span>
                </p>
                <p className="fd-card__amount mono">{formatMoney(fd.amount)}</p>
                <dl className="account-card__facts">
                  <div>
                    <dt>Next payout</dt>
                    <dd>
                      <span className="mono">{formatMoney(fd.interestPerPayout)}</span> on {formatDate(fd.nextPayoutDate)}
                      {fd.payoutDue && <span className="tag tag--warning">due, posted by the bank's daily run</span>}
                    </dd>
                  </div>
                  <div>
                    <dt>Interest paid so far</dt>
                    <dd className="mono">{formatMoney(fd.interestPaid)}</dd>
                  </div>
                  <div>
                    <dt>Matures</dt>
                    <dd>{formatDate(fd.maturityDate)}</dd>
                  </div>
                </dl>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="portal-section" aria-labelledby="recent-heading">
        <div className="portal-section__head">
          <h2 id="recent-heading">Latest activity</h2>
          <Link className="button button--quiet button--small" to="/history">
            Full history
          </Link>
        </div>
        {recent.length === 0 ? (
          <p className="portal-empty">No transactions yet.</p>
        ) : (
          <ul className="activity-list">
            {recent.map((row) => (
              <li key={row.transactionId}>
                <span className="activity-list__what">
                  {describe(row)}
                  <span className="activity-list__meta">
                    {formatDateTime(row.at)} · <span className="mono">{row.accountNo}</span> · <span className="mono">{row.referenceNo}</span>
                  </span>
                </span>
                <span className={`activity-list__amount mono activity-list__amount--${row.direction === 'CREDIT' ? 'in' : 'out'}`}>
                  {row.direction === 'CREDIT' ? '+' : '−'}
                  {formatMoney(row.amount, { currency: false })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
