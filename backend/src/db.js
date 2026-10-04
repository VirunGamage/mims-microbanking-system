// The single MySQL connection pool, plus the helpers every route uses: callProc, callRows and query. Owner: Virun.
// Values always travel as ? placeholders. Only procedure names and OUT-variable names go into the SQL text, and they are checked first.
import mysql from 'mysql2/promise';

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
let pool = null;

export function initPool(dbConfig) {
  pool = mysql.createPool({
    ...dbConfig,
    connectionLimit: 10,
    dateStrings: true, // dates come back as text ('2026-10-05', '2026-10-05 10:00:00'), never as JS Date objects
    decimalNumbers: false, // money stays text such as '1500.00', so there is never any floating-point rounding
    supportBigNumbers: true,
    multipleStatements: false,
  });
  return pool;
}

function getPool() {
  if (!pool) throw new Error('The database pool has not been created yet (call initPool first)');
  return pool;
}

function assertIdentifier(name) {
  if (typeof name !== 'string' || !IDENTIFIER.test(name)) {
    throw new Error(`Refusing to use "${name}" as an SQL name`);
  }
}

// Runs a stored procedure that has OUT parameters. mysql2 cannot read OUT parameters directly, so each one is
// written into a session variable (@name) and read back with a SELECT on the same connection, before the
// connection goes back to the pool.
export async function callProc(name, inParams = [], outNames = []) {
  assertIdentifier(name);
  outNames.forEach(assertIdentifier);
  const conn = await getPool().getConnection();
  try {
    const args = [...inParams.map(() => '?'), ...outNames.map((out) => `@${out}`)].join(', ');
    await conn.query(`CALL ${name}(${args})`, inParams);
    if (outNames.length === 0) return {};
    const [rows] = await conn.query(`SELECT ${outNames.map((out) => `@${out} AS ${out}`).join(', ')}`);
    return rows[0];
  } finally {
    conn.release();
  }
}

// Runs a report procedure and returns its rows. MySQL also sends a status packet after the rows; it is dropped here.
export async function callRows(name, inParams = []) {
  assertIdentifier(name);
  const args = inParams.map(() => '?').join(', ');
  const [results] = await getPool().query(`CALL ${name}(${args})`, inParams);
  return Array.isArray(results[0]) ? results[0] : [];
}

// Plain statements: read-only SELECTs, plus the one INSERT the app is allowed to do (registering a customer).
export async function query(sql, params = []) {
  const [result] = await getPool().query(sql, params);
  return result;
}

export async function checkConnection() {
  const [rows] = await getPool().query(
    'SELECT DATABASE() AS db, NOW() AS serverTime, VERSION() AS version',
  );
  return rows[0];
}

// Today's date by the database clock, as YYYY-MM-DD. The database decides business hours and "today" for every rule,
// so the server compares dates against this, not against the computer's own clock.
export async function databaseToday() {
  const [rows] = await getPool().query('SELECT CURDATE() AS today');
  return rows[0].today;
}

export async function closePool() {
  if (pool) {
    const closing = pool;
    pool = null;
    await closing.end();
  }
}
