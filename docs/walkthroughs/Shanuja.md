# Walkthrough — Shanuja's files

My part is the frontend core (page frame, design tokens, global styles, shared components and Home), the Fixed deposits slice (route, API calls, page and helper), and the deposit/withdraw SQL tests. The page checks the input first, then asks the database through the API and shows the database's own error messages. If a payout is due, the close dialog only warns, but the database also refuses the close ("Interest is due..."), so the database is what really stops it. I also made one SQL fix in PROC_CLOSE_FIXED_DEPOSIT for that.

This guide explains every file you own. Read it with the code open beside it: each part names the real functions, components and procedures, so you can jump straight to them.

## What you own

You own three parts of MIMS. First, the **frontend core**: the page frame (`main.jsx`, `App.jsx`), the design tokens (named colours, fonts and sizes) and the global styles, the ten shared components (reusable building blocks for screens) and the Home page. It stands on Virun's frontend set-up (the package and Vite settings, the API client and data hooks, the agent context, and the money and date helpers), which his walkthrough explains. Second, the **Fixed deposits slice** from end to end: the backend route `backend/src/routes/fixedDeposits.js`, the API module `frontend/src/api/fixedDeposits.js`, the page `FixedDeposits.jsx`, the rules helper `fdRules.js`, `fixedDeposits.css` and `fdRules.test.js`. Third, the **SQL test file** for deposits and withdrawals, `tests/test_deposit_withdraw.sql`. Every business rule lives in the MySQL database; your code asks it, explains its answers and shows them clearly.

## How a request travels

Example: an agent opens a fixed deposit (FD) on the Fixed deposits page.

Four words first. A **component** is a function that returns what should appear on screen, written in JSX (HTML-like tags inside JavaScript). A **prop** is a value a component receives from its parent, like a function argument. **State** is a value React remembers between redraws; changing it redraws the component. A **hook** is a React function whose name starts with `use` (such as `useState`) that gives a component state or another ability.

1. **The page.** `OpenFixedDeposit` (in `FixedDeposits.jsx`) holds the form. The agent chooses an account, the holder asking, a term and an amount, then presses **Open fixed deposit**. `submit()` first checks the form itself: an account, a holder and a term are chosen, and `fdAmountError()` accepts the amount. Any problem goes into the `errors` state and nothing is sent.
2. **The action hook.** `open` is `useAction(openFixedDeposit)`. `open.run({ accountId, customerId, fdPlanId, amount, agentId })` marks the form busy and calls `openFixedDeposit`.
3. **The API module.** `openFixedDeposit(body)` in `frontend/src/api/fixedDeposits.js` is one line: `api.post('/fixed-deposits', body)`.
4. **The client.** `request()` in `client.js` (Virun's frontend set-up) uses `fetch` (the browser's built-in way to send a request) to send `POST /api/fixed-deposits` with the body as JSON (a text format for data). In Tester view it adds the header `X-Debug: 1`.
5. **The proxy.** The page itself came from the Vite development server on port 5173, so the request goes there. Vite acts as a **proxy** (a go-between that passes requests on): anything starting with `/api` is forwarded to the backend on port 3001 (the rule is in Virun's `vite.config.js`).
6. **The route.** Express (the backend's web framework) passes it to `router.post('/')` in `backend/src/routes/fixedDeposits.js`. The route checks each value with `id()` and `money()` from `validate.js` (Virun's backend core), notes the call for the Tester panel with `noteCall()`, and runs `callProc('PROC_OPEN_FIXED_DEPOSIT', params, ['fd_id', 'reference_no', 'new_balance'])`.
7. **The database.** `PROC_OPEN_FIXED_DEPOSIT` is a **stored procedure** (a named program kept inside MySQL). Inside one **database transaction** (a group of changes saved together or not at all) it checks the amount, business hours, the agent, the account, that the customer is the PRIMARY holder, the plan, that no other FD on the account is ACTIVE, and that the balance stays at or above the plan minimum. Then it inserts the FD, adds an `FD_OPEN` row to the `TRANSACTION` table and lowers the savings balance. It hands back three **OUT parameters** (values a procedure gives back to its caller): `fd_id`, `reference_no` and `new_balance`. `callProc` reads them through session variables (`@fd_id` and so on).
8. **The answer.** The route reads the new FD back with `findFd()` and replies with status 201 and `{ data: { ...fd, referenceNo, newBalance } }`, plus `debug` in Tester view.
9. **Back on the page.** `request()` returns `payload.data`, `useAction` stores it as `open.result`, and `OpenedCard` shows it in a `SuccessCard`: amount, term, interest per payout, first payout, maturity date, reference and the new balance. `submit()` also clears the amount and reloads the account, the active-FD check and the FD list.

**When the database says no.** A rule refuses with `SIGNAL SQLSTATE '45000'` (MySQL's way of raising an error on purpose) and a message written for people, such as `Fixed Deposit would take the balance below the plan minimum`. The route catches it and throws `ruleError(err, OPEN_FIELDS)`: the first pattern in `OPEN_FIELDS` that matches the message names the form field (`/amount|minimum/` → `amount`, `/holder/` → `customerId`, and so on), giving an `HttpError` with status 422. Express 5 passes an error thrown in an `async` route to `errorHandler` in `backend/src/errors.js` (Virun's), which replies `{ error, field }`; any other error becomes a short plain message there too, never SQL text or a stack trace. In the browser, `request()` turns the reply into an `ApiError` carrying `message`, `status` and `field`. On the page, `fieldError('amount')` returns the page's own message for that field or, when `open.error.field` is `'amount'`, the server's message, and `FormField` prints it under the Amount box. An error that is not about one of the form's fields (business hours, or the agent, who is chosen in the top bar) goes to the `ErrorBanner` above the form instead.

## File by file

Your SQL test file has its own section after this one.

### `frontend/src/main.jsx`

The starting point. It imports the fonts (Source Sans 3 and IBM Plex Mono, installed from npm so they also work offline), then `tokens.css` and `global.css`. `createRoot(document.getElementById('root')).render(...)` hands the `#root` div to React and draws, from the outside in:
- `<StrictMode>`: extra checks while developing (React runs some code twice on purpose to expose mistakes); it does nothing in the built site.
- `<BrowserRouter>`: keeps the page on screen in step with the address bar.
- `<AgentProvider>`: shares the acting agent and the view mode with every page (Virun's `AgentContext.jsx`).
- `<App />`: the frame and the pages.

### `frontend/src/App.jsx`

The page frame and the routes (a **route** pairs an address such as `/fixed-deposits` with the page shown there).
- **Pages are found automatically.** `import.meta.glob('./pages/*.jsx', { eager: true })` is a Vite feature that imports every `.jsx` file in `src/pages`, all up front. Each file that exports a component and a `meta` object (`path`, `title`, `order`, optional `testerOnly`) becomes a route and a menu entry, sorted by `order`. A teammate adds a page by adding a file; nobody edits `App.jsx`.
- `App` draws the sidebar (brand link, a **Menu** button for narrow screens, the menu as `NavLink`s), the top bar, the `<Routes>`, and `<RequestPanel />` under every page. Tester-only pages are listed only in Tester view. A "Skip to content" link lets keyboard users jump past the menu. An **effect** (`useEffect`: code React runs after drawing, and again whenever a value in its dependency list changes; the function it returns is its clean-up) closes the menu whenever `location.pathname` changes.
- `TopBar`: the **Acting as** drop-down of ACTIVE agents or, if that list fails to load or is empty, a text box that keeps only digits (`replace(/\D/g, '')`). Then the Agent/Tester radio buttons and `BranchPill`, which shows the answer of `useBranchStatus()` (from Virun's `useApi.js`), so the light is checked again every minute.
- `PageFrame`: sets the browser tab title. After a page change, but not on the first load (a `useRef` box, which keeps a value between redraws, remembers which), it moves keyboard focus to `<main>`, so screen-reader users (people whose software reads the screen aloud) start at the new content. A tester-only page in Agent view shows a short explanation instead.
- `NotFound` answers any other address (`path="*"`). `end` on the Home link means it only counts as the current page at exactly `/`.

### `frontend/src/styles/tokens.css`

Design tokens: every colour, font, text size, space and corner radius, defined once as CSS custom properties on `:root` (variables written `--name` and used as `var(--name)`). Change a token and every page follows. Deep greens (`--pine-*`, `--moss-*`) and warm greys; the signal colours (`--success`, `--warning`, `--error`, `--info`) are for states only, never decoration; the passbook has three colours of its own; there are two focus-ring colours, one for the dark sidebar. The comment records that three shades were darkened from the first palette so small text passes the WCAG AA contrast level (the web accessibility guidelines' usual minimum), and `--field-border` reaches 3:1 against white and the page background.

### `frontend/src/styles/global.css`

Plain CSS for the whole app, built on the tokens. In order: base rules (box sizing, text, headings, links, a clear `:focus-visible` ring, `.num` for right-aligned figures of equal width, `.visually-hidden` for words only screen readers read, reduced motion); the page frame (a grid of sidebar and workspace, the top bar, the Agent/Tester switch, the branch pill); the narrow-screen layout below `56.25em` (about 900px: one column and a Menu button); headers, panels and columns; forms, including a red border on any input or select with `aria-invalid='true'` (ARIA attributes are extra labels for screen readers; `FormField` sets this one); the `LKR` box; buttons (`--quiet`, `--danger`, `--small`); banners, the success card, loading and empty states; tables with a sticky header; the dialog and its `::backdrop`; the request panel; the Home page; the pickers; and `.tag`, a small label in words, because state is shown "always words, never colour alone". Names such as `button--quiet` and `branch-pill__dot` follow the block__element--modifier pattern, so each class says where it belongs.

### `frontend/src/styles/fixedDeposits.css`

Styles for the Fixed deposits page, which imports this file. An imported CSS file still applies to the whole app, which is why these class names are specific to the page. `.term-option` turns each term's radio button and label into a card; `:has(input:checked)` highlights the chosen card and `:has(input:focus-visible)` outlines it for keyboard users. `.fd-preview` is the green payout preview and `.fd-list__head` puts the list heading and the **Show** filter on one line.

### `frontend/src/api/fixedDeposits.js`

The three calls behind your page. `fixedDepositsPath({ accountId, status })` builds `/fixed-deposits?accountId=…&status=…` with `URLSearchParams` and leaves out empty filters; it returns a path, not a request, because pages hand it to `useApiData`. `openFixedDeposit(body)` posts to `/fixed-deposits`, and `closeFixedDeposit(fdId, body)` posts to `/fixed-deposits/:id/close`, with the ID made safe by `encodeURIComponent`. Reads return paths and actions return promises (values that arrive later), the same pattern as the other slices' API files.

### Shared components (`frontend/src/components/`)

Ten small components that the pages are built from.
- **`ConfirmModal.jsx`** — the "are you sure?" dialog for actions that cannot be undone (closing an FD; Run interest on Data checks). It uses the browser's own `<dialog>`: an effect calls `showModal()` when the `open` prop turns true and `close()` when it turns false. `showModal` keeps keyboard focus inside and shows the dimmed `::backdrop`. Escape fires the dialog's `cancel` event; the handler calls `preventDefault()` so the page decides, and ignores Escape while `busy`. `useId()` makes a unique ID that links the title to the dialog. While busy both buttons are disabled and the confirm button says "Working…"; `confirmDisabled` keeps the confirm button disabled until the page has what it needs; `danger` makes it red.
- **`DataTable.jsx`** — a table from `columns` (`{ key, header, align, render }`) and `rows`. No rows → `EmptyState`. `align: 'right'` adds `.num` for money; `render(row)` draws a custom cell; `rowKey` gives each row a stable key. The wrapper has `tabIndex={0}` so keyboard users can scroll a wide table, and `hideCaption` keeps the caption for screen readers only.
- **`EmptyState.jsx`** — what a list shows when it is empty: a title and an optional hint.
- **`ErrorBanner.jsx`** — draws nothing without an error; takes an `Error` or a string. `role="alert"` makes screen readers read it at once. A business-hours refusal gets the title "The branch is closed" and a note that this is the rule working, not a fault.
- **`FormField.jsx`** — label, optional hint, the control, and the error under it. `cloneElement` (which copies an element with extra props) gives the single child its `id`, `aria-describedby` (the hint and error IDs) and `aria-invalid`, so screen readers read the hint and the error with the field, and `global.css` draws the red border.
- **`Loading.jsx`** — a quiet "Loading…" line with `role="status"` and `aria-live="polite"`, announced without interrupting.
- **`MoneyInput.jsx`** — a text box with a fixed `LKR` in front (hidden from screen readers by `aria-hidden`). It is `type="text"` with `inputMode="decimal"` (a number keypad on phones), so the value stays exactly as typed and no rounding can creep in; pages check it with `amountError()`. `onChange` receives the text, not the event. Every other prop (`...inputProps`) goes to the real `<input>`: the `id` and ARIA attributes from `FormField` and, because React 19 treats `ref` as an ordinary prop, the ref the Transactions page uses to move focus to the box.
- **`PageHeader.jsx`** — the page's `<h1>`, a one-line intro and optional extras.
- **`RequestPanel.jsx`** — Tester view only: a fold-out (`<details>`) under every page. It starts from `getLastExchange()` and subscribes with `onExchange(setExchange)` inside an effect; the unsubscribe function that `onExchange` returns is the effect's clean-up. It lists the request, the JSON sent, the procedure and its parameters, the OUT values, the HTTP status with the message, and the data. It only shows what the backend sent, and the backend never sends secrets or raw SQL errors.
- **`SuccessCard.jsx`** — the summary after a successful action: a heading, a list of `{ label, value, mono }` pairs (`mono` uses the ledger typeface) and optional extras such as a Done button. `role="status"` announces it.

### `frontend/src/utils/fdRules.js`

The sums behind the FD page's preview. The database still posts the real amounts.
- `interestFor(amount, rate, days, basis)` follows `FUNC_CALC_INTEREST`: amount × rate ÷ 100 × days ÷ basis, rounded to the cent. In BigInt that is cents × rate in hundredths of a percent × days ÷ (10000 × basis). **How it copies the database's rounding:** BigInt division drops the remainder, so the code adds half the divisor first, `(numerator × 2 + denominator) ÷ (2 × denominator)`. That rounds half up, which for positive amounts is what MySQL's `ROUND(x, 2)` does. LKR 50,000.00 at 13% for 30 days on a 365-day basis is 534.2465…, so `'534.25'`.
- `addDays('2026-10-05', 180)` → `'2027-04-03'`, worked out with `Date.UTC` and `toISOString()`, both in UTC, so no time zone can move the date.
- `fdAmountError(text, account)` runs `amountError`, then the rule `PROC_OPEN_FIXED_DEPOSIT` applies: the balance left must not drop below the plan minimum. The message says the most that can move.
- `termLabel('6_MONTH')` → `'6 months'`.

### `frontend/test/fdRules.test.js`

Run them with `npm test` in `frontend/`. They use Node's built-in `node:test` and `node:assert/strict` and test plain functions, so no browser, server or database is needed.
- `fdRules.test.js` (3 tests): `interestFor` matches, to the cent, the FD interest in the sample data (FDs 2, 3, 6, 7, 8 and 9); `addDays` over 30, 180 and 1080 days; `fdAmountError` allows exactly the balance above the minimum, refuses one cent more with the exact message, and covers an account with nothing to spare and an empty box; plus `termLabel`.

### `frontend/src/pages/Home.jsx`

The first page (`meta = { path: '/', title: 'Home', order: 0 }`). It loads `/status`, `/health`, `/lookups/settings`, `/lookups/savings-plans` and `/lookups/fd-plans` with `useApiData`.
- `RightNow`: if the server or the database cannot be reached, it says so once (503 means the database). Otherwise `BranchState` shows "Open for transactions" or "Closed for transactions", the database's own message and the database clock, and `HealthLine` shows the database name and MySQL version.
- `Rules`: opening hours, the daily withdrawal limit, the large-deposit threshold, the interest formula (with the savings cycle and the FD cycle, each read from its own setting) and the age bands, filled in from the bank's settings in `SYSTEM_CONFIG`, so the words always match what the database enforces.
- `PlanTable` and `FdPlanTable` show the savings plans and FD terms in `DataTable`s. `SectionProblem` shows a quiet line when the server is down (already said above) or the lookups route is missing (404), and an `ErrorBanner` for any other problem.
- A numbered list explains how a branch visit usually goes.

### `frontend/src/pages/FixedDeposits.jsx`

Your slice's page (`order: 4`), in three parts.
- **`OpenFixedDeposit`** — the form. The chosen account lives in the address (`?account=6`, through `useSearchParams`), so a reload keeps it. When a new account loads, an effect pre-selects its PRIMARY holder. A hint shows the balance, the plan minimum and the most that can move. If the account already has an ACTIVE FD, an info banner says the database allows only one; a warning appears when `/status` says the branch is closed. The terms are radio cards. Once a term and a well-formed amount are chosen, the **preview** shows the interest per payout (`interestFor`, with the FD cycle and the day-count basis from the settings), the first payout date and the maturity date (`addDays` from the database's date in `/status`, the day the FD would start; this computer's date only until that answer arrives), and says the database posts the exact amounts. Sending and error placing are described in "How a request travels".
- **`FdTable`** — the FDs, ACTIVE ones first, filtered by **Show** (Active, Matured, Closed early, All). "Next payout" shows the date and the amount, plus a **due, not posted yet** tag when the backend's `payoutDue` is true: the payout date has come, but the interest job (the interest procedures, started by **Run interest** on the Data checks page) has not posted it yet. Every ACTIVE row has a **Close early** button whose hidden text tells screen-reader users which FD it closes.
- **`CloseDialog`** — a `ConfirmModal` that loads the account's holders with `getAccount()` and pre-selects the primary one. If that look-up fails, it shows the error with a **Try again** button (which adds one to `attempt`, so the effect runs again), and the **Close FD** button stays disabled (`confirmDisabled`) until a holder is chosen. It warns that the amount goes back to the savings account, that closing early loses the interest of the unfinished payout cycle (there is no other penalty), and that payouts already made stay. If `payoutDue` is true, a warning banner says closing now would lose that payout and to post the interest first (Tester view, Data checks, Run interest). A holder refusal shows under the holder field, anything else in a banner. On success `ClosedCard` shows the amount returned, the reference, the new balance and the date, and the list reloads.

### `backend/src/routes/fixedDeposits.js`

Your Express routes, mounted at `/api/fixed-deposits` by `routes/index.js`. Values always travel as `?` placeholders.
- `FD_COLUMNS` is one SELECT list for every read: the FD with its account and plan; `payoutDue` (ACTIVE, with a `next_payout_date` on or before `CURDATE()`); `interestPerPayout` from `FUNC_CALC_INTEREST`, the same function the interest job uses, with the FD cycle from `SYSTEM_CONFIG`; how many `FD_INTEREST` payouts there have been and their total; and the primary holder's name. `shape()` turns MySQL's `1`/`0` into `true`/`false`.
- `GET /` lists FDs, optionally by `accountId` and `status` (only `ACTIVE`, `MATURED` or `CLOSED`), ACTIVE first, then newest, at most 500. `GET /:id` returns one FD or a 404.
- `POST /` validates the five values, calls `PROC_OPEN_FIXED_DEPOSIT` with three OUT names, maps refusals with `OPEN_FIELDS`, and answers 201 with the FD read back plus `referenceNo` and `newBalance`. The order of `OPEN_FIELDS` matters: "Customer is not a holder of this account" must meet `/holder/` before `/account/`, and "This Savings Account already has an active Fixed Deposit." lands on the account field.
- `POST /:id/close` calls `PROC_CLOSE_FIXED_DEPOSIT` (a holder refusal maps to `customerId`). That procedure has no OUT values, so the route reads back the FD, its latest `FD_CLOSURE` row in `TRANSACTION` and the account balance.
- The file only CALLs procedures and runs SELECTs. The backend connects as `mims_app`, which cannot update any table, so every change goes through a procedure.

## Your SQL test file: `tests/test_deposit_withdraw.sql`

It tests `PROC_PROCESS_DEPOSIT` and `PROC_PROCESS_WITHDRAWAL` (`procedures/01_deposit_withdrawal.sql`): 35 checks in the suite `deposit_withdraw`, grouped as DW01 to DW16.

**The helpers** come from `tests/_helpers.sql`, which builds its own schema (a separate database), `mims_test`, so `mims` never keeps test objects.
- `try_sql(sql, @state, @message)` runs one statement from a string (a prepared statement). Its error handler catches any failure, so a refusal does not stop the script; it reports the SQLSTATE (`00000` when it worked) and the message.
- `check_that(suite, id, description, ok, detail)` writes one PASS or FAIL row into `mims_test.results`; `NULL` counts as FAIL.
- `expect_ok(...)` passes when the statement works. `expect_refusal(..., message)` passes only when it is refused with SQLSTATE `45000` and exactly that message.
- `clock_at(moment)` sets this session's `timestamp`, which fixes `NOW()`, `CURDATE()` and new `txn_timestamp` values; `clock_reset()` returns to the real time. Only this connection is affected, and nothing in the database changes.
- Your file also uses `start_suite` (clears old results), `report` (prints them), `new_nic()` (a unique test NIC) and `ledger_balance()` (an account's balance worked out from its `TRANSACTION` rows).

**Why the clock is pinned.** Business hours and the daily limit depend on the time. At fixed moments the tests give the same result on a Tuesday morning or a Saturday night, and they can test exact edges such as 16:00:00 against 16:00:01, or "the next day".

**Why `mims.NAME` inside the strings.** While a stored procedure runs, MySQL's default database is the procedure's own schema. `try_sql` lives in `mims_test`, so a bare `PROC_PROCESS_DEPOSIT` would be looked for there; the strings therefore say `mims.PROC_PROCESS_DEPOSIT`. Variables such as `@acc` and `@agent` still work inside them because user variables belong to the whole session.

**Test data**, made on Monday 5 October 2026 at 10:00: an ACTIVE agent and an ON_LEAVE agent; four customers (a holder, a second holder, a stranger and a frozen-account holder); and five accounts opened with `PROC_OPEN_SAVINGS_ACCOUNT`: `@acc` (50,000.00, Adult plan, minimum 1,000.00), `@small` (5,000.00), `@big` (300,000.00), `@joint` (20,000.00, with a SECONDARY holder) and `@frozen` (10,000.00, then set to FROZEN). The balance guard, a **trigger** (code MySQL runs automatically when a table changes), allows that last update because only the status changes.

**What each group checks:**
- DW01 — a deposit raises the balance, returns the new balance, and logs exactly one matching DEPOSIT row stamped with the pinned time.
- DW02 — reference numbers are `TXN` + 7 digits, and the next one is higher.
- DW03 — deposits of 0.00, −50.00 and NULL are refused.
- DW04 — exactly 1,000,000.00 is accepted and not flagged; 1,000,000.01 is accepted and flagged for review.
- DW05 — deposits into a FROZEN account or a missing one are refused.
- DW06 — a deposit by an ON_LEAVE agent is refused (by the trigger `trg_transaction_bi`) and nothing is saved.
- DW07 — Saturday, Sunday, 08:59:59 and 16:00:01 are refused; 09:00:00 and 16:00:00 are accepted.
- DW08 — a withdrawal lowers the balance and logs one WITHDRAWAL row.
- DW09 — a withdrawal may leave exactly the 1,000.00 minimum, but not 999.99.
- DW10 — the daily limit is a running total: 60,000 and then 40,000 are accepted (100,000 in total), 0.01 more is refused and nothing is saved; a withdrawal breaking both rules gets the minimum-balance message first; the next day the limit starts again.
- DW11 — a customer who is not a holder cannot withdraw.
- DW12 — the SECONDARY holder of a joint account can.
- DW13 — withdrawals of 0.00 and NULL are refused.
- DW14 — withdrawals from a FROZEN account, or on a Saturday, are refused.
- DW15 — all or nothing (below).
- DW16 — each test account's stored balance equals its transaction history.

**The temporary fault trigger (DW15).** The file creates `test_fault_after_balance_update`, an AFTER UPDATE trigger on `SAVINGS_ACCOUNT` that always fails with "Test fault after the balance update". Then a deposit and a withdrawal are tried. Each fails at its last write, the balance UPDATE, after its `TRANSACTION` row was already inserted. The checks prove that the procedure's error handler (`DECLARE EXIT HANDLER FOR SQLEXCEPTION`) rolled everything back: the message is the fault's, the balance and the number of rows are unchanged, and `@allow_balance_update` is back to 0. The trigger is dropped straight afterwards, and also at the top of the file in case an earlier run stopped before the end.

**How to run it**, from the repository folder:
- The whole suite: `mysql -u root -p --table < tests/run_all.sql`. It reloads the database, runs all five SQL test files, reloads the database again so the app has the plain sample data, and should end with `ALL 166 CHECKS PASS`.
- Your file alone: `mysql -u root -p < tests/_helpers.sql`, then `mysql -u root -p --table < tests/test_deposit_withdraw.sql`. The last table should say `ALL PASS`. The test rows stay in `mims` (transactions are permanent), so afterwards reload the plain sample data with `mysql -u root -p < scripts/load_all.sql`.

`--table` prints the results as boxed tables. Each test was also shown to FAIL when its rule was deliberately broken on a throw-away copy of the database, so a PASS means the rule really is being checked.

## Before you commit

- In `frontend/`, run `npm test` (every test must pass) and `npm run build` (it must finish without errors).
- After changing the SQL test file, run the whole SQL suite again and look for `ALL 166 CHECKS PASS`.
- Rewrite every `TODO(Shanuja)` line in your own words. There is one near the top of each of your files.
- Make sure you can explain every line of every file above; this walkthrough is a map, not a script to read out.
- Never commit `node_modules/` or `.env` (nor the `dist/` build output); `.gitignore` already leaves them out. Run `git status` (it lists the files you have changed or added) before committing, to check nothing else slipped in.

## Likely viva questions

**1. How does a new page get into the menu?**
`App.jsx` uses Vite's `import.meta.glob('./pages/*.jsx', { eager: true })` to import every page file. A file that exports a component and a `meta` object becomes a route and a menu entry, sorted by `meta.order`; `testerOnly` pages appear only in Tester view. Nobody has to edit `App.jsx`.

**2. How does the Tester view show the procedure and its OUT values?**
In Tester view `client.js` adds the header `X-Debug: 1`. The route records the procedure and its parameters with `noteCall()` and the OUT values with `noteResult()`, and the backend adds them to the reply as `debug`. `client.js` stores the last exchange and tells `RequestPanel`, which subscribed with `onExchange()`.

**3. An agent types an amount that would break the plan minimum. Where is that checked, and where does the message appear?**
The page checks first with `fdAmountError()` and shows the message under Amount without sending anything. The database still has the final word: if the page's balance is out of date, `PROC_OPEN_FIXED_DEPOSIT` refuses with SQLSTATE 45000, the route's `ruleError` maps "minimum" to the field `amount`, and `fieldError('amount')` shows the database's message under the same box.

**4. Does the payout preview decide how much interest is paid?**
No. `interestFor()` uses the same formula and rounding as `FUNC_CALC_INTEREST`, and `fdRules.test.js` checks it against the sample data to the cent, but it only informs the agent. The database calculates and posts the real interest.

**5. What does "due, not posted yet" mean, and why does the close dialog warn about it?**
The backend sets `payoutDue` when an ACTIVE FD's next payout date is today or earlier by the database's date, so the interest job has not posted it yet. Closing sets the FD to CLOSED and clears its payout date, and the interest job only pays ACTIVE FDs, so that payout would be lost. The dialog says to run the interest first.

**6. How does your SQL test prove a deposit is all or nothing?**
DW15 adds a temporary trigger that makes the balance UPDATE fail after the `TRANSACTION` row has been inserted. The checks confirm the balance and the row count are unchanged and the guard flag is back to 0, so the procedure's error handler rolled everything back. The trigger is dropped afterwards.

**7. What are design tokens, and why use them?**
Every colour, font, size and spacing value is defined once in `tokens.css` as a CSS variable (`--name`) and used everywhere as `var(--name)`, so changing a token changes every page. Three shades were darkened so small text passes the WCAG AA contrast level, and a state such as an error or a warning is never shown by colour alone: there is always a word too.

**8. How does your confirm dialog behave for keyboard users?**
`ConfirmModal` uses the browser's own `<dialog>` with `showModal()`, which keeps keyboard focus inside the dialog and dims the page behind it. Escape is caught through the dialog's `cancel` event so the page decides what happens, and it is ignored while the action is running; both buttons are disabled while busy.
