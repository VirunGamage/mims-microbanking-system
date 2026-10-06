// Customers: find a customer, see their details and accounts, or register a new one. Owner: Sameera.
// Uses GET /api/customers?search=, GET /api/customers/:id and POST /api/customers (an INSERT checked by trg_customer_bi).
// Main page component for searching, viewing customer details, and registering new customers.
import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CUSTOMER_SEARCH_LIMIT, customerPath, customersPath, registerCustomer } from '../api/customers.js';
import { useAction, useApiData } from '../api/useApi.js';
import DataTable from '../components/DataTable.jsx';
import EmptyState from '../components/EmptyState.jsx';
import ErrorBanner from '../components/ErrorBanner.jsx';
import FormField from '../components/FormField.jsx';
import Loading from '../components/Loading.jsx';
import PageHeader from '../components/PageHeader.jsx';
import SuccessCard from '../components/SuccessCard.jsx';
import { useAgent } from '../context/AgentContext.jsx';
import { ageFromDob, customerFormErrors } from '../utils/accountRules.js';
import { formatDate, todayIso } from '../utils/format.js';
import { formatMoney } from '../utils/money.js';

export const meta = { path: '/customers', title: 'Customers', order: 1 };

export default function Customers() {
  const [params, setParams] = useSearchParams();
  const search = params.get('q') ?? '';
  const selected = params.get('customer');
  const registering = params.get('new') === '1';
  const [text, setText] = useState(search);
  const results = useApiData(customersPath(search));

  useEffect(() => setText(search), [search]); // keep the box in step with the Back and Forward buttons

  // The page's state lives in the address (?q=, ?customer=, ?new=1), so Back works and a customer can be linked to.
  function update(changes) {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value === '') next.delete(key);
      else next.set(key, String(value));
    }
    setParams(next);
  }

  return (
    <>
      <PageHeader title="Customers" intro="Find a customer to see their details and accounts, or register someone new.">
        {!registering && (
          <button type="button" className="button" onClick={() => update({ new: '1', customer: null })}>
            Register a new customer
          </button>
        )}
      </PageHeader>

      <div className="split">
        <section aria-labelledby="find-heading">
          <h2 id="find-heading">Find a customer</h2>
          <form
            className="search-form"
            role="search"
            onSubmit={(event) => {
              event.preventDefault();
              update({ q: text.trim() });
            }}
          >
            <label htmlFor="customer-search">Name, NIC, phone or customer ID</label>
            <div className="search-row">
              <input id="customer-search" type="search" value={text} onChange={(event) => setText(event.target.value)} />
              <button type="submit" className="button">
                Search
              </button>
            </div>
          </form>
          <SearchResults state={results} search={search} selected={selected} onPick={(id) => update({ customer: id, new: null })} />
        </section>

        <div>
          {registering ? (
            <RegisterCustomer
              onShow={(id) => update({ new: null, customer: id })}
              onCancel={() => update({ new: null })}
              onRegistered={results.reload}
            />
          ) : selected ? (
            <CustomerDetails customerId={selected} />
          ) : (
            <EmptyState title="No customer chosen">
              <p>Choose a customer from the list to see their details and accounts, or register a new customer.</p>
            </EmptyState>
          )}
        </div>
      </div>
    </>
  );
}

function SearchResults({ state, search, selected, onPick }) {
  if (state.loading && !state.data) return <Loading label="Searching…" />; // a reload keeps the old list on screen
  if (state.error) return <ErrorBanner error={state.error} title="Could not search the customers" />;
  return (
    <>
      <p className="section__lead" role="status">
        {search
          ? `${state.data.length}${state.data.length >= CUSTOMER_SEARCH_LIMIT ? '+' : ''} match${state.data.length === 1 ? '' : 'es'} for "${search}"`
          : 'Newest customers first'}
      </p>
      <DataTable
        caption="Customers"
        hideCaption
        rows={state.data}
        rowKey={(row) => row.customerId}
        emptyTitle="No customer matches that search."
        emptyHint="Try part of a name, a NIC, a phone number or a customer ID."
        columns={[
          {
            key: 'name',
            header: 'Customer',
            render: (row) => (
              <button
                type="button"
                className="link-button"
                aria-current={String(row.customerId) === selected ? 'true' : undefined}
                onClick={() => onPick(row.customerId)}
              >
                {row.firstName} {row.lastName}
              </button>
            ),
          },
          { key: 'customerId', header: 'ID', align: 'right' },
          { key: 'age', header: 'Age', align: 'right' },
          { key: 'nic', header: 'NIC', render: (row) => <span className="mono">{row.nic ?? '—'}</span> },
          { key: 'accountCount', header: 'Accounts', align: 'right' },
        ]}
      />
    </>
  );
}

function CustomerDetails({ customerId }) {
  const state = useApiData(customerPath(customerId));
  const headingRef = useRef(null);

  useEffect(() => {
    if (state.data) headingRef.current?.focus({ preventScroll: false });
  }, [state.data]);

  if (state.loading) return <Loading label="Loading the customer…" />;
  if (state.error) return <ErrorBanner error={state.error} title="Could not load this customer" />;
  const customer = state.data;
  const name = `${customer.firstName} ${customer.lastName}`;

  return (
    <section className="panel" aria-labelledby="customer-heading">
      <h2 id="customer-heading" ref={headingRef} tabIndex={-1}>
        {name}
      </h2>
      <p className="section__lead">Customer {customer.customerId}</p>

      {customer.nicMissing && (
        <div className="banner banner--warning" role="note">
          <p className="banner__title">NIC needed</p>
          <p>
            {customer.firstName} is {customer.age} and has no NIC on record. Please ask for it. This app cannot change a
            registered customer, so the NIC has to be recorded outside the app; until then {customer.firstName} is listed
            in Data checks (Tester view).
          </p>
        </div>
      )}

      <dl className="summary-list">
        <div>
          <dt>NIC</dt>
          <dd className="mono">{customer.nic ?? 'Not recorded'}</dd>
        </div>
        <div>
          <dt>Date of birth</dt>
          <dd>
            {formatDate(customer.dob)} (age {customer.age})
          </dd>
        </div>
        <div>
          <dt>Phone</dt>
          <dd>{customer.phone ?? '—'}</dd>
        </div>
        <div>
          <dt>E-mail</dt>
          <dd>{customer.email ?? '—'}</dd>
        </div>
        <div>
          <dt>Address</dt>
          <dd>{customer.address ?? '—'}</dd>
        </div>
        <div>
          <dt>Registered</dt>
          <dd>
            by {customer.registeredByAgent} at {customer.registeredBranch}
          </dd>
        </div>
      </dl>

      <h3 className="panel__subheading">Accounts</h3>
      <DataTable
        caption={`Accounts held by ${name}`}
        hideCaption
        rows={customer.accounts}
        rowKey={(row) => row.accountId}
        emptyTitle={`${customer.firstName} has no accounts yet.`}
        columns={[
          {
            key: 'accountNo',
            header: 'Account',
            render: (row) => (
              <Link className="mono" to={`/transactions?account=${row.accountId}`}>
                {row.accountNo}
              </Link>
            ),
          },
          { key: 'planName', header: 'Plan' },
          { key: 'role', header: 'Holder', render: (row) => (row.role === 'PRIMARY' ? 'Primary' : 'Second holder') },
          { key: 'status', header: 'Status', render: (row) => row.status.charAt(0) + row.status.slice(1).toLowerCase() },
          { key: 'balance', header: 'Balance', align: 'right', render: (row) => formatMoney(row.balance) },
        ]}
      />
      <div className="form-actions panel__actions">
        <Link className="button" to={`/open-account?primary=${customer.customerId}`}>
          Open an account for {customer.firstName}
        </Link>
      </div>
    </section>
  );
}

const EMPTY_FORM = { firstName: '', lastName: '', dob: '', nic: '', phone: '', email: '', address: '' };

function RegisterCustomer({ onShow, onCancel, onRegistered }) {
  const { agent, agentId } = useAgent();
  const settings = useApiData('/lookups/settings');
  const status = useApiData('/status');
  const [form, setForm] = useState(EMPTY_FORM);
  const [errors, setErrors] = useState({});
  const save = useAction(registerCustomer);
  const formRef = useRef(null);
  const today = status.data?.serverTime?.slice(0, 10) ?? todayIso(); // the database's date, which the triggers use
  const adultAge = settings.data?.ageAdultMin ?? 18;
  const age = ageFromDob(form.dob, today);

  const change = (field) => (event) => {
    setForm((current) => ({ ...current, [field]: event.target.value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
    if (save.error) save.reset(); // the old refusal no longer applies once the form is edited
  };

  // When the server refuses one field (say, a NIC that is already registered), put the cursor in that field.
  useEffect(() => {
    if (save.error?.field) focusFirstError(formRef.current);
  }, [save.error]);

  async function submit(event) {
    event.preventDefault();
    const found = customerFormErrors(form, today, adultAge);
    if (!agentId) found.agentId = 'Choose who you are acting as in the bar at the top of the page';
    setErrors(found);
    if (Object.keys(found).length > 0) {
      focusFirstError(formRef.current);
      return;
    }
    const customer = await save.run({ ...form, agentId });
    if (customer) {
      setForm(EMPTY_FORM);
      onRegistered(); // the list on the left then includes the new customer
    }
  }

  // A rule the server or database refused that belongs to one field is shown beside that field; anything else above the form.
  const serverError = save.error;
  const fieldError = (field) => errors[field] ?? (serverError?.field === field ? serverError.message : undefined);
  const bannerError = serverError && !['firstName', 'lastName', 'dob', 'nic', 'phone', 'email', 'address'].includes(serverError.field)
    ? serverError
    : null;

  if (save.result) {
    const customer = save.result;
    return (
      <SuccessCard
        title="Customer registered"
        items={[
          { label: 'Customer ID', value: customer.customerId, mono: true },
          { label: 'Name', value: `${customer.firstName} ${customer.lastName}` },
          { label: 'Date of birth', value: `${formatDate(customer.dob)} (age ${customer.age})` },
          { label: 'NIC', value: customer.nic ?? 'Not recorded', mono: Boolean(customer.nic) },
          { label: 'Registered at', value: `${customer.registeredBranch}, by ${customer.registeredByAgent}` },
        ]}
      >
        <div className="form-actions">
          <Link className="button" to={`/open-account?primary=${customer.customerId}`}>
            Open an account for {customer.firstName}
          </Link>
          <button type="button" className="button button--quiet" onClick={() => onShow(customer.customerId)}>
            View {customer.firstName}'s details
          </button>
          <button type="button" className="button button--quiet" onClick={() => save.reset()}>
            Register another customer
          </button>
        </div>
      </SuccessCard>
    );
  }

  return (
    <section className="panel" aria-labelledby="register-heading">
      <h2 id="register-heading">Register a new customer</h2>
      <p className="section__lead">
        {agent
          ? `Registered by ${agent.name} at ${agent.branchName}: the customer belongs to the branch of the agent who registers them.`
          : 'Choose who you are acting as in the bar at the top; the customer is registered at that agent’s branch.'}
      </p>
      <ErrorBanner error={bannerError} title="The customer was not saved" />
      {errors.agentId && <ErrorBanner error={errors.agentId} title="No agent chosen" />}

      <form ref={formRef} className="form" noValidate onSubmit={submit}>
        <div className="form-row">
          <FormField id="first-name" label="First name" error={fieldError('firstName')}>
            <input value={form.firstName} onChange={change('firstName')} autoComplete="off" maxLength={50} />
          </FormField>
          <FormField id="last-name" label="Last name" error={fieldError('lastName')}>
            <input value={form.lastName} onChange={change('lastName')} autoComplete="off" maxLength={50} />
          </FormField>
        </div>
        <FormField id="dob" label="Date of birth" error={fieldError('dob')}>
          <input type="date" value={form.dob} onChange={change('dob')} min="1900-01-01" max={today} />
        </FormField>
        <FormField
          id="nic"
          label="NIC"
          optional={age === null || age < adultAge}
          hint={
            age === null
              ? `Required from age ${adultAge}. Enter the date of birth first.`
              : age >= adultAge
                ? `Required: the customer is ${age}.`
                : `Not required yet: the customer is ${age}. Needed from age ${adultAge}.`
          }
          error={fieldError('nic')}
        >
          <input value={form.nic} onChange={change('nic')} autoComplete="off" maxLength={12} className="mono" />
        </FormField>
        <div className="form-row">
          <FormField id="phone" label="Phone" optional error={fieldError('phone')}>
            <input type="tel" value={form.phone} onChange={change('phone')} autoComplete="off" maxLength={20} />
          </FormField>
          <FormField id="email" label="E-mail" optional error={fieldError('email')}>
            <input type="email" value={form.email} onChange={change('email')} autoComplete="off" maxLength={100} />
          </FormField>
        </div>
        <FormField id="address" label="Address" optional error={fieldError('address')}>
          <input value={form.address} onChange={change('address')} autoComplete="off" maxLength={150} />
        </FormField>
        <div className="form-actions">
          <button type="submit" className="button" disabled={save.busy}>
            {save.busy ? 'Saving…' : 'Save customer'}
          </button>
          <button type="button" className="button button--quiet" onClick={onCancel} disabled={save.busy}>
            Cancel
          </button>
        </div>
      </form>
    </section>
  );
}

// Moves keyboard focus to the first field the browser-side check complained about.
function focusFirstError(form) {
  requestAnimationFrame(() => form?.querySelector('[aria-invalid="true"]')?.focus());
}
