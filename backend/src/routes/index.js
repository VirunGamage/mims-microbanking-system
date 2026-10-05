// Builds the /api router: /api/health and /api/status live here, and each slice's router is added once its file exists.
// Owner: Virun. Uses SELECT DATABASE()/NOW()/VERSION() and PROC_CHECK_BUSINESS_HOURS (read-only).
// Builds the /api router with /health and /status, and mounts each slice's route file once that file exists, so nobody has to edit this file.
import { existsSync } from 'node:fs';
import { Router } from 'express';
import { callProc, checkConnection } from '../db.js';
import { noteCall, sendData } from '../respond.js';

// Each slice has its own file and its own owner. A file that hasn't been merged yet is simply skipped,
// so nobody has to edit this file when their slice arrives.
const SLICES = [
  ['/lookups', './lookups.js'],
  ['/customers', './customers.js'],
  ['/accounts', './accounts.js'],
  ['/accounts', './transactions.js'], // deposit, withdraw and history are /api/accounts/:id/...
  ['/fixed-deposits', './fixedDeposits.js'],
  ['/reports', './reports.js'],
  ['/tester', './tester.js'],
];

export async function createApiRouter({ log = console.log } = {}) {
  const router = Router();

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
    let message = 'The branch is open for deposits, withdrawals, new accounts and new fixed deposits.';
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
  for (const [path, file] of SLICES) {
    const url = new URL(file, import.meta.url);
    if (!existsSync(url)) {
      waiting.push(file.slice(2));
      continue;
    }
    const { default: sliceRouter } = await import(url);
    router.use(path, sliceRouter);
    mounted.push(file.slice(2));
  }
  log(`Routes loaded: health, status${mounted.length ? `, ${mounted.join(', ')}` : ''}`);
  if (waiting.length) log(`Not merged yet (skipped): ${waiting.join(', ')}`);

  return router;
}
