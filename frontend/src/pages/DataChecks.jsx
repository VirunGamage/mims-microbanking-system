// Data checks (Tester view only): the two known gaps checked on demand, and the QA-only "Run interest" control.
// Owner: Rukshi. Uses GET /api/tester/gap/nic-at-18 and /gap/plan-outgrown (the views in procedures/08_gap_queries.sql)
// and POST /api/tester/run-interest (FD interest, then FD maturity, then savings interest).
// This page lets testers check the two known data gaps and safely run the interest-processing routines for testing.
import { useState } from 'react';
import { GAP_NIC_PATH, GAP_PLAN_PATH, runInterest } from '../api/reports.js';
import { useAction, useApiData } from '../api/useApi.js';
import ConfirmModal from '../components/ConfirmModal.jsx';
import DataTable from '../components/DataTable.jsx';
import ErrorBanner from '../components/ErrorBanner.jsx';
import FormField from '../components/FormField.jsx';
import Loading from '../components/Loading.jsx';
import PageHeader from '../components/PageHeader.jsx';
import SuccessCard from '../components/SuccessCard.jsx';
import { formatDate, todayIso } from '../utils/format.js';
import '../styles/reports.css';

export const meta = { path: '/data-checks', title: 'Data checks', order: 6, testerOnly: true };

export default function DataChecks() {
  const status = useApiData('/status');
  const today = status.data?.serverTime?.slice(0, 10) ?? todayIso();
  return (
    <>
      <PageHeader
        title="Data checks"
        intro="Two known limitations of the design, checked on demand, and the interest run for testing. An empty result is the right answer for the sample data."
      />
      <GapCheck
        id="nic"
        path={GAP_NIC_PATH}
        title="Adults without a NIC"
        about="A NIC is required from age 18, but the database only checks it when a customer is registered or edited. These customers have turned 18 since and have no NIC on record."
        emptyTitle="Nobody aged 18 or over is missing a NIC."
        columns={[
          { key: 'name', header: 'Customer', render: (row) => `${row.firstName} ${row.lastName}` },
          { key: 'customerId', header: 'ID', align: 'right' },
          { key: 'dob', header: 'Date of birth', render: (row) => formatDate(row.dob) },
          { key: 'currentAge', header: 'Age', align: 'right' },
          { key: 'registeredBranch', header: 'Registered at' },
        ]}
        rowKey={(row) => row.customerId}
      />
      <GapCheck
        id="plan"
        path={GAP_PLAN_PATH}
        title="Accounts that have outgrown their plan"
        about="An account's plan is chosen from the primary holder's age only when it is opened. These accounts are on a plan that no longer matches the holder's age."
        emptyTitle="Every account's plan still matches its primary holder's age."
        columns={[
          { key: 'accountNo', header: 'Account', render: (row) => <span className="mono">{row.accountNo}</span> },
          { key: 'name', header: 'Primary holder', render: (row) => `${row.firstName} ${row.lastName}` },
          { key: 'currentAge', header: 'Age', align: 'right' },
          { key: 'currentPlan', header: 'Plan now' },
          { key: 'planForAgeNow', header: 'Plan for this age' },
        ]}
        rowKey={(row) => row.accountId}
      />
      <RunInterest today={today} />
    </>
  );
}

function GapCheck({ id, path, title, about, emptyTitle, columns, rowKey }) {
  const state = useApiData(path); // runs when the page opens, and again on "Check again"
  return (
    <section className="panel check-panel" aria-labelledby={`${id}-heading`}>
      <div className="check-panel__head">
        <h2 id={`${id}-heading`}>{title}</h2>
        <button type="button" className="button button--quiet button--small" onClick={state.reload} disabled={state.loading}>
          {state.loading ? 'Checking…' : 'Check again'}
        </button>
      </div>
      <p className="section__lead">{about}</p>
      {state.error && <ErrorBanner error={state.error} title="Could not run this check" />}
      {state.loading && !state.data && <Loading label="Checking…" />}
      {state.data && (
        <DataTable caption={title} hideCaption rows={state.data} rowKey={rowKey} columns={columns} emptyTitle={emptyTitle} />
      )}
    </section>
  );
}

function RunInterest({ today }) {
  const [runDate, setRunDate] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [problem, setProblem] = useState(null);
  const run = useAction(runInterest);
  const date = runDate || today;

  function ask(event) {
    event.preventDefault();
    if (!date) return setProblem('Choose the date to post interest up to');
    if (date > today) return setProblem('Run date cannot be in the future');
    setProblem(null);
    setConfirming(true);
  }

  async function confirm() {
    await run.run(date);
    setConfirming(false);
  }

  const fieldError = problem ?? (run.error?.field === 'runDate' ? run.error.message : undefined);
  return (
    <section className="panel run-interest" aria-labelledby="run-heading">
      <h2 id="run-heading">Run interest (testing only)</h2>
      <p className="section__lead">
        Posts every interest payment that is due up to the chosen date, in the database's own order: fixed deposit interest,
        then fixed deposits that have matured, then savings interest. Nothing is ever posted twice, so running it again is
        safe. It changes data: reload the database to go back to the sample data.
      </p>
      {run.result && (
        <SuccessCard
          title={`Interest posted up to ${formatDate(run.result.runDate)}`}
          items={[
            { label: 'Fixed deposit interest payments', value: run.result.fdInterestPostings },
            { label: 'Fixed deposits matured', value: run.result.fdsMatured },
            { label: 'Savings interest payments', value: run.result.savingsInterestPostings },
          ]}
        />
      )}
      {run.error && run.error.field !== 'runDate' && <ErrorBanner error={run.error} title="The interest run stopped" />}
      <form className="form" noValidate onSubmit={ask}>
        <FormField
          id="run-date"
          label="Post interest due up to"
          hint="Normally today (by the database clock). Maturity always uses today's date."
          error={fieldError}
        >
          <input
            type="date"
            value={date}
            max={today}
            onChange={(event) => {
              setRunDate(event.target.value);
              setProblem(null);
              if (run.error) run.reset();
            }}
          />
        </FormField>
        <div className="form-actions">
          <button type="submit" className="button" disabled={run.busy}>
            Run interest…
          </button>
        </div>
      </form>
      <ConfirmModal
        open={confirming}
        title="Post interest now?"
        confirmLabel="Post interest"
        busy={run.busy}
        onCancel={() => setConfirming(false)}
        onConfirm={confirm}
      >
        <p>
          Every fixed deposit and savings payment due up to <strong>{formatDate(date)}</strong> will be posted as a
          transaction, and fixed deposits that have reached maturity will pay their principal back. This changes the data.
        </p>
      </ConfirmModal>
    </section>
  );
}
