// Send money from one of the customer's accounts to any B-Trust account (PROC_TRANSFER on the ONLINE channel).
// The page checks the form and shows the recipient's name first, the way banks do; the database checks every rule
// again (holder, minimum balance, daily limit) and saves both halves of the transfer together or not at all.
// Online banking works at any hour; only transactions at a branch keep the business-hours rule.
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { checkRecipient, sendMoney } from '../api/me.js';
import { useAction } from '../api/useApi.js';
import ConfirmModal from '../components/ConfirmModal.jsx';
import ErrorBanner from '../components/ErrorBanner.jsx';
import FormField from '../components/FormField.jsx';
import MoneyInput from '../components/MoneyInput.jsx';
import PageHeader from '../components/PageHeader.jsx';
import SuccessCard from '../components/SuccessCard.jsx';
import { availableToday, normaliseAccountNo, transferErrors } from '../utils/customerRules.js';
import { formatDateTime } from '../utils/format.js';
import { formatMoney, normaliseAmount } from '../utils/money.js';
import { useBanking } from './CustomerApp.jsx';

export default function SendMoney() {
  const { accounts, dailyWithdrawalLimit, reload } = useBanking();
  const [params] = useSearchParams();
  const usable = accounts.filter((account) => account.status === 'ACTIVE');
  const preferred = usable.find((account) => String(account.accountId) === params.get('from')) ?? usable[0];

  const [fromId, setFromId] = useState(preferred ? String(preferred.accountId) : '');
  const [toAccountNo, setToAccountNo] = useState('');
  const [amount, setAmount] = useState('');
  const [errors, setErrors] = useState({});
  const [recipient, setRecipient] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const check = useAction(checkRecipient);
  const send = useAction(sendMoney);

  const from = usable.find((account) => String(account.accountId) === fromId) ?? null;
  const available = from ? availableToday(from, dailyWithdrawalLimit) : undefined;

  if (usable.length === 0) {
    return (
      <>
        <PageHeader title="Send money" />
        <p className="portal-empty">You have no active account to send money from.</p>
      </>
    );
  }

  async function lookUp(accountNo) {
    setRecipient(null);
    const found = await check.run(accountNo);
    if (found) setRecipient(found);
    return found;
  }

  async function review(event) {
    event.preventDefault();
    send.reset();
    const problems = transferErrors({ toAccountNo, amount }, from, available);
    setErrors(problems);
    if (Object.keys(problems).length) return;
    const to = normaliseAccountNo(toAccountNo);
    const found = recipient?.accountNo === to ? recipient : await lookUp(to);
    if (found) setConfirming(true);
  }

  async function confirm() {
    const result = await send.run({ fromAccountId: Number(fromId), toAccountNo: normaliseAccountNo(toAccountNo), amount: normaliseAmount(amount) });
    setConfirming(false);
    if (result) reload();
  }

  function startAgain() {
    send.reset();
    setToAccountNo('');
    setAmount('');
    setRecipient(null);
    setErrors({});
  }

  const serverField = send.error?.field;
  const fieldError = (name) => errors[name] ?? (serverField === name ? send.error.message : null) ?? (name === 'toAccountNo' ? check.error?.message : null);

  if (send.result) {
    const done = send.result;
    return (
      <>
        <PageHeader title="Send money" />
        <SuccessCard
          title="Money sent"
          items={[
            { label: 'Amount', value: formatMoney(done.amount), mono: true },
            { label: 'From', value: from?.accountNo ?? done.fromAccountId, mono: true },
            { label: 'To', value: `${done.toAccountNo}${recipient ? ` (${recipient.holderName})` : ''}`, mono: true },
            { label: 'Your reference', value: done.withdrawalRef, mono: true },
            { label: "Recipient's reference", value: done.depositRef, mono: true },
            { label: 'New balance', value: formatMoney(done.newBalance), mono: true },
            { label: 'Date', value: formatDateTime(done.at) },
          ]}
        >
          <div className="form-actions">
            <button type="button" className="button" onClick={startAgain}>
              Send more
            </button>
            <Link className="button button--quiet" to="/">
              Back to overview
            </Link>
          </div>
        </SuccessCard>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Send money"
        intro="To any B-Trust savings account. The money leaves your account and arrives in the other one at the same moment."
      />
      <div className="portal-columns">
        <form className="form panel" onSubmit={review} noValidate>
          <FormField id="from" label="From" error={serverField === 'fromAccountId' ? send.error.message : null}>
            <select value={fromId} onChange={(event) => setFromId(event.target.value)}>
              {usable.map((account) => (
                <option key={account.accountId} value={account.accountId}>
                  {account.accountNo} · {account.planName} · {formatMoney(account.balance)}
                </option>
              ))}
            </select>
          </FormField>

          <FormField id="to" label="To account number" hint="SA followed by 7 digits, for example SA0000007" error={fieldError('toAccountNo')}>
            <input
              type="text"
              autoComplete="off"
              spellCheck="false"
              value={toAccountNo}
              onChange={(event) => {
                setToAccountNo(event.target.value.toUpperCase());
                setRecipient(null);
                check.reset();
              }}
              onBlur={() => {
                const to = normaliseAccountNo(toAccountNo);
                if (/^SA\d{7}$/.test(to) && recipient?.accountNo !== to) lookUp(to);
              }}
            />
          </FormField>
          {recipient && (
            <p className="recipient" role="status">
              Account holder: <strong>{recipient.holderName}</strong>
              {recipient.status !== 'ACTIVE' && <span className="status-tag status-tag--frozen">{recipient.status}</span>}
            </p>
          )}
          {usable.length > 1 && (
            <p className="field-hint">
              Between your own accounts:{' '}
              {usable
                .filter((account) => account.accountNo !== from?.accountNo)
                .map((account) => (
                  <button key={account.accountId} type="button" className="link-button" onClick={() => setToAccountNo(account.accountNo)}>
                    {account.accountNo}
                  </button>
                ))}
            </p>
          )}

          <FormField
            id="amount"
            label="Amount"
            hint={available !== undefined ? `You can send up to ${formatMoney(available)} from this account today` : null}
            error={fieldError('amount')}
          >
            <MoneyInput value={amount} onChange={setAmount} />
          </FormField>

          <ErrorBanner error={send.error && !['toAccountNo', 'amount', 'fromAccountId'].includes(serverField) ? send.error : null} />
          <div className="form-actions">
            <button type="submit" className="button" disabled={check.busy}>
              {check.busy ? 'Checking the account…' : 'Review and send'}
            </button>
          </div>
        </form>

        <aside className="panel portal-aside">
          <h2>Good to know</h2>
          <ul className="portal-points">
            <li>Your account keeps its plan's minimum balance.</li>
            <li>
              At most {formatMoney(dailyWithdrawalLimit)} a day can leave an account, counting withdrawals and money sent
              together.
            </li>
            <li>Online transfers work at any hour, every day of the week.</li>
            <li>Every transfer appears in both passbooks with its own reference number.</li>
          </ul>
        </aside>
      </div>

      <ConfirmModal
        open={confirming}
        title="Send this money?"
        confirmLabel="Send now"
        busy={send.busy}
        onConfirm={confirm}
        onCancel={() => setConfirming(false)}
      >
        <dl className="summary-list">
          <div>
            <dt>Amount</dt>
            <dd className="mono">{formatMoney(normaliseAmount(amount))}</dd>
          </div>
          <div>
            <dt>From</dt>
            <dd className="mono">{from?.accountNo}</dd>
          </div>
          <div>
            <dt>To</dt>
            <dd>
              <span className="mono">{normaliseAccountNo(toAccountNo)}</span> {recipient && `(${recipient.holderName})`}
            </dd>
          </div>
        </dl>
      </ConfirmModal>
    </>
  );
}
