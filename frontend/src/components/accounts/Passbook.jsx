// The passbook: every movement on one account, newest first, with withdrawals and deposits in separate columns and the
// running balance after each line, the way a printed bank passbook reads. Owner: Archchu.
// Shows the rows from GET /api/accounts/:id/transactions; the page loads them and handles paging.

//Displays the account transaction history as a passbook with running balances and transaction details.

import { formatDate, formatTime } from '../../utils/format.js';
import { describe } from '../../utils/ledger.js';
import { formatMoney } from '../../utils/money.js';
import '../../styles/passbook.css';

export default function Passbook({ accountNo, book, onPage }) {
  const { rows, page, pages, total } = book;
  const first = total === 0 ? 0 : (page - 1) * book.pageSize + 1;
  const last = Math.min(total, page * book.pageSize);

  return (
    <section className="passbook" aria-labelledby="passbook-heading">
      <header className="passbook__head">
        <h2 id="passbook-heading">
          Passbook <span className="passbook__account mono">{accountNo}</span>
        </h2>
        <p className="passbook__range">
          {total === 0 ? 'No entries yet' : `Entries ${first}–${last} of ${total}, newest first`}
        </p>
      </header>

      {total > 0 && (
        <div className="passbook__scroll" tabIndex={0} role="region" aria-label={`Passbook for ${accountNo}`}>
          <table className="passbook__table">
            <caption className="visually-hidden">
              Passbook for {accountNo}, newest first, page {page} of {pages}
            </caption>
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col">Details</th>
                <th scope="col">Reference</th>
                <th scope="col" className="num">
                  Withdrawals
                </th>
                <th scope="col" className="num">
                  Deposits
                </th>
                <th scope="col" className="num">
                  Balance
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.transactionId}>
                  <td className="passbook__date">
                    {formatDate(row.at)}
                    <span className="passbook__time">{formatTime(row.at)}</span>
                  </td>
                  <td>
                    {describe(row)}
                    {row.reviewFlagged && <span className="passbook__flag">Flagged for review</span>}
                  </td>
                  <td className="mono passbook__ref">{row.referenceNo}</td>
                  <td className="num mono">{row.direction === 'DEBIT' ? formatMoney(row.amount, { currency: false }) : ''}</td>
                  <td className="num mono">{row.direction === 'CREDIT' ? formatMoney(row.amount, { currency: false }) : ''}</td>
                  <td className="num mono passbook__balance">{formatMoney(row.balanceAfter, { currency: false })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pages > 1 && (
        <nav className="passbook__pages" aria-label="Passbook pages">
          <button type="button" className="button button--quiet" onClick={() => onPage(page - 1)} disabled={page <= 1}>
            Newer entries
          </button>
          <span>
            Page {page} of {pages}
          </span>
          <button type="button" className="button button--quiet" onClick={() => onPage(page + 1)} disabled={page >= pages}>
            Older entries
          </button>
        </nav>
      )}
      <p className="passbook__note">Amounts in LKR. The balance column is worked out by the database, line by line.</p>
    </section>
  );
}
