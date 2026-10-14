// The passbook of one of the customer's accounts, newest first with the running balance, and a statement download (CSV).
// Uses GET /api/me/accounts/:id/transactions, which only answers for an account this customer holds.
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { fullHistory, historyPath } from '../api/me.js';
import { useAction, useApiData } from '../api/useApi.js';
import Passbook from '../components/accounts/Passbook.jsx';
import ErrorBanner from '../components/ErrorBanner.jsx';
import Loading from '../components/Loading.jsx';
import PageHeader from '../components/PageHeader.jsx';
import { csvFileName, downloadCsv, toCsv } from '../utils/csv.js';
import { todayIso } from '../utils/format.js';
import { describe } from '../utils/ledger.js';
import { useBanking } from './CustomerApp.jsx';

const STATEMENT_COLUMNS = [
  { key: 'at', header: 'Date' },
  { key: 'details', header: 'Details' },
  { key: 'referenceNo', header: 'Reference' },
  { key: 'moneyOut', header: 'Withdrawals (LKR)' },
  { key: 'moneyIn', header: 'Deposits (LKR)' },
  { key: 'balanceAfter', header: 'Balance (LKR)' },
];

export default function History() {
  const { accounts } = useBanking();
  const [params, setParams] = useSearchParams();
  const chosen = accounts.find((account) => String(account.accountId) === params.get('account')) ?? accounts[0];
  const [page, setPage] = useState(1);
  const book = useApiData(chosen ? historyPath(chosen.accountId, page) : null);
  const statement = useAction(async (account) => {
    const rows = await fullHistory(account.accountId);
    const lines = rows.map((row) => ({
      at: row.at,
      details: describe(row),
      referenceNo: row.referenceNo,
      moneyOut: row.direction === 'DEBIT' ? row.amount : '',
      moneyIn: row.direction === 'CREDIT' ? row.amount : '',
      balanceAfter: row.balanceAfter,
    }));
    downloadCsv(csvFileName(`statement ${account.accountNo}`, todayIso()), toCsv(STATEMENT_COLUMNS, lines));
    return lines.length;
  });

  if (!chosen) {
    return (
      <>
        <PageHeader title="History" />
        <p className="portal-empty">You have no accounts yet.</p>
      </>
    );
  }

  return (
    <>
      <PageHeader title="History" intro="Every movement on your account, the way your passbook shows it." />
      <div className="history-bar">
        {accounts.length > 1 && (
          <label className="history-bar__pick">
            Account{' '}
            <select
              value={chosen.accountId}
              onChange={(event) => {
                setPage(1);
                setParams({ account: event.target.value });
              }}
            >
              {accounts.map((account) => (
                <option key={account.accountId} value={account.accountId}>
                  {account.accountNo} · {account.planName}
                </option>
              ))}
            </select>
          </label>
        )}
        <button type="button" className="button button--quiet button--small" disabled={statement.busy} onClick={() => statement.run(chosen)}>
          {statement.busy ? 'Preparing…' : 'Download statement (CSV)'}
        </button>
      </div>
      <ErrorBanner error={statement.error} title="The statement could not be prepared" />
      {book.loading && !book.data && <Loading label="Loading your history…" />}
      <ErrorBanner error={book.error} title="The history could not be loaded" />
      {book.data && <Passbook accountNo={chosen.accountNo} book={book.data} onPage={setPage} />}
    </>
  );
}
