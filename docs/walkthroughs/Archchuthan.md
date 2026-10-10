# Walkthrough — Archchuthan's files

<!--
My main contribution was the Transactions part of the MIMS application. I worked on the deposit and withdrawal flow, the account picker, the passbook, transaction validation rules, and the related tests. This walkthrough helps me follow one transaction from the page, through the backend route, to the MySQL procedure, and then back to the passbook, while also showing why the database is the final place that enforces the banking rules.
-->

This guide explains every file I worked on in the app phase. I can read it with the code open beside it because each part names the real functions, so I can jump straight to them.

## What I worked on

- **The Transactions slice:** the API (`backend/src/routes/transactions.js`), the browser calls (`frontend/src/api/transactions.js`) and the Transactions page with its account picker, passbook, passbook wording, rule checks and styles.
- **Two app tests:** the database test that checks every report's numbers (`backend/test/integration/reports.test.js`) and the browser-rule tests (`frontend/test/transactionRules.test.js`).
- **The interest-posting SQL tests:** `tests/test_interest_posting.sql`.

I also wrote the transaction and FD sample data earlier;

My slice stands on the shared core that Virun owns: the backend core (`app.js`, `config.js`, `db.js`, `errors.js`, `validate.js`, `respond.js`, `routes/index.js`) and the frontend set-up (the API client and data hooks, the agent context and the money helpers). I did not commit those shared files, but I understand what they do for my part: the request below passes through them, and Virun's walkthrough explains them line by line.

One idea runs through all of it: **the database decides every rule.** My code checks that the input has the right shape, calls a stored procedure (a named program saved inside MySQL) and explains the answer in plain words. The backend logs in as `mims_app`, a MySQL user that may only read, call procedures and add a customer. So even a bug in my code cannot change a balance.

## How a request travels

Here is one deposit, from the button to the passbook.

1. **The page.** On the Transactions page (`Transactions.jsx`) the agent picks an account, types `1500.5` in the Deposit box and presses *Record deposit*. The `DepositForm` *component* (a function that returns what React, the library that draws the pages, should show) calls `form.submit(depositError, { agentId })`.
2. **The browser check.** `useMoneyForm` is a *hook*: a function whose name starts with `use` and that can remember things between redraws. It runs `depositError('1500.5')` first. An empty box, a non-amount or zero shows a message under the box and nothing is sent. Here it is fine, so `normaliseAmount` turns it into `'1500.50'`.
3. **The call.** `deposit(accountId, { agentId, amount: '1500.50' })` in `frontend/src/api/transactions.js` calls `api.post(...)`. The shared client (`client.js`, Virun's) sends, for example, `POST /api/accounts/7/deposit` with a JSON body (data written as text).
4. **The Vite proxy.** The page comes from Vite, the development server on port 5173. Vite forwards every `/api/...` request to the backend on port 3001; a *proxy* is a server that passes requests on to another server. So the browser only ever talks to one address.
5. **Express.** Express is the web-server library the backend is built on. A *middleware* is a function Express runs on each request, in the order it was added; it can change the request, answer it or pass it on. In `app.js` (Virun's backend core), the `express.json()` middleware turns the JSON body into `req.body`. The `/api` router from `routes/index.js` hands `/accounts/7/deposit` to the transactions router.
6. **The route.** `router.post('/:id/deposit')` checks the input with `id()` and `money()` from `validate.js`. A bad value stops here with HTTP 400 (*bad request*) and the name of the field. Then it calls `callProc('PROC_PROCESS_DEPOSIT', [7, '1500.50', 'BRANCH', 1], ['reference_no', 'new_balance'])`.
7. **The database helper.** `callProc` in `db.js` (Virun's backend core) borrows one connection from the *connection pool* (a few open connections that are reused, so no request has to log in again). It runs `CALL PROC_PROCESS_DEPOSIT(?, ?, ?, ?, @reference_no, @new_balance)`; each `?` is a *placeholder* that mysql2 (the library that talks to MySQL) fills with one of the four values. Then, on the same connection, it runs `SELECT @reference_no AS reference_no, @new_balance AS new_balance`. An *OUT parameter* is a procedure parameter that the procedure fills in for the caller. mysql2 cannot read one directly, so it is parked in a session variable (`@name`) and read back. Session variables belong to one connection, which is why both statements must use the same one.
8. **The procedure.** `PROC_PROCESS_DEPOSIT` checks the amount, the business hours and that the account exists and is ACTIVE. It sets the review flag if the amount is above the large-deposit threshold (LKR 1,000,000), takes the next reference number, inserts the `TRANSACTION` row, raises the balance and commits. It is all or nothing.
9. **The review flag.** The procedure has no OUT parameter for the flag, so the route's `readBack()` reads `review_flag` and `txn_timestamp` from the new `TRANSACTION` row, found by its `reference_no`. It only reads.
10. **The answer.** `sendData` replies with HTTP 201 (*created*) and `{ data: { accountId, type, amount, referenceNo, newBalance, reviewFlagged, at } }`.
11. **Back on the page.** The client returns `data`. `useMoneyForm` clears the box and calls `refresh()`, which reloads the account (new balance in the summary strip) and the passbook (back on page 1). `MoneyResult` shows a success card with the reference, amount, new balance and time, plus a note if the deposit was flagged for review.

**When the database says no.** Suppose a withdrawal would leave less than the plan minimum.

- `PROC_PROCESS_WITHDRAWAL` runs `SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Withdrawal would take the balance below the plan minimum'`. *SQLSTATE* is a five-character code that says how a statement ended. `45000` is the code our procedures and triggers use for "a business rule refused this". The procedure's handler rolls everything back first.
- mysql2 throws an error with `sqlState: '45000'` and that `sqlMessage`.
- The route catches it and throws `ruleError(err, MONEY_FIELDS)`. That makes an `HttpError` with status 422 and the same message. It also tests the message against the *regular expressions* (text patterns such as `/limit/i`) in `MONEY_FIELDS`: `minimum` matches, so the error gets `field: 'amount'`.
- Express 5 passes any error thrown inside an `async` route to the error handler by itself. `errorHandler` in `errors.js` (Virun's) sends `422 { "error": "Withdrawal would take the balance below the plan minimum", "field": "amount" }`. (422 means "understood, but it breaks a rule".)
- On the page, the client throws an `ApiError` that carries `field`. `useMoneyForm` shows the message under the Amount box and puts the cursor there. A message with no field, such as the business-hours refusal, appears in the error banner above the form instead.

## File by file

### `backend/src/routes/transactions.js`

My slice of the API contains three endpoints for one savings account.

- `POST /api/accounts/:id/deposit` checks the account ID, `amount` and `agentId`, then calls `PROC_PROCESS_DEPOSIT`. `CHANNEL` is always `'BRANCH'`: in this submission every money movement is made by an agent at a branch (team decision #9), so the browser cannot pick a channel.
- `POST /api/accounts/:id/withdraw` also needs `customerId`, the holder taking the money, and calls `PROC_PROCESS_WITHDRAWAL`. Both answer 201 after `readBack()`.
- `req.body ?? {}`: in Express 5, `req.body` is `undefined` when no JSON body was sent. This avoids a crash and lets the checks give a proper 400.
- `MONEY_FIELDS` pairs rule messages with form fields: messages about the amount, the minimum or the limit go to `amount`; "not a holder" goes to `customerId`; anything about the agent (from the trigger `trg_transaction_bi`) goes to `agentId`. The first match wins.
- `GET /api/accounts/:id/transactions?page=1&pageSize=20` is the passbook. `pageNumber()` checks `page` (default 1) and `pageSize` (default 20, at most 100). An unknown account gives 404.

**The running balance.** The inner query uses a *window function*: a calculation over a set of rows that, unlike `GROUP BY`, keeps every row. Its core, `SUM(IF(transaction_type IN CREDIT_TYPES, amount, -amount)) OVER (ORDER BY txn_timestamp, transaction_id)`, gives each row the total of itself and all earlier rows, which is the balance after it. Credits are `DEPOSIT`, `SAVINGS_INTEREST`, `FD_INTEREST` and `FD_CLOSURE`; the rest take money out. The same test gives each row its `direction`, `CREDIT` or `DEBIT`. `LEFT JOIN AGENT` adds the agent's name but keeps rows with no agent, such as interest. The outer query then sorts newest first and cuts out one page with `LIMIT ? OFFSET ?`. The sum covers the whole history before the page is cut, so every page shows true balances. Finally the route turns each row's review flag (1 or 0) into `reviewFlagged` (true or false).

**Why `txn_timestamp`, then 'transaction_id`**? A late interest run stamps each posting with its due date (01:00 savings, 02:00 FD), so a back-dated posting can have a higher ID than a later deposit. Ordering by time puts it where `PROC_POST_SAVINGS_INTEREST` itself counts it. `transaction_id` breaks ties between rows stamped in the same second; without it, those rows would all show the balance after the last of them.

**`withdrawnToday`** is the total of today's WITHDRAWAL rows for this account, with "today" from the database clock (`CURDATE()`). It is the same running total the procedure adds the new amount to before comparing with the daily limit (LKR 100,000). `CREDIT_TYPES` is the only text pasted into this SQL, and it is a constant written in this file; the account ID, page size and offset all travel as `?`.

### `backend/test/integration/reports.test.js`

*Integration test*: it runs against the real database. `before()` creates the pool from my `backend/.env` (`loadConfig().db`, from the core's `config.js`), so it logs in as `mims_app`; `after()` closes it. It adds `cents()`, which turns money text into whole cents as a `BigInt`, and `testDays()`, which finds the first, last and busiest day with two queries run together (`Promise.all`).

### `frontend/src/api/transactions.js`

The three calls behind the page. `passbookPath(accountId, page)` builds the passbook address, which the page passes to `useApiData`; `PAGE_SIZE` is 15 rows. `deposit()` and `withdraw()` send a POST through the shared `api` client. `encodeURIComponent` stops an odd value from breaking the address.

### `frontend/src/components/accounts/AccountPicker.jsx`

A field for choosing one savings account by its number, a holder's name or NIC, or its ID. The Transactions and Fixed Deposits pages use it. Its *props* (inputs) are `id`, `label`, `hint`, `value`, `onChange` and `error`; its *state* (what it remembers) is the search text, the results, a busy flag and any problem.

- With no account chosen it shows a search box and *Find*. Enter also searches; `preventDefault()` stops Enter submitting a form. `find()` calls `searchAccounts()` (`GET /api/accounts?search=`) and lists up to 8 matches (`SHOWN`), each with plan, holders, balance and any non-ACTIVE status.
- Once an account is chosen it shows the number, plan and holders, with a *Change* button that calls `onChange(null)`.
- After a pick, the `useEffect` (code React runs after drawing) moves keyboard focus to *Change*, so keyboard and screen-reader users keep their place. `justPicked` makes this happen only after a real pick.
- `holderNames()` joins the holders' names with " & "; the page reuses it.

### `frontend/src/components/accounts/Passbook.jsx`

Shows one page of the passbook like a printed bank book: date (time underneath), details, reference, then Withdrawals, Deposits and Balance. A row goes in Withdrawals when its `direction` is `DEBIT` and in Deposits when it is `CREDIT`, so money moved into an FD shows as a withdrawal. The Balance column is the database's `balanceAfter`; the component does no sums. A flagged deposit gets a "Flagged for review" badge. The header says, for example, "Entries 1–15 of 42, newest first". *Newer entries* and *Older entries* call `onPage()` and appear only when there is more than one page. The table has a hidden caption for screen readers, and its scroll box can take keyboard focus.

### `frontend/src/pages/Transactions.jsx`

The page itself. `export const meta` makes `App.jsx` add it to the menu at `/transactions`.

- The chosen account lives in the address (`?account=7`, read with `useSearchParams`, React Router's hook for that part of the address), so a reload keeps it. `choose()` sets or clears it, and an effect goes back to page 1 when the account changes.
- `useApiData` loads four things: the account, the passbook page, the bank's settings (`/lookups/settings`, from `SYSTEM_CONFIG`) and the branch status (`/status`). The limits on the page come from the database's settings, never from numbers typed into the code.
- `AccountSummary` shows the balance, the plan with its rate and minimum, the holders and status, and *Withdrawn today* against the daily limit.
- If the branch is closed, a warning says the database will refuse; the forms still show. If the account is not ACTIVE, the forms are hidden and a note explains why.
- `useMoneyForm`, shared by both forms, wraps `useAction`. `submit()` runs the browser check first; a problem is shown and nothing is sent. Otherwise it sends the tidy amount, and on success clears the box and calls `refresh()`. Server errors with `field: 'amount'` go under the box, others to the banner. Typing again clears old messages.
- `DepositForm` uses `willBeFlagged()` to say, before sending, that an amount above the threshold will be saved and flagged.
- `WithdrawForm` adds a holder list: one holder is chosen automatically, and with two the agent must choose. Its check is `withdrawalError(amount, limits)`. A "not a holder" error appears beside the holder list.
- `MoneyResult` builds the success card; a withdrawal adds "Taken out by". The agent comes from `useAgent()` (the "Acting as" bar); without one, the buttons stay disabled.

### `frontend/src/styles/passbook.css`

The passbook is drawn as a page from a real passbook. The paper is cream (`--passbook`), with ruled lines between rows and columns. A thick dark-green left border is the binding, and the `::before` rule draws a dashed white stitch line along it. A double rule sits under the heading. Figures use the monospaced font (the `mono` class), so digits line up; the money columns (`.num`) are right-aligned and never wrap. The Balance column is bold on a light green tint, and the review badge uses the warning colour. On a narrow screen `.passbook__scroll` lets the table scroll sideways instead of squashing. The file also styles the summary strip above the forms (`.account-strip`), a grid that fits as many columns as there is room for.

### `frontend/src/utils/ledger.js`

`describe(row)` writes the Details line from the row's type, channel, agent and FD. A BRANCH row names the agent ("Deposit · Carol Lee"); other channels say "online", "mobile app", "ATM" or "by the bank". An `FD_CLOSURE` by `SYSTEM` is a maturity ("FD 3 matured · money returned"); by an agent it is an early closure.

### `frontend/src/utils/transactionRules.js`

Browser copies of the money rules, so a mistake shows beside the amount before anything is sent. They use the cents helpers in `money.js`, never floating-point sums.

- `depositError()` checks the amount is present, well formed and above zero.
- `willBeFlagged()` is true only when the amount is strictly above the threshold, like the procedure's `p_amount > v_threshold`.
- `withdrawalError()` checks, in order: a valid amount, the plan minimum, then the running daily limit. Its messages say what is still possible ("at most LKR 10,256.51 can be withdrawn", "LKR 40,000.00 is left for today"). The order is the order of `PROC_PROCESS_WITHDRAWAL`, which tests the minimum before the limit. So when both rules are broken, the page gives the same reason the database would. A check whose numbers have not loaded yet is skipped and left to the database.

### `frontend/test/transactionRules.test.js`

Unit tests for the two files above. `TEEN` is a Teen-plan account (balance 10,756.51, minimum 500.00). The ledger wording is loaded inside its own test with `await import(...)`.

### `tests/test_interest_posting.sql`

SQL tests for interest posting and FD maturity. The file selects `mims`, clears its own results (`start_suite`), creates its test data, runs the checks IP01–IP13, resets the clock and prints a report. Explained in full below.

## My test files

### What my tests check

- **`reports.test.js`** reads all five reports and cross-checks their numbers against the tables underneath, mainly `TRANSACTION`. It compares in whole cents, so no rounding can hide a difference:
  - account-wise: one row per account with the stored balance; deposits − withdrawals + interest + FD money in − FD money out equals the balance; the branch filter splits the accounts with nothing lost or repeated;
  - agent-wise and customer activity: over the whole period **and** on the first, last and busiest single day, so a report that drops the first or last day of its range is caught. Every agent is listed, even at zero; a joint account's money counts once for each holder;
  - monthly interest: each month equals that month's interest transactions, and all months together equal the account-wise total;
  - the active-FD view lists every ACTIVE FD in `FIXED_DEPOSIT` once, with its principal; and every stored balance equals its transaction history.

  It only reads: SELECTs and report procedures, as a user that could not change data anyway.
- **`transactionRules.test.js`:** exactly LKR 1,000,000.00 is not flagged but one cent more is; leaving exactly the 500.00 minimum is fine but one cent more is refused; reaching exactly 100,000.00 today is fine but one cent more is refused; the minimum is checked before the limit; and the passbook wording.

### How `tests/test_interest_posting.sql` works

It uses the shared helpers in `tests/_helpers.sql`, which live in their own schema (a separate database), `mims_test`:

- `try_sql(sql, @state, @message)` runs one statement and reports how it ended: `'00000'` when it worked, otherwise the error's SQLSTATE and message. Its handler catches the error, so the script carries on.
- `check_that(suite, id, description, condition, detail)` records PASS or FAIL in `mims_test.results`; a NULL condition counts as FAIL.
- `expect_refusal(...)` passes only if the statement is refused with SQLSTATE 45000 **and** exactly the expected message.
- `clock_at(moment)` runs `SET timestamp = ...`, which fixes `NOW()`, `CURDATE()` and new timestamps for this session only. Nothing in the database changes; `clock_reset()` goes back to real time.

**Why the clock is pinned.** Interest falls due every 30 days, opening an account needs business hours, and a run date may not be in the future. With a pinned clock the test jumps straight to each due day, and it gives the same result on any day, at any hour.

**Why `mims.NAME` inside the strings.** `try_sql` is a procedure in `mims_test`, and inside a procedure the default database is the procedure's own. So the statements it runs must say `mims.PROC_...`. The `@` variables still work, because they belong to the session.

**The fixtures** (test data made at the start), on Monday 5 October 2026 at 10:00: an agent, an adult and a child; Adult accounts of 10,000.00 (`@acc`, `@late`, `@frozen`); a Children account of 0.01 (`@tiny`); and three accounts of 60,000.00 (`@fd_acc`, `@fd2_acc`, `@fd3_acc`) that each move 40,000.00 into a 6-month FD at 13% (`@fd`, `@fd2`, `@fd3`), leaving 20,000.00. `@frozen` and `@fd3_acc` are then set to FROZEN. Interest and the first FD payouts fall due on 2026-11-04; the FDs mature on 2027-04-03.

| Test | What it checks |
|---|---|
| IP01 | `FUNC_CALC_INTEREST` = amount × rate/100 × 30/365, rounded to cents: 10,000 at 10% → 82.19; 40,000 at 13% → 427.40; 1.00 at 7% → 0.01 (0.00575 rounds up); 0.00 → 0.00 |
| IP02 | Posting for tomorrow is refused ("Run date cannot be in the future"), and so is a run with no date |
| IP03 | On 2026-11-03 nothing is due yet, and the due dates stay put |
| IP04 | On 2026-11-04 the FD pays 427.40 as a SYSTEM `FD_INTEREST` stamped 02:00 (balance 20,427.40); posting again pays nothing |
| IP05 | Savings interest of 82.19 is stamped 01:00, the balance becomes 10,082.19, the next date 2026-12-04; posting again pays nothing |
| IP06 | The FD's account earns 164.38: interest on 20,000.00 at 01:00, not counting the payout at 02:00 |
| IP07 | A FROZEN account, or an FD on one, earns nothing and keeps its due date |
| IP08 | Interest that rounds to 0.00 is not posted, but the due date still moves on |
| IP09 | A late run on 2027-01-05 posts the three missed cycles on their own due days: 82.19, 82.87 and 83.55, each on the balance just before (interest on interest), ending at 10,248.61 |
| IP10 | The savings and FD jobs run twice for one day post nothing the second time: they are *idempotent* (running again changes nothing more) |
| IP11 | On 2027-06-10 maturity waits while payouts up to the maturity date are unposted |
| IP12 | In the daily order (FD interest, maturity, savings interest): exactly 6 payouts of 427.40, the last on 2027-04-03; both FDs MATURED on that date with 40,000.00 paid back by SYSTEM; the FD on the FROZEN account neither paid nor matured |
| IP13 | Every test account's balance equals its transaction history |

That is 31 checks. Each test was also shown to FAIL when its rule was deliberately broken on a throw-away copy of the database, so I know each one can catch the mistake it is there for.

### How to run them

From the repository folder (on Windows, use Command Prompt: PowerShell does not support `<`):

```
cd backend
npm run test:db
```

`npm run test:db` needs MySQL running, the database loaded, `mims_app` created and `backend/.env` filled in; it runs my `reports.test.js` together with the core's `db.test.js`. My frontend test runs with `cd frontend` then `npm test`. For the SQL tests, from the repository folder:

```
mysql -u root -p --table < tests/run_all.sql
```

Expect the last table to say **ALL 166 CHECKS PASS**. `run_all.sql` reloads the database before and after the tests, so it also wipes anything entered through the app.

## Before I commit

- Run `npm run test:db` in `backend`, `npm test` in `frontend`, and `tests/run_all.sql`. Everything must pass.
- Never commit `backend/.env`: it holds the `mims_app` password. `.gitignore` already skips it; `git status` (which lists new and changed files) must not show it.
- I make sure every personal placeholder assigned to me has been rewritten in my own words before committing. I use `git grep --untracked -n -F "TODO("` to check for any remaining TODO markers in tracked and untracked project files; ignored folders such as `node_modules` stay skipped.
- Be able to explain every line. Make a deposit in the Tester view and follow it through the request panel: it shows the procedure, the parameters and the OUT values.
- Keep the backend thin: a check in the page or the route is only an early warning; the rule itself belongs in the database.

## Questions and answers about these files

**1. My API logs in as `mims_app`, which cannot UPDATE. How does a deposit change the balance?**
`mims_app` has SELECT and EXECUTE, plus INSERT on CUSTOMER only. A stored procedure runs with the rights of the account that created it, so `PROC_PROCESS_DEPOSIT` may update the balance while the app may not. The core's `db.test.js` proves a direct UPDATE fails with error 1142.

**2. How does my route keep out SQL injection?**
Every value — the account ID, the amount, the page size and the offset — travels as a `?` placeholder, and mysql2 escapes it, so typed text can never change the statement. The only text written into my SQL is `CREDIT_TYPES`, a constant in my own file. The core adds a second wall: procedure names are checked before any CALL, and `multipleStatements: false` blocks a second statement.

**3. Why is money a string in my code?**
JavaScript numbers are binary fractions, so many cent values cannot be stored exactly. `decimalNumbers: false` in the core's `db.js` keeps `DECIMAL(14,2)` as text, `money()` tidies text without arithmetic, and the page and `reports.test.js` add up whole cents with `BigInt`.

**4. A withdrawal would pass the daily limit. What happens?**
Usually the page stops it first: `withdrawalError` adds the amount to `withdrawnToday` and compares with the limit. If it does reach the database, the procedure signals 45000 "Daily withdrawal limit exceeded" and rolls back. `ruleError` matches `limit`, so the answer is 422 with `field: 'amount'`, and the page shows it under the Amount box.

**5. How does the passbook work out the balance after each row?**
A window function, `SUM(...) OVER (ORDER BY txn_timestamp, transaction_id)`, keeps a running total over the account's whole history; credits add and debits subtract. Time order puts a late, back-dated interest posting where the database counts it, and the ID breaks ties. Only then is the page cut out, newest first.

**6. If the page checks the rules, why check them again in the database?**
The page may hold old numbers (another agent may have just withdrawn), and anyone could call the API directly. The procedure checks inside one locked transaction, so it is the final word. The page checks the minimum before the limit only so it gives the same reason the procedure would.

**7. How can my SQL tests check a payout due next month, and how do I know they can fail?**
`clock_at` sets the session's `timestamp`, so `NOW()` and `CURDATE()` return the day the test needs, for this session only. Each rule was also broken on purpose on a throw-away copy, and its test failed.
