// Read-only lists for drop-downs and the Home page: branches, ACTIVE agents, savings plans, FD terms and the bank's
// settings. Owner: Virun. Plain SELECTs on BRANCH, AGENT, SAVINGS_PLAN, FD_PLAN and SYSTEM_CONFIG.
// Read-only lists for the drop-downs and the Home page (branches, active agents, savings plans, FD terms and the bank's settings), each one a plain SELECT.
import { Router } from 'express';
import { query } from '../db.js';
import { sendData } from '../respond.js';

const router = Router();

router.get('/branches', async (req, res) => {
  const rows = await query(
    'SELECT branch_id AS branchId, branch_name AS branchName, district FROM BRANCH ORDER BY branch_id',
  );
  sendData(req, res, rows);
});

// Only ACTIVE agents may process anything, so only they appear in the "Acting as" list.
router.get('/agents', async (req, res) => {
  const rows = await query(
    `SELECT a.agent_id AS agentId, CONCAT(a.first_name, ' ', a.last_name) AS name,
            a.branch_id AS branchId, b.branch_name AS branchName
       FROM AGENT a
       JOIN BRANCH b ON b.branch_id = a.branch_id
      WHERE a.status = 'ACTIVE'
      ORDER BY a.agent_id`,
  );
  sendData(req, res, rows);
});

router.get('/savings-plans', async (req, res) => {
  const rows = await query(
    `SELECT plan_id AS planId, plan_name AS planName, interest_rate AS interestRate, minimum_balance AS minimumBalance
       FROM SAVINGS_PLAN ORDER BY plan_id`,
  );
  sendData(req, res, rows);
});

router.get('/fd-plans', async (req, res) => {
  const rows = await query(
    `SELECT fd_plan_id AS fdPlanId, term_name AS termName, duration_days AS durationDays, interest_rate AS interestRate
       FROM FD_PLAN ORDER BY duration_days`,
  );
  sendData(req, res, rows);
});

// SYSTEM_CONFIG key -> the name the pages use, and whether the value is a whole number. Times and money stay text.
const SETTINGS = {
  business_day_start: ['businessDayStart', false],
  business_day_end: ['businessDayEnd', false],
  daily_withdrawal_limit: ['dailyWithdrawalLimit', false],
  large_deposit_threshold: ['largeDepositThreshold', false],
  savings_interest_cycle_days: ['savingsInterestCycleDays', true],
  fd_interest_cycle_days: ['fdInterestCycleDays', true],
  interest_day_count_basis: ['interestDayCountBasis', true],
  age_child_max: ['ageChildMax', true],
  age_teen_min: ['ageTeenMin', true],
  age_teen_max: ['ageTeenMax', true],
  age_adult_min: ['ageAdultMin', true],
  age_senior_min: ['ageSeniorMin', true],
};

router.get('/settings', async (req, res) => {
  const rows = await query('SELECT config_key AS configKey, config_value AS configValue FROM SYSTEM_CONFIG');
  const settings = {};
  for (const { configKey, configValue } of rows) {
    const known = SETTINGS[configKey];
    if (known) settings[known[0]] = known[1] ? Number(configValue) : configValue;
  }
  sendData(req, res, settings);
});

export default router;
