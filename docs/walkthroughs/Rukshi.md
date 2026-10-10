# Walkthrough — Rukshi's files

I wrote this walkthrough to explain the files I worked on and to help me prepare for the viva.

This guide explains the files I worked on in simple words so I can explain them clearly at the viva. It describes what the code does now, and I will update the matching section if I change a file.

## What I own

The main rule is that every business rule lives in MySQL. My backend code only calls *stored procedures* (named blocks of SQL saved inside the database and run with `CALL`) or reads with SELECT, and my pages only show what comes back. Procedures and functions together are called *routines*.

- **The five management reports** in `reports/management_reports.sql` (already in the repository): four report procedures (`RPT_…`) and one *view*, `VW_ACTIVE_FD_PAYOUT_SCHEDULE`. A view is a saved SELECT that I can read like a table; it holds no rows of its own and is worked out afresh every time it is read.
- **Setup scripts:** `scripts/load_all.sql` rebuilds the database and `scripts/create_app_user.sql` creates the app's limited MySQL user.
- **Two Data Checks views** in `procedures/08_gap_queries.sql`.
- **The Reports and Data Checks slice** my part of the app, from the database call to the screen): the backend *routes* `backend/src/routes/reports.js` and `tester.js` (the functions that answer each API address), the API module `frontend/src/api/reports.js`, the pages `frontend/src/pages/Reports.jsx` and `DataChecks.jsx`, the six chart files in `frontend/src/components/charts/`, the CSV export `frontend/src/utils/csv.js` with its test `frontend/test/csv.test.js`, and the styles `frontend/src/styles/charts.css` and `reports.css`.
- **SQL tests:** the shared helpers `tests/_helpers.sql`, the run-everything script `tests/run_all.sql` and the account-opening tests `tests/test_open_savings_account.sql`.

## How a request travels

Example: a manager opens the **Monthly interest** tab and chooses September 2026.

1. The page address becomes `/reports?report=monthly-interest&year=2026&month=9`. `Reports()` reads it with React Router's `useSearchParams`, a *hook* (a React function whose name starts with `use` and that lets a component keep state or react to changes), and shows the `MonthlyInterest` component.
2. `MonthlyInterest` takes `year` and `month` from the address and asks `reportPath['monthly-interest']` in `frontend/src/api/reports.js` for the API path: `/reports/monthly-interest?year=2026&month=9`.
3. `useApiData(path)` (Virun's hook in `api/useApi.js`) calls `api.get`, which fetches `/api/reports/monthly-interest?year=2026&month=9` from the Vite dev server on port 5173. Vite acts as a *proxy* (a go-between): it passes every `/api` request on to the backend on port 3001.
4. Express hands the request to `router.get('/monthly-interest')` in `backend/src/routes/reports.js`. `wholeNumber` checks that the year is from 2000 to 2100 and the month from 1 to 12; a wrong value gets HTTP status 400 (bad request) with the field's name.
5. `report()` notes the call for the Tester view (`noteCall`), then `callRows` runs `CALL RPT_MONTHLY_INTEREST_DISTRIBUTION(?, ?)` with `[2026, 9]`, logged in as `mims_app`. The `?` placeholders make the database driver escape each value before it goes into the statement, so a value can never change what the statement does.
6. MySQL runs my report: it joins `TRANSACTION`, `SAVINGS_ACCOUNT` and `SAVINGS_PLAN`, keeps the `SAVINGS_INTEREST` and `FD_INTEREST` rows of that month and adds them up per plan. On freshly loaded data the first row is `Senior, 2, 1959.69`.
7. `camelRows` renames the columns (`total_interest_paid` becomes `totalInterestPaid`) and `sendData` answers with JSON (the text format the API speaks): `{ "data": [ … ] }`. The amount stays text, `'1959.69'`, because the backend's connection pool (the few database connections it keeps open and reuses) is set to return DECIMAL values, MySQL's exact type for money, as strings.
8. Back in the browser, `ReportBody` shows the row count, the **Download CSV** button, a `BarChart` with one bar per plan and a `DataTable` with the same figures. The bar's length comes from `toNumber('1959.69')`; the words on screen come from `formatMoney`, which gives `LKR 1,959.69` from the exact text.
9. **Download CSV** passes the same rows to `toCsv` and names the file with `csvFileName('Monthly interest 2026-09', today)`: `mims-monthly-interest-2026-09-<today>.csv`.

## File by file

### `scripts/load_all.sql`

It rebuilds the whole `mims` database from the repository files with one command, run from the repository folder: `mysql -u root -p < scripts/load_all.sql` (on Windows use Command Prompt, because PowerShell does not support `<`). It drops the database first, so anything entered through the app is lost.

- `SOURCE` is a command of the `mysql` client that runs another file. Its paths are relative to the folder `mysql` was started from, which is why the script must be run from the repository root.
- The order: the tables (`sql/mims_schema.sql`), `USE mims;`, the sample data (01, 02, 04, 03), the procedure files 01 to 08, `reports/management_reports.sql`, and a final SELECT that counts customers, accounts, fixed deposits and transactions: 15, 13, 10 and 230 on a fresh load.
- **Why the data goes in before the procedures.** `03_transactions.sql` ends with an UPDATE that sets every balance from the account's transactions. `trg_savings_balance_guard` in `procedures/04_triggers.sql` is a *trigger* (SQL that MySQL runs by itself when a row is inserted, updated or deleted); it refuses any balance change unless the *session variable* `@allow_balance_update` (a name starting with `@` that lives as long as one connection) is 1. Loaded first, it would block that fix-up. There is a second reason: `02_open_savings_account.sql` starts its account-number counter, `ACCOUNT_NO_SEQ`, after the highest number already in `SAVINGS_ACCOUNT`, so the sample accounts must be there already. New accounts then start at SA0000014.
- **Why 04 before 03.** Fixed-deposit transactions carry an `fd_id`, and `fk_txn_fd` is a *foreign key*: the value must match an existing row in `FIXED_DEPOSIT`. The fixed deposits must exist before the transactions that point at them.
- `management_reports.sql` has no `USE mims;` of its own, so it relies on the one near the top.

### `scripts/create_app_user.sql`

It creates `mims_app`, the MySQL account the backend logs in with. Run it as root after `load_all.sql`: at the `mysql>` prompt type `SET @app_password = 'example-password';` (at least 8 characters) and then `SOURCE scripts/create_app_user.sql;`.

- **Why the password comes from `@app_password`.** It is typed at the prompt into a session variable and never written into a file, so it can never be committed to Git. `SET @create_sql = NULL, @password_ok = NULL;` clears the statement text that contained it.
- `CREATE USER … IDENTIFIED BY` needs a written-out string, not a variable, so the script builds the text with `CONCAT` and runs it as a *prepared statement* (SQL text built while the script runs, then prepared, executed and deallocated with `PREPARE`, `EXECUTE` and `DEALLOCATE PREPARE`). `QUOTE()` wraps the password in quotes and escapes any quote inside it, so a password such as `it's` works and cannot break out of the statement.
- `CREATE USER IF NOT EXISTS` makes the account the first time. The `ALTER USER` straight after sets the password even if the account already existed, so running the script again with a new password updates it.
- **Why two hosts.** MySQL names an account by user *and* host. `'mims_app'@'localhost'` is for the `mysql` command line; `'mims_app'@'127.0.0.1'` is for the backend, which connects over a network connection (TCP) to `127.0.0.1`, the default `DB_HOST`.
- **The rights:** SELECT and EXECUTE on `mims.*` and INSERT on `mims.CUSTOMER` only (registering a customer), for both hosts. There is no UPDATE or DELETE anywhere. A procedure runs with the rights of the account that created it (root), so EXECUTE is all the app needs to post a deposit, yet it can never change a balance any other way. `SHOW GRANTS` prints the result.
- **A missing or short password stops it.** `@password_ok` is true only when the password has at least 8 characters. When it is false, the first SELECT prints `STOP: …` and every statement text is set to NULL; MySQL refuses to prepare a NULL statement (a syntax error), so the script stops there and no user is created or changed. Even if the `mysql` client is told to carry on after errors, the GRANT lines fail too, because MySQL 8 never creates a user through GRANT. (Tested: no password, an empty one and a 7-character one all leave no `mims_app` account; a good password containing a quote works.)

### `procedures/08_gap_queries.sql`

Two read-only views behind the Data Checks page, for two gaps the team accepted in the design (G1 and G2). Both are dropped first (`DROP VIEW IF EXISTS`), so the file can be loaded again.

- **`VW_GAP_NIC_AT_18` (G1).** The triggers `trg_customer_bi` and `trg_customer_bu` demand a NIC from age 18, but only when a customer row is inserted or updated, so a child registered without one is never checked again after turning 18. The view lists customers with no NIC whose age today, `TIMESTAMPDIFF(YEAR, DOB, CURDATE())`, is at least `age_adult_min`, with the branch where they registered.
- **`VW_GAP_PLAN_OUTGROWN` (G2).** A plan is chosen from the primary holder's age only once, at opening. The inner SELECT (a *derived table*: a SELECT used as a table, here named `x`) gathers every ACTIVE, non-Joint account with its plan, its PRIMARY holder, the holder's age today and the four age limits. The outer SELECT keeps only the mismatches (Children over 12, Teen outside 13 to 17, Adult aged 60 or more, Senior under 60) and works out `plan_for_age_now` with a CASE (SQL's if-then-else). Joint accounts are left out because Joint has no age limits.
- **Why the age bands come from `SYSTEM_CONFIG`.** `PROC_OPEN_SAVINGS_ACCOUNT` reads the same keys (`age_child_max`, `age_teen_min`, `age_teen_max`, `age_senior_min`) when it picks a plan. Reading them from the same place keeps the check and the rule in step: if the bank changes a band, both follow, and no age is typed in twice.
- Both views are empty for the sample data, and that is the right answer.

### `backend/src/routes/reports.js`

The five report routes, mounted under `/api/reports`. Each ties a method and a path, such as `GET /monthly-interest`, to the function that answers it. Nothing here changes data.

- `camelCase` turns a MySQL column name into *camelCase*, the JavaScript style: `total_interest_paid` becomes `totalInterestPaid`, and a name in capitals such as `NIC` becomes `nic`. `camelRows` does this for every column of every row, so a column added to a report later comes through with no change here. It is exported because `tester.js` uses it too.
- `period(req)` reads `start` and `end`: both must be real dates written as YYYY-MM-DD (`date()` from `validate.js`), and start may not be after end. `wholeNumber` checks a whole number within a range.
- `report()` is the shared path: `noteCall` (remembers the routine and its parameters for the Tester view's debug panel), `callRows` (runs the CALL with `?` placeholders and returns its rows), `camelRows`, then `sendData` (answers `{ data }`).
- The routes: `/agent-wise` (start, end) calls `RPT_AGENT_WISE_TRANSACTIONS`; `/account-wise` calls `RPT_ACCOUNT_WISE_SUMMARY` with `branchId`, or NULL for all branches; `/active-fds` runs `SELECT * FROM VW_ACTIVE_FD_PAYOUT_SCHEDULE`, a fixed text with no user input in it; `/monthly-interest` (year 2000–2100, month 1–12) calls `RPT_MONTHLY_INTEREST_DISTRIBUTION`; `/customer-activity` (start, end) calls `RPT_CUSTOMER_ACTIVITY`.
- A `ValidationError` becomes status 400 with the field's name. Express 5 passes any error thrown in an `async` handler to the shared error handler in `errors.js`, which answers in plain words and never shows SQL to the browser.

### `backend/src/routes/tester.js`

The QA-only routes under `/api/tester`: the two Data Checks views and the **Run interest** button.

- `GET /gap/nic-at-18` and `GET /gap/plan-outgrown` read the two views with a fixed SELECT and pass the rows through `camelRows`.
- `POST /run-interest` expects `{ runDate: 'YYYY-MM-DD', confirm: true }`. Without `confirm: true` it refuses, so a stray request cannot post interest. The date must be real and not later than `databaseToday()`.
- **Why "today" comes from the database clock.** Every rule (business hours, interest dates, maturity) is judged by MySQL's `NOW()` and `CURDATE()`, and the interest procedures themselves refuse a future run date. The computer running Node could have another time zone or a wrong clock, so the server asks MySQL (`SELECT CURDATE()`). The page, the server and the database then agree on what "today" means.
- **The order** (team decision #45, the same as in `procedures/07_interest_posting.sql`): `PROC_RUN_FD_INTEREST(runDate)`, then `PROC_PROCESS_FD_MATURITY()`, then `PROC_RUN_SAVINGS_INTEREST(runDate)`. FD interest comes first because an FD's last payout falls on its maturity date: the maturity procedure only matures an FD once that payout has been posted, and a MATURED FD is no longer ACTIVE, so it earns nothing more. Savings interest comes last because it is worked out on the balance on its due date, which must already include the FD interest credited before it. The maturity procedure takes no date; it always uses `CURDATE()`.
- The two run procedures hand back their counts through an *OUT parameter* (a parameter that carries a value back to the caller), which `callProc` reads as `postings`. The maturity procedure has none, so `maturedCount()` counts MATURED fixed deposits before and after it.
- The procedures save each account or FD on its own. If a step fails with *SQLSTATE* `45000` (SQLSTATE is a five-character result code; 45000 is the one our procedures use when they `SIGNAL` a broken rule), the route answers 422 (understood, but refused by a rule) with the message and the step's name; for the second or third step it adds that what was posted before is saved. Running again is safe: each posting moves the due date on, so no cycle is paid twice.
- `noteResult` adds the counts to the debug details, and `sendData` answers `{ runDate, fdInterestPostings, fdsMatured, savingsInterestPostings }`.

### `frontend/src/api/reports.js`

The one place the Reports and Data Checks pages get their API addresses from.

- `query(values)` builds a *query string* (the `?key=value&…` end of an address) with `URLSearchParams`, which also escapes special characters. Empty values are left out, so "All branches" simply sends no `branchId`.
- `reportPath` maps each report id to a function that builds its path, such as `reportPath['agent-wise']({ start, end })`. The pages hand these paths to `useApiData`, which fetches and keeps the loading and error states.
- `GAP_NIC_PATH` and `GAP_PLAN_PATH` are the two Data Checks addresses, and `runInterest(runDate)` posts `{ runDate, confirm: true }` to `/tester/run-interest`.

### `frontend/src/pages/Reports.jsx`

The Reports page: one tab per report, each with its filters, a chart, a table and a CSV download.

- `export const meta = { path: '/reports', … }` is how `App.jsx` finds the page: every page file that exports `meta` becomes a route and a menu entry. `REPORTS` lists the five reports with an id, a title, the routine behind it (shown as "Source:" in Tester view) and a one-line description.
- `today` is the database's date, taken from `serverTime` in `GET /api/status`; until that answer arrives the page uses the computer's date (`todayIso()`).
- **Why the filters live in the address bar.** `setFilters` writes the choices into the address (`?report=agent-wise&start=…&end=…`), and every report component reads its filters back from there. A report can therefore be bookmarked or shared, a reload shows the same report, and the browser's Back button returns to the previous choice. Clicking a tab keeps only `?report=`, so its filters start fresh.
- Shared pieces: `PeriodFilter` (From and To boxes, applied when I press **Show report**; `min` and `max` keep From on or before To), `ReportBody` (an error banner, a loading message, or the row count, **Download CSV**, chart and table; while new figures load, the old ones stay on screen, dimmed by the `is-loading` class) and `money(key)` (a table cell formatted with `formatMoney`). `PeriodFilter` copies the dates from the address when it appears and again whenever the address changes (an effect watching `addressStart` and `addressEnd`), so after Back or Forward its boxes show the same period as the chart and table.
- The five reports: `AgentActivity` (radio buttons switch the chart between value and number of transactions), `Accounts` (a branch list; the note says an account belongs to the branch where its primary holder registered, which is how the report filters), `ActiveFds` (a `TimelineChart`, and a *due, not posted yet* tag when the next payout date is before today), `MonthlyInterest` (month and year lists, last month by default) and `CustomerActivity` (the chart shows the ten customers who moved the most money; the table lists everyone).
- **How numbers are converted for the charts.** Amounts arrive as exact text such as `'1959.69'`. Each chart item carries two forms: `value: toNumber(text)`, used only to work out where to draw, and `display: formatMoney(text)`, the words a person reads. Counts use `Number()`. Floating-point rounding can therefore never show up in an amount on screen or in the CSV.
- `MonthlyInterest` checks whether the rows also contain `savingsInterest` and `fdInterest` (the change I made to my report). If they do, it draws a two-series `GroupedBarChart` and adds both columns to the table and the CSV; if not, one bar per plan, with a note that savings and FD interest are shown together.
- **Why every chart has a table under it.** The chart is a picture; the table is the exact version that a *screen reader* (software that reads the page aloud), a keyboard user or someone copying a figure can rely on. The tooltips only repeat what the table shows, so nothing is hidden behind a hover. `DataTable` also handles an empty result with a plain message.

### `frontend/src/pages/DataChecks.jsx`

The Data checks page. `meta.testerOnly` is true, so the menu lists it only in Tester view, and in Agent view `App.jsx` shows a note instead of the page.

- `GapCheck` is one panel. It loads its view through `useApiData(path)` when the page opens; **Check again** calls `state.reload` (the button is disabled and reads *Checking…* meanwhile). The column lists, passed in from `DataChecks`, join first and last names and format the date of birth.
- `RunInterest` is the interest form. The date box starts at today by the database clock and cannot go past it. `ask()` checks the date (present, not in the future) and opens a `ConfirmModal`; only `confirm()` calls `run.run(date)`, which posts through `runInterest`. A `SuccessCard` then shows the three counts. A `runDate` error appears beside the date box, any other error in a banner, and changing the date clears the old error.
- The page text states the order, that a second run is safe, and that the run changes data, so the database must be reloaded to get the sample data back.

### The chart files (`frontend/src/components/charts/`)

Every chart is hand-drawn *SVG* (Scalable Vector Graphics: lines, rectangles, paths and text written as elements in the page, which the browser draws sharply at any size). No chart library is used.

- **`GroupedBarChart.jsx`** draws horizontal bars: one row per category (an agent, a plan, a customer) and one bar per series in each row. It sizes the label column from the longest label (about 7.2 pixels per character, at most 38% of the width, cutting longer labels with `…`), keeps room for printed values, takes round axis ticks from `niceTicks`, and uses `x(value)` to turn a value into a pixel position. `barPath` writes one bar as an SVG path, square at the baseline and rounded at the end, or nothing for a zero. Each row is a `<g>` with `tabIndex={0}` (so the Tab key reaches it), `role="img"` and an `aria-label` (the text a screen reader speaks), such as "Senior: Interest paid LKR 1,959.69". An invisible full-row rectangle, `chart__hit`, makes the whole row react to the mouse. The `<figcaption>` is hidden on screen but names the chart for screen readers; `useId` gives it a unique id.
- **`BarChart.jsx`** is the one-series version. It turns its `items` into the shape `GroupedBarChart` expects and switches on `showValues`, so the value is written at the end of each bar. Building on one component keeps both charts looking and behaving the same.
- **`TimelineChart.jsx`** draws the active fixed deposits: a pale bar from start to maturity, a dot on the next payout, and a vertical *Today* line. `dayNumber` turns `'YYYY-MM-DD'` into whole days since 1970 with `Date.UTC`, so no time zone can move a date by a day. The axis runs from 30 days before the earliest date to 30 days after the latest; `timeTicks` marks the 1st of every third month, or every January when the span is longer than two and a half years.
- **`Tooltip.jsx`** is the hover and focus box. `useTooltip` remembers where the box is and what it says. With the mouse, `onPointerMove` places it at the pointer (the pointer's position minus the chart's top-left corner) and `onPointerLeave` hides it. With the keyboard, `onFocus` places it above the middle of the focused row and `onBlur` hides it. `markEvents` returns those four handlers, which each row spreads onto its `<g>`. `ChartTooltip` keeps the box inside the chart and is `aria-hidden`, because the same words are already in the row's `aria-label` and in the table.
- **`scale.js`** holds the axis maths. `niceTicks(max)` picks the smallest step of 1, 2, 2.5, 5 or 10 times a power of ten that is at least a quarter of `max`, and returns ticks from 0 that cover it: `niceTicks(1253029.59)` gives 0, 500000, 1000000 and 1500000. `toPrecision(12)` clears floating-point noise, and a maximum of 0 gives `[0, 1]`, so nothing is divided by zero. `shortNumber` writes tick labels such as 25K or 1.5M; `toNumber` turns text into a number for drawing, or 0 if it is not one.
- **`useChartWidth.js`** is a small custom hook. It measures the chart's box after the first render and again whenever it changes size, using a `ResizeObserver` (a browser feature that reports size changes), with 640 pixels as a fallback. The SVG is then drawn at its real width, so on a phone the chart gets narrower but its text stays readable instead of shrinking.

### `frontend/src/utils/csv.js`

It turns a report's rows into a CSV file that opens correctly in Excel.

- `csvCell(value)` writes one cell; an empty value gives nothing. **The formula-injection guard:** text that starts with `=`, `+`, `-`, `@`, a tab or a carriage return could be run by a spreadsheet as a formula (for example `=HYPERLINK(…)`), so it gets a single quote `'` in front and shows as plain text. Plain numbers such as `-1651.00` match `PLAIN_NUMBER`, a *regular expression* (a text pattern), and are left alone, so Excel still reads a negative amount as a number. Then comes **RFC 4180 quoting** (RFC 4180 is the published description of the CSV format): a cell containing a double quote, a comma, a carriage return or a line feed is wrapped in double quotes, and each double quote inside is doubled.
- `toCsv(columns, rows)` writes the header line, then one line per row, with the columns in the given order. Every line ends with **CRLF** (carriage return plus line feed, `\r\n`), the line ending RFC 4180 asks for. The text starts with `\uFEFF`, the **BOM** (byte-order mark: the character U+FEFF, stored in UTF-8 as the bytes `EF BB BF`), written as an escape so it can be seen in the code. It tells Excel the file is UTF-8; without it Excel may guess an older Windows encoding and garble any character outside plain English.
- The CSV holds the raw text from the database, such as `90500.00`, not `LKR 90,500.00`, so Excel can add the amounts up.
- `csvFileName('Agent activity', '2026-10-05')` gives `mims-agent-activity-2026-10-05.csv`: lower case, any run of other characters becomes `-`, and dashes at either end are trimmed.
- `downloadCsv` wraps the text in a `Blob` (a file held in memory), gives it a temporary address with `URL.createObjectURL`, clicks a hidden `<a download>` link, removes the link and frees the address a second later.

### `frontend/test/csv.test.js`

Four tests for Node's built-in test runner (`node:test`) with strict assertions; `npm test` in `frontend/` runs them without a server or a database. They check quoting only when needed (a comma, doubled quotes, a line break, `null`, the number 42); the formula guard (`=HYPERLINK(…)`, `+94 77 123`, `@SUM(A1)` and `-2+3` get a `'`, but `-1651.00` does not); the exact file text with the BOM and CRLF, and the file name; and the axis maths (`niceTicks` for four maximums including 0, and `shortNumber`).

### `frontend/src/styles/charts.css`

The chart styles. Colours are set as *tokens* (named values the whole page can use) on `:root`: `--chart-1` (teal green) and `--chart-2` (burnt orange) for the two series, `--chart-span` for the pale FD term bars, and pale greys for the grid and the baseline. The comment records that the two series colours were checked for colour-blind separation and for at least 3:1 contrast on white. SVG text is coloured with `fill`, not `color`. `crispEdges` keeps 1-pixel grid lines sharp, and `tabular-nums` gives digits equal widths so numbers line up. Hovering or focusing a row fades its bars to 80%; for keyboard focus the browser's outline is switched off and a ring is drawn round the row's `chart__hit` rectangle instead. `.chart { position: relative }` lets the tooltip be placed inside the chart; its `transform: translate(-50%, calc(-100% - 10px))` centres the box just above the point, and `pointer-events: none` keeps it out of the mouse's way.

### `frontend/src/styles/reports.css`

Layout for the Reports and Data Checks pages, built from the shared tokens in `tokens.css`. The active tab is styled from `aria-current='page'`, the same attribute a screen reader announces, so what is shown and what is announced always agree. `.filter-row` lays the filters out in a wrapping row, `.report-body.is-loading` dims the old figures to 55% while new ones load, `.chart-switch` styles the value/count radio buttons, and `.run-interest` gets a thick warning-coloured top border to mark the one control on the page that changes data.

## My SQL test files

To run them all, from the repository folder: `mysql -u root -p --table < tests/run_all.sql`.

### `tests/_helpers.sql`

The shared tools every SQL test file uses. They live in their own *schema* (in MySQL, another word for a database) called `mims_test`, so test tools and results never sit inside `mims`. The file drops and recreates `mims_test` each time it runs.

- `results` is the table of checks: suite, test id, description, PASS or FAIL, and a detail for failures.
- `try_sql(p_sql, OUT p_state, OUT p_message)` runs one statement (usually a CALL) and reports how it ended instead of stopping the script. It sets the state to `'00000'` (success) and runs the text as a prepared statement. If anything fails, its `EXIT HANDLER FOR SQLEXCEPTION` (code that runs on any error and then leaves the procedure) uses `GET DIAGNOSTICS` to copy the error's SQLSTATE and message into the OUT parameters. This is what lets a test expect a refusal.
- **Why `SQL SECURITY INVOKER`.** A procedure normally runs with the rights of the account that created it. `try_sql` runs any text it is given, so with those rights it could do things the caller may not. `INVOKER` makes the statement run with the caller's own rights, never more.
- **Why test statements write `mims.NAME`.** While a procedure runs, MySQL makes the procedure's own schema the default database, which inside `try_sql` is `mims_test`. A bare `PROC_OPEN_SAVINGS_ACCOUNT` would be looked for there, so the tests write `mims.PROC_OPEN_SAVINGS_ACCOUNT`.
- `check_that(suite, id, description, ok, detail)` records one check: PASS when `ok` is true, otherwise FAIL. NULL counts as FAIL, so a check that cannot even be worked out (for example, about an account that was never made) never slips through.
- `expect_ok` passes when the statement worked. `expect_refusal` passes only when it was refused with SQLSTATE 45000 *and* exactly the expected message. `expect_check_violation` passes when a CHECK constraint (a rule declared on a table) stopped it: MySQL error 3819, SQLSTATE `HY000`, message `Check constraint '<name>' is violated.`
- `clock_at(moment)` runs `SET timestamp = UNIX_TIMESTAMP(moment)`. For this session only, `NOW()`, `CURDATE()` and new `txn_timestamp` values then return that moment, so business hours, ages and interest dates are tested at a known time on any day. No data changes, and `clock_reset()` goes back to the real time. (Any MySQL session may set its own clock like this, the app's included; the team recorded that as an accepted limitation.)
- `start_suite` deletes a suite's old results before it runs. `report(suite)` prints one row per check (the detail only for a FAIL) and a summary row.
- `new_nic()` returns `T` plus 11 digits from `UUID_SHORT()` (a MySQL function that gives a new unique number on every call), in a form no real NIC has, so test customers never clash with real ones or with each other.
- `ledger_balance(account)` works out an account's balance from its `TRANSACTION` rows (deposits, both kinds of interest and FD closures add; withdrawals and FD openings subtract). It must always equal `SAVINGS_ACCOUNT.balance`.
- `plan_of(account)` gives the name of the account's savings plan, or NULL if the account does not exist.

### `tests/run_all.sql`

It runs every SQL test with one command. `--table` asks the client to print boxed tables even though its input comes from a file. The script loads the database, loads the helpers, runs the five test files (account opening, deposits and withdrawals, fixed deposits, interest posting, triggers and reports) and then **loads the database again**. Tests cannot clean up after themselves: the triggers in `05_transaction_immutability.sql` refuse every UPDATE and DELETE on `TRANSACTION`, and the test accounts are held in place by their transactions. The second load brings back the plain sample data (and wipes anything entered through the app). The results survive because they are in `mims_test`, which `load_all.sql` does not touch. The last two tables give a count per suite and one overall line, which must say **ALL 166 CHECKS PASS**.

### `tests/test_open_savings_account.sql`

 My 35 checks of `PROC_OPEN_SAVINGS_ACCOUNT` (in `procedures/02_open_savings_account.sql`). Every call goes through `try_sql`, and the checks then read the tables directly.

- **Set-up.** `start_suite` clears old results, and a fault trigger left over from an interrupted run is dropped. The clock is pinned to Monday 5 October 2026 at 10:00, inside business hours. The *fixtures* (test data made at the start) are an ACTIVE agent, an ON_LEAVE agent and ten customers whose ages on that day are 12; 13; 17; 17 with an 18th birthday tomorrow; 18 with the birthday today; 59; 59 with a 60th birthday tomorrow; 60 with the birthday today; and two adults of 36 and 41. Those aged 18 or over get a NIC from `new_nic()`, because the customer trigger demands one.
- **OA01:** the plan follows the primary holder's age on the opening day, including every birthday edge: 12 is Children, 13 and 17 are Teen, the day before turning 18 is still Teen, 18 is Adult, 59 and the day before turning 60 are still Adult, 60 is Senior.
- **OA02:** a new account is ACTIVE, opened on 5 October 2026, with the opening deposit (2,500.00) as its balance; its number is `SA` plus 7 digits; its first interest date is one 30-day cycle later, 4 November 2026; it has exactly one holder, the PRIMARY one; and its only transaction is the opening deposit: a BRANCH DEPOSIT by the agent, not flagged, stamped 10:00:00, with the reference number the procedure returned.
- **OA03:** a joint opening of 4,999.99 is refused (the Joint minimum is 5,000.00); 5,000.00 gives a Joint account with a PRIMARY and a SECONDARY holder; a 13-year-old may be the primary holder of a Joint account.
- **OA04:** the opening deposit must cover the plan minimum: Teen 499.99, Adult 999.99 and Senior 999.99 are refused; Children 0.01 is accepted.
- **OA05:** 0.00, a negative amount and no amount are all refused.
- **OA06:** an agent who does not exist, or who is ON_LEAVE, is refused.
- **OA07:** opening on Saturday 10 October, or on the Monday at 08:59:59 or 16:00:01, is refused; then the clock goes back to Monday 10:00.
- **OA08 and OA09:** the same customer cannot be both holders, and a primary or secondary holder who does not exist is refused.
- **OA10:** an opening deposit of exactly 1,000,000.00 is not flagged; 1,000,000.01 is accepted but flagged for review.
- **OA11, all or nothing.** The procedure works inside one *database transaction* (a group of changes saved together with COMMIT or undone together with ROLLBACK). The test creates a temporary trigger, `test_fault_after_balance_update`, that makes every UPDATE of `SAVINGS_ACCOUNT` fail, so the opening fails at its balance update, after the account, both holders and the opening deposit have already been inserted. The check confirms that the error was the test fault, that the row counts of `SAVINGS_ACCOUNT`, `ACCOUNT_HOLDER` and `TRANSACTION` are unchanged (the rollback removed everything), and that `@allow_balance_update` is back to 0 (the error handler switched the balance guard on again). The trigger is dropped straight after the call.
- **OA12:** `PROC_VERIFY_JOINT_HOLDERS` on a Joint account with only one holder must fail with "A Joint account must have at least 2 linked holders." The opening procedure can never make such an account, so the test builds one by hand (`SA9999999` with one PRIMARY holder) inside `START TRANSACTION … ROLLBACK`: it runs the check, then rolls back, so nothing is kept.
- At the end the clock is reset and `report` prints the suite.

Each test was also shown to FAIL when its rule was deliberately broken on a throw-away copy of the database, which proves it can catch a mistake rather than passing whatever happens; the demo script records 68 such breakages in all, every one caught. To run only this file, load `tests/_helpers.sql` first, then run `mysql -u root -p --table < tests/test_open_savings_account.sql`, and reload the database afterwards.

## Before I commit

- In `frontend/`, run `npm test` (the CSV and axis tests must pass) and `npm run build` (the pages must compile).
- With MySQL running and both servers started, run the smoke test, `node scripts/smoke-test.mjs`, from the repository folder: every line should say PASS or SKIP.
- Run `mysql -u root -p --table < tests/run_all.sql`: the last line must say ALL 166 CHECKS PASS.
- I must replace every unfinished placeholder in my files and in this walkthrough with my own words.
- I should read each file once more and make sure I can explain every line; this guide is a starting point, not a script.
## Likely viva questions

**1. Why can't the app change a balance directly?**
`mims_app` has only SELECT and EXECUTE on the database and INSERT on `CUSTOMER`, so it has no UPDATE right at all. A balance can only change through a procedure, which runs with its creator's rights and checks the rules first. As a second wall, `trg_savings_balance_guard` refuses a balance change unless `@allow_balance_update` is 1, a flag the procedures switch on only around their own UPDATE.

**2. Why does `load_all.sql` load the data before the procedures, and 04 before 03?**
The balance fix-up at the end of `03_transactions.sql` would be blocked by `trg_savings_balance_guard`, and the account-number counter must start after the sample accounts. 04 comes first because fixed-deposit transactions point at their FD through the foreign key `fk_txn_fd`, so the FDs must exist.

**3. Why keep the report filters in the address bar?**
So a report can be bookmarked or shared, a reload keeps it, and Back and Forward move between earlier choices. The address is the single source of truth: each report component reads its filters from it.

**4. Why do I turn amounts into JavaScript numbers? Is that safe for money?**
Only for drawing: SVG needs numbers to place bars, so `toNumber` is used for lengths and positions. Every amount a person reads, in labels, tooltips, tables and the CSV, comes from the exact text the database sent, so rounding never reaches what is shown.

**5. What does the CSV formula guard do, and why does `-1651.00` keep its minus sign?**
A cell starting with `=`, `+`, `-`, `@`, a tab or a carriage return could be run as a formula when the file opens in Excel, so it gets a leading `'`. A plain number cannot run anything, and a quote would turn a real negative amount into text, so plain numbers are left alone.

**6. Why does Run interest post FD interest, then maturity, then savings interest?**
An FD's last payout falls on its maturity date, so it must be posted before maturity marks the FD MATURED; the maturity procedure even waits for that payout. Savings interest is worked out on the balance on its due date, which must already include the FD interest credited before it.

**7. Who can call `POST /api/tester/run-interest`?**
The page appears only in Tester view, but the app has no log-in, so the server cannot tell who is calling. The protection is `confirm: true`, the check against the database's today, and the procedures themselves: they refuse a future date and never pay the same cycle twice.

**8. How do my SQL tests expect a refusal without the script stopping?**
`try_sql` runs the statement inside a procedure whose error handler catches the error and hands back its SQLSTATE and message. `expect_refusal` then passes only if the code is 45000 and the message is exactly the expected one.
