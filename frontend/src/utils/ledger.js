// How each passbook line is worded. Owner: Archchu. Used by components/accounts/Passbook.jsx.
// The words depend only on the transaction type, its channel, the agent and the FD it belongs to.

// Converts transaction data into clear labels and values for displaying passbook entries.

const CHANNEL = { ONLINE: 'online', MOBILE: 'mobile app', ATM: 'ATM', SYSTEM: 'by the bank' };

// One line of plain words per transaction type. FD_CLOSURE by the system is a maturity; by an agent, an early closure.
export function describe(row) {
  const by = row.channel === 'BRANCH' ? row.agentName : CHANNEL[row.channel] ?? row.channel;
  switch (row.type) {
    case 'DEPOSIT':
      return `Deposit · ${by}`;
    case 'WITHDRAWAL':
      return `Withdrawal · ${by}`;
    case 'SAVINGS_INTEREST':
      return 'Savings interest';
    case 'FD_INTEREST':
      return `Fixed deposit interest · FD ${row.fdId}`;
    case 'FD_OPEN':
      return `Moved to fixed deposit FD ${row.fdId} · ${by}`;
    case 'FD_CLOSURE':
      return row.channel === 'SYSTEM'
        ? `FD ${row.fdId} matured · money returned`
        : `FD ${row.fdId} closed early · money returned`;
    default:
      return row.type;
  }
}
