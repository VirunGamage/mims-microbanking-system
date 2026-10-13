// Unit tests for notify.js: who gets which e-mail, what it says, and that nothing is sent when it is turned off.
// Run with: npm test  (no database and no mail server needed: the e-mails are collected instead of sent)
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createNotifier, formatLkr, mailSettings, mailStatusLine } from '../src/notify.js';

// Collects every e-mail instead of sending it
function fakeTransport() {
  const sent = [];
  return { sent, sendMail: async (message) => { sent.push(message); } };
}

// Two holders (a joint account), one of them without an e-mail address, and an agent
const lookup = {
  holders: async () => [
    { name: 'Lucas Thompson', email: 'lucas@mail.com', accountNo: 'SA0000012' },
    { name: 'Harper Garcia', email: null, accountNo: 'SA0000012' },
  ],
  agent: async () => 'Alice Smith, Central Branch',
};

const deposit = { accountId: 12, amount: '2500.00', referenceNo: 'TXN0000231', newBalance: '44125.22', at: '2026-10-13 13:54:47', agentId: 1 };

test('money is written with thousands separators and two decimals', () => {
  assert.equal(formatLkr('2500.00'), 'LKR 2,500.00');
  assert.equal(formatLkr('1250000.5'), 'LKR 1,250,000.50');
  assert.equal(formatLkr('0.01'), 'LKR 0.01');
});

test('without SMTP_HOST e-mail is off and nothing is looked up or sent', async () => {
  assert.equal(mailSettings({}), null);
  assert.match(mailStatusLine(null), /off/);
  const transport = fakeTransport();
  const notifier = createNotifier({ settings: null, transport, lookup: { holders: () => assert.fail('no lookup when off') } });
  assert.equal(await notifier.deposit(deposit), 0);
  assert.equal(await notifier.reviewAlert(deposit), 0);
  assert.equal(transport.sent.length, 0);
});

test('with a demo inbox every receipt goes there and says who it was for', async () => {
  const settings = mailSettings({ SMTP_HOST: 'mail', SMTP_PORT: '1025', MAIL_DEMO_INBOX: 'demo@btrust.local' });
  const transport = fakeTransport();
  assert.equal(await createNotifier({ settings, transport, lookup }).deposit(deposit), 1); // Harper has no e-mail
  const [mail] = transport.sent;
  assert.equal(mail.to, 'demo@btrust.local');
  assert.equal(mail.subject, 'B-Trust: LKR 2,500.00 deposited to SA0000012');
  assert.match(mail.text, /^\[Demo: this receipt was for Lucas Thompson <lucas@mail\.com>\]/);
  assert.match(mail.text, /LKR 2,500\.00 was deposited to your savings account SA0000012\./);
  assert.match(mail.text, /Reference: +TXN0000231/);
  assert.match(mail.text, /New balance: +LKR 44,125\.22/);
  assert.match(mail.text, /Processed by: +Alice Smith, Central Branch/);
});

test("receipts go to customers' own addresses only when MAIL_SEND_TO_CUSTOMERS is true", async () => {
  const transport = fakeTransport();
  const off = mailSettings({ SMTP_HOST: 'smtp.example.com' });
  assert.equal(await createNotifier({ settings: off, transport, lookup }).deposit(deposit), 0);
  assert.match(mailStatusLine(off), /receipts are off/);

  const on = mailSettings({ SMTP_HOST: 'smtp.example.com', MAIL_SEND_TO_CUSTOMERS: 'true' });
  assert.equal(await createNotifier({ settings: on, transport, lookup }).withdrawal(deposit), 1);
  assert.equal(transport.sent[0].to, 'lucas@mail.com');
  assert.doesNotMatch(transport.sent[0].text, /\[Demo/);
});

test('a flagged deposit sends one alert to the bank, not to the customer', async () => {
  const settings = mailSettings({ SMTP_HOST: 'mail', MAIL_REVIEW_TO: 'review@btrust.lk' });
  const transport = fakeTransport();
  assert.equal(await createNotifier({ settings, transport, lookup }).reviewAlert({ ...deposit, amount: '1250000.00' }), 1);
  assert.equal(transport.sent.length, 1);
  assert.equal(transport.sent[0].to, 'review@btrust.lk');
  assert.match(transport.sent[0].subject, /review: LKR 1,250,000\.00 deposit to SA0000012/);
});

test('the fixed deposit receipt names the term in words', async () => {
  const settings = mailSettings({ SMTP_HOST: 'mail', MAIL_DEMO_INBOX: 'demo@btrust.local' });
  const transport = fakeTransport();
  await createNotifier({ settings, transport, lookup }).fdOpened({
    accountId: 12, fdId: 11, amount: '10000.00', termName: '6_MONTH', interestRate: '13.00', maturityDate: '2027-04-11',
    nextPayoutDate: '2026-11-12', referenceNo: 'TXN0000235', newBalance: '41007.29', agentId: 3,
  });
  assert.match(transport.sent[0].text, /Term: +6 months at 13\.00% a year/);
  assert.equal(transport.sent[0].subject, 'B-Trust: fixed deposit FD 11 opened');
});

test('settings: port 465 uses TLS from the start, and MAIL_FROM falls back to SMTP_USER', () => {
  const gmail = mailSettings({ SMTP_HOST: 'smtp.gmail.com', SMTP_PORT: '465', SMTP_USER: 'mims.demo@gmail.com', SMTP_PASS: 'abcd efgh' });
  assert.equal(gmail.secure, true);
  assert.equal(gmail.from, 'mims.demo@gmail.com');
  assert.equal(gmail.pass, 'abcd efgh');
  assert.equal(mailSettings({ SMTP_HOST: 'x' }).port, 587);
});
