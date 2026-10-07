// Reports: the five management reports, each with its filters, a chart, a table and a CSV download. Owner: Rukshi.
// Uses GET /api/reports/agent-wise, /account-wise, /active-fds, /monthly-interest and /customer-activity, which call
// the RPT_... routines and VW_ACTIVE_FD_PAYOUT_SCHEDULE. The chosen report and its filters are kept in the address.
// This page displays the five management reports with filters, charts, tables, and CSV download support.
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { reportPath } from '../api/reports.js';
import { useApiData } from '../api/useApi.js';
import BarChart from '../components/charts/BarChart.jsx';
import GroupedBarChart from '../components/charts/GroupedBarChart.jsx';
import TimelineChart from '../components/charts/TimelineChart.jsx';
import DataTable from '../components/DataTable.jsx';
import ErrorBanner from '../components/ErrorBanner.jsx';
import Loading from '../components/Loading.jsx';
import PageHeader from '../components/PageHeader.jsx';
import { useAgent } from '../context/AgentContext.jsx';
import { csvFileName, downloadCsv, toCsv } from '../utils/csv.js';
import { termLabel } from '../utils/fdRules.js';
import { formatDate, formatPercent, todayIso } from '../utils/format.js';
import { formatMoney } from '../utils/money.js';
import { shortNumber, toNumber } from '../components/charts/scale.js';
import '../styles/reports.css';

export const meta = { path: '/reports', title: 'Reports', order: 5 };

const REPORTS = [
  { id: 'agent-wise', title: 'Agent activity', routine: 'RPT_AGENT_WISE_TRANSACTIONS', about: 'How many transactions each agent processed in a period, and their total value.' },
  { id: 'account-wise', title: 'Accounts', routine: 'RPT_ACCOUNT_WISE_SUMMARY', about: "Every account's balance, deposits, withdrawals and interest, for one branch or all of them." },
  { id: 'active-fds', title: 'Active fixed deposits', routine: 'VW_ACTIVE_FD_PAYOUT_SCHEDULE', about: 'Every active fixed deposit, its term and its next payout date.' },
  { id: 'monthly-interest', title: 'Monthly interest', routine: 'RPT_MONTHLY_INTEREST_DISTRIBUTION', about: 'Interest paid in one month, per savings plan.' },
  { id: 'customer-activity', title: 'Customer activity', routine: 'RPT_CUSTOMER_ACTIVITY', about: "Each customer's deposits and withdrawals in a period." },
];

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export default function Reports() {
  const [params, setParams] = useSearchParams();
  const { isTester } = useAgent();
  const status = useApiData('/status');
  const today = status.data?.serverTime?.slice(0, 10) ?? todayIso(); // the database's date, like every rule
  const report = REPORTS.find((r) => r.id === params.get('report')) ?? REPORTS[0];

  // Filters live in the address (?report=...&start=...), so a report can be bookmarked and Back works.
  function setFilters(values) {
    const next = new URLSearchParams({ report: report.id });
    for (const [key, value] of Object.entries(values)) if (value) next.set(key, value);
    setParams(next);
  }

  return (
    <>
      <PageHeader title="Reports" intro="The five management reports. Each one is worked out by the database; download any of them as a CSV file." />
      <nav className="report-tabs" aria-label="Choose a report">
        {REPORTS.map((r) => (
          <button
            key={r.id}
            type="button"
            className="report-tabs__tab"
            aria-current={r.id === report.id ? 'page' : undefined}
            onClick={() => setParams(new URLSearchParams({ report: r.id }))}
          >
            {r.title}
          </button>
        ))}
      </nav>
      <section className="section" aria-labelledby="report-heading">
        <h2 id="report-heading">{report.title}</h2>
        <p className="section__lead">
          {report.about}
          {isTester && <span className="report-source"> Source: {report.routine}</span>}
        </p>
        {report.id === 'agent-wise' && <AgentActivity params={params} today={today} onFilter={setFilters} />}
        {report.id === 'account-wise' && <Accounts params={params} today={today} onFilter={setFilters} />}
        {report.id === 'active-fds' && <ActiveFds today={today} />}
        {report.id === 'monthly-interest' && <MonthlyInterest params={params} today={today} onFilter={setFilters} />}
        {report.id === 'customer-activity' && <CustomerActivity params={params} today={today} onFilter={setFilters} />}
      </section>
    </>
  );
}

// ---------- shared pieces ----------

function startOfYear(today) {
  return `${today.slice(0, 4)}-01-01`;
}

function PeriodFilter({ params, today, onFilter }) {
  const addressStart = params.get('start') ?? startOfYear(today);
  const addressEnd = params.get('end') ?? today;
  const [start, setStart] = useState(addressStart);
  const [end, setEnd] = useState(addressEnd);

  // Back and Forward change the address: show that period in the boxes again.
  useEffect(() => {
    setStart(addressStart);
    setEnd(addressEnd);
  }, [addressStart, addressEnd]);
  return (
    <form
      className="filter-row"
      onSubmit={(event) => {
        event.preventDefault();
        onFilter({ start, end });
      }}
    >
      <label>
        From <input type="date" value={start} max={end} onChange={(event) => setStart(event.target.value)} required />
      </label>
      <label>
        To <input type="date" value={end} min={start} onChange={(event) => setEnd(event.target.value)} required />
      </label>
      <button type="submit" className="button button--quiet">
        Show report
      </button>
    </form>
  );
}

// The chart, the table and the CSV button for one report. While new figures load, the old ones stay on screen, dimmed.
function ReportBody({ state, name, today, csvColumns, chart, table, emptyTitle }) {
  if (state.error) return <ErrorBanner error={state.error} title="Could not run this report" />;
  if (!state.data) return <Loading label="Running the report…" />;
  const rows = state.data;
  return (
    <div className={state.loading ? 'report-body is-loading' : 'report-body'} aria-busy={state.loading}>
      <div className="report-toolbar">
        <p className="report-count">
          {rows.length} row{rows.length === 1 ? '' : 's'}
        </p>
        <button
          type="button"
          className="button button--quiet button--small"
          disabled={rows.length === 0}
          onClick={() => downloadCsv(csvFileName(name, today), toCsv(csvColumns, rows))}
        >
          Download CSV
        </button>
      </div>
      {rows.length > 0 && chart(rows)}
      <DataTable caption={name} hideCaption rows={rows} rowKey={table.rowKey} columns={table.columns} emptyTitle={emptyTitle} />
    </div>
  );
}

const money = (key) => (row) => formatMoney(row[key]);

// ---------- 1. Agent activity ----------

function AgentActivity({ params, today, onFilter }) {
  const start = params.get('start') ?? startOfYear(today);
  const end = params.get('end') ?? today;
  const state = useApiData(reportPath['agent-wise']({ start, end }));
  const [measure, setMeasure] = useState('value');
  return (
    <>
      <PeriodFilter params={params} today={today} onFilter={onFilter} />
      <ReportBody
        state={state}
        name="Agent activity"
        today={today}
        emptyTitle="No agents found."
        csvColumns={[
          { key: 'agentId', header: 'Agent ID' },
          { key: 'agentName', header: 'Agent' },
          { key: 'branchName', header: 'Branch' },
          { key: 'totalTransactions', header: 'Transactions' },
          { key: 'totalValue', header: 'Value (LKR)' },
        ]}
        chart={(rows) => (
          <>
            <fieldset className="chart-switch">
              <legend>Chart shows</legend>
              {[
                ['value', 'Value'],
                ['count', 'Number of transactions'],
              ].map(([value, label]) => (
                <label key={value}>
                  <input type="radio" name="agent-measure" value={value} checked={measure === value} onChange={() => setMeasure(value)} />
                  {label}
                </label>
              ))}
            </fieldset>
            <BarChart
              caption={`Agent activity from ${formatDate(start)} to ${formatDate(end)}: ${measure === 'value' ? 'value of transactions' : 'number of transactions'} per agent`}
              seriesLabel={measure === 'value' ? 'Value of transactions' : 'Transactions'}
              tickFormat={shortNumber}
              items={rows.map((row) => ({
                key: row.agentId,
                label: row.agentName,
                value: measure === 'value' ? toNumber(row.totalValue) : Number(row.totalTransactions),
                display: measure === 'value' ? formatMoney(row.totalValue) : `${row.totalTransactions} transaction${row.totalTransactions === 1 ? '' : 's'}`,
              }))}
            />
          </>
        )}
        table={{
          rowKey: (row) => row.agentId,
          columns: [
            { key: 'agentName', header: 'Agent' },
            { key: 'branchName', header: 'Branch' },
            { key: 'totalTransactions', header: 'Transactions', align: 'right' },
            { key: 'totalValue', header: 'Value', align: 'right', render: money('totalValue') },
          ],
        }}
      />
    </>
  );
}

// ---------- 2. Accounts ----------

function Accounts({ params, today, onFilter }) {
  const branchId = params.get('branchId') ?? '';
  const branches = useApiData('/lookups/branches');
  const state = useApiData(reportPath['account-wise']({ branchId }));
  const branchName = branches.data?.find((b) => String(b.branchId) === branchId)?.branchName ?? 'All branches';
  return (
    <>
      <form className="filter-row" onSubmit={(event) => event.preventDefault()}>
        <label>
          Branch{' '}
          <select value={branchId} onChange={(event) => onFilter({ branchId: event.target.value })}>
            <option value="">All branches</option>
            {branches.data?.map((b) => (
              <option key={b.branchId} value={b.branchId}>
                {b.branchName}
              </option>
            ))}
          </select>
        </label>
        <p className="filter-row__note">An account belongs to the branch where its primary holder was registered.</p>
      </form>
      <ReportBody
        state={state}
        name={`Accounts ${branchName}`}
        today={today}
        emptyTitle="No accounts for this branch."
        csvColumns={[
          { key: 'accountNo', header: 'Account' },
          { key: 'planName', header: 'Plan' },
          { key: 'status', header: 'Status' },
          { key: 'currentBalance', header: 'Balance (LKR)' },
          { key: 'totalDeposits', header: 'Deposits (LKR)' },
          { key: 'totalWithdrawals', header: 'Withdrawals (LKR)' },
          { key: 'totalInterestCredited', header: 'Interest credited (LKR)' },
        ]}
        chart={(rows) => (
          <BarChart
            caption={`Current balance of each account, ${branchName}`}
            seriesLabel="Current balance"
            items={rows.map((row) => ({ key: row.accountNo, label: row.accountNo, value: toNumber(row.currentBalance), display: formatMoney(row.currentBalance) }))}
          />
        )}
        table={{
          rowKey: (row) => row.accountNo,
          columns: [
            { key: 'accountNo', header: 'Account', render: (row) => <span className="mono">{row.accountNo}</span> },
            { key: 'planName', header: 'Plan' },
            { key: 'status', header: 'Status', render: (row) => row.status.charAt(0) + row.status.slice(1).toLowerCase() },
            { key: 'currentBalance', header: 'Balance', align: 'right', render: money('currentBalance') },
            { key: 'totalDeposits', header: 'Deposits', align: 'right', render: money('totalDeposits') },
            { key: 'totalWithdrawals', header: 'Withdrawals', align: 'right', render: money('totalWithdrawals') },
            { key: 'totalInterestCredited', header: 'Interest credited', align: 'right', render: money('totalInterestCredited') },
          ],
        }}
      />
    </>
  );
}

// ---------- 3. Active fixed deposits ----------

function ActiveFds({ today }) {
  const state = useApiData(reportPath['active-fds']());
  return (
    <ReportBody
      state={state}
      name="Active fixed deposits"
      today={today}
      emptyTitle="There are no active fixed deposits."
      csvColumns={[
        { key: 'fdId', header: 'FD' },
        { key: 'accountNo', header: 'Account' },
        { key: 'term', header: 'Term' },
        { key: 'principal', header: 'Principal (LKR)' },
        { key: 'interestRate', header: 'Rate (% a year)' },
        { key: 'startDate', header: 'Started' },
        { key: 'maturityDate', header: 'Matures' },
        { key: 'nextPayoutDate', header: 'Next payout' },
      ]}
      chart={(rows) => (
        <TimelineChart
          caption="Active fixed deposits: term from start to maturity, and the next payout date"
          today={today}
          note="A payout date before today means that payout is due but hasn't been posted yet."
          items={rows.map((row) => ({
            key: row.fdId,
            label: `FD ${row.fdId} · ${row.accountNo}`,
            start: row.startDate,
            end: row.maturityDate,
            marker: row.nextPayoutDate,
            details: [
              { label: 'principal', value: formatMoney(row.principal) },
              { label: 'a year', value: formatPercent(row.interestRate) },
              { label: 'started', value: formatDate(row.startDate) },
              { label: 'matures', value: formatDate(row.maturityDate) },
              { label: 'next payout', value: formatDate(row.nextPayoutDate) },
            ],
          }))}
        />
      )}
      table={{
        rowKey: (row) => row.fdId,
        columns: [
          { key: 'fdId', header: 'FD', render: (row) => <span className="mono nowrap">FD {row.fdId}</span> },
          { key: 'accountNo', header: 'Account', render: (row) => <span className="mono">{row.accountNo}</span> },
          { key: 'term', header: 'Term', render: (row) => `${termLabel(row.term)}, ${formatPercent(row.interestRate)}` },
          { key: 'principal', header: 'Principal', align: 'right', render: money('principal') },
          { key: 'startDate', header: 'Started', render: (row) => formatDate(row.startDate) },
          { key: 'maturityDate', header: 'Matures', render: (row) => formatDate(row.maturityDate) },
          {
            key: 'nextPayoutDate',
            header: 'Next payout',
            render: (row) => (
              <>
                {formatDate(row.nextPayoutDate)}
                {row.nextPayoutDate && row.nextPayoutDate < today && <span className="tag tag--warning">due, not posted yet</span>}
              </>
            ),
          },
        ],
      }}
    />
  );
}

// ---------- 4. Monthly interest ----------

function previousMonth(today) {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  return month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
}

function MonthlyInterest({ params, today, onFilter }) {
  const fallback = previousMonth(today);
  const year = Number(params.get('year') ?? fallback.year);
  const month = Number(params.get('month') ?? fallback.month);
  const state = useApiData(reportPath['monthly-interest']({ year, month }));
  const thisYear = Number(today.slice(0, 4));
  const years = Array.from({ length: thisYear - 2019 }, (_, index) => thisYear - index);
  // The report gives one total per plan. If it also returns savingsInterest and fdInterest (a proposed change to the
  // report), the chart splits them automatically.
  const split = state.data?.length > 0 && 'savingsInterest' in state.data[0] && 'fdInterest' in state.data[0];

  return (
    <>
      <form className="filter-row" onSubmit={(event) => event.preventDefault()}>
        <label>
          Month{' '}
          <select value={month} onChange={(event) => onFilter({ year, month: event.target.value })}>
            {MONTH_NAMES.map((name, index) => (
              <option key={name} value={index + 1}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Year{' '}
          <select value={year} onChange={(event) => onFilter({ year: event.target.value, month })}>
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </label>
      </form>
      <ReportBody
        state={state}
        name={`Monthly interest ${year}-${String(month).padStart(2, '0')}`}
        today={today}
        emptyTitle={`No interest was paid in ${MONTH_NAMES[month - 1]} ${year}.`}
        csvColumns={[
          { key: 'planName', header: 'Plan' },
          { key: 'accountsCredited', header: 'Accounts credited' },
          ...(split ? [{ key: 'savingsInterest', header: 'Savings interest (LKR)' }, { key: 'fdInterest', header: 'FD interest (LKR)' }] : []),
          { key: 'totalInterestPaid', header: 'Total interest (LKR)' },
        ]}
        chart={(rows) =>
          split ? (
            <GroupedBarChart
              caption={`Interest paid in ${MONTH_NAMES[month - 1]} ${year}, savings and fixed deposit interest per plan`}
              series={[
                { key: 'savings', label: 'Savings interest', color: 'var(--chart-1)' },
                { key: 'fd', label: 'Fixed deposit interest', color: 'var(--chart-2)' },
              ]}
              categories={rows.map((row) => ({
                key: row.planName,
                label: row.planName,
                values: {
                  savings: { value: toNumber(row.savingsInterest), display: formatMoney(row.savingsInterest) },
                  fd: { value: toNumber(row.fdInterest), display: formatMoney(row.fdInterest) },
                },
              }))}
            />
          ) : (
            <BarChart
              caption={`Interest paid in ${MONTH_NAMES[month - 1]} ${year} per plan`}
              seriesLabel="Interest paid"
              note="Savings and fixed deposit interest are shown together, as the report returns them."
              items={rows.map((row) => ({ key: row.planName, label: row.planName, value: toNumber(row.totalInterestPaid), display: formatMoney(row.totalInterestPaid) }))}
            />
          )
        }
        table={{
          rowKey: (row) => row.planName,
          columns: [
            { key: 'planName', header: 'Plan' },
            { key: 'accountsCredited', header: 'Accounts credited', align: 'right' },
            ...(split
              ? [
                  { key: 'savingsInterest', header: 'Savings interest', align: 'right', render: money('savingsInterest') },
                  { key: 'fdInterest', header: 'FD interest', align: 'right', render: money('fdInterest') },
                ]
              : []),
            { key: 'totalInterestPaid', header: 'Total interest', align: 'right', render: money('totalInterestPaid') },
          ],
        }}
      />
    </>
  );
}

// ---------- 5. Customer activity ----------

const TOP = 10;

function CustomerActivity({ params, today, onFilter }) {
  const start = params.get('start') ?? startOfYear(today);
  const end = params.get('end') ?? today;
  const state = useApiData(reportPath['customer-activity']({ start, end }));
  return (
    <>
      <PeriodFilter params={params} today={today} onFilter={onFilter} />
      <ReportBody
        state={state}
        name="Customer activity"
        today={today}
        emptyTitle="No deposits or withdrawals in this period."
        csvColumns={[
          { key: 'customerId', header: 'Customer ID' },
          { key: 'customerName', header: 'Customer' },
          { key: 'nic', header: 'NIC' },
          { key: 'totalDeposits', header: 'Deposits (LKR)' },
          { key: 'totalWithdrawals', header: 'Withdrawals (LKR)' },
          { key: 'netBalanceChange', header: 'Net change (LKR)' },
        ]}
        chart={(rows) => {
          // The ten customers who moved the most money (deposits plus withdrawals); the table lists everyone.
          const busiest = [...rows]
            .sort((a, b) => toNumber(b.totalDeposits) + toNumber(b.totalWithdrawals) - (toNumber(a.totalDeposits) + toNumber(a.totalWithdrawals)))
            .slice(0, TOP);
          return (
            <GroupedBarChart
              caption={`Deposits and withdrawals of the ${busiest.length} most active customers, ${formatDate(start)} to ${formatDate(end)}`}
              note={rows.length > TOP ? `The ${TOP} customers who moved the most money; the table below lists all ${rows.length}.` : undefined}
              series={[
                { key: 'deposits', label: 'Deposits', color: 'var(--chart-1)' },
                { key: 'withdrawals', label: 'Withdrawals', color: 'var(--chart-2)' },
              ]}
              categories={busiest.map((row) => ({
                key: row.customerId,
                label: row.customerName,
                values: {
                  deposits: { value: toNumber(row.totalDeposits), display: formatMoney(row.totalDeposits) },
                  withdrawals: { value: toNumber(row.totalWithdrawals), display: formatMoney(row.totalWithdrawals) },
                },
              }))}
            />
          );
        }}
        table={{
          rowKey: (row) => row.customerId,
          columns: [
            { key: 'customerName', header: 'Customer' },
            { key: 'nic', header: 'NIC', render: (row) => <span className="mono">{row.nic ?? '—'}</span> },
            { key: 'totalDeposits', header: 'Deposits', align: 'right', render: money('totalDeposits') },
            { key: 'totalWithdrawals', header: 'Withdrawals', align: 'right', render: money('totalWithdrawals') },
            { key: 'netBalanceChange', header: 'Net change', align: 'right', render: money('netBalanceChange') },
          ],
        }}
      />
      <p className="filter-row__note">A joint account's deposits and withdrawals count for both of its holders.</p>
    </>
  );
}
