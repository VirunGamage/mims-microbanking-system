// Fixed Deposits: open one from a savings account, see every FD with its next payout, and close one early.
// Uses POST /api/fixed-deposits (PROC_OPEN_FIXED_DEPOSIT), POST /api/fixed-deposits/:id/close
// (PROC_CLOSE_FIXED_DEPOSIT), GET /api/fixed-deposits, GET /api/accounts/:id and the FD plan and settings lookups.
// This is the Fixed deposits page. It lets an agent open an FD from a savings account, see every FD with its next payout and close one early.
// It checks the input first, then asks the database through the API and shows the database's own error messages.

import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { accountPath, getAccount } from '../api/customers.js';
import { closeFixedDeposit, fixedDepositsPath, openFixedDeposit } from '../api/fixedDeposits.js';
import { useAction, useApiData, useBranchStatus } from '../api/useApi.js';
import AccountPicker from '../components/accounts/AccountPicker.jsx';
import ConfirmModal from '../components/ConfirmModal.jsx';
import DataTable from '../components/DataTable.jsx';
import ErrorBanner from '../components/ErrorBanner.jsx';
import FormField from '../components/FormField.jsx';
import Loading from '../components/Loading.jsx';
import MoneyInput from '../components/MoneyInput.jsx';
import PageHeader from '../components/PageHeader.jsx';
import SuccessCard from '../components/SuccessCard.jsx';
import { useAgent } from '../context/AgentContext.jsx';
import { addDays, fdAmountError, interestFor, termLabel } from '../utils/fdRules.js';
import { formatDate, formatPercent, todayIso } from '../utils/format.js';
import { formatMoney, normaliseAmount, subtractAmounts } from '../utils/money.js';
import '../styles/fixedDeposits.css';

export const meta = { path: '/fixed-deposits', title: 'Fixed deposits', order: 4 };

const STATUS_WORDS = { ACTIVE: 'Active', MATURED: 'Matured', CLOSED: 'Closed early' };

export default function FixedDeposits() {
  const [params, setParams] = useSearchParams();
  const accountId = params.get('account');
  const [status, setStatus] = useState('ACTIVE');
  const list = useApiData(fixedDepositsPath({ status }));
  const [closing, setClosing] = useState(null);
  const [closed, setClosed] = useState(null);

  function choose(account) {
    const next = new URLSearchParams(params);
    if (account) next.set('account', account.accountId);
    else next.delete('account');
    setParams(next);
  }

  return (
    <>
      <PageHeader
        title="Fixed deposits"
        intro="Move money from a savings account into a fixed deposit, follow its payouts, or close it early. Interest is paid into the savings account every 30 days."
      />
      <OpenFixedDeposit accountId={accountId} onChoose={choose} onOpened={list.reload} />

      <section className="section fd-list" aria-labelledby="fd-list-heading">
        <div className="fd-list__head">
          <h2 id="fd-list-heading">Fixed deposits</h2>
          <label className="inline-field">
            <span>Show</span>
            <select value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="ACTIVE">Active</option>
              <option value="MATURED">Matured</option>
              <option value="CLOSED">Closed early</option>
              <option value="">All</option>
            </select>
          </label>
        </div>
        {closed && <ClosedCard fd={closed} onDismiss={() => setClosed(null)} />}
        <FdTable state={list} onClose={setClosing} />
      </section>

      {closing && (
        <CloseDialog
          fd={closing}
          onCancel={() => setClosing(null)}
          onClosed={(result) => {
            setClosing(null);
            setClosed(result);
            list.reload();
          }}
        />
      )}
    </>
  );
}

function OpenFixedDeposit({ accountId, onChoose, onOpened }) {
  const { agent, agentId } = useAgent();
  const account = useApiData(accountId ? accountPath(accountId) : null);
  const activeFds = useApiData(accountId ? fixedDepositsPath({ accountId, status: 'ACTIVE' }) : null);
  const plans = useApiData('/lookups/fd-plans');
  const settings = useApiData('/lookups/settings');
  const status = useBranchStatus();
  const [holderId, setHolderId] = useState('');
  const [planId, setPlanId] = useState('');
  const [amount, setAmount] = useState('');
  const [errors, setErrors] = useState({});
  const open = useAction(openFixedDeposit);
  const data = account.data;

  // A newly chosen account starts with its primary holder asking (only they may open an FD).
  useEffect(() => {
    const primary = data?.holders.find((holder) => holder.role === 'PRIMARY');
    setHolderId(primary ? String(primary.customerId) : '');
  }, [data?.accountId]); // the holder list itself is reloaded after every action

  const plan = plans.data?.find((p) => String(p.fdPlanId) === planId) ?? null;
  const cycle = settings.data?.fdInterestCycleDays;
  const cleanAmount = normaliseAmount(amount);
  const today = status.data?.serverTime?.slice(0, 10) ?? todayIso(); // the database's date, which the FD will start on
  const existing = activeFds.data?.[0] ?? null;
  const serverField = open.error?.field;
  const fieldError = (field) => errors[field] ?? (serverField === field ? open.error.message : undefined);
  const bannerError = open.error && !['amount', 'customerId', 'fdPlanId', 'accountId'].includes(serverField) ? open.error : null;

  function clear(field) {
    setErrors((current) => ({ ...current, [field]: undefined }));
    if (open.error) open.reset();
  }

  async function submit(event) {
    event.preventDefault();
    const found = {};
    if (!data) found.accountId = 'Choose the savings account the money comes from';
    if (!holderId) found.customerId = 'Choose the holder who is asking';
    if (!plan) found.fdPlanId = 'Choose a term';
    const amountProblem = fdAmountError(amount, data);
    if (amountProblem) found.amount = amountProblem;
    setErrors(found);
    if (Object.keys(found).length > 0 || !agentId) return;
    const result = await open.run({
      accountId: data.accountId,
      customerId: Number(holderId),
      fdPlanId: plan.fdPlanId,
      amount: cleanAmount,
      agentId,
    });
    if (result) {
      setAmount('');
      account.reload();
      activeFds.reload();
      onOpened();
    }
  }

  return (
    <section className="panel" aria-labelledby="open-fd-heading">
      <h2 id="open-fd-heading">Open a fixed deposit</h2>
      {open.result && <OpenedCard fd={open.result} />}
      {status.data && !status.data.branchOpen && (
        <div className="banner banner--warning" role="note">
          <p className="banner__title">The branch is closed now</p>
          <p>New fixed deposits are only accepted Monday to Friday, during business hours. The database will refuse one until then.</p>
        </div>
      )}
      <ErrorBanner error={bannerError} title="The fixed deposit was not opened" />
      <form className="form form--wide" noValidate onSubmit={submit}>
        <AccountPicker
          id="fd-account"
          label="Savings account the money comes from"
          value={data}
          onChange={(chosen) => {
            onChoose(chosen);
            clear('accountId');
          }}
          error={fieldError('accountId')}
        />
        {data && (
          <p className="field-hint">
            Balance {formatMoney(data.balance)} · {data.planName} plan minimum {formatMoney(data.minimumBalance)} · up to{' '}
            {formatMoney(subtractAmounts(data.balance, data.minimumBalance))} can go into a fixed deposit.
          </p>
        )}
        {existing && (
          <div className="banner banner--info" role="note">
            <p className="banner__title">{data?.accountNo} already has an active fixed deposit</p>
            <p>
              FD {existing.fdId} ({formatMoney(existing.amount)}, matures {formatDate(existing.maturityDate)}). The database
              allows one active fixed deposit per savings account.
            </p>
          </div>
        )}

        {data && (
          <FormField id="fd-holder" label="Holder asking" hint="Only the primary holder can open a fixed deposit." error={fieldError('customerId')}>
            <select
              value={holderId}
              onChange={(event) => {
                setHolderId(event.target.value);
                clear('customerId');
              }}
            >
              {data.holders.map((holder) => (
                <option key={holder.customerId} value={holder.customerId}>
                  {holder.name} ({holder.role === 'PRIMARY' ? 'primary' : 'second holder'})
                </option>
              ))}
            </select>
          </FormField>
        )}

        <fieldset className="term-options" aria-describedby={fieldError('fdPlanId') ? 'fd-term-error' : undefined}>
          <legend>Term</legend>
          {plans.loading && <Loading />}
          {plans.data?.map((option) => (
            <label key={option.fdPlanId} className="term-option">
              <input
                type="radio"
                name="fd-term"
                value={option.fdPlanId}
                checked={planId === String(option.fdPlanId)}
                onChange={(event) => {
                  setPlanId(event.target.value);
                  clear('fdPlanId');
                }}
              />
              <span className="term-option__name">{termLabel(option.termName)}</span>
              <span className="term-option__rate">{formatPercent(option.interestRate)} a year</span>
              <span className="term-option__days">{option.durationDays} days</span>
            </label>
          ))}
          {fieldError('fdPlanId') && (
            <p id="fd-term-error" className="field-error">
              {fieldError('fdPlanId')}
            </p>
          )}
        </fieldset>

        <FormField id="fd-amount" label="Amount" error={fieldError('amount')}>
          <MoneyInput
            value={amount}
            onChange={(value) => {
              setAmount(value);
              clear('amount');
            }}
          />
        </FormField>

        {plan && cleanAmount && cycle && settings.data && (
          <div className="fd-preview" aria-live="polite">
            <p>
              About <strong className="mono">{formatMoney(interestFor(cleanAmount, plan.interestRate, cycle, settings.data.interestDayCountBasis))}</strong>{' '}
              interest every {cycle} days, paid into {data?.accountNo ?? 'the savings account'}, first on{' '}
              {formatDate(addDays(today, cycle))}.
            </p>
            <p>
              Matures on {formatDate(addDays(today, plan.durationDays))}; then {formatMoney(cleanAmount)} goes back to the
              savings account. The database posts the exact amounts.
            </p>
          </div>
        )}

        <p className="field-hint">{agent ? `Processed by ${agent.name}, ${agent.branchName}.` : 'Choose who you are acting as in the bar at the top.'}</p>
        <div className="form-actions">
          <button type="submit" className="button" disabled={open.busy || !agentId}>
            {open.busy ? 'Opening…' : 'Open fixed deposit'}
          </button>
        </div>
      </form>
    </section>
  );
}

function OpenedCard({ fd }) {
  return (
    <SuccessCard
      title={`Fixed deposit FD ${fd.fdId} opened`}
      items={[
        { label: 'Amount', value: formatMoney(fd.amount), mono: true },
        { label: 'Term', value: `${termLabel(fd.termName)}, ${formatPercent(fd.interestRate)} a year` },
        { label: 'Interest per payout', value: formatMoney(fd.interestPerPayout), mono: true },
        { label: 'First payout', value: formatDate(fd.nextPayoutDate) },
        { label: 'Matures', value: formatDate(fd.maturityDate) },
        { label: 'Reference', value: fd.referenceNo, mono: true },
        { label: `${fd.accountNo} balance now`, value: formatMoney(fd.newBalance), mono: true },
      ]}
    />
  );
}

function FdTable({ state, onClose }) {
  if (state.loading && !state.data) return <Loading label="Loading the fixed deposits…" />;
  if (state.error) return <ErrorBanner error={state.error} title="Could not load the fixed deposits" />;
  return (
    <DataTable
      caption="Fixed deposits"
      hideCaption
      rows={state.data}
      rowKey={(row) => row.fdId}
      emptyTitle="No fixed deposits to show."
      columns={[
        { key: 'fdId', header: 'FD', render: (row) => <span className="mono nowrap">FD {row.fdId}</span> },
        { key: 'accountNo', header: 'Account', render: (row) => <span className="mono">{row.accountNo}</span> },
        { key: 'primaryHolder', header: 'Primary holder' },
        { key: 'termName', header: 'Term', render: (row) => <span className="nowrap">{termLabel(row.termName)}, {formatPercent(row.interestRate)}</span> },
        { key: 'amount', header: 'Amount', align: 'right', render: (row) => formatMoney(row.amount) },
        { key: 'startDate', header: 'Started', render: (row) => <span className="nowrap">{formatDate(row.startDate)}</span> },
        { key: 'maturityDate', header: 'Matures', render: (row) => <span className="nowrap">{formatDate(row.maturityDate)}</span> },
        {
          key: 'nextPayoutDate',
          header: 'Next payout',
          render: (row) =>
            row.status !== 'ACTIVE' ? (
              '—'
            ) : (
              <>
                <span className="nowrap">
                  {formatDate(row.nextPayoutDate)} · {formatMoney(row.interestPerPayout)}
                </span>
                {row.payoutDue && <span className="tag tag--warning">due, not posted yet</span>}
              </>
            ),
        },
        { key: 'interestPaid', header: 'Paid so far', align: 'right', render: (row) => formatMoney(row.interestPaid) },
        {
          key: 'status',
          header: 'Status',
          render: (row) => (row.status === 'ACTIVE' ? 'Active' : `${STATUS_WORDS[row.status]} ${formatDate(row.closeDate)}`),
        },
        {
          key: 'action',
          header: <span className="visually-hidden">Action</span>,
          render: (row) =>
            row.status === 'ACTIVE' ? (
              <button type="button" className="button button--quiet button--small" onClick={() => onClose(row)}>
                Close early<span className="visually-hidden"> FD {row.fdId}</span>
              </button>
            ) : null,
        },
      ]}
    />
  );
}

function CloseDialog({ fd, onCancel, onClosed }) {
  const { agentId } = useAgent();
  const [account, setAccount] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [holderId, setHolderId] = useState('');
  const [attempt, setAttempt] = useState(0); // "Try again" loads the holders once more
  const close = useAction((body) => closeFixedDeposit(fd.fdId, body));

  useEffect(() => {
    let cancelled = false;
    setLoadError(null);
    getAccount(fd.accountId)
      .then((loaded) => {
        if (cancelled) return;
        setAccount(loaded);
        const primary = loaded.holders.find((holder) => holder.role === 'PRIMARY');
        setHolderId(primary ? String(primary.customerId) : '');
      })
      .catch((error) => !cancelled && setLoadError(error));
    return () => {
      cancelled = true;
    };
  }, [fd.accountId, attempt]);

  async function confirm() {
    if (!holderId || !agentId) return;
    const result = await close.run({ customerId: Number(holderId), agentId });
    if (result) onClosed(result);
  }

  const holderError = close.error?.field === 'customerId' ? close.error.message : undefined;
  return (
    <ConfirmModal
      open
      title={`Close FD ${fd.fdId} before it matures?`}
      confirmLabel={`Close FD ${fd.fdId}`}
      danger
      busy={close.busy}
      confirmDisabled={!account || !holderId || !agentId}
      onCancel={onCancel}
      onConfirm={confirm}
    >
      <p>
        <strong className="mono">{formatMoney(fd.amount)}</strong> goes back to savings account{' '}
        <span className="mono">{fd.accountNo}</span>.
      </p>
      <p>
        It would mature on {formatDate(fd.maturityDate)}. Closing early forfeits the interest of the payout cycle that hasn't
        finished; there is no other penalty. The {fd.payouts} payouts already made ({formatMoney(fd.interestPaid)}) stay in the
        account.
      </p>
      {fd.payoutDue && (
        <div className="banner banner--warning" role="note">
          <p className="banner__title">A payout is due but not posted</p>
          <p>
            {formatMoney(fd.interestPerPayout)} was due on {formatDate(fd.nextPayoutDate)}. Closing now would lose it. Post the
            interest first: Tester view, Data checks, Run interest.
          </p>
        </div>
      )}
      {close.error && !holderError && <ErrorBanner error={close.error} title="The fixed deposit was not closed" />}
      {account ? (
        <FormField id="close-holder" label="Holder asking" hint="Only the primary holder can close a fixed deposit." error={holderError}>
          <select value={holderId} onChange={(event) => { setHolderId(event.target.value); if (close.error) close.reset(); }}>
            {account.holders.map((holder) => (
              <option key={holder.customerId} value={holder.customerId}>
                {holder.name} ({holder.role === 'PRIMARY' ? 'primary' : 'second holder'})
              </option>
            ))}
          </select>
        </FormField>
      ) : loadError ? (
        <>
          <ErrorBanner error={loadError} title="Could not load the account holders" />
          <button type="button" className="button button--quiet button--small" onClick={() => setAttempt((n) => n + 1)}>
            Try again
          </button>
        </>
      ) : (
        <Loading label="Loading the account holders…" />
      )}
    </ConfirmModal>
  );
}

function ClosedCard({ fd, onDismiss }) {
  return (
    <SuccessCard
      title={`FD ${fd.fdId} closed`}
      items={[
        { label: 'Returned to savings', value: formatMoney(fd.closure?.amount ?? fd.amount), mono: true },
        { label: 'Reference', value: fd.closure?.referenceNo ?? '—', mono: true },
        { label: `${fd.accountNo} balance now`, value: formatMoney(fd.newBalance), mono: true },
        { label: 'Closed on', value: formatDate(fd.closeDate) },
      ]}
    >
      <div className="form-actions">
        <button type="button" className="button button--quiet" onClick={onDismiss}>
          Done
        </button>
      </div>
    </SuccessCard>
  );
}
