// E-mail notifications. After a deposit, withdrawal, new account, new fixed deposit or early FD closure, every holder of
// the account who has an e-mail address gets a short receipt, and a deposit flagged for review sends an alert to the bank.
// The e-mails go out after the stored procedure has committed and never hold up or undo it: if the mail server is slow or
// down, the agent still gets their answer and the problem is only written to the server log.
// Settings (backend/.env, or .env next to docker-compose.yml): SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM,
// MAIL_DEMO_INBOX, MAIL_SEND_TO_CUSTOMERS and MAIL_REVIEW_TO. Without SMTP_HOST nothing is sent.
import nodemailer from 'nodemailer';
import { query } from './db.js';

// The sample customers' e-mail addresses are made up, but real people could own them. So receipts only go to customers'
// own addresses when MAIL_SEND_TO_CUSTOMERS is 'true'; with MAIL_DEMO_INBOX set, every e-mail goes to that one inbox.
export function mailSettings(env = process.env) {
  const host = env.SMTP_HOST?.trim();
  if (!host) return null;
  const port = Number(env.SMTP_PORT?.trim() || 587);
  return {
    host,
    port,
    secure: port === 465, // 465 starts with TLS (Gmail); 587 upgrades with STARTTLS; 1025 is the local test inbox
    user: env.SMTP_USER?.trim() || null,
    pass: env.SMTP_PASS || null, // not trimmed: a space could be part of the password
    from: env.MAIL_FROM?.trim() || env.SMTP_USER?.trim() || 'B-Trust MIMS <no-reply@btrust.local>',
    demoInbox: env.MAIL_DEMO_INBOX?.trim() || null,
    toCustomers: env.MAIL_SEND_TO_CUSTOMERS?.trim() === 'true',
    reviewTo: env.MAIL_REVIEW_TO?.trim() || null,
  };
}

// One line for the server log at start-up, so it is clear where the e-mails will go.
export function mailStatusLine(settings) {
  if (!settings) return 'E-mail notifications: off (set SMTP_HOST to turn them on)';
  const receipts = settings.demoInbox
    ? `every e-mail goes to the demo inbox ${settings.demoInbox}`
    : settings.toCustomers
      ? "receipts go to the customers' own addresses"
      : 'receipts are off (set MAIL_DEMO_INBOX, or MAIL_SEND_TO_CUSTOMERS=true)';
  const alerts = settings.reviewTo ? `; review alerts go to ${settings.reviewTo}` : '';
  return `E-mail notifications: on through ${settings.host}:${settings.port}, ${receipts}${alerts}`;
}

// '1250000.5' -> 'LKR 1,250,000.50'. Money stays text all the way, like everywhere else in the app.
export function formatLkr(amount) {
  const [whole, cents = ''] = String(amount).split('.');
  return `LKR ${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${cents.padEnd(2, '0').slice(0, 2)}`;
}

// The two read-only lookups an e-mail needs, as plain SELECTs on the same pool as every route.
const databaseLookup = {
  async holders(accountId) {
    return query(
      `SELECT CONCAT(c.first_name, ' ', c.last_name) AS name, c.email, sa.account_no AS accountNo
         FROM ACCOUNT_HOLDER h
         JOIN CUSTOMER c ON c.customer_id = h.customer_id
         JOIN SAVINGS_ACCOUNT sa ON sa.account_id = h.account_id
        WHERE h.account_id = ?
        ORDER BY h.role, c.customer_id`,
      [accountId],
    );
  },
  async agent(agentId) {
    const [row] = await query(
      `SELECT CONCAT(a.first_name, ' ', a.last_name, ', ', b.branch_name) AS label
         FROM AGENT a JOIN BRANCH b ON b.branch_id = a.branch_id WHERE a.agent_id = ?`,
      [agentId],
    );
    return row?.label ?? null;
  },
};

const TERM_WORDS = { '6_MONTH': '6 months', '1_YEAR': '1 year', '3_YEAR': '3 years' };

function body(greeting, sentence, rows, closing) {
  const width = Math.max(...rows.map(([label]) => label.length)) + 2;
  const table = rows.filter(([, value]) => value).map(([label, value]) => `  ${`${label}:`.padEnd(width)} ${value}`);
  return [greeting, '', sentence, '', ...table, '', closing, 'B-Trust Microbanking'].join('\n');
}

// settings: mailSettings() (null = off). transport: anything with sendMail(). lookup: holders() and agent().
export function createNotifier({ settings, transport, lookup = databaseLookup }) {
  async function send(to, subject, text) {
    await transport.sendMail({ from: settings.from, to, subject, text });
  }

  // One receipt per holder with an e-mail address. In demo mode they all go to the demo inbox, each saying who it was for.
  async function receipt(accountId, agentId, build) {
    if (!settings || (!settings.demoInbox && !settings.toCustomers)) return 0;
    const [holders, agent] = await Promise.all([lookup.holders(accountId), agentId ? lookup.agent(agentId) : null]);
    let sent = 0;
    for (const holder of holders) {
      if (!holder.email) continue;
      const { subject, sentence, rows } = build(holder.accountNo);
      let text = body(`Dear ${holder.name},`, sentence, [...rows, ['Processed by', agent ?? 'Online banking']],
        'If you did not expect this, please contact your branch.');
      let to = holder.email;
      if (settings.demoInbox) {
        text = `[Demo: this receipt was for ${holder.name} <${holder.email}>]\n\n${text}`;
        to = settings.demoInbox;
      }
      await send(to, `B-Trust: ${subject}`, text);
      sent += 1;
    }
    return sent;
  }

  return {
    deposit: ({ accountId, amount, referenceNo, newBalance, at, agentId }) =>
      receipt(accountId, agentId, (accountNo) => ({
        subject: `${formatLkr(amount)} deposited to ${accountNo}`,
        sentence: `${formatLkr(amount)} was deposited to your savings account ${accountNo}.`,
        rows: [['Reference', referenceNo], ['Date', at], ['New balance', formatLkr(newBalance)]],
      })),

    withdrawal: ({ accountId, amount, referenceNo, newBalance, at, agentId }) =>
      receipt(accountId, agentId, (accountNo) => ({
        subject: `${formatLkr(amount)} withdrawn from ${accountNo}`,
        sentence: `${formatLkr(amount)} was withdrawn from your savings account ${accountNo}.`,
        rows: [['Reference', referenceNo], ['Date', at], ['New balance', formatLkr(newBalance)]],
      })),

    accountOpened: ({ accountId, planName, amount, referenceNo, agentId }) =>
      receipt(accountId, agentId, (accountNo) => ({
        subject: `your new savings account ${accountNo}`,
        sentence: `Welcome to B-Trust. Your ${planName} savings account ${accountNo} is open.`,
        rows: [['Opening deposit', formatLkr(amount)], ['Reference', referenceNo]],
      })),

    fdOpened: ({ accountId, fdId, amount, termName, interestRate, maturityDate, nextPayoutDate, referenceNo, newBalance, agentId }) =>
      receipt(accountId, agentId, (accountNo) => ({
        subject: `fixed deposit FD ${fdId} opened`,
        sentence: `Your fixed deposit FD ${fdId} of ${formatLkr(amount)} is open, funded from savings account ${accountNo}.`,
        rows: [
          ['Term', `${TERM_WORDS[termName] ?? termName} at ${interestRate}% a year`],
          ['First payout', nextPayoutDate],
          ['Matures', maturityDate],
          ['Reference', referenceNo],
          [`${accountNo} balance`, formatLkr(newBalance)],
        ],
      })),

    fdClosed: ({ accountId, fdId, amount, referenceNo, newBalance, agentId }) =>
      receipt(accountId, agentId, (accountNo) => ({
        subject: `fixed deposit FD ${fdId} closed`,
        sentence: `Your fixed deposit FD ${fdId} was closed early and ${formatLkr(amount)} was paid back to savings account ${accountNo}.`,
        rows: [['Reference', referenceNo], [`${accountNo} balance`, formatLkr(newBalance)]],
      })),

    // A deposit above large_deposit_threshold is accepted but flagged (review_flag = 1): the bank is told about it.
    async reviewAlert({ accountId, amount, referenceNo, at, agentId }) {
      const to = settings?.reviewTo || settings?.demoInbox;
      if (!to) return 0;
      const [[holder], agent] = await Promise.all([lookup.holders(accountId), agentId ? lookup.agent(agentId) : null]);
      const accountNo = holder?.accountNo ?? `account ${accountId}`;
      await send(to, `B-Trust review: ${formatLkr(amount)} deposit to ${accountNo}`,
        body('Hello,', `A deposit of ${formatLkr(amount)} to ${accountNo} was flagged for review (above the large-deposit threshold).`,
          [['Reference', referenceNo], ['Date', at], ['Holder', holder?.name], ['Processed by', agent]],
          'The deposit is already saved; this is for the review that the bank does by hand.'));
      return 1;
    },
  };
}

// The notifier the routes use, made on first use from the environment (backend/.env has been read by then).
let shared = null;
export function notifications() {
  if (!shared) {
    const settings = mailSettings();
    const transport = settings
      ? nodemailer.createTransport({
          host: settings.host,
          port: settings.port,
          secure: settings.secure,
          auth: settings.user ? { user: settings.user, pass: settings.pass } : undefined,
          connectionTimeout: 10000,
          greetingTimeout: 10000,
          socketTimeout: 15000,
        })
      : null;
    shared = createNotifier({ settings, transport });
  }
  return shared;
}

// Routes call this after the database has answered: the e-mail is sent in the background and a failure is only logged,
// so the agent never waits for the mail server and a transaction is never undone because an e-mail could not be sent.
export function sendInBackground(task) {
  Promise.resolve()
    .then(task)
    .catch((err) => console.error(`[${new Date().toISOString()}] e-mail not sent: ${err.message}`));
}
