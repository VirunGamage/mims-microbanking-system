# Walkthrough — Virun's files

This explains the files I committed in the app phase. Each part names the real functions, components and procedures, so the code can be opened beside it.

## What I own

I wrote the database design: the schema (tables, keys, constraints, and the customer and agent triggers) and the account-opening and FD-opening procedures. In the app phase I also own the foundations the others build on, and some documents:

- **Repository set-up:** `.gitignore`, `.gitattributes`, `README.md` and `backend/.env.example`.
- **The backend core** in `backend/src/`: start-up (`server.js`), the Express app (`app.js`), the settings (`config.js`), the database helpers (`db.js`), error handling (`errors.js`), input checks (`validate.js`), the answer format (`respond.js`) and the route list (`routes/index.js`), with the unit tests (`app.test.js`, `errors.test.js`, `validate.test.js`) and the database test `integration/db.test.js`. Every other route file is built on these.
- **The customer and account API:** `backend/src/routes/lookups.js`, `customers.js` and `accounts.js`, and the search helper `backend/src/search.js` with its test `backend/test/search.test.js`.
- **The frontend set-up:** `frontend/package.json`, `vite.config.js` and `index.html`; the API client `frontend/src/api/client.js` and the data hooks `api/useApi.js`; the agent context `context/AgentContext.jsx`; and the money and date helpers `utils/money.js` and `utils/format.js` with their tests. Shanuja's frontend core is built on these.
- **The smoke test:** `scripts/smoke-test.mjs`.
- `docs/SRS_REVISION.md`: the SRS v3.1 revision text.

The browser never talks to MySQL. A page calls the Express API (port 3001), and the API calls the team's procedures as `mims_app`, a user that may only SELECT, EXECUTE routines and INSERT into `CUSTOMER`. So every rule — business hours, minimum balances, the daily limit, the plan by age, interest — is still enforced by the database, whatever the page does. The pages only check the same rules early, so a mistake shows beside the field. My core code checks that the input has the right shape, calls a stored procedure and explains the answer in plain words; even a bug in the app cannot change a balance.

## How a request travels

Here is one deposit, from the button to the passbook. The page and the transactions route are Archchu's; the client, the proxy, Express, the input checks, the database helpers and the error handling they stand on are yours.

1. **The page.** On Archchu's Transactions page (`Transactions.jsx`) the agent picks an account, types `1500.5` in the Deposit box and presses *Record deposit*. The `DepositForm` *component* (a function that returns what React, the library that draws the pages, should show) calls `form.submit(depositError, { agentId })`.
2. **The browser check.** `useMoneyForm` is a *hook*: a function whose name starts with `use` and that can remember things between redraws. It runs `depositError('1500.5')` first. An empty box, a non-amount or zero shows a message under the box and nothing is sent. Here it is fine, so `normaliseAmount` turns it into `'1500.50'`.
3. **The call.** `deposit(accountId, { agentId, amount: '1500.50' })` in `frontend/src/api/transactions.js` calls `api.post(...)`. The shared client (`client.js`) sends, for example, `POST /api/accounts/7/deposit` with a JSON body (data written as text).
4. **The Vite proxy.** The page comes from Vite, the development server on port 5173. Vite forwards every `/api/...` request to the backend on port 3001; a *proxy* is a server that passes requests on to another server. So the browser only ever talks to one address.
5. **Express.** Express is the web-server library the backend is built on. A *middleware* is a function Express runs on each request, in the order it was added; it can change the request, answer it or pass it on. In `app.js`, the `express.json()` middleware turns the JSON body into `req.body`. The `/api` router from `routes/index.js` hands `/accounts/7/deposit` to the transactions router.
6. **The route.** In Archchu's `transactions.js`, `router.post('/:id/deposit')` checks the input with `id()` and `money()` from `validate.js`. A bad value stops here with HTTP 400 (*bad request*) and the name of the field. Then it calls `callProc('PROC_PROCESS_DEPOSIT', [7, '1500.50', 'BRANCH', 1], ['reference_no', 'new_balance'])`.
7. **The database helper.** `callProc` in `db.js` borrows one connection from the *connection pool* (a few open connections that are reused, so no request has to log in again). It runs `CALL PROC_PROCESS_DEPOSIT(?, ?, ?, ?, @reference_no, @new_balance)`; each `?` is a *placeholder* that mysql2 (the library that talks to MySQL) fills with one of the four values. Then, on the same connection, it runs `SELECT @reference_no AS reference_no, @new_balance AS new_balance`. An *OUT parameter* is a procedure parameter that the procedure fills in for the caller. mysql2 cannot read one directly, so it is parked in a session variable (`@name`) and read back. Session variables belong to one connection, which is why both statements must use the same one.
8. **The procedure.** `PROC_PROCESS_DEPOSIT` checks the amount, the business hours and that the account exists and is ACTIVE. It sets the review flag if the amount is above the large-deposit threshold (LKR 1,000,000), takes the next reference number, inserts the `TRANSACTION` row, raises the balance and commits. It is all or nothing.
9. **The review flag.** The procedure has no OUT parameter for the flag, so the route's `readBack()` reads `review_flag` and `txn_timestamp` from the new `TRANSACTION` row, found by its `reference_no`. It only reads.
10. **The answer.** `sendData` replies with HTTP 201 (*created*) and `{ data: { accountId, type, amount, referenceNo, newBalance, reviewFlagged, at } }`.
11. **Back on the page.** The client returns `data`. `useMoneyForm` clears the box and calls `refresh()`, which reloads the account (new balance in the summary strip) and the passbook (back on page 1). `MoneyResult` shows a success card with the reference, amount, new balance and time, plus a note if the deposit was flagged for review.

**When the database says no.** Suppose a withdrawal would leave less than the plan minimum.

- `PROC_PROCESS_WITHDRAWAL` runs `SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Withdrawal would take the balance below the plan minimum'`. *SQLSTATE* is a five-character code that says how a statement ended. `45000` is the code our procedures and triggers use for "a business rule refused this". The procedure's handler rolls everything back first.
- mysql2 throws an error with `sqlState: '45000'` and that `sqlMessage`.
- The route catches it and throws `ruleError(err, MONEY_FIELDS)`. That makes an `HttpError` with status 422 and the same message. It also tests the message against the *regular expressions* (text patterns such as `/limit/i`) in `MONEY_FIELDS`: `minimum` matches, so the error gets `field: 'amount'`.
- Express 5 passes any error thrown inside an `async` route to the error handler by itself. `errorHandler` in `errors.js` sends `422 { "error": "Withdrawal would take the balance below the plan minimum", "field": "amount" }`. (422 means "understood, but it breaks a rule".)
- On the page, the client throws an `ApiError` that carries `field`. `useMoneyForm` shows the message under the Amount box and puts the cursor there. A message with no field, such as the business-hours refusal, appears in the error banner above the form instead.

### Registering a customer

Sameera's form (`RegisterCustomer` in `Customers.jsx`) checks the fields in the browser, then her `registerCustomer()` posts the form to `/api/customers` through my client and the proxy. From there it is my code:

1. Express passes the request to `router.post('/')` in `backend/src/routes/customers.js`. The helpers from `validate.js` check each value: first and last name required, at most 50 characters; date of birth a real `YYYY-MM-DD` date, not before 1900-01-01 and not after the database's today (`databaseToday()`); NIC, address, phone and e-mail optional, at most 12, 150, 20 and 100 characters; `agentId` a positive whole number. A failure throws a `ValidationError`: HTTP 400 naming the field.
2. The route reads the agent: `SELECT status, branch_id … FROM AGENT WHERE agent_id = ?`. No such agent gives 400 "That agent does not exist"; an agent who is not ACTIVE gives 422 "Only an ACTIVE agent can register a customer", both on the `agentId` field. The trigger `trg_customer_bi` refuses the same thing; the route checks first so the error lands on the agent field.
3. `noteCall` records what is about to run, for the Tester view's panel. Then comes the app's only INSERT. It is a **parameterised query**: the SQL text has `?` placeholders, the nine values are handed over separately, and the mysql2 driver escapes each one, so nothing typed in the form can become part of the SQL command. The form sends no branch: `registered_at_branch_id` is the agent's own `branchId`.
4. Before the row is saved, MySQL runs the trigger `trg_customer_bi`. It refuses a date of birth in the future, a customer aged 18 or over with no NIC, an agent who is not ACTIVE, and a branch that is not the agent's. The UNIQUE key `uq_customer_nic` refuses a NIC that another customer already has.
5. If the INSERT fails: error 1062 on `uq_customer_nic` becomes HTTP **409** "A customer with this NIC is already registered" on the `nic` field. A trigger refusal goes through `ruleError(err, CUSTOMER_FIELDS)`: HTTP **422** with the trigger's own message, and the patterns in `CUSTOMER_FIELDS` pick the field (a message containing "NIC" → `nic`, "date of birth" → `dob`, "agent" → `agentId`). Any other error goes on to the shared error handler in `errors.js`.
6. On success, `noteResult` records the new `insertId`, `findCustomer` reads the whole customer back with the agent's and branch's names, and `sendData` answers 201 with `{ data: customer }`.

**Opening an account** takes the same road. Sameera's `OpenAccount.jsx` calls `openAccount`, which posts to `/api/accounts`. My route in `accounts.js` checks the IDs and the amount, then calls `PROC_OPEN_SAVINGS_ACCOUNT` through `callProc`. That procedure has three **OUT parameters** — values a procedure fills in for its caller to read afterwards: the new account ID, the account number (SA + 7 digits) and the opening deposit's reference (TXN + 7 digits). mysql2 cannot read OUT parameters directly, so `callProc` (in `db.js`) passes the **session variables** `@account_id`, `@account_no` and `@reference_no` (variables that last as long as one database connection) and reads them back with a `SELECT` on the same connection. The procedure itself picks the plan, checks business hours and the plan minimum, and saves the account, its holders and the opening deposit together or not at all.

## File by file

### `.gitignore`

A **.gitignore** file lists files and folders Git must never track. Yours has three groups:

- `node_modules/` (installed packages, recreated by `npm ci`), `dist/` (the output of `npm run build`) and `coverage/` (reports from test-coverage tools).
- `.env` and `.env.*`, then `!.env.example`. The `!` brings back the one file the line above would hide: the template is committed, real settings never are.
- Logs (`*.log`, `npm-debug.log*`) and operating-system clutter (`.DS_Store` from macOS, `Thumbs.db` from Windows).

**Why it must be committed before anyone runs `npm install`.** A `.gitignore` only stops Git picking up *untracked* files. If someone installs packages or creates `backend/.env` before the file reaches their copy, one `git add .` stages thousands of package files and the database password. Once a file is committed, a later rule does not untrack it, and the password stays in the history even after the file is deleted.

### `.gitattributes`

**Line endings** are the invisible characters that end each line of text: Windows normally uses two (CR LF), macOS and Linux one (LF). Without a rule, a Windows editor can change every line ending in a file, so a one-line change looks like a whole-file change and merges clash.

- `* text=auto` lets Git decide which files are text. It stores them with LF in the repository and converts them to suit each person's computer when it checks them out.
- `*.png`, `*.jpg`, `*.ico` and `*.woff2` are `binary`: Git never converts them, never shows a text diff and never merges them line by line.

### `README.md`

The front page of the repository, written so a newcomer can follow it from top to bottom. Each command is shown exactly as typed, and key steps say what to expect, so a reader can tell whether it worked. Its main sections, in order:

1. An introduction: what MIMS is, that every business rule lives in MySQL, and that the web app never changes a balance by itself.
2. **What is in this repository:** a table of the folders.
3. **What is needed:** MySQL 8.0.46, Node.js 24 LTS (22.12 or newer also works) and Git. On Windows, Command Prompt, because PowerShell does not support `<`.
4. **Set up (once per computer):** five steps — build the database, check the data (36 PASS), create the `mims_app` user, copy `.env.example` to `.env`, and run `npm ci` in both folders. `npm ci` installs the exact versions recorded in `package-lock.json`.
5. **Run the app:** two terminals with `npm run dev`, the address http://localhost:5173, the smoke test, and the reminder that business hours are a rule, not a bug.
6. **Tests:** a table of each kind of test, its command and what it needs, then how the SQL tests pin the clock and why `run_all.sql` reloads the database.
7. **Team Member Contributions:** who did what, and how work reaches `main` (a feature branch, a pull request, "Create a merge commit").

### `backend/.env.example`

An **environment file** (`.env`) is a small text file of `NAME=value` settings that the backend reads when it starts. The real `backend/.env` holds the database password, so Git ignores it. `.env.example` is the committed template with placeholders only, because anything committed can be read by everyone who has the repository. Each person chooses their own password when they run `scripts/create_app_user.sql`, copies the template to `.env` and puts the password in `DB_PASSWORD`.

- `DB_HOST=127.0.0.1` and `DB_PORT=3306`: MySQL on this computer at its usual port. `create_app_user.sql` creates a `mims_app@127.0.0.1` account for exactly this connection.
- `DB_USER=mims_app`: the limited user (SELECT and EXECUTE on `mims`, INSERT on `CUSTOMER` only). `DB_NAME=mims`.
- `PORT=3001`: the backend's port, the one Vite forwards `/api` to.
- `change-me` is a safe placeholder: the backend refuses to start while `DB_PASSWORD` still says `change-me` (see `config.js`) and says what to do.

### `backend/package.json`

The backend's ID card. `"type": "module"` lets every file use `import` and `export`. `"engines"` asks for Node 22.12 or newer. The scripts:

- `npm start` runs `node src/server.js`; `npm run dev` adds `--watch`, which restarts the server whenever a file changes.
- `npm test` runs Node's built-in test runner on `test/*.test.js` (no database needed); `npm run test:db` runs `test/integration/*.test.js` against MySQL.

There are only four libraries: `express`, `mysql2`, `dotenv` (reads `.env`) and `cors`. Each is pinned to one exact version, and `npm ci` installs exactly what `package-lock.json` lists, so every teammate runs the same tested code.

### `backend/src/server.js`

`main()` starts the API in a safe order: read the settings (`loadConfig`), create the pool (`initPool`), prove the database answers (`checkConnection`), build the app (`createApp`), and only then listen on port 3001.

- If the settings, the database check or the port fails, `stop(message)` prints "The MIMS API could not start." and the reason, then exits with code 1 (any code other than 0 means "it failed"). A server running without its database would fail every request with confusing errors, so it stops at once and says what to fix.
- The friendly start-up messages:
  - no `.env` file, or a missing value: a `ConfigError` from `config.js`, such as "backend/.env has no value for DB_PASSWORD…";
  - MySQL stopped (`ECONNREFUSED`): "Is MySQL running? On Windows: open Services, find MySQL80, click Start.";
  - wrong password (`ER_ACCESS_DENIED_ERROR`): check `DB_USER` and `DB_PASSWORD`, or set the password again with `scripts/create_app_user.sql`;
  - no database (`ER_BAD_DB_ERROR`): load it with `scripts/load_all.sql`;
  - port in use (`EADDRINUSE`): "Another backend window is probably still running".

  All but the first are written by `startupProblem()` in `errors.js`.
- In Express 5, the function given to `app.listen` is also called with an error, for example when port 3001 is taken. That is why it checks `err` first.
- `shutDown` runs on Ctrl + C (`SIGINT`) or `SIGTERM` (a request to stop from the system). It stops the server, closes the pool and exits with code 0.

### `backend/src/app.js`

`createApp()` builds the Express app and returns it; it does not open a port. Keeping it apart from `server.js` means a test can build the app without starting the real server: `test/app.test.js` does exactly that. What it sets up, in order:

1. `app.disable('x-powered-by')` stops Express announcing itself in every answer.
2. `express.json({ limit: '50kb' })` reads JSON bodies. A bigger body is refused with 413, broken JSON with 400.
3. `cors(...)` allows pages from port 5173. *CORS* is the browser rule that blocks a page from calling another address unless that server allows it. With the Vite proxy the calls are same-address, so this only matters if someone calls port 3001 directly.
4. `GET /` answers "The MIMS API is running…", and `/api` gets the router from `createApiRouter()`.
5. `notFound`, then `errorHandler`, come last: `notFound` runs only when no route answered, and Express recognises `errorHandler` as the error handler by its four parameters.

`createApp` is `async` because the route list loads the route files while the program runs.

### `backend/src/config.js`

Reads `backend/.env` and checks it before anything else starts.

- `ENV_PATH` is worked out from this file's own location (`import.meta.url`), so `.env` is found whichever folder Node is started from.
- `DB_USER`, `DB_PASSWORD` and `DB_NAME` are required. `DB_HOST` (`127.0.0.1`), `DB_PORT` (3306) and `PORT` (3001) have defaults; `toPort()` accepts only a whole number from 1 to 65535.
- It refuses the example password `change-me`, so nobody runs on the template by mistake. The password is not trimmed, because a space could be part of it.
- `ConfigError` is its own class, so `server.js` can tell "the settings are wrong" apart from a real bug.
- The work is split in two. `readConfig(env)` checks a plain object, so a test can hand it made-up settings. `loadConfig()` checks the file exists, loads it with `dotenv` (`quiet: true` hides dotenv's banner) and calls `readConfig(process.env)`.

### `backend/src/db.js`

The one place that talks to MySQL. `initPool()` creates the pool with these options:

- `connectionLimit: 10`: at most ten connections at once.
- `decimalNumbers: false`: money comes back as text such as `'1500.00'`. JavaScript numbers are binary fractions (`0.1 + 0.2` gives `0.30000000000000004`), so turning money into numbers could change cents. As text it stays exact, and the pages add and compare it as whole cents with `BigInt`, JavaScript's exact whole-number type.
- `dateStrings: true`: dates come back as text such as `'2026-10-05'`. Without it, mysql2 would turn a date into a JavaScript `Date` at local midnight, and JSON writes a `Date` in UTC. In Sri Lanka (UTC+5:30), midnight on 5 October would become `2026-10-04T18:30:00.000Z`, a day early.
- `supportBigNumbers: true`: a BIGINT too big for a JavaScript number comes back as text instead of being rounded. `multipleStatements: false`: one call can never run two statements joined by `;`.

**Values and names.** Every value (an amount, an ID) goes into the SQL as a `?` placeholder. mysql2 fills each `?` with the value, quoted and escaped, so typed text can never change what the statement does. (With `query()` mysql2 does this escaping itself before sending; `execute()` would prepare the statement on the server instead.) Changing a statement through typed text is called *SQL injection*. A `?` can only stand for a value, never for a name such as a procedure name, so names must be written into the SQL text. That is why `assertIdentifier()` first checks every procedure name and OUT name against `IDENTIFIER` (letters, digits and `_`, not starting with a digit) and refuses anything else.

- `callProc(name, inParams, outNames)` runs a procedure with OUT parameters (see step 7 above). It takes a connection with `getConnection()` and gives it back in `finally`, so it returns to the pool even when the call fails.
- `callRows(name, inParams)` runs a report procedure and returns its rows. After the rows MySQL also sends a status packet; `results[0]` keeps only the rows.
- `query(sql, params)` runs a plain statement: read-only SELECTs, plus the one INSERT the app may do (registering a customer).
- `checkConnection()` asks MySQL for the database name, its clock and its version. `databaseToday()` gives today by the database clock; other routes use it so "today" means the same as in the rules. `closePool()` closes everything on shut-down.

### `backend/src/errors.js`

Turns any error into a short JSON answer in plain words. The browser never sees SQL text, error numbers or stack traces (the list of code lines an error passed through): they would confuse an agent and tell an attacker how the database is built. The HTTP statuses used: 400 the request was wrong, 404 not found, 409 a clash with stored data, 413 too large, 422 a broken rule, 500 a fault on the server, 503 the database is out of reach.

- `HttpError(status, message, field)` is an error that already knows its HTTP status and, if it has one, its form field.
- `mapError(err)` decides the status and message, in this order:
  - an `HttpError` keeps its own; broken JSON is 400 and a too-large body 413;
  - **SQLSTATE 45000 is 422 with the procedure's own message**, because our procedures write those messages for people to read;
  - a connection problem (MySQL stopped, login refused, connection lost) is 503: "The database is not reachable…";
  - then by MySQL error number: 1062 duplicate is 409 ("A customer with this NIC is already registered" for `uq_customer_nic`); 1452 missing parent row is 400 ("That agent does not exist" for `fk_txn_agent`); 1451 row still in use is 409; 3819 broken CHECK is 422; 1406, 1264, 1292 and 1366 (bad values) are 400;
  - anything else is 500 with a general sentence.

  `pick()` finds the friendly sentence by looking for the constraint name inside MySQL's message.
- `ruleError(err, fieldsByMessage)` is used in the `catch` around a procedure call in a route. A 45000 error becomes `HttpError(422)`, and the first pattern that matches its message names the field. Any other error is returned unchanged.
- `notFound` answers 404 for an unknown endpoint.
- `errorHandler(err, req, res, next)` sends `{ error, field }`. It writes 500 errors in full to the server's own log, and a 503 as one line. With the header `X-Debug: 1` (the Tester view) it adds `debug`. If an answer has already started, it hands the error back to Express with `next(err)`.
- `startupProblem(err, config)` writes the start-up advice described under `server.js`.

### `backend/src/validate.js`

Input checks that run before anything reaches the database. They catch obvious mistakes early and name the field; the database still has the final word.

- `ValidationError(field, message)` is an `HttpError` with status 400.
- `money()` accepts up to 12 digits before the point and 2 after (what `DECIMAL(14,2)` holds), as text or a number. It returns tidy text: `'1500.5'` becomes `'1500.50'` and `'007.10'` becomes `'7.10'`. Zero, negatives, three decimals, commas and `1e5` are refused. It does no arithmetic, so nothing can be rounded.
- `id()` accepts a positive whole number that fits an INT column (at most 2147483647) and returns a number; `optionalId()` also allows empty.
- `date()` accepts a real `YYYY-MM-DD` date: it builds the date and checks the day did not roll over, so `2026-02-30` is refused.
- `requiredText()` and `optionalText()` trim text and check its length; `oneOf()` accepts only listed values.

### `backend/src/respond.js`

`sendData(req, res, data, status)` sends every success as `{ data }`. The Tester view sends `X-Debug: 1`; then the answer also carries `debug`: the procedure, its parameters and its OUT values. `noteCall()` stores the first two in `res.locals` (Express's scratch space for one request) **before** the call, so the debug panel can show what was sent even when the call fails. `noteResult()` adds the OUT values after a success.

### `backend/src/routes/index.js`

Builds the `/api` router.

- `GET /api/health` returns `status: 'ok'`, the database name, its clock and the MySQL version.
- `GET /api/status` calls `PROC_CHECK_BUSINESS_HOURS`. The procedure returns quietly when the branch is open and raises 45000 when it is closed; the route turns that into `branchOpen: false` with the procedure's message. Any other error is thrown on.
- `SLICES` lists each slice's file and where it is mounted. For each, `existsSync()` checks the file is there. If it is, `await import(url)` loads it while the program runs (a *dynamic import*) and `router.use()` mounts it. If not, it is skipped and logged as "Not merged yet (skipped)". So the server starts before every slice is merged, and nobody edits this file when theirs arrives.
- `/accounts` appears twice. Express tries `accounts.js` first; a path it does not handle, such as `/accounts/7/deposit`, falls through to `transactions.js`.

### `backend/src/routes/lookups.js`

Read-only lists for drop-downs and the Home page. `Router()` makes a small set of routes, and `routes/index.js` mounts this file under `/api/lookups`. Each route `await`s one plain SELECT (it waits for MySQL without holding up other requests), and `sendData` answers `{ data: … }`. `AS` gives columns the names the pages use (`branch_name AS branchName`).

- `/branches`: used by the branch filter on the Reports page.
- `/agents`: ACTIVE agents only, with their branch. It fills the "Acting as" list, because only an ACTIVE agent may process anything.
- `/savings-plans` and `/fd-plans`: the five savings plans and the three fixed deposit terms.
- `/settings` reads `SYSTEM_CONFIG`. The `SETTINGS` map gives each known key the page's name for it and says whether it is a whole number. Age bands, cycle lengths and the interest day-count basis become numbers; times (`09:00`) and money (`100000.00`) stay text, so money never meets floating-point rounding. Unknown keys are left out.

There is no `try`/`catch` here: in Express 5, an error inside an `async` route reaches the shared error handler by itself. My two other route files, `customers.js` and `accounts.js`, use `try`/`catch` only around the INSERT and the procedure call, to attach a field name to a refusal before passing it on.

### `backend/src/routes/customers.js`

Three routes. Registration (`POST /`) is followed step by step under "Registering a customer" above.

- `GET /api/customers?search=…` With no search text it lists the 50 newest customers (`ORDER BY c.customer_id DESC`). Otherwise it looks for the text inside the first name, last name, full name, NIC, phone and e-mail, sorted by name, still at most 50. Even the limit travels as a `?` value (`LIMIT ?`). The `${where}` and `${order}` pieces put into the SQL text are fixed strings from the code, never typed text.
- `LIST_COLUMNS` includes the age, which MySQL works out with `TIMESTAMPDIFF(YEAR, c.DOB, CURDATE())`, and how many accounts the customer holds.
- **Why a number also matches an exact ID.** The ID is not one of the columns searched as text, so when the text is 1 to 10 digits the route adds `OR c.customer_id = ?`. It uses `=`, so `13` means customer 13, not every ID containing 13. Ten digits is the longest an INT can be.
- `GET /api/customers/:id` returns `findCustomer`: details, the registering agent and branch, the accounts held (role, plan, status, balance) and `nicMissing`. 400 if the ID is not a positive whole number, 404 if there is no such customer.
- `nicMissing` is true when the customer is in the view `VW_GAP_NIC_AT_18`: 18 or over today, still with no NIC. The triggers check the NIC only when a row is inserted or updated, so a child registered without one is never refused once they turn 18.

**Why the NIC is checked like the database, with no format rule.** The `CUSTOMER` table allows a NIC of up to 12 characters, unique, or `NULL` (no value at all), and the trigger requires it from age 18. The database has no format rule, so the route and the page add none: a format rule only in the app would be a business rule outside the database, and could refuse a NIC the database accepts. `optionalText` saves an empty NIC box as `NULL`, not as empty text: the trigger tests for `NULL`, and a UNIQUE key allows many `NULL`s but would refuse a second empty text.

**Why the date of birth is checked against the database's today.** The trigger compares with the database's `CURDATE()`. `databaseToday()` asks MySQL for that same date instead of using the server's clock, so the route and the trigger mean the same thing by "the future".

### `backend/src/routes/accounts.js`

- `GET /api/accounts?search=…` is **what the account picker searches**: part of an account number, a holder's full name or a holder's NIC, and an exact account ID when the text is 1 to 10 digits, at most 20 results. An empty search lists the 20 newest accounts. The account picker on the Transactions and Fixed Deposits pages calls it.
- `GET /api/accounts?customerId=5` lists the accounts one customer holds. `GET /api/accounts/:id` returns one account; the Transactions and Fixed Deposits pages load accounts this way.
- `withHolders` adds each account's holders with **one** extra query for the whole list (`WHERE h.account_id IN (?)`; mysql2 turns the array into `IN (3, 7, 12)`), not one query per account. `ORDER BY h.role` puts PRIMARY first: `role` is an ENUM (one word from a fixed list), and an ENUM sorts in the order its words are declared.
- `POST /api/accounts` checks the input (a primary holder, a different second holder if any, an amount such as `1500.50`, an agent), calls the procedure, and turns its refusals into fields with `OPEN_FIELDS`; for example "Opening deposit is below the plan minimum balance" belongs to `openingAmount`. The business-hours refusal names no field, so the page shows it in a banner.
- The procedure has no OUT value for the large-deposit flag, so the route reads `review_flag` from the opening deposit's row by its reference number and returns `reviewFlagged`.

### `backend/src/search.js`

Two helpers for both search routes.

- `searchText(value, maxLength = 100)` accepts only a single piece of text; anything else, such as the list Express makes from `?search=a&search=b`, counts as empty. It trims spaces and refuses more than 100 characters with HTTP 400 on the `search` field, so a huge pasted text never reaches MySQL.
- `likePattern(text)` builds a **LIKE pattern**. In SQL's `LIKE`, `%` means "any run of characters, even none", `_` means "exactly one character" and `\` is the escape character. The helper puts a `\` before every `\`, `%` and `_` the user typed, so they count as ordinary characters, then wraps the text in `%…%` to mean "contains". Without it, a search for `%` would match every customer.

The pattern still travels as a `?` value. These are two different protections: the placeholder stops SQL injection, and the escaping stops surprise wildcards.

### `backend/test/search.test.js`

Unit tests using Node's built-in `node:test` and `node:assert/strict`; `npm test` in `backend/` runs them with no database. The first test checks trimming, that `undefined` and a list both give `''`, and that 101 characters throw an error with status 400 on `search`. The second checks `SA00` → `%SA00%`, `50%_off` → `%50\%\_off%`, and that a typed backslash is doubled. In the JavaScript source, each `\\` stands for one backslash.

### `backend/test/app.test.js`, `errors.test.js` and `validate.test.js`

*Unit tests*: they check one piece of code on its own, with no database. They use Node's own `node:test` (`test()`) and `node:assert/strict`. `sqlError()` builds errors shaped like the ones mysql2 throws, and the `errorHandler` test passes a fake `req` and a fake `res` that just record the status and body. So every mapping is tested quickly, without MySQL. `app.test.js` goes one step further: it builds the whole app with `createApp({ log: () => {} })` (the `log` option keeps the "Routes loaded" line quiet), starts it on port 0 (the computer picks any free port) and sends real requests with `fetch`. What they check is listed in "My test files" below.

### `backend/test/integration/db.test.js`

*Integration test*: it runs my code against the real database. `before()` creates the pool from my `backend/.env` (`loadConfig().db`), so it logs in as `mims_app`; `after()` closes it. Archchu's `reports.test.js` uses the same set-up.

### `frontend/package.json`

The description of the frontend project for npm (Node's package manager; Node runs JavaScript outside the browser).
- `"type": "module"` tells Node that the `.js` files use `import` and `export` (ES modules). `"engines"` asks for Node 22.12.0 or newer.
- `scripts`: `npm run dev` starts Vite on port 5173; `npm run build` makes the finished site in `dist/`; `npm run preview` serves that build; `npm test` runs `node --test "test/*.test.js"`, Node's built-in test runner, so no test library is needed.
- `dependencies`: React and React DOM 19, React Router 7 (pages chosen by address) and two font packages. `devDependencies`: Vite and its React plugin, needed only to develop and build.
- The versions are exact (`"19.3.0"`, not `"^19.3.0"`), so every teammate installs the same ones.

### `frontend/vite.config.js`

Vite is the development server and build tool.
- `plugins: [react()]` lets Vite read JSX and update the open page when a file is saved.
- `port: 5173` with `strictPort: true`: if the port is busy, Vite stops with a clear error instead of quietly moving to another port.
- `proxy: { '/api': 'http://127.0.0.1:3001' }` forwards every `/api/...` request to the backend, path unchanged.
- **Why a proxy:** the browser talks to one address only, so the pages and the API share one origin (scheme, host and port) and CORS (the browser's rule about calling a different origin) never gets in the way. It says `127.0.0.1` rather than `localhost` because some computers look `localhost` up as the IPv6 address first.

### `frontend/index.html`

The only HTML page. React draws everything inside `<div id="root">`, and `<script type="module" src="/src/main.jsx">` starts the app. The page also sets the language, a viewport line for phones, a description, the title and the tab icon. The icon is an SVG written straight into the link (a `data:` address): a dark-green square with a light "M", so there is no icon file to lose.

### `frontend/src/api/client.js`

The one place the pages talk to the backend.
- `ApiError` is an `Error` that also carries `status`, `field` (the form field it is about), `debug` and `unreachable` (the server or database could not be reached at all).
- `request(method, path, body, { record })` sets the headers (`Content-Type` only when there is a body; `X-Debug: 1` in Tester view) and calls `fetch('/api' + path)`. It ends in one of four ways: no connection → an `ApiError` with the `SERVER_DOWN` message; a reply that is not JSON (usually Vite answering because the backend is stopped) → also `SERVER_DOWN`; an error reply → an `ApiError` with the backend's own `error` text and `field` (status 503 means the database is down, so `unreachable` is set); success → `payload.data`.
- `api.get(path)` and `api.post(path, body)` are the shortcuts every slice uses.
- **How the Tester panel gets its data:** `remember()` stores the last exchange (what was sent and what came back) in `lastExchange` and calls every function registered with `onExchange()`, which returns a function to unregister. Only actions (anything but GET) are recorded unless a page passes `{ record: true }`, so the status check every minute cannot push a form submit out of the panel. `AgentContext` switches the header on and off with `setTesterMode()`.
- `isBusinessHoursError()` spots the business-hours refusal by its words, so pages can present it as a rule, not a fault.

### `frontend/src/api/useApi.js`

Two custom hooks used across the app.
- `useApiData(path, { enabled, record, refreshMs })` loads data when a component appears and whenever `path` changes, and returns `{ data, error, loading, reload }`. With `refreshMs` it also loads again on a timer (`setInterval`), and the effect's clean-up stops the timer. A `null` path means "nothing to load yet" (no account chosen, for example). While reloading, the old data stays on screen. The `cancelled` flag, set by the effect's clean-up, ignores an answer that arrives after the path has changed, so a slow old answer can never overwrite a newer one. `reload()` adds one to `version`, which is in the effect's dependency list, so the effect runs again; `useCallback` keeps `reload` the same function between redraws.
- `useBranchStatus()` is `useApiData('/status', { refreshMs: STATUS_REFRESH_MS })`: the branch's open/closed state, asked again every 60 seconds. The top bar and the Open account, Transactions and Fixed deposits pages use it, so a page left open notices when the branch opens or closes.
- `useAction(action)` is for form submits and returns `{ busy, error, result, run, reset }`. `run(...)` never throws: on failure it stores the error and returns `undefined`, so a page can simply write `if (result)`. `actionRef` always holds the newest `action`, so `run` can stay the same function even when a page passes a new arrow function on every redraw, as `CloseDialog` does.

### `frontend/src/context/AgentContext.jsx`

A **context** shares values with every component inside its provider, without passing props through each level. `AgentProvider` holds the ACTIVE agents (loaded once from `GET /api/lookups/agents`), the chosen `agentId` and `viewMode` (`'agent'` or `'tester'`). Components read them with `useAgent()`, which throws a clear error when used outside the provider.
- **Remembered safely.** Both choices are kept in `localStorage` (a small key–value store in the browser that survives a reload) under `mims.agentId` and `mims.viewMode`. `readStored` and `writeStored` wrap every use in `try/catch`, because storage can be missing or blocked (private windows, strict settings) and would otherwise throw and stop the whole app; the choice still works until the next reload. Stored values are checked on the way in: `Number(...) || null` for the agent, and anything except `'tester'` means Agent view.
- When the agent list arrives, the remembered agent is kept if it is still ACTIVE; otherwise the first agent is chosen and stored.
- `setTesterMode(viewMode === 'tester')` runs while drawing, not in an effect. React runs the pages' effects before the provider's own, so an effect would be too late for the pages' first requests; this way even those carry the `X-Debug` header.
- `useMemo` (which keeps a computed value until one of its inputs changes) rebuilds the shared value only when something in it changes, so pages are not redrawn for nothing.

### `frontend/src/utils/money.js`

Money comes from the backend as text such as `'1253029.59'` and stays text. For sums and comparisons it becomes whole cents in a **BigInt** (JavaScript's whole-number type with no size limit, written with an `n`, as in `100n`).
- `toCents()` reads `'1,253,029.59'`, `'-12.5'` or `250` into cents, or returns `null` for anything that is not an amount. `centsToAmount()` goes back: `150050n` → `'1500.50'`.
- `formatMoney()` gives `'LKR 1,253,029.59'`, puts a real minus sign in front of negatives (`'−LKR 1,000.00'`) and shows `'—'` for anything unreadable.
- `amountError(text, label)` checks a typed amount: present, a plain amount with up to 12 digits and 2 decimals (the same pattern as `money()` in the backend's `validate.js`, and what `DECIMAL(14,2)` holds), and more than zero. `normaliseAmount()` gives the exact text sent to the API (`'1,500.5'` → `'1500.50'`).
- `addAmounts`, `subtractAmounts` and `compareAmounts` work exactly.
- **Why:** ordinary JavaScript numbers are binary floating point, so `0.1 + 0.2` gives `0.30000000000000004`, and above about 9 × 10¹⁵ they cannot hold every whole number. The largest `DECIMAL(14,2)` amount is 9,999,999,999,999,999 cents; a BigInt holds it exactly.

### `frontend/src/utils/format.js`

Dates, numbers and percentages, written the same way on every page.
- `formatDate('2026-10-05')` → `'5 Oct 2026'`; `formatDateTime` adds the time (`'5 Oct 2026, 10:00'`); `formatTime` gives `'10:00'`. A regular expression (a pattern that text must match) splits the text into year, month, day, hour and minute; anything unreadable shows `'—'`.
- **Why dates stay `YYYY-MM-DD` text:** `new Date('2026-10-05')` means midnight in UTC, so a computer whose time zone is behind UTC would show 4 October. The backend sends dates as text (`dateStrings: true` in `db.js`), and splitting text can never move a day.
- `todayIso()` gives this computer's date as `YYYY-MM-DD`; `ageOn(dob, on)` counts full years like MySQL's `TIMESTAMPDIFF(YEAR, …)`; `formatCount(1234)` → `'1,234'`; `formatPercent('13.50')` → `'13.5%'`.

### `frontend/test/money.test.js` and `format.test.js`

Run them with `npm test` in `frontend/`. They use Node's built-in `node:test` and `node:assert/strict` and test plain functions, so no browser, server or database is needed.
- `money.test.js` (6 tests): exact reading of amounts with commas, spaces and signs; `0.10 + 0.20` is exactly `0.30`; thousands grouping and two decimals, up to `99,999,999,999,999.99`; `amountError` refuses `-5`, `1.234` and a 13-digit amount, like the backend; `normaliseAmount`; `compareAmounts`.
- `format.test.js` (4 tests): dates, including 29 February 2024 and an impossible month 13; date-times and times; ages the day before and on an 18th birthday; counts and percentages.

### `scripts/smoke-test.mjs`

A day-one check that answers "is my environment working?". Load the database, start both servers, then run `node scripts/smoke-test.mjs` from the repository folder. The `.mjs` ending tells Node the file is an *ES module*, which allows `import` and a top-level `await`. It reuses the backend's own `config.js`, `db.js` and `errors.js`, so it reads `.env` by the same rules and prints the same fixes as the server.

Every result line starts with one of four words, counted in `tally` and printed by `report()` (ASCII only, for older Windows consoles):

- **PASS:** the check worked.
- **FAIL:** something must be fixed; the indented lines say how. Any FAIL ends the script with exit code 1 (the number a program hands back to the terminal; 0 means success).
- **WARN:** it works but differs from the tested set-up: MySQL is not 8.0, or the database clock is not Sri Lanka time (UTC+05:30).
- **SKIP:** the check could not run, because an earlier problem blocks it or because a slice's route is not merged yet (the backend answers 404, "not found").

The three sections:

1. **This computer:** Node.js 22.12 or newer (if not, the test stops there); the backend packages (`mysql2`, `dotenv`, `express`) and the frontend's `vite` are installed; `backend/.env` passes `loadConfig()` and uses `DB_USER=mims_app`, never root.
2. **Database** (SKIP when the backend packages or `backend/.env` failed above): it connects and prints the MySQL version. `checkGrants` reads `SHOW GRANTS`, splits each line into single rights and compares them, ignoring case (Windows stores table names in lower case), with exactly SELECT and EXECUTE on the database and INSERT on CUSTOMER; anything extra or missing is a FAIL. `checkContents` compares the row counts with a fresh load (fewer is a FAIL; more is fine after using the app) and checks that all 18 routines and 3 views exist, that there are 5 savings plans and 3 FD terms, and that `RPT_ACCOUNT_WISE_SUMMARY(NULL)` returns rows. `checkDeposit` checks the database clock (`NOW()` minus `UTC_TIMESTAMP()` should be 05:30) and then tries a deposit.
3. **Servers:** `GET /api/health` on the backend; the same address through the Vite proxy on port 5173; the app page itself (it must contain `id="root"`); and two API calls, a lookup and the account-wise report.

**Why it never saves anything unless run with `--write`.** The deposit check calls `PROC_PROCESS_DEPOSIT` for account id 0, which does not exist. If the branch is closed, the procedure refuses at its business-hours check: PASS, the rule is working. If the branch is open, it passes that check and stops at "Account not found": also PASS, and still nothing is written. Either answer proves that `mims_app` may run procedures and that the clock rule is live. With `--write` it uses the first ACTIVE account instead and makes one real LKR 1.00 deposit; do that only on my own copy, never on the demo database.

Smaller helpers: `lkr()` formats money as text, never as a floating-point number; `explain()` turns a MySQL error number into a likely fix (1370: no right to run procedures; 1305 or 1146: part of the database is missing; 1142: a right is missing); `getPage()` gives up after 5 seconds, so a stopped server cannot make the test hang.

## `docs/SRS_REVISION.md`

The SRS v3.0 describes the system before the procedures and the app existed (Python/Streamlit, "no API tier", 11 tables, 3 triggers, about 150 transactions, 33/34 checks). This file gives, for each outdated passage, where it is, the replacement text and why. It also lists the facts the new text relies on, all checkable with `load_all.sql` and `run_all.sql`. Commit it as one file; then make the edits in the SRS source **one numbered section per commit**, and regenerate the PDFs as v3.1 (with the new Appendix E change log).

## My test files

### What the backend tests check

- **`app.test.js`:** the root address says the API is running; an unknown endpoint is a 404 with a plain message; a body that is not valid JSON is a 400; and when something fails inside the server (here: no database pool exists in the test), the browser gets only `{ error }` with a short message, while the details are logged on the server.
- **`errors.test.js`:** 45000 becomes 422 with the procedure's message; a duplicate NIC becomes 409 with the friendly sentence; an unknown agent becomes 400; a broken CHECK becomes 422 with no `chk_` text; connection problems become 503; broken JSON becomes 400; an `HttpError` keeps its status, message and field; anything unknown becomes 500 and hides the details. `errorHandler` sends `{ error }` with 422 and adds `debug` only when `X-Debug` is 1. `startupProblem` names the fix for each case. `ruleError` adds the field when a pattern matches, leaves it out when none does, and returns other errors unchanged.
- **`validate.test.js`:** `money` gives tidy text and refuses ten bad inputs with `field: 'amount'`; `date` accepts 2024-02-29 but refuses 2026-02-30 and 2025-02-29; `id` refuses 2147483648. It also covers text, `oneOf` and `readConfig` (missing values, the example password, a bad PORT, the defaults).
- **`db.test.js`:** it connects to `mims`; the sample data is there; money comes back as exact text and dates as text; OUT parameters are read back (`PROC_RUN_FD_INTEREST` for the year 2000 posts 0); `callRows` drops the status packet; a deposit of 0.00 arrives as SQLSTATE 45000 and maps to 422 "Deposit amount must be greater than zero" (the amount check comes before the hours check, so this works at any hour); `mims_app` gets error 1142 if it tries to UPDATE a balance; an unsafe procedure name is refused before it reaches MySQL.
- **`search.test.js`** (`npm test` too): trimming, empty and repeated `search` values, the 100-character limit, and the escaping of `%`, `_` and `\` in `likePattern`.

### How to run them

From the repository folder (on Windows, use Command Prompt: PowerShell does not support `<`):

```
cd backend
npm test
npm run test:db
```

`npm test` needs no database. `npm run test:db` needs MySQL running, the database loaded, `mims_app` created and `backend/.env` filled in. The frontend test runs with `cd frontend` then `npm test`. For the SQL tests, from the repository folder:

```
mysql -u root -p --table < tests/run_all.sql
```

Expect the last table to say **ALL 166 CHECKS PASS**. `run_all.sql` reloads the database before and after the tests, so it also wipes anything entered through the app.

## Questions and answers about these files

**1. Why are some rules triggers and not CHECK constraints?** MySQL refuses non-deterministic functions such as `CURDATE()` in a CHECK (error 3814), and a CHECK cannot look at another table. "NIC from 18", "date of birth not in the future" and "the agent must be ACTIVE" need today's date or another table, so they are triggers.

**2. If the procedures already check a rule, why also a trigger?** Defence in depth. The procedure gives the clear error first; the trigger still refuses a bad row that arrives some other way, such as a direct INSERT by an administrator. The tests prove it: breaking only the procedure's one-FD check still fails safely, because the trigger refuses; only breaking both makes the test fail.

**3. How can a balance only change through a procedure?** Three layers: `mims_app` has no UPDATE right at all; `trg_savings_balance_guard` refuses any balance change unless the session flag `@allow_balance_update` is set; and the procedures set that flag only around their own balance update, inside the transaction that also writes the TRANSACTION row, and reset it in their error handler.

**4. Why can't a transaction be changed or deleted?** It is the audit trail. `trg_transaction_bu` and `trg_transaction_bd` refuse every UPDATE and DELETE; a mistake is corrected with a new, offsetting transaction. (TRUNCATE and DROP skip triggers, which is why the app's user has no such rights.)

**5. What are the two "data checks"?** Two accepted gaps: a child registered without a NIC is not flagged when they turn 18, and an account keeps its plan when its holder outgrows the age band, because the triggers only run when a row changes. Two views list them on demand. One honest detail: the views read the adult age from `SYSTEM_CONFIG`, while the customer triggers have 18 written in; they agree while that setting stays 18.

**6. How do you know the tests test anything?** Each rule was broken on purpose in a temporary copy (a changed comparison, a removed check, a dropped trigger) and the matching test failed — 68 times out of 68.

**7. How are the reports verified?** The SQL test checks they run; a backend test reads every report and reconciles it with the transactions — for example, deposits − withdrawals + interest + FD money in − FD money out equals each account's balance — over the whole period and on single days at both ends.

**8. Why is the SRS at v3.1?** The UI changed from a Python screen with no API tier to a React app with a thin Node.js/Express API. The SRS promised (TBD 7, revision history) that a change of UI scope would be recorded; `SRS_REVISION.md` is that record, with every outdated number fixed too.

**9. Why does `callProc` borrow one connection instead of sending two queries to the pool?**
The OUT values are parked in session variables such as `@new_balance`, and those exist only on the connection that ran the CALL. Two queries sent to the pool could land on different connections, and the SELECT could read NULL or another call's old value. `finally` gives the connection back even when the call fails.

**10. How do you prevent SQL injection?**
Every value travels as a `?` placeholder, and mysql2 escapes it, so it can never change the statement. Names cannot be placeholders, so `assertIdentifier()` allows only letters, digits and `_`; `db.test.js` shows the name `'PROC_X; DROP TABLE CUSTOMER'` is refused before it reaches MySQL. `multipleStatements: false` blocks a second statement as well.

**11. Why did `.gitignore` have to be committed before anyone ran `npm install`?** It stops Git picking up `node_modules/` (thousands of files that `npm ci` recreates) and `.env` (the database password). It only affects files that are not tracked yet, so once something is committed a later rule does not remove it, and a password stays in the history.

**12. What is a parameterised query, and why do you still escape `%` and `_`?** The SQL has `?` placeholders and the values are passed separately; mysql2 escapes each one, so typed text can never change the command. Every value my routes send to MySQL travels that way, even the `LIMIT` number. Escaping is a separate problem: inside `LIKE`, `%` and `_` are wildcards, so `likePattern` puts a backslash before them and a search for `50%` means exactly that.

**13. What stops an ON_LEAVE agent from registering a customer?** The "Acting as" list shows only ACTIVE agents, but an agent ID can still be typed or sent straight to the API. The route reads the agent first and answers 422 "Only an ACTIVE agent can register a customer", so nothing is inserted. If the route were skipped, the trigger `trg_customer_bi` would refuse it too: two layers.

**14. Why don't you use ordinary JavaScript numbers for money?**
They are binary floating-point numbers, so `0.1 + 0.2` is `0.30000000000000004`, and very large amounts cannot be held exactly. Money stays text such as `'1500.50'`, and `money.js` adds and compares it as whole cents in BigInt, which is exact at any size. The test "0.10 + 0.20 is exactly 0.30" shows it.

**15. What does the Vite proxy do?**
The browser sends `/api/...` requests to the Vite server on port 5173, which forwards them to Express on port 3001. Pages and API therefore share one origin, so CORS never applies, and the frontend code never needs to know the backend's port.
