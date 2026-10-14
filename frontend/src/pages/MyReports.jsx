// Reports for the agent at the counter: the transactions this agent processed in a period, with totals for balancing the
// cash drawer, and the fixed deposits at every branch with a payout or maturity coming up (any customer can walk in to any
// agent). Uses GET /api/agent-reports/my-activity and /api/agent-reports/fds-due. The management reports are for admins.
import { useState } from 'react';
import { useApiData } from '../api/useApi.js';
import DataTable from '../components/DataTable.jsx';
import ErrorBanner from '../components/ErrorBanner.jsx';
import Loading from '../components/Loading.jsx';
import PageHeader from '../components/PageHeader.jsx';
import { useAgent } from '../context/AgentContext.jsx';
import { termLabel } from '../utils/fdRules.js';
import { formatDate, formatDateTime, formatPercent, todayIso } from '../utils/format.js';
import { describe } from '../utils/ledger.js';
import { formatMoney } from '../utils/money.js';

export const meta = { path: '/my-reports', title: 'My reports', order: 4.5 };

const DUE_WINDOWS = [7, 30, 90];

export default function MyReports() {
  const { agentId, agent } = useAgent();
  const today = todayIso();
  const [start, setStart] = useState(today);
  const [end, setEnd] = useState(today);
  const [days, setDays] = useState(30);
  const activity = useApiData(agentId ? `/agent-reports/my-activity?agentId=${agentId}&start=${start}&end=${end}` : null);
  const due = useApiData(`/agent-reports/fds-due?days=${days}`);
  const totals = activity.data?.totals;

  return (
    <>
      <PageHeader
        title="My reports"
        intro="Your own work, and the fixed deposits any customer may ask about. The bank-wide management reports are for admins."
      />

      <section className="section" aria-labelledby="activity-heading">
        <h2 id="activity-heading">My activity{agent ? `: ${agent.name}` : ''}</h2>
        <p className="section__lead">Every transaction you processed in the period, for balancing your cash drawer.</p>
        <div className="report-period">
          <label className="inline-field">
            From <input type="date" value={start} max={end} onChange={(event) => setStart(event.target.value)} />
          </label>
          <label className="inline-field">
            To <input type="date" value={end} min={start} onChange={(event) => setEnd(event.target.value)} />
          </label>
          <button type="button" className="button button--quiet button--small" onClick={() => { setStart(today); setEnd(today); }}>
            Today
          </button>
        </div>
        <ErrorBanner error={activity.error} title="Your activity could not be loaded" />
        {activity.loading && !activity.data && <Loading label="Loading your activity…" />}
        {totals && (
          <dl className="summary-list">
            <div><dt>Transactions</dt><dd>{totals.count} (deposits: {totals.deposits}, withdrawals: {totals.withdrawals})</dd></div>
            <div><dt>Money in</dt><dd className="mono">{formatMoney(totals.moneyIn)}</dd></div>
            <div><dt>Money out</dt><dd className="mono">{formatMoney(totals.moneyOut)}</dd></div>
          </dl>
        )}
        {activity.data && (
          <DataTable
            caption="Transactions you processed"
            hideCaption
            rowKey={(row) => row.transactionId}
            rows={activity.data.rows}
            emptyTitle="No transactions in this period."
            columns={[
              { key: 'at', header: 'When', render: (row) => formatDateTime(row.at) },
              { key: 'what', header: 'What', render: (row) => describe({ ...row, channel: 'BRANCH', agentName: 'you' }) },
              { key: 'accountNo', header: 'Account', render: (row) => <span className="mono">{row.accountNo}</span> },
              { key: 'holder', header: 'Customer' },
              { key: 'referenceNo', header: 'Reference', render: (row) => <span className="mono">{row.referenceNo}</span> },
              { key: 'in', header: 'In', align: 'right', render: (row) => (row.direction === 'CREDIT' ? formatMoney(row.amount, { currency: false }) : '') },
              { key: 'out', header: 'Out', align: 'right', render: (row) => (row.direction === 'DEBIT' ? formatMoney(row.amount, { currency: false }) : '') },
            ]}
          />
        )}
      </section>

      <section className="section" aria-labelledby="due-heading">
        <h2 id="due-heading">Fixed deposits due soon</h2>
        <p className="section__lead">Active fixed deposits at every branch with a payout or maturity coming up, so you can tell the customer.</p>
        <fieldset className="view-switch">
          <legend>Within</legend>
          {DUE_WINDOWS.map((window) => (
            <label key={window}>
              <input type="radio" name="due-window" checked={days === window} onChange={() => setDays(window)} />
              {window} days
            </label>
          ))}
        </fieldset>
        <ErrorBanner error={due.error} title="The fixed deposits could not be loaded" />
        {due.loading && !due.data && <Loading label="Loading fixed deposits…" />}
        {due.data && (
          <DataTable
            caption="Fixed deposits due soon"
            hideCaption
            rowKey={(row) => row.fdId}
            rows={due.data.rows}
            emptyTitle={`Nothing due in the next ${days} days.`}
            columns={[
              { key: 'fdId', header: 'FD', render: (row) => `FD ${row.fdId}` },
              { key: 'holder', header: 'Customer' },
              { key: 'phone', header: 'Phone', render: (row) => row.phone || '—' },
              { key: 'branchName', header: 'Home branch' },
              { key: 'accountNo', header: 'Account', render: (row) => <span className="mono">{row.accountNo}</span> },
              { key: 'principal', header: 'Amount', align: 'right', render: (row) => formatMoney(row.principal, { currency: false }) },
              { key: 'term', header: 'Term', render: (row) => `${termLabel(row.term)} at ${formatPercent(row.interestRate)}` },
              { key: 'nextPayoutDate', header: 'Next payout', render: (row) => formatDate(row.nextPayoutDate) },
              {
                key: 'maturityDate',
                header: 'Matures',
                render: (row) => (
                  <>
                    {formatDate(row.maturityDate)}
                    {row.maturing && <span className="tag tag--warning">soon</span>}
                  </>
                ),
              },
            ]}
          />
        )}
      </section>
    </>
  );
}
