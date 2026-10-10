// QA-only routes for the Tester view: the two Data Checks views and the "Run interest" button. Owner: Rukshi.
// Reads VW_GAP_NIC_AT_18 and VW_GAP_PLAN_OUTGROWN (procedures/08_gap_queries.sql); Run interest calls, in the repository's
// order (the same as the daily event), PROC_RUN_FD_INTEREST, PROC_PROCESS_FD_MATURITY and PROC_RUN_SAVINGS_INTEREST.
// This route file provides the tester data-check endpoints and runs the fixed-deposit and savings-interest processing in the required order.
import { Router } from 'express';
import { callProc, databaseToday, query } from '../db.js';
import { HttpError } from '../errors.js';
import { noteCall, noteResult, sendData } from '../respond.js';
import { ValidationError, date } from '../validate.js';
import { camelRows } from './reports.js';

const router = Router();

router.get('/gap/nic-at-18', async (req, res) => {
  noteCall(res, 'SELECT * FROM VW_GAP_NIC_AT_18', []);
  sendData(req, res, camelRows(await query('SELECT * FROM VW_GAP_NIC_AT_18')));
});

router.get('/gap/plan-outgrown', async (req, res) => {
  noteCall(res, 'SELECT * FROM VW_GAP_PLAN_OUTGROWN', []);
  sendData(req, res, camelRows(await query('SELECT * FROM VW_GAP_PLAN_OUTGROWN')));
});

async function maturedCount() {
  const [row] = await query("SELECT COUNT(*) AS n FROM FIXED_DEPOSIT WHERE status = 'MATURED'");
  return Number(row.n);
}

// POST /api/tester/run-interest  { runDate: 'YYYY-MM-DD', confirm: true }
// Each step commits on its own (that is how the procedures are written), so if a later step fails, the earlier
// postings stay saved; running it again is safe because nothing is ever posted twice for the same cycle.
router.post('/run-interest', async (req, res) => {
  const body = req.body ?? {};
  if (body.confirm !== true) throw new ValidationError('confirm', 'Confirm the interest run first');
  const runDate = date(body.runDate, 'runDate', 'Run date');
  if (runDate > (await databaseToday())) throw new ValidationError('runDate', 'Run date cannot be in the future');

  noteCall(res, 'PROC_RUN_FD_INTEREST, PROC_PROCESS_FD_MATURITY, PROC_RUN_SAVINGS_INTEREST', [runDate]);
  const result = { runDate, fdInterestPostings: 0, fdsMatured: 0, savingsInterestPostings: 0 };
  let step = 'fixed deposit interest';
  try {
    result.fdInterestPostings = Number((await callProc('PROC_RUN_FD_INTEREST', [runDate], ['postings'])).postings);
    step = 'fixed deposit maturity';
    const before = await maturedCount();
    await callProc('PROC_PROCESS_FD_MATURITY');
    result.fdsMatured = (await maturedCount()) - before;
    step = 'savings interest';
    result.savingsInterestPostings = Number((await callProc('PROC_RUN_SAVINGS_INTEREST', [runDate], ['postings'])).postings);
  } catch (err) {
    if (err?.sqlState !== '45000') throw err;
    const saved = step === 'fixed deposit interest' ? '' : ' What was posted before this step is saved.';
    throw new HttpError(422, `${err.sqlMessage} (while posting ${step}).${saved}`);
  }
  noteResult(res, result);
  sendData(req, res, result);
});

export default router;
