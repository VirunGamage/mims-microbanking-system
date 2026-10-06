// Day-1 check: "is my environment working?" Run it from the project folder after loading the database and starting
// both servers:  node scripts/smoke-test.mjs   (it changes no data; add --write for one real LKR 1.00 deposit). Owner: Virun.
// Uses backend/.env and the backend's own database code, PROC_PROCESS_DEPOSIT, RPT_ACCOUNT_WISE_SUMMARY and GET /api/health.
// A one-command check that this computer is ready: it tests the database connection and the stored procedures, then the backend and the web pages, and prints PASS, SKIP or FAIL with what to fix. It changes no data unless you add --write.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BACKEND = path.join(ROOT, 'backend');
const FRONTEND = path.join(ROOT, 'frontend');
const FRONTEND_URL = 'http://localhost:5173';
const WRITE = process.argv.includes('--write');
const RELOAD = 'Reload the database from the project folder:  mysql -u root -p < scripts/load_all.sql';

// What a fresh load_all.sql gives; using the app can only add rows, never remove them.
const FRESH = { branches: 3, agents: 5, customers: 15, accounts: 13, fixedDeposits: 10, transactions: 230 };
const ROUTINES = [
  'FUNC_CALC_INTEREST', 'PROC_CHECK_BUSINESS_HOURS', 'PROC_CLOSE_FIXED_DEPOSIT', 'PROC_NEXT_TXN_REF',
  'PROC_OPEN_FIXED_DEPOSIT', 'PROC_OPEN_SAVINGS_ACCOUNT', 'PROC_POST_FD_INTEREST', 'PROC_POST_SAVINGS_INTEREST',
  'PROC_PROCESS_DEPOSIT', 'PROC_PROCESS_FD_MATURITY', 'PROC_PROCESS_WITHDRAWAL', 'PROC_RUN_FD_INTEREST',
  'PROC_RUN_SAVINGS_INTEREST', 'PROC_VERIFY_JOINT_HOLDERS', 'RPT_ACCOUNT_WISE_SUMMARY', 'RPT_AGENT_WISE_TRANSACTIONS',
  'RPT_CUSTOMER_ACTIVITY', 'RPT_MONTHLY_INTEREST_DISTRIBUTION',
];
const VIEWS = ['VW_ACTIVE_FD_PAYOUT_SCHEDULE', 'VW_GAP_NIC_AT_18', 'VW_GAP_PLAN_OUTGROWN'];

const tally = { PASS: 0, FAIL: 0, WARN: 0, SKIP: 0 };

// '1253030.59' -> 'LKR 1,253,030.59' using text only (money is never turned into a floating-point number).
function lkr(amount) {
  const [whole, cents = '00'] = String(amount).split('.');
  return `LKR ${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${cents}`;
}

// Prints one result line; the extra lines (cause and fix) are indented under it. ASCII only, for older Windows consoles.
function report(result, text, ...extra) {
  tally[result] += 1;
  console.log(`  ${result.padEnd(4)}  ${text}`);
  for (const line of extra.flatMap((part) => String(part).split('\n'))) console.log(`        ${line.trim()}`);
}

async function main() {
  console.log(`MIMS smoke test${WRITE ? ' (--write: a real deposit is made if the branch is open)' : ''}`);

  console.log('\n1. This computer');
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 22 || (major === 22 && minor < 12)) {
    report('FAIL', `Node.js ${process.versions.node} is too old (22.12 or newer is needed)`,
      'Fix: install Node.js 24 LTS from https://nodejs.org, open a new terminal, then run  npm ci  again in backend and frontend.');
    return;
  }
  report('PASS', `Node.js ${process.versions.node} (22.12 or newer is needed)`);

  const backendReady = ['mysql2', 'dotenv', 'express'].every((name) => existsSync(path.join(BACKEND, 'node_modules', name)));
  if (backendReady) report('PASS', 'Backend packages are installed');
  else report('FAIL', 'Backend packages are not installed', 'Fix: in the backend folder run  npm ci  (not npm install).');

  if (existsSync(path.join(FRONTEND, 'node_modules', 'vite'))) report('PASS', 'Frontend packages are installed');
  else report('FAIL', 'Frontend packages are not installed', 'Fix: in the frontend folder run  npm ci  (not npm install).');

  let config = null;
  if (backendReady) {
    const { loadConfig, ConfigError } = await import(pathToFileURL(path.join(BACKEND, 'src', 'config.js')));
    try {
      config = loadConfig();
    } catch (err) {
      if (!(err instanceof ConfigError)) throw err;
      report('FAIL', 'backend/.env is not ready', `Fix: ${err.message}`);
    }
  }
  if (config && config.db.user !== 'mims_app') {
    report('FAIL', `backend/.env uses the MySQL user "${config.db.user}"`,
      'The app must connect as mims_app, never root (it may only read, run procedures and register customers).',
      'Fix: set DB_USER=mims_app and its password in backend/.env (README, "Set up", steps 3 and 4).');
    config = null;
  } else if (config) {
    report('PASS', `backend/.env is filled in (user mims_app, database ${config.db.database} at ${config.db.host}:${config.db.port})`);
  }

  console.log('\n2. Database');
  if (config) await checkDatabase(config);
  else report('SKIP', 'Database checks (fix the problems above first)');

  console.log('\n3. Servers (both must be running: npm run dev in backend, and npm run dev in frontend)');
  await checkServers(config?.port ?? 3001);
}

async function checkDatabase(config) {
  const db = await import(pathToFileURL(path.join(BACKEND, 'src', 'db.js')));
  const { startupProblem } = await import(pathToFileURL(path.join(BACKEND, 'src', 'errors.js')));
  db.initPool(config.db);
  try {
    let info;
    try {
      info = await db.checkConnection();
    } catch (err) {
      report('FAIL', 'Cannot connect to the database', startupProblem(err, config));
      return;
    }
    report('PASS', `Connected to MySQL ${info.version} as mims_app, database ${info.db}`);
    if (!info.version.startsWith('8.0.')) {
      report('WARN', `MySQL ${info.version} is not the tested version`, 'The project is tested on MySQL 8.0.46 only; other versions may behave differently.');
    }

    await checkGrants(db, config.db.database);
    await checkContents(db, config.db.database);
    await checkDeposit(db);
  } catch (err) {
    report('FAIL', `Unexpected database error: ${err.sqlMessage ?? err.message}`, explain(err));
  } finally {
    await db.closePool();
  }
}

async function checkGrants(db, database) {
  const allowed = new Set(['USAGE ON *.*', `SELECT ON ${database}.*`, `EXECUTE ON ${database}.*`, `INSERT ON ${database}.CUSTOMER`]);
  const needed = [...allowed].filter((grant) => !grant.startsWith('USAGE'));
  const found = [];
  for (const row of await db.query('SHOW GRANTS')) {
    const text = String(Object.values(row)[0]).replaceAll('`', '');
    const match = text.match(/^GRANT (.+) ON (\S+) TO /);
    if (!match || /WITH GRANT OPTION/i.test(text)) found.push(text);
    else for (const privilege of match[1].split(', ')) found.push(`${privilege} ON ${match[2]}`);
  }
  // Windows keeps table names in lower case (CUSTOMER becomes customer), so compare without case.
  const same = (a, b) => a.toUpperCase() === b.toUpperCase();
  const extra = found.filter((grant) => ![...allowed].some((ok) => same(ok, grant)));
  const missing = needed.filter((grant) => !found.some((have) => same(have, grant)));
  if (extra.length === 0 && missing.length === 0) {
    report('PASS', 'mims_app has exactly the rights it needs (SELECT and EXECUTE on the database, INSERT on CUSTOMER)');
    return;
  }
  report('FAIL', `mims_app has the wrong rights${extra.length ? `; extra: ${extra.join(', ')}` : ''}${missing.length ? `; missing: ${missing.join(', ')}` : ''}`,
    "Fix: log in to MySQL as root and run:  DROP USER 'mims_app'@'localhost', 'mims_app'@'127.0.0.1';",
    "then  SET @app_password = 'your-password';  (8+ characters) and  SOURCE scripts/create_app_user.sql;  (same password as in backend/.env)");
}

async function checkContents(db, database) {
  const [counts] = await db.query(`
    SELECT (SELECT COUNT(*) FROM BRANCH) AS branches, (SELECT COUNT(*) FROM AGENT) AS agents,
           (SELECT COUNT(*) FROM CUSTOMER) AS customers, (SELECT COUNT(*) FROM SAVINGS_ACCOUNT) AS accounts,
           (SELECT COUNT(*) FROM FIXED_DEPOSIT) AS fixedDeposits, (SELECT COUNT(*) FROM \`TRANSACTION\`) AS transactions`);
  const summary = `${counts.branches} branches, ${counts.agents} agents, ${counts.customers} customers, ${counts.accounts} accounts, ` +
    `${counts.fixedDeposits} fixed deposits, ${counts.transactions} transactions`;
  const short = Object.keys(FRESH).filter((key) => Number(counts[key]) < FRESH[key]);
  const isFresh = Object.keys(FRESH).every((key) => Number(counts[key]) === FRESH[key]);
  if (short.length > 0) report('FAIL', `Sample data is incomplete: ${summary}`, `A fresh load has 3, 5, 15, 13, 10 and 230. Fix: ${RELOAD}`);
  else report('PASS', `Tables loaded: ${summary}${isFresh ? ' (a fresh load)' : ' (more than a fresh load: fine after using the app)'}`);

  const routines = (await db.query('SELECT ROUTINE_NAME AS name FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = ?', [database]))
    .map((row) => row.name.toUpperCase());
  const views = (await db.query("SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'VIEW'", [database]))
    .map((row) => row.name.toUpperCase());
  const missing = [...ROUTINES.filter((name) => !routines.includes(name)), ...VIEWS.filter((name) => !views.includes(name))];
  if (missing.length === 0) report('PASS', `All ${ROUTINES.length} procedures and functions and all ${VIEWS.length} views are there`);
  else report('FAIL', `Missing from the database: ${missing.join(', ')}`, `Fix: ${RELOAD}`);

  const plans = await db.query('SELECT plan_name AS name FROM SAVINGS_PLAN ORDER BY plan_id');
  const [fd] = await db.query('SELECT COUNT(*) AS n FROM FD_PLAN');
  if (plans.length === 5 && Number(fd.n) === 3) {
    report('PASS', `Lookup: ${plans.length} savings plans (${plans.map((plan) => plan.name).join(', ')}) and ${fd.n} fixed deposit terms`);
  } else {
    report('FAIL', `Lookup: expected 5 savings plans and 3 fixed deposit terms, found ${plans.length} and ${fd.n}`, `Fix: ${RELOAD}`);
  }

  const rows = await db.callRows('RPT_ACCOUNT_WISE_SUMMARY', [null]);
  if (rows.length > 0) report('PASS', `Report: RPT_ACCOUNT_WISE_SUMMARY (all branches) returned ${rows.length} rows`);
  else report('FAIL', 'Report: RPT_ACCOUNT_WISE_SUMMARY returned no rows', `The sample data is probably missing. Fix: ${RELOAD}`);
}

// The deposit is "clock-aware": outside Mon-Fri business hours the database must refuse it; inside them it must accept it.
// Without --write it targets an account that does not exist, so even when the branch is open nothing is saved.
async function checkDeposit(db) {
  const [clock] = await db.query(
    "SELECT DATE_FORMAT(NOW(), '%W %Y-%m-%d %H:%i') AS now, TIMEDIFF(NOW(), UTC_TIMESTAMP()) AS offset");
  const hours = Object.fromEntries((await db.query(
    "SELECT config_key AS k, config_value AS v FROM SYSTEM_CONFIG WHERE config_key IN ('business_day_start', 'business_day_end')"))
    .map((row) => [row.k, row.v]));
  const when = `${clock.now} by the database clock; open Mon-Fri ${hours.business_day_start}-${hours.business_day_end}`;
  if (clock.offset === '05:30:00') report('PASS', `Database clock is Sri Lanka time: ${clock.now} (UTC+05:30)`);
  else report('WARN', `Database clock is UTC${clock.offset.startsWith('-') ? '' : '+'}${clock.offset.slice(0, -3)}, not Sri Lanka time (UTC+05:30)`,
    'Business hours are judged by this clock. Fix: set this computer\'s time zone to Sri Lanka and restart MySQL,',
    "or add  default-time-zone='+05:30'  under [mysqld] in my.ini and restart MySQL.");

  const [agent] = await db.query("SELECT agent_id AS id FROM AGENT WHERE status = 'ACTIVE' ORDER BY agent_id LIMIT 1");
  const [account] = WRITE
    ? await db.query("SELECT account_id AS id, account_no AS no FROM SAVINGS_ACCOUNT WHERE status = 'ACTIVE' ORDER BY account_id LIMIT 1")
    : [{ id: 0, no: null }];
  if (!agent || !account) {
    report('FAIL', 'Deposit: there is no ACTIVE agent or account to use', `Fix: ${RELOAD}`);
    return;
  }
  try {
    const out = await db.callProc('PROC_PROCESS_DEPOSIT', [account.id, '1.00', 'BRANCH', agent.id], ['ref', 'balance']);
    report('PASS', `Deposit: the branch is open (${when}).`,
      `PROC_PROCESS_DEPOSIT saved LKR 1.00 into ${account.no}: reference ${out.ref}, new balance ${lkr(out.balance)}.`);
  } catch (err) {
    const message = err.sqlMessage ?? err.message;
    if (err.sqlState === '45000' && /business hours/i.test(message)) {
      report('PASS', `Deposit: the branch is closed (${when}),`,
        `so PROC_PROCESS_DEPOSIT refused it: "${message}". That is the rule working, not a fault. Nothing was saved.`);
    } else if (err.sqlState === '45000' && !WRITE && /account not found/i.test(message)) {
      report('PASS', `Deposit: the branch is open (${when}).`,
        'PROC_PROCESS_DEPOSIT passed the business-hours check and stopped at its account check, because this test uses',
        'an account that does not exist, so nothing was saved. Run with --write to make one real LKR 1.00 deposit.');
    } else {
      report('FAIL', `Deposit: PROC_PROCESS_DEPOSIT failed: ${message}`, explain(err));
    }
  }
}

function explain(err) {
  if (err?.errno === 1370) return "Likely cause: mims_app may not run procedures. Fix: log in as root and run scripts/create_app_user.sql again.";
  if (err?.errno === 1305 || err?.errno === 1146) return `Likely cause: part of the database is missing. Fix: ${RELOAD}`;
  if (err?.errno === 1142) return 'Likely cause: mims_app is missing a right. Fix: log in as root and run scripts/create_app_user.sql again.';
  return 'If this message does not help, send the whole output of this test to Virun.';
}

async function getPage(url) {
  try {
    const response = await fetch(url, { headers: { Accept: 'application/json, text/html' }, signal: AbortSignal.timeout(5000) });
    const text = await response.text();
    let body = null;
    try {
      body = JSON.parse(text);
    } catch {
      body = null; // an HTML page, or nothing
    }
    return { status: response.status, body, text };
  } catch (err) {
    return { status: 0, down: true, reason: err.cause?.code ?? err.name };
  }
}

async function checkServers(port) {
  const backend = `http://localhost:${port}`;
  const health = await getPage(`${backend}/api/health`);
  const backendUp = health.status === 200 && health.body?.data?.status === 'ok';
  if (backendUp) report('PASS', `Backend answers at ${backend}/api/health (database ${health.body.data.database})`);
  else if (health.down) report('FAIL', `Backend is not answering at ${backend} (${health.reason})`,
    'Fix: open a terminal in the backend folder and run  npm run dev  , leave it open, then run this test again.');
  else if (health.status === 503) report('FAIL', 'Backend is running but cannot reach the database',
    'Fix the database problem first (part 2 above), then run this test again.');
  else report('FAIL', `Backend answered ${health.status}: ${health.body?.error ?? 'not the MIMS API'}`,
    `Is something else using port ${port}? Read the messages in the backend terminal.`);

  // Any JSON answer from our API (even an error) proves the proxy reached the backend; the backend itself is checked above.
  const proxied = await getPage(`${FRONTEND_URL}/api/health`);
  if (proxied.body && ('data' in proxied.body || 'error' in proxied.body)) {
    report('PASS', `Frontend proxy works: ${FRONTEND_URL}/api/health reaches the backend`);
  } else if (proxied.down) {
    report('FAIL', `Frontend dev server is not answering at ${FRONTEND_URL} (${proxied.reason})`,
      'Fix: open a second terminal in the frontend folder and run  npm run dev  , and leave it open.');
  } else {
    report('FAIL', `Frontend is running but its proxy cannot reach the backend (answered ${proxied.status})`,
      'Fix: start the backend first. frontend/vite.config.js sends /api to http://127.0.0.1:3001, so PORT in backend/.env must stay 3001.');
  }

  const home = await getPage(`${FRONTEND_URL}/`);
  if (home.status === 200 && home.text.includes('id="root"')) report('PASS', `The app page loads at ${FRONTEND_URL}/`);
  else if (!home.down) report('FAIL', `${FRONTEND_URL}/ did not return the app page (answered ${home.status})`,
    'Is another program using port 5173? Stop it, then start the frontend again with  npm run dev.');

  // The lookup and report routes arrive with the slices; until they are merged the backend answers 404.
  const apiChecks = [
    ['Lookup through the API', '/api/lookups/savings-plans', "Virun's lookups"],
    ['Report through the API', '/api/reports/account-wise?branchId=1', "Rukshi's reports"],
  ];
  for (const [label, route, slice] of apiChecks) {
    if (!backendUp) {
      report('SKIP', `${label} (${route}): the backend health check failed`);
      continue;
    }
    const answer = await getPage(`${backend}${route}`);
    if (answer.status === 200 && Array.isArray(answer.body?.data)) report('PASS', `${label}: ${route} returned ${answer.body.data.length} rows`);
    else if (answer.status === 404) report('SKIP', `${label}: ${route} is not merged yet (${slice} slice)`);
    else report('FAIL', `${label}: ${route} answered ${answer.status}: ${answer.body?.error ?? 'unexpected answer'}`,
      'Read the messages in the backend terminal for details.');
  }
}

try {
  await main();
} catch (err) {
  report('FAIL', `The smoke test itself stopped: ${err.message}`, 'Send the whole output to Virun.');
}
const counts = Object.entries(tally).map(([result, n]) => `${n} ${result}`).join(', ');
console.log(`\nResult: ${counts}`);
console.log(tally.FAIL === 0
  ? 'Your environment is ready.'
  : 'Fix the FAIL lines above, starting with the first one, then run this test again.');
process.exitCode = tally.FAIL === 0 ? 0 : 1;
