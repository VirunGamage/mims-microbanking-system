// Home: whether the branch is open right now, whether the server and database are healthy, and the bank's rules
// in plain words, read from the database. Owner: Shanuja.
// Uses GET /api/status, /api/health, /api/lookups/settings, /api/lookups/savings-plans and /api/lookups/fd-plans.
// This is the Home page. It shows whether the branch is open, whether the server and database are healthy and the bank's rules and plans in plain words, all read from the database.
import { useApiData } from '../api/useApi.js';
import DataTable from '../components/DataTable.jsx';
import ErrorBanner from '../components/ErrorBanner.jsx';
import Loading from '../components/Loading.jsx';
import PageHeader from '../components/PageHeader.jsx';
import { termLabel } from '../utils/fdRules.js';
import { formatCount, formatDateTime, formatPercent } from '../utils/format.js';
import { formatMoney } from '../utils/money.js';

export const meta = { path: '/', title: 'Home', order: 0 };

export default function Home() {
  const status = useApiData('/status');
  const health = useApiData('/health');
  const settings = useApiData('/lookups/settings');
  const savingsPlans = useApiData('/lookups/savings-plans');
  const fdPlans = useApiData('/lookups/fd-plans');

  return (
    <>
      <PageHeader
        title="B-Trust MIMS"
        intro="Savings accounts, fixed deposits and reports for branch agents and QA testers. Every rule is checked by the database itself; these pages only ask it."
      />

      <section className="section" aria-labelledby="now-heading">
        <h2 id="now-heading">Right now</h2>
        <RightNow status={status} health={health} />
      </section>

      <section className="section" aria-labelledby="rules-heading">
        <h2 id="rules-heading">The rules, in plain words</h2>
        <p className="section__lead">Read from the bank's settings in the database, so they always match what it enforces.</p>
        <Rules settings={settings} />
      </section>

      <section className="section columns" aria-label="Plans">
        <div>
          <h3>Savings plans</h3>
          <PlanTable state={savingsPlans} />
        </div>
        <div>
          <h3>Fixed deposit terms</h3>
          <FdPlanTable state={fdPlans} />
        </div>
      </section>

      <section className="section" aria-labelledby="steps-heading">
        <h2 id="steps-heading">How a branch visit usually goes</h2>
        <ol className="steps">
          <li>Find or register the customer (a NIC is needed from age 18).</li>
          <li>Open a savings account. The plan is chosen by the database from the holder's age, or Joint when two people hold it.</li>
          <li>Record deposits and withdrawals; the passbook shows every movement and the running balance.</li>
          <li>Open or close a fixed deposit for the account's primary holder.</li>
          <li>Managers read the five reports. Testers can also use Data checks and Run interest in the Tester view.</li>
        </ol>
      </section>
    </>
  );
}

// When the server or the database is down, every request fails the same way, so it is said once, here.
function RightNow({ status, health }) {
  const down = [health.error, status.error].find((error) => error?.unreachable);
  if (down) {
    const title = down.status === 503 ? 'The database is not answering' : 'The MIMS server is not answering';
    return <ErrorBanner error={down} title={title} />;
  }
  return (
    <>
      <BranchState status={status} />
      <HealthLine health={health} />
    </>
  );
}

function BranchState({ status }) {
  if (status.loading) return <Loading label="Asking the database whether the branch is open…" />;
  if (status.error) return <ErrorBanner error={status.error} title="Could not check the branch hours" />;
  const { branchOpen, message, serverTime } = status.data;
  return (
    <div className={`status-strip${branchOpen ? ' status-strip--open' : ''}`}>
      <span className="status-strip__state">{branchOpen ? 'Open for transactions' : 'Closed for transactions'}</span>
      <p className="status-strip__detail">{message}</p>
      <span className="status-strip__label">Database clock</span>
      <p className="status-strip__detail mono">{formatDateTime(serverTime)}</p>
    </div>
  );
}

function HealthLine({ health }) {
  if (health.loading) return null;
  if (health.error) return <ErrorBanner error={health.error} title="The server or database is not answering" />;
  return (
    <p className="health-line">
      Server OK · database “{health.data.database}” on MySQL {health.data.mysqlVersion}
    </p>
  );
}

// Why a section has nothing to show: the server is down (already said above), the lookups route is not merged yet,
// or a real error worth a banner.
function SectionProblem({ error, what }) {
  if (error.unreachable) return <p className="section__lead">{what} will show again once the server answers.</p>;
  if (error.status === 404) {
    return <p className="section__lead">{what} will appear here once the lookups endpoint is part of the backend.</p>;
  }
  return <ErrorBanner error={error} title={`Could not load ${what.toLowerCase()}`} />;
}

function Rules({ settings }) {
  if (settings.loading) return <Loading />;
  if (settings.error) return <SectionProblem error={settings.error} what="The rules" />;
  const s = settings.data;
  return (
    <dl className="rule-list">
      <div>
        <dt>Opening hours</dt>
        <dd>
          Monday to Friday, {s.businessDayStart}–{s.businessDayEnd}, by the database clock. Deposits, withdrawals, new
          accounts and new fixed deposits are refused outside these hours.
        </dd>
      </div>
      <div>
        <dt>Withdrawals</dt>
        <dd>
          Up to {formatMoney(s.dailyWithdrawalLimit)} per account per day, counting every withdrawal that day. A
          withdrawal can never take the balance below the plan's minimum.
        </dd>
      </div>
      <div>
        <dt>Large deposits</dt>
        <dd>Deposits above {formatMoney(s.largeDepositThreshold)} are accepted and flagged for review.</dd>
      </div>
      <div>
        <dt>Interest</dt>
        <dd>
          Savings accounts earn interest every {formatCount(s.savingsInterestCycleDays)} days and fixed deposits every{' '}
          {formatCount(s.fdInterestCycleDays)} days: amount × yearly rate × days ÷ {formatCount(s.interestDayCountBasis)}, each
          payment posted as its own transaction.
        </dd>
      </div>
      <div>
        <dt>Age bands</dt>
        <dd>
          Children 0–{s.ageChildMax}, Teen {s.ageTeenMin}–{s.ageTeenMax}, Adult {s.ageAdultMin}–{s.ageSeniorMin - 1},
          Senior {s.ageSeniorMin}+. A NIC is required from age {s.ageAdultMin}.
        </dd>
      </div>
    </dl>
  );
}

function PlanTable({ state }) {
  if (state.loading) return <Loading />;
  if (state.error) return <SectionProblem error={state.error} what="The savings plans" />;
  return (
    <DataTable
      caption="Savings plans"
        hideCaption
      rowKey={(row) => row.planId}
      rows={state.data}
      columns={[
        { key: 'planName', header: 'Plan' },
        { key: 'interestRate', header: 'Yearly rate', align: 'right', render: (row) => formatPercent(row.interestRate) },
        { key: 'minimumBalance', header: 'Minimum balance', align: 'right', render: (row) => formatMoney(row.minimumBalance) },
      ]}
    />
  );
}

function FdPlanTable({ state }) {
  if (state.loading) return <Loading />;
  if (state.error) return <SectionProblem error={state.error} what="The fixed deposit terms" />;
  return (
    <DataTable
      caption="Fixed deposit terms"
        hideCaption
      rowKey={(row) => row.fdPlanId}
      rows={state.data}
      columns={[
        { key: 'termName', header: 'Term', render: (row) => termLabel(row.termName) },
        { key: 'durationDays', header: 'Days', align: 'right', render: (row) => formatCount(row.durationDays) },
        { key: 'interestRate', header: 'Yearly rate', align: 'right', render: (row) => formatPercent(row.interestRate) },
      ]}
    />
  );
}
