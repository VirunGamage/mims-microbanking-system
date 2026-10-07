// Transactions: choose an account, record a deposit or a withdrawal, and read the account's passbook.
// Uses POST /api/accounts/:id/deposit (PROC_PROCESS_DEPOSIT), POST /api/accounts/:id/withdraw (PROC_PROCESS_WITHDRAWAL),
// GET /api/accounts/:id and GET /api/accounts/:id/transactions. The database checks every rule; this page only explains.

//Provides the Transactions page where an agent selects an account, records deposits or withdrawals and views the passbook.

import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { accountPath } from '../api/customers.js';
import { deposit, passbookPath, withdraw } from '../api/transactions.js';
import { useAction, useApiData, useBranchStatus } from '../api/useApi.js';
import AccountPicker, { holderNames } from '../components/accounts/AccountPicker.jsx';
import Passbook from '../components/accounts/Passbook.jsx';
import ErrorBanner from '../components/ErrorBanner.jsx';
import FormField from '../components/FormField.jsx';
import Loading from '../components/Loading.jsx';
import MoneyInput from '../components/MoneyInput.jsx';
import PageHeader from '../components/PageHeader.jsx';
import SuccessCard from '../components/SuccessCard.jsx';
import { useAgent } from '../context/AgentContext.jsx';
import { formatDateTime, formatPercent } from '../utils/format.js';
import { formatMoney, normaliseAmount } from '../utils/money.js';
import { depositError, willBeFlagged, withdrawalError } from '../utils/transactionRules.js';

export const meta = { path: '/transactions', title: 'Transactions', order: 3 };

export default function Transactions() {
  const [params, setParams] = useSearchParams();
  const accountId = params.get('account');
  const [page, setPage] = useState(1);
  const account = useApiData(accountId ? accountPath(accountId) : null);
  const book = useApiData(accountId ? passbookPath(accountId, page) : null);
  const settings = useApiData('/lookups/settings');
  const status = useBranchStatus();

  useEffect(() => setPage(1), [accountId]);

  function choose(chosen) {
    const next = new URLSearchParams(params);
    if (chosen) next.set('account', chosen.accountId);
    else next.delete('account');
    setParams(next);
  }

  // After a deposit or withdrawal: fresh balance, and the passbook back on its newest page.
  function refresh() {
    account.reload();
    if (page === 1) book.reload();
    else setPage(1);
  }

  const data = account.data;
  const closed = status.data && !status.data.branchOpen;

  return (
    <>
      <PageHeader
        title="Transactions"
        intro="Record a deposit or a withdrawal, and read the account's passbook. The database checks the business hours, the plan minimum and the daily withdrawal limit."
      />

      <AccountPicker id="account" label="Account" value={data} onChange={choose} />
      {account.loading && <Loading label="Loading the account…" />}
      {account.error && <ErrorBanner error={account.error} title="Could not load this account" />}

      {data && (
        <>
          <AccountSummary account={data} withdrawnToday={book.data?.withdrawnToday} settings={settings.data} />
          {closed && (
            <div className="banner banner--warning" role="note">
              <p className="banner__title">The branch is closed now</p>
              <p>
                Deposits and withdrawals are only accepted Monday to Friday
                {settings.data ? `, ${settings.data.businessDayStart}–${settings.data.businessDayEnd}` : ''}, by the
                database clock. The database will refuse them until the branch opens.
              </p>
            </div>
          )}
          {data.status !== 'ACTIVE' ? (
            <div className="banner banner--info" role="note">
              <p className="banner__title">This account is {data.status.toLowerCase()}</p>
              <p>The database refuses deposits and withdrawals on an account that isn't active.</p>
            </div>
          ) : (
            <div className="columns money-forms">
              <DepositForm account={data} settings={settings.data} onDone={refresh} />
              <WithdrawForm account={data} withdrawnToday={book.data?.withdrawnToday} settings={settings.data} onDone={refresh} />
            </div>
          )}
          {book.error && <ErrorBanner error={book.error} title="Could not load the passbook" />}
          {book.data && <Passbook accountNo={data.accountNo} book={book.data} onPage={setPage} />}
          {book.loading && !book.data && <Loading label="Loading the passbook…" />}
        </>
      )}
    </>
  );
}

function AccountSummary({ account, withdrawnToday, settings }) {
  return (
    <dl className="account-strip">
      <div>
        <dt>Balance</dt>
        <dd className="account-strip__balance mono">{formatMoney(account.balance)}</dd>
      </div>
      <div>
        <dt>Plan</dt>
        <dd>
          {account.planName}, {formatPercent(account.interestRate)} a year
          <span className="account-strip__sub">minimum balance {formatMoney(account.minimumBalance)}</span>
        </dd>
      </div>
      <div>
        <dt>{account.holders.length > 1 ? 'Holders' : 'Holder'}</dt>
        <dd>
          {holderNames(account)}
          <span className="account-strip__sub">Status: {account.status.toLowerCase()}</span>
        </dd>
      </div>
      <div>
        <dt>Withdrawn today</dt>
        <dd className="mono">
          {withdrawnToday === undefined ? '…' : formatMoney(withdrawnToday)}
          {settings && <span className="account-strip__sub">daily limit {formatMoney(settings.dailyWithdrawalLimit)}</span>}
        </dd>
      </div>
    </dl>
  );
}

// Shared by both forms: the result card after a success, and errors placed beside the amount when they are about it.
function useMoneyForm(action, onDone) {
  const run = useAction(action);
  const [amount, setAmount] = useState('');
  const [problem, setProblem] = useState(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (run.error?.field === 'amount') inputRef.current?.focus();
  }, [run.error]);

  async function submit(check, body) {
    const found = check(amount);
    setProblem(found);
    if (found) {
      inputRef.current?.focus();
      return;
    }
    const result = await run.run({ ...body, amount: normaliseAmount(amount) });
    if (result) {
      setAmount('');
      onDone();
    }
  }

  const amountError = problem ?? (run.error?.field === 'amount' ? run.error.message : undefined);
  const bannerError = run.error && run.error.field !== 'amount' ? run.error : null;
  return { run, amount, setAmount: (value) => { setAmount(value); setProblem(null); if (run.error) run.reset(); }, amountError, bannerError, inputRef, submit };
}

function DepositForm({ account, settings, onDone }) {
  const { agent, agentId } = useAgent();
  const form = useMoneyForm((body) => deposit(account.accountId, body), onDone);
  const flagged = willBeFlagged(form.amount, settings?.largeDepositThreshold);

  return (
    <section className="panel" aria-labelledby="deposit-heading">
      <h2 id="deposit-heading">Deposit</h2>
      {form.run.result && <MoneyResult title="Deposit recorded" result={form.run.result} />}
      <ErrorBanner error={form.bannerError} title="The deposit was not saved" />
      <form
        className="form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (!agentId) return;
          form.submit(depositError, { agentId });
        }}
      >
        <FormField
          id="deposit-amount"
          label="Amount"
          hint={flagged ? `Above ${formatMoney(settings.largeDepositThreshold)}: it will be saved and flagged for review.` : 'Any amount above zero.'}
          error={form.amountError}
        >
          <MoneyInput ref={form.inputRef} value={form.amount} onChange={form.setAmount} />
        </FormField>
        <p className="field-hint">{agent ? `Recorded by ${agent.name}, ${agent.branchName}.` : 'Choose who you are acting as in the bar at the top.'}</p>
        <div className="form-actions">
          <button type="submit" className="button" disabled={form.run.busy || !agentId}>
            {form.run.busy ? 'Saving…' : 'Record deposit'}
          </button>
        </div>
      </form>
    </section>
  );
}

function WithdrawForm({ account, withdrawnToday, settings, onDone }) {
  const { agent, agentId } = useAgent();
  const [holderId, setHolderId] = useState(account.holders.length === 1 ? String(account.holders[0].customerId) : '');
  const [holderProblem, setHolderProblem] = useState(null);
  const form = useMoneyForm((body) => withdraw(account.accountId, body), onDone);

  // A different account was chosen: start again with its holders (a single holder is chosen automatically).
  useEffect(() => {
    setHolderId(account.holders.length === 1 ? String(account.holders[0].customerId) : '');
  }, [account.accountId]);

  const limits = {
    balance: account.balance,
    minimumBalance: account.minimumBalance,
    withdrawnToday,
    dailyLimit: settings?.dailyWithdrawalLimit,
  };
  const holderError = holderProblem ?? (form.run.error?.field === 'customerId' ? form.run.error.message : undefined);
  const banner = form.bannerError?.field === 'customerId' ? null : form.bannerError;

  return (
    <section className="panel" aria-labelledby="withdraw-heading">
      <h2 id="withdraw-heading">Withdrawal</h2>
      {form.run.result && (
        <MoneyResult
          title="Withdrawal recorded"
          result={form.run.result}
          extra={{ label: 'Taken out by', value: account.holders.find((h) => h.customerId === form.run.result.customerId)?.name }}
        />
      )}
      <ErrorBanner error={banner} title="The withdrawal was not saved" />
      <form
        className="form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (!agentId) return;
          if (!holderId) {
            setHolderProblem('Choose the holder who is taking the money out');
            return;
          }
          form.submit((amount) => withdrawalError(amount, limits), { agentId, customerId: Number(holderId) });
        }}
      >
        <FormField id="withdraw-holder" label="Holder taking the money out" hint="Any holder of the account may withdraw." error={holderError}>
          <select
            value={holderId}
            onChange={(event) => {
              setHolderId(event.target.value);
              setHolderProblem(null);
              if (form.run.error) form.run.reset();
            }}
          >
            {account.holders.length > 1 && <option value="">Choose a holder…</option>}
            {account.holders.map((holder) => (
              <option key={holder.customerId} value={holder.customerId}>
                {holder.name} ({holder.role === 'PRIMARY' ? 'primary' : 'second holder'})
              </option>
            ))}
          </select>
        </FormField>
        <FormField
          id="withdraw-amount"
          label="Amount"
          hint={`The balance must stay at or above ${formatMoney(account.minimumBalance)}; at most ${formatMoney(settings?.dailyWithdrawalLimit ?? '0')} a day in total.`}
          error={form.amountError}
        >
          <MoneyInput ref={form.inputRef} value={form.amount} onChange={form.setAmount} />
        </FormField>
        <p className="field-hint">{agent ? `Recorded by ${agent.name}, ${agent.branchName}.` : 'Choose who you are acting as in the bar at the top.'}</p>
        <div className="form-actions">
          <button type="submit" className="button" disabled={form.run.busy || !agentId}>
            {form.run.busy ? 'Saving…' : 'Record withdrawal'}
          </button>
        </div>
      </form>
    </section>
  );
}

function MoneyResult({ title, result, extra }) {
  const items = [
    { label: 'Reference', value: result.referenceNo, mono: true },
    { label: 'Amount', value: formatMoney(result.amount), mono: true },
    { label: 'New balance', value: formatMoney(result.newBalance), mono: true },
    { label: 'Time', value: formatDateTime(result.at) },
  ];
  if (extra?.value) items.splice(2, 0, extra);
  return (
    <SuccessCard title={title} items={items}>
      {result.reviewFlagged && (
        <p className="banner banner--info">Above the large-deposit limit: saved and flagged for review.</p>
      )}
    </SuccessCard>
  );
}

