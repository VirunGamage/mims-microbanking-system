// Builds the /api router: /api/health and /api/status live here, and each slice's router is added once its file exists.
// Owner: Virun. Uses SELECT DATABASE()/NOW()/VERSION() and PROC_CHECK_BUSINESS_HOURS (read-only).
// Sign-in (/api/auth) and the public rates (/api/rates) are open; every slice says which logins may use it.
// Builds the /api router with /health and /status, and mounts each slice's route file once that file exists, so nobody has to edit this file.
import { existsSync } from 'node:fs';
import { Router } from 'express';
import { callProc, checkConnection, query } from '../db.js';
import { noteCall, sendData } from '../respond.js';
import { createAuthRouter, requireRole, signedInAgent } from '../session.js';

const EVERYONE = ['CUSTOMER', 'AGENT', 'ADMIN'];
const PUBLIC_SETTINGS = {
  business_day_start: 'businessDayStart',
  business_day_end: 'businessDayEnd',
  daily_withdrawal_limit: 'dailyWithdrawalLimit',
  fd_interest_cycle_days: 'fdInterestCycleDays',
  interest_day_count_basis: 'interestDayCountBasis',
  age_child_max: 'ageChildMax',
  age_teen_min: 'ageTeenMin',
  age_teen_max: 'ageTeenMax',
  age_adult_min: 'ageAdultMin',
  age_senior_min: 'ageSeniorMin',
};
const STAFF = ['AGENT', 'ADMIN'];

// Each slice has its own file and its own owner. A file that hasn't been merged yet is simply skipped,
// so nobody has to edit this file when their slice arrives. The third value is who may use the slice:
// customers only see their own accounts (/api/me), agents and admins the branch screens, and only admins the management
// reports (they cover every branch, agent and customer) and the Tester tools.
const SLICES = [
  ['/lookups', './lookups.js', EVERYONE],
  ['/customers', './customers.js', STAFF],
  ['/accounts', './accounts.js', STAFF],
  ['/accounts', './transactions.js', STAFF], // deposit, withdraw and history are /api/accounts/:id/...
  ['/fixed-deposits', './fixedDeposits.js', STAFF],
  ['/reports', './reports.js', ['ADMIN']],
  ['/agent-reports', './agentReports.js', STAFF], // the agent's own activity and the FDs due soon
  ['/tester', './tester.js', ['ADMIN']],
  ['/me', './me.js', ['CUSTOMER']], // online banking
];

export async function createApiRouter({ log = console.log, sessionSecret, findLogin } = {}) {
  const router = Router();

  router.use('/auth', createAuthRouter({ secret: sessionSecret, findLogin }));

  // The rates and the public rules (opening hours, age bands, interest cycle), for the start page: a bank shows these to
  // everyone. Nothing about any customer, account or agent.
  router.get('/rates', async (req, res) => {
    const savings = await query(
      `SELECT plan_name AS planName, interest_rate AS interestRate, minimum_balance AS minimumBalance
         FROM SAVINGS_PLAN ORDER BY plan_id`,
    );
    const fixedDeposits = await query(
      `SELECT term_name AS termName, duration_days AS durationDays, interest_rate AS interestRate
         FROM FD_PLAN ORDER BY duration_days`,
    );
    const rows = await query(
      `SELECT config_key AS configKey, config_value AS configValue FROM SYSTEM_CONFIG
        WHERE config_key IN (${Object.keys(PUBLIC_SETTINGS).map(() => '?').join(', ')})`,
      Object.keys(PUBLIC_SETTINGS),
    );
    const settings = Object.fromEntries(rows.map(({ configKey, configValue }) => [PUBLIC_SETTINGS[configKey], configValue]));
    sendData(req, res, { savings, fixedDeposits, settings });
  });

  router.get('/health', async (req, res) => {
    const info = await checkConnection();
    sendData(req, res, { status: 'ok', database: info.db, serverTime: info.serverTime, mysqlVersion: info.version });
  });

  // The procedure itself decides whether the branch is open: it returns quietly when open and raises
  // SQLSTATE 45000 with a message when closed.
  router.get('/status', async (req, res) => {
    noteCall(res, 'PROC_CHECK_BUSINESS_HOURS', []);
    const { serverTime } = await checkConnection();
    let branchOpen = true;
    let message = 'The branch is open for deposits, withdrawals, new accounts, new fixed deposits and early fixed-deposit closures.';
    try {
      await callProc('PROC_CHECK_BUSINESS_HOURS');
    } catch (err) {
      if (err.sqlState !== '45000') throw err;
      branchOpen = false;
      message = err.sqlMessage;
    }
    sendData(req, res, { branchOpen, message, serverTime });
  });

  const mounted = [];
  const waiting = [];
  for (const [path, file, roles] of SLICES) {
    const url = new URL(file, import.meta.url);
    if (!existsSync(url)) {
      waiting.push(file.slice(2));
      continue;
    }
    const { default: sliceRouter } = await import(url);
    router.use(path, requireRole(...roles), signedInAgent, sliceRouter);
    mounted.push(file.slice(2));
  }
  log(`Routes loaded: health, status, auth, rates${mounted.length ? `, ${mounted.join(', ')}` : ''}`);
  if (waiting.length) log(`Not merged yet (skipped): ${waiting.join(', ')}`);

  return router;
}
