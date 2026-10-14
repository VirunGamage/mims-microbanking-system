// The customer's fixed deposits: each one with its payouts so far and what comes next, closing one early, and opening a
// new one online (PROC_OPEN_FIXED_DEPOSIT and PROC_CLOSE_FIXED_DEPOSIT on the ONLINE channel). The preview uses the same
// formula as FUNC_CALC_INTEREST; the database posts the real amounts and checks every rule again.
import { useState } from 'react';
import { closeFixedDeposit, openFixedDeposit } from '../api/me.js';
import { useAction, useApiData } from '../api/useApi.js';
import ConfirmModal from '../components/ConfirmModal.jsx';
import ErrorBanner from '../components/ErrorBanner.jsx';
import FormField from '../components/FormField.jsx';
import Loading from '../components/Loading.jsx';
import MoneyInput from '../components/MoneyInput.jsx';
import PageHeader from '../components/PageHeader.jsx';
import SuccessCard from '../components/SuccessCard.jsx';
import { accountsForNewFd, closeCheck, fdProjection } from '../utils/customerRules.js';
import { addDays, fdAmountError, termLabel } from '../utils/fdRules.js';
import { formatDate, formatPercent, todayIso } from '../utils/format.js';
import { formatMoney, normaliseAmount } from '../utils/money.js';
import { useBanking } from './CustomerApp.jsx';

const STATUS_WORDS = { ACTIVE: 'Active', MATURED: 'Matured', CLOSED: 'Closed early' };

export default function MyFixedDeposits() {
  const { accounts, fixedDeposits, reload } = useBanking();
  const plans = useApiData('/lookups/fd-plans');
  const settings = useApiData('/lookups/settings');
  const [closing, setClosing] = useState(null);
  const close = useAction(closeFixedDeposit);
  const today = todayIso();
  const accountOf = (fd) => accounts.find((account) => account.accountId === fd.accountId);

  async function confirmClose() {
    const result = await close.run(closing.fdId);
    setClosing(null);
    if (result) reload();
  }

  return (
    <>
      <PageHeader
        title="Fixed deposits"
        intro="Money set aside for a fixed term. It earns more than savings and pays its interest into your savings account every 30 days."
      />

      {close.result && (
        <SuccessCard
          title="Fixed deposit closed"
          items={[
            { label: 'Returned to savings', value: formatMoney(close.result.amount), mono: true },
            { label: 'Reference', value: close.result.closure?.referenceNo ?? '—', mono: true },
            { label: 'New savings balance', value: formatMoney(close.result.newBalance), mono: true },
          ]}
        />
      )}
      <ErrorBanner error={close.error} title="The fixed deposit was not closed" />

      <section className="portal-section" aria-labelledby="my-fds">
        <h2 id="my-fds">Your fixed deposits</h2>
        {fixedDeposits.length === 0 ? (
          <p className="portal-empty">You have no fixed deposits yet.</p>
        ) : (
          <div className="card-grid">
            {fixedDeposits.map((fd) => {
              const can = closeCheck(fd, accountOf(fd), today);
              const totalPayouts = settings.data ? Math.floor(fd.durationDays / settings.data.fdInterestCycleDays) : null;
              return (
                <article key={fd.fdId} className={`fd-card${fd.status === 'ACTIVE' ? '' : ' fd-card--done'}`}>
                  <header className="account-card__head">
                    <span className="account-card__plan">
                      FD {fd.fdId} · {termLabel(fd.termName)} at {formatPercent(fd.interestRate)}
                    </span>
                    <span className={`status-tag status-tag--${fd.status.toLowerCase()}`}>{STATUS_WORDS[fd.status] ?? fd.status}</span>
                  </header>
                  <p className="fd-card__amount mono">{formatMoney(fd.amount)}</p>
                  <dl className="account-card__facts">
                    <div>
                      <dt>Savings account</dt>
                      <dd className="mono">{fd.accountNo}</dd>
                    </div>
                    <div>
                      <dt>Started</dt>
                      <dd>{formatDate(fd.startDate)}</dd>
                    </div>
                    <div>
                      <dt>{fd.status === 'ACTIVE' ? 'Matures' : 'Ended'}</dt>
                      <dd>{formatDate(fd.status === 'ACTIVE' ? fd.maturityDate : fd.closeDate)}</dd>
                    </div>
                    <div>
                      <dt>Interest paid</dt>
                      <dd>
                        <span className="mono">{formatMoney(fd.interestPaid)}</span>
                        {totalPayouts !== null && ` (${fd.payouts} of ${totalPayouts} payouts)`}
                      </dd>
                    </div>
                    {fd.status === 'ACTIVE' && (
                      <div>
                        <dt>Next payout</dt>
                        <dd>
                          <span className="mono">{formatMoney(fd.interestPerPayout)}</span> on {formatDate(fd.nextPayoutDate)}
                          {fd.payoutDue && <span className="tag tag--warning">due</span>}
                        </dd>
                      </div>
                    )}
                  </dl>
                  {fd.status === 'ACTIVE' && (
                    <footer className="fd-card__actions">
                      <button type="button" className="button button--quiet button--small" disabled={!can.ok} onClick={() => setClosing(fd)}>
                        Close early
                      </button>
                      {can.reason && <p className="field-hint">{can.reason}</p>}
                    </footer>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </section>

      <OpenForm accounts={accountsForNewFd(accounts, fixedDeposits)} allAccounts={accounts} plans={plans} settings={settings} reload={reload} />

      <ConfirmModal
        open={Boolean(closing)}
        title="Close this fixed deposit early?"
        confirmLabel="Close it"
        danger
        busy={close.busy}
        onConfirm={confirmClose}
        onCancel={() => setClosing(null)}
      >
        {closing && (
          <>
            <p>
              <span className="mono">{formatMoney(closing.amount)}</span> goes back to savings account{' '}
              <span className="mono">{closing.accountNo}</span> now.
            </p>
            <p>The interest of the 30-day period that has not finished is not paid. There is no other penalty.</p>
          </>
        )}
      </ConfirmModal>
    </>
  );
}

function OpenForm({ accounts, allAccounts, plans, settings, reload }) {
  const [accountId, setAccountId] = useState('');
  const [planId, setPlanId] = useState('');
  const [amount, setAmount] = useState('');
  const [errors, setErrors] = useState({});
  const [confirming, setConfirming] = useState(false);
  const open = useAction(openFixedDeposit);

  const account = accounts.find((a) => String(a.accountId) === accountId) ?? accounts[0] ?? null;
  const planList = plans.data ?? [];
  const plan = planList.find((p) => String(p.fdPlanId) === planId) ?? planList[1] ?? planList[0] ?? null;
  const cycle = settings.data?.fdInterestCycleDays;
  const basis = settings.data?.interestDayCountBasis;
  const clean = normaliseAmount(amount);
  const projection = clean && plan && cycle ? fdProjection(clean, plan.interestRate, plan.durationDays, cycle, basis) : null;

  if (open.result) {
    const fd = open.result;
    return (
      <section className="portal-section" aria-labelledby="open-fd">
        <h2 id="open-fd">Open a fixed deposit</h2>
        <SuccessCard
          title="Fixed deposit opened"
          items={[
            { label: 'Amount', value: formatMoney(fd.amount), mono: true },
            { label: 'Term', value: `${termLabel(fd.termName)} at ${formatPercent(fd.interestRate)}` },
            { label: 'First payout', value: `${formatMoney(fd.interestPerPayout)} on ${formatDate(fd.nextPayoutDate)}` },
            { label: 'Matures', value: formatDate(fd.maturityDate) },
            { label: 'Reference', value: fd.referenceNo, mono: true },
            { label: 'Savings balance left', value: formatMoney(fd.newBalance), mono: true },
          ]}
        >
          <div className="form-actions">
            <button type="button" className="button button--quiet" onClick={() => { open.reset(); setAmount(''); }}>
              Done
            </button>
          </div>
        </SuccessCard>
      </section>
    );
  }

  if (accounts.length === 0) {
    const secondaryOnly = allAccounts.length > 0 && allAccounts.every((a) => a.role !== 'PRIMARY');
    return (
      <section className="portal-section" aria-labelledby="open-fd">
        <h2 id="open-fd">Open a fixed deposit</h2>
        <p className="portal-empty">
          {secondaryOnly
            ? 'Only the primary holder of an account can open a fixed deposit on it.'
            : 'Each savings account can have one active fixed deposit at a time, and every account you hold as primary holder already has one.'}
        </p>
      </section>
    );
  }

  function review(event) {
    event.preventDefault();
    open.reset();
    const problem = fdAmountError(amount, account);
    setErrors(problem ? { amount: problem } : {});
    if (!problem && plan) setConfirming(true);
  }

  async function confirm() {
    const result = await open.run({ accountId: account.accountId, fdPlanId: plan.fdPlanId, amount: clean });
    setConfirming(false);
    if (result) reload();
  }

  return (
    <section className="portal-section" aria-labelledby="open-fd">
      <h2 id="open-fd">Open a fixed deposit</h2>
      {plans.loading && <Loading label="Loading the terms…" />}
      <ErrorBanner error={plans.error ?? settings.error} title="The terms could not be loaded" />
      <div className="portal-columns">
        <form className="form panel" onSubmit={review} noValidate>
          <FormField id="fd-account" label="From savings account" hint="The amount moves out of this account into the fixed deposit.">
            <select value={account ? String(account.accountId) : ''} onChange={(event) => setAccountId(event.target.value)}>
              {accounts.map((a) => (
                <option key={a.accountId} value={a.accountId}>
                  {a.accountNo} · {formatMoney(a.balance)}
                </option>
              ))}
            </select>
          </FormField>

          <fieldset className="term-choice">
            <legend>Term</legend>
            {planList.map((p) => (
              <label key={p.fdPlanId} className={plan?.fdPlanId === p.fdPlanId ? 'is-chosen' : undefined}>
                <input type="radio" name="fd-term" value={p.fdPlanId} checked={plan?.fdPlanId === p.fdPlanId} onChange={() => setPlanId(String(p.fdPlanId))} />
                <span className="term-choice__term">{termLabel(p.termName)}</span>
                <span className="term-choice__rate">{formatPercent(p.interestRate)} a year</span>
              </label>
            ))}
          </fieldset>

          <FormField id="fd-amount" label="Amount" error={errors.amount ?? (open.error?.field === 'amount' ? open.error.message : null)}>
            <MoneyInput value={amount} onChange={setAmount} />
          </FormField>

          <ErrorBanner error={open.error && open.error.field !== 'amount' ? open.error : null} title="The fixed deposit was not opened" />
          <div className="form-actions">
            <button type="submit" className="button" disabled={!plan}>
              Review
            </button>
          </div>
        </form>

        <aside className="panel portal-aside" aria-live="polite">
          <h2>What you would earn</h2>
          {projection ? (
            <dl className="summary-list">
              <div>
                <dt>Every 30 days</dt>
                <dd className="mono">{formatMoney(projection.perPayout)}</dd>
              </div>
              <div>
                <dt>Payouts</dt>
                <dd>{projection.payouts}</dd>
              </div>
              <div>
                <dt>Interest in total</dt>
                <dd className="mono">{formatMoney(projection.total)}</dd>
              </div>
              <div>
                <dt>Matures about</dt>
                <dd>{formatDate(addDays(todayIso(), plan.durationDays))}</dd>
              </div>
            </dl>
          ) : (
            <p className="field-hint">Choose a term and type an amount to see the interest.</p>
          )}
        </aside>
      </div>

      <ConfirmModal open={confirming} title="Open this fixed deposit?" confirmLabel="Open it" busy={open.busy} onConfirm={confirm} onCancel={() => setConfirming(false)}>
        {plan && clean && (
          <p>
            <span className="mono">{formatMoney(clean)}</span> moves from <span className="mono">{account?.accountNo}</span> into a{' '}
            {termLabel(plan.termName)} fixed deposit at {formatPercent(plan.interestRate)} a year.
          </p>
        )}
      </ConfirmModal>
    </section>
  );
}
