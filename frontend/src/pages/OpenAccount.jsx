// Open Account: choose the holder (and a second holder for a joint account), enter the opening deposit, and the
// database opens the account. Owner: Sameera. Uses POST /api/accounts (PROC_OPEN_SAVINGS_ACCOUNT), GET /api/customers
// and the plan and settings lookups. The plan shown before saving is a preview; the procedure makes the final choice.
// Page component for opening savings accounts, handling holder selection, plan previews, and deposits.
import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { isBusinessHoursError } from '../api/client.js';
import { getCustomer, openAccount } from '../api/customers.js';
import { useAction, useApiData, useBranchStatus } from '../api/useApi.js';
import CustomerPicker from '../components/customers/CustomerPicker.jsx';
import ErrorBanner from '../components/ErrorBanner.jsx';
import FormField from '../components/FormField.jsx';
import MoneyInput from '../components/MoneyInput.jsx';
import PageHeader from '../components/PageHeader.jsx';
import SuccessCard from '../components/SuccessCard.jsx';
import { useAgent } from '../context/AgentContext.jsx';
import { expectedPlan, openingAmountError } from '../utils/accountRules.js';
import { formatPercent } from '../utils/format.js';
import { formatMoney, normaliseAmount } from '../utils/money.js';
import '../styles/customers.css';

export const meta = { path: '/open-account', title: 'Open account', order: 2 };

// Server field name -> the field on this page.
const SERVER_FIELDS = { primaryCustomerId: 'primary', secondaryCustomerId: 'secondary', openingAmount: 'amount' };

export default function OpenAccount() {
  const [params] = useSearchParams();
  const prefillId = params.get('primary');
  const { agent, agentId } = useAgent();
  const settings = useApiData('/lookups/settings');
  const plans = useApiData('/lookups/savings-plans');
  const status = useBranchStatus();
  const [primary, setPrimary] = useState(null);
  const [joint, setJoint] = useState(false);
  const [secondary, setSecondary] = useState(null);
  const [amount, setAmount] = useState('');
  const [errors, setErrors] = useState({});
  const open = useAction(openAccount);
  const formRef = useRef(null);

  // Coming from a customer's page (?primary=16): start with that customer already chosen.
  useEffect(() => {
    if (!prefillId) return undefined;
    let cancelled = false;
    getCustomer(prefillId)
      .then((customer) => !cancelled && setPrimary(customer))
      .catch(() => { }); // an unknown ID simply leaves the field empty
    return () => {
      cancelled = true;
    };
  }, [prefillId]);

  useEffect(() => {
    if (open.error?.field && SERVER_FIELDS[open.error.field]) {
      requestAnimationFrame(() => formRef.current?.querySelector('[aria-invalid="true"]')?.focus());
    }
  }, [open.error]);

  const plan = expectedPlan({ age: primary?.age ?? null, joint, settings: settings.data, plans: plans.data });

  function clearProblem(field) {
    setErrors((current) => ({ ...current, [field]: undefined }));
    if (open.error) open.reset();
  }

  async function submit(event) {
    event.preventDefault();
    const found = {};
    if (!primary) found.primary = 'Choose the primary holder';
    if (joint && !secondary) found.secondary = 'Choose the second holder, or untick "Joint account"';
    if (joint && primary && secondary && primary.customerId === secondary.customerId) {
      found.secondary = 'Joint holders must be two different customers';
    }
    const amountProblem = openingAmountError(amount, plan);
    if (amountProblem) found.amount = amountProblem;
    if (!agentId) found.agent = 'Choose who you are acting as in the bar at the top of the page';
    setErrors(found);
    if (Object.keys(found).length > 0) {
      requestAnimationFrame(() => formRef.current?.querySelector('[aria-invalid="true"]')?.focus());
      return;
    }
    await open.run({
      primaryCustomerId: primary.customerId,
      secondaryCustomerId: joint ? secondary.customerId : null,
      openingAmount: normaliseAmount(amount),
      agentId,
    });
  }

  function startAgain() {
    open.reset();
    setPrimary(null);
    setSecondary(null);
    setJoint(false);
    setAmount('');
    setErrors({});
  }

  const serverField = open.error?.field ? SERVER_FIELDS[open.error.field] : undefined;
  const fieldError = (field) => errors[field] ?? (serverField === field ? open.error.message : undefined);
  const bannerError = open.error && !serverField ? open.error : null;
  // The early warning is not repeated once the database has actually refused for the same reason.
  const closed = status.data && !status.data.branchOpen && !isBusinessHoursError(bannerError);

  if (open.result) return <Opened account={open.result} onAgain={startAgain} />;

  return (
    <>
      <PageHeader
        title="Open a savings account"
        intro="The database picks the plan: Joint when there is a second holder, otherwise by the primary holder's age. The opening deposit must cover that plan's minimum balance."
      />
      {closed && (
        <div className="banner banner--warning" role="note">
          <p className="banner__title">The branch is closed now</p>
          <p>
            New accounts are only accepted Monday to Friday
            {settings.data ? `, ${settings.data.businessDayStart}–${settings.data.businessDayEnd}` : ''}, by the
            database clock. You can fill in the form, but the database will refuse it until the branch opens.
          </p>
        </div>
      )}
      <ErrorBanner error={bannerError} title="The account was not opened" />
      {errors.agent && <ErrorBanner error={errors.agent} title="No agent chosen" />}

      <form ref={formRef} className="form form--wide" noValidate onSubmit={submit}>
        <CustomerPicker
          id="primary-holder"
          label="Primary holder"
          hint="The account's owner. For an individual account, their age decides the plan."
          value={primary}
          onChange={(customer) => {
            setPrimary(customer);
            clearProblem('primary');
          }}
          error={fieldError('primary')}
          excludeId={joint ? secondary?.customerId ?? null : null}
        />

        <div className="check-field">
          <input
            id="joint"
            type="checkbox"
            checked={joint}
            onChange={(event) => {
              setJoint(event.target.checked);
              if (!event.target.checked) setSecondary(null);
              clearProblem('secondary');
            }}
          />
          <label htmlFor="joint">Joint account (add a second holder)</label>
        </div>

        {joint && (
          <CustomerPicker
            id="second-holder"
            label="Second holder"
            hint="Can deposit and withdraw like the primary holder; only the primary holder can open or close a fixed deposit."
            value={secondary}
            onChange={(customer) => {
              setSecondary(customer);
              clearProblem('secondary');
            }}
            error={fieldError('secondary')}
            excludeId={primary?.customerId ?? null}
          />
        )}

        <PlanPreview plan={plan} primary={primary} joint={joint} />

        <FormField
          id="opening-amount"
          label="Opening deposit"
          hint={plan ? `At least ${formatMoney(plan.minimumBalance)} for the ${plan.planName} plan, and more than zero.` : 'More than zero, and at least the plan minimum.'}
          error={fieldError('amount')}
        >
          <MoneyInput
            value={amount}
            onChange={(value) => {
              setAmount(value);
              clearProblem('amount');
            }}
          />
        </FormField>

        <p className="field-hint">
          {agent ? `Processed by ${agent.name}, ${agent.branchName}.` : 'Choose who you are acting as in the bar at the top.'}
        </p>

        <div className="form-actions">
          <button type="submit" className="button" disabled={open.busy}>
            {open.busy ? 'Opening…' : 'Open account'}
          </button>
        </div>
      </form>
    </>
  );
}

function PlanPreview({ plan, primary, joint }) {
  let reason = 'Choose the primary holder to see which plan the database will pick.';
  if (plan && joint) reason = 'A joint account always uses the Joint plan, whatever the holders’ ages.';
  else if (plan) reason = `${primary.firstName} is ${primary.age}, so the database will pick the ${plan.planName} plan.`;
  return (
    <div className="plan-preview" aria-live="polite">
      <p className="plan-preview__label">Expected plan</p>
      {plan ? (
        <p className="plan-preview__name">
          {plan.planName}{' '}
          <span className="plan-preview__terms">
            {formatPercent(plan.interestRate)} a year · minimum balance {formatMoney(plan.minimumBalance)}
          </span>
        </p>
      ) : null}
      <p className="plan-preview__reason">{reason}</p>
    </div>
  );
}

function Opened({ account, onAgain }) {
  const primary = account.holders.find((holder) => holder.role === 'PRIMARY');
  return (
    <>
      <PageHeader title="Open a savings account" />
      <SuccessCard
        title="Account opened"
        items={[
          { label: 'Account number', value: account.accountNo, mono: true },
          { label: 'Plan', value: `${account.planName} (${formatPercent(account.interestRate)} a year)` },
          { label: 'Opening balance', value: formatMoney(account.balance), mono: true },
          { label: 'Reference', value: account.referenceNo, mono: true },
          {
            label: account.holders.length > 1 ? 'Holders' : 'Holder',
            value: account.holders.map((h) => `${h.name} (${h.role === 'PRIMARY' ? 'primary' : 'second holder'})`).join(', '),
          },
        ]}
      >
        {account.reviewFlagged && (
          <p className="banner banner--info">
            The opening deposit is above the large-deposit limit, so it was saved and flagged for review.
          </p>
        )}
        <div className="form-actions">
          <Link className="button" to={`/transactions?account=${account.accountId}`}>
            Record a deposit
          </Link>
          {primary && (
            <Link className="button button--quiet" to={`/customers?customer=${primary.customerId}`}>
              View {primary.name}
            </Link>
          )}
          <button type="button" className="button button--quiet" onClick={onAgain}>
            Open another account
          </button>
        </div>
      </SuccessCard>
    </>
  );
}
