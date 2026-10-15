# MIMS — Microbanking and Interest Management System (B-Trust)

MIMS is the central database for B-Trust, a microfinance bank in Sri Lanka. It records branches and agents, customers, savings accounts (single and joint), fixed deposits and every money movement, and it posts interest every 30 days. **All business rules live in the MySQL database** (stored procedures, functions and triggers). The web app in `backend/` and `frontend/` lets customers (online banking), branch agents and admins (the Tester view) sign in and use those rules; it never changes a balance by itself.

Group 27 — Database Systems project.

## What is in this repository

| Folder | What it holds |
|---|---|
| `sql/` | `mims_schema.sql`: the tables, keys, checks and the first triggers |
| `sample-data/` | Sample branches, agents, customers, accounts, fixed deposits, 230 transactions and the demo sign-ins |
| `procedures/` | Stored procedures, functions, triggers, the daily interest event, the Data Checks views and transfers (`09_transfer.sql`) |
| `procedures/` | Stored procedures, functions, triggers, the daily interest event, the Data Checks views and transfers (`09_transfer.sql`) |
| `reports/` | The five management reports |
| `scripts/` | `load_all.sql` (rebuild the database), `create_app_user.sql` (the app's limited MySQL user), `smoke-test.mjs` (environment check) |
| `tests/` | `validate_sample_data.sql` (36 data checks), `run_all.sql` with the five SQL test files and their helpers |
| `backend/` | Node.js + Express API on port 3001: it only calls stored procedures and runs read-only queries |
| `frontend/` | React + Vite web pages on port 5173 |
| `docs/` | QA user guide, demo script, SRS revision notes, cloud deployment guide (`DEPLOYMENT.md`), and a walkthrough of each person's files |
| `.github/workflows/` | `ci.yml`: the automatic checks that run on every push and pull request (see *Continuous integration*); `deploy.yml`: updates the cloud server after CI passes on `main` (see *Cloud hosting*) |
| `Dockerfile`, `docker-compose.yml`, `docker-compose.cloud.yml`, `docker/` | The two container images (the app, and MySQL with the MIMS database) and the file that starts both; see *Run with Docker*. `docker-compose.cloud.yml` adds the HTTPS web server for the cloud |

## What you need

- **MySQL 8.0.46** (the version we tested). 8.0 reached end of life in April 2026; 8.4 has not been tested here.
- **Node.js 24 LTS** (tested with 24.21.0; 22.12 or newer also works — tested with 22.22.0).
- **Git**.

Or only **Docker Desktop**, to run everything in containers (next section) instead of installing MySQL and Node.js.

On Windows, type the commands below in **Command Prompt**, not PowerShell (PowerShell does not support `<`).

## Run with Docker (one command)

Docker runs MIMS in two containers: `db` (MySQL 8.0.46 with the schema, procedures, reports and sample data built in)
and `app` (the Node.js API, which also serves the React pages). Nothing else needs installing.

1. Install and start **Docker Desktop** (https://www.docker.com/products/docker-desktop/).
2. In the repository folder, run:

```
docker compose up --build
```

The first start takes a few minutes: Docker downloads MySQL and Node.js, builds the two images and loads the sample
data. When the log shows `MIMS API listening`, open **http://localhost:8080**.

| To | Run |
|---|---|
| Stop | `Ctrl + C` in that window, or `docker compose down` |
| Start again (keeps everything entered through the app) | `docker compose up` |
| Run the SQL tests and the 36 data checks inside the container | `docker compose exec db mims-tests` (reloads the sample data) |
| Start again with fresh sample data | `docker compose down -v`, then `docker compose up` |

**Updating from a version before sign-in was added?** The old database has no `APP_LOGIN` table, so every sign-in
fails. Run `docker compose down -v`, then `docker compose up --build`, once.

- The database clock is set to Sri Lanka time in the container, so business hours work as described below.
- MySQL Workbench can connect to the container's database at `127.0.0.1`, port **3307**, user `root`, password
  `mims-root-local`.
- Those passwords are local-only defaults. To choose your own, copy `.env.example` to `.env` before the first start
  (or run `docker compose down -v` first, because the passwords are set when the database is created).

## Email notifications

After every deposit, withdrawal, new account, new fixed deposit and early FD closure, each holder of the account who has
an e-mail address gets a receipt: the amount, the reference number, the new balance and the agent. A deposit flagged
for review (above LKR 1,000,000) also sends an alert to the bank. The e-mails are sent by `backend/src/notify.js`
**after** the stored procedure has committed, so a slow or broken mail server never delays or undoes a transaction;
a failed e-mail is only written to the server log.

**Try it without any e-mail account** (Docker). Create a file `.env` next to `docker-compose.yml` (or add to it) with:

```
SMTP_HOST=mail
SMTP_PORT=1025
MAIL_DEMO_INBOX=demo@btrust.local
```

then run `docker compose --profile mail up --build`, make a deposit in the app, and open **http://localhost:8025**:
the receipt is in that test inbox (a pretend mail server, Mailpit, that keeps every e-mail instead of sending it).

**Real e-mails with Gmail.** Use a Gmail account made for the project, not a personal one. In that Google account turn
on 2-Step Verification, then create an **App password** (Google Account, Security, App passwords). In `.env`:

```
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_USER=the.project.address@gmail.com
SMTP_PASS=the 16-letter app password
MAIL_DEMO_INBOX=the inbox where you want to see every e-mail
MAIL_REVIEW_TO=the inbox for the large-deposit alerts
```

and restart with `docker compose up -d`. The app's log line `E-mail notifications: on ...` says where e-mails go.
Without Docker, put the same lines in `backend/.env`.

**Keep `MAIL_DEMO_INBOX` set.** It sends every e-mail to that one address, with a first line saying which customer it
was for. The sample customers' addresses (such as `liam@mail.com`) are made up, but real people could own them.
Receipts only go to customers' own addresses with `MAIL_SEND_TO_CUSTOMERS=true`, which is for real data only.

## Cloud hosting

MIMS runs on a cloud server with HTTPS: **https://btrust-mims.malaysiawest.cloudapp.azure.com**. It opens on the
start page; sign in with the demo accounts below (*Sign in and online banking*). It is the same Docker setup as on a
laptop: `docker-compose.cloud.yml` puts a web server (Caddy) in front of the app, gets a free HTTPS certificate, and
keeps the app and the database off the internet. The server is switched off at night and when nobody needs it, so start it in the
Azure portal before using the address. The step-by-step guide (Azure for Students, free credit, no credit card) is
`docs/DEPLOYMENT.md`. After that one-time setup, every change merged into `main` that passes CI is put on the server
automatically (`.github/workflows/deploy.yml`).

## Set up (once per computer)

Run everything from the repository folder (the one that contains this README).

**1. Build the database** (this wipes and rebuilds the `mims` database):

```
mysql -u root -p < scripts/load_all.sql
```

It ends by printing `15  13  10  230` (customers, accounts, fixed deposits, transactions).

**2. Check the data** — every one of the 36 rows must say PASS:

```
mysql -u root -p mims < tests/validate_sample_data.sql
```

**3. Create the app's own MySQL user** (it can read and call procedures, but can never edit a balance). Log in with `mysql -u root -p`, then at the `mysql>` prompt type, with a password of your own (at least 8 characters):

```
SET @app_password = 'choose-your-own-password';
SOURCE scripts/create_app_user.sql;
```

**4. Give the backend its settings.** Copy `backend/.env.example` to `backend/.env` and put the same password in `DB_PASSWORD`. Never commit `.env`.

**5. Install the exact tested library versions** (`npm ci` reads `package-lock.json`):

```
cd backend
npm ci
cd ../frontend
npm ci
```

## Run the app

Open two terminal windows in the repository folder.

```
cd backend
npm run dev
```

```
cd frontend
npm run dev
```

Then open **http://localhost:5173** and sign in with one of the demo accounts (next section). To stop either one, press `Ctrl + C` in its window.

## Sign in and online banking

The app opens on B-Trust's start page: the savings plans and fixed deposit rates (read from the database), and a
sign-in box with three tabs.

| Login | What it opens |
|---|---|
| **Customer** | Online banking: their own accounts and balances, the passbook with a statement download, sending money to any B-Trust account (with the recipient's name shown first), and opening or closing a fixed deposit |
| **Agent** | The branch screens (customers, accounts, deposits and withdrawals, fixed deposits) and *My reports*: their own transactions with totals for the cash drawer, and the fixed deposits at any branch due for a payout or maturity soon. The agent always works as themselves |
| **Admin** | Everything an agent has, the five management reports (they cover every branch, agent and customer), the choice of which agent to act as, and the Tester view (Data checks, Run interest, and what the database returned for each request) |

**Demo accounts** (in `sample-data/05_app_logins.sql`; every password is `demo1234`):

| Username | Login | Who |
|---|---|---|
| `james` | Customer | James Anderson: Adult account with an active fixed deposit |
| `sophia` | Customer | Sophia Thomas: Adult account, no fixed deposit yet (try opening one) |
| `lucas` | Customer | Lucas Thompson: primary holder of a joint account |
| `harper` | Customer | Harper Garcia: second holder of the same joint account (can send money, cannot open or close its fixed deposit) |
| `alice` | Agent | Alice Smith, Central Branch |
| `carol` | Agent | Carol Lee, North Branch |
| `admin` | Admin | Every screen and the Tester view |

**How it works.** The logins are in the `APP_LOGIN` table: a login belongs to one customer, one agent, or (admin) to
nobody, and a CHECK constraint makes sure of it. Passwords are never stored: only a salted scrypt hash. After signing
in, the browser keeps a signed, HttpOnly session cookie for 8 hours (`backend/src/session.js`). Every API route checks
the kind of login: a customer only reaches `/api/me/...`, which always works on the signed-in customer, never on an id
sent by the page; only an admin reaches the management reports and the Tester tools.

**Online banking has no opening hours.** Transfers and fixed deposits made by a customer go through the same procedures
as at the branch, on the `ONLINE` channel with no agent, at any hour. Only transactions at a branch counter (`BRANCH`
channel) keep the Monday–Friday 09:00–16:00 rule. `PROC_CHECK_CHANNEL` decides this in one place. Reports, searches and
the passbook can be read at any time by every login.

**Transfers** (`PROC_TRANSFER`) are stored as the two movements they are made of: a WITHDRAWAL from one account and a
DEPOSIT into the other, saved together or not at all, so the daily limit, the review flag and the reports treat them
like any other withdrawal and deposit. The two accounts are always locked in the same order, so two opposite transfers
at the same moment cannot deadlock.

**Check your setup** at any time with `node scripts/smoke-test.mjs` (run from the repository folder while both are running; it changes no data). Every line should say PASS or SKIP (SKIP = that part is not merged yet); a FAIL line says what to fix.

**Business hours are a rule, not a bug:** at a branch, deposits, withdrawals, new accounts, new fixed deposits and early fixed-deposit closures are only accepted Monday to Friday, 09:00–16:00 (database time). Online banking (customers) is open at any hour.

## Security and possible improvements

- Every value from a user is sent to MySQL as a query parameter (`?`), never pasted into the SQL text, so it cannot
  change the command (SQL injection). Procedure names are checked against a safe pattern (`backend/src/db.js`).
- The app's MySQL user `mims_app` can only read, call procedures and add customers; it cannot change a balance or a
  transaction, even if the app had a bug.
- Passwords are stored only as salted scrypt hashes, and a wrong password and an unknown username get the same answer.

Possible improvements: limit repeated sign-in attempts (for example 5 failures per 15 minutes), let customers change
their password, and close a savings account from the app.

## Tests

| What | Command | Needs |
|---|---|---|
| Sample-data checks (36) | `mysql -u root -p mims < tests/validate_sample_data.sql` | a freshly loaded database |
| SQL tests for every procedure, trigger, view and report (213 checks) | `mysql -u root -p --table < tests/run_all.sql` | MySQL (run from the repository folder) |
| Backend unit tests | `cd backend` then `npm test` | nothing else |
| Backend database tests (connection, report numbers) | `cd backend` then `npm run test:db` | MySQL, `backend/.env` |
| Frontend tests and build | `cd frontend` then `npm test` and `npm run build` | nothing else |

The data checks expect exactly 15 customers and 10 fixed deposits, so reload the database before running them if you have used the app.

**About the SQL tests.** Each test sets its own session clock to a fixed moment, so business hours, ages and interest dates give the same result at any time of day. `run_all.sql` loads the database, runs the five test files and loads the database again at the end (test transactions cannot be deleted), so it also wipes anything entered through the app. The last table must say `ALL 213 CHECKS PASS`. To run one file on its own, load `tests/_helpers.sql` first.

## Continuous integration (CI)

Every push to `main` and every pull request starts GitHub Actions (`.github/workflows/ci.yml`). It runs three jobs on a clean machine:

| Job | What it runs |
|---|---|
| Frontend tests and build | `npm ci`, `npm test` and `npm run build` in `frontend/` |
| Backend unit tests | `npm ci` and `npm test` in `backend/` |
| SQL tests (213 checks) | starts a fresh MySQL 8.0 service, runs `tests/run_all.sql`, and fails unless the result is `ALL 213 CHECKS PASS` |

A pull request is merged only when all three jobs show a green tick (the Checks box of the pull request, or the Actions tab on GitHub). Because the SQL job starts from an empty database on a new machine, it proves that the tests do not depend on anything on one person's computer.

## User experience (UX)

- **Keyboard:** every page works with the keyboard alone. A clear focus ring is always visible, and a "Skip to content" link jumps past the menu.
- **Screen readers:** errors, loading messages and results are announced (`role="alert"`, `aria-live`), and each form field is linked to its hint and error message.
- **Responsive layout:** a sidebar on wide screens and a top bar with a Menu button below about 900 px.
- **Dialogs:** confirmations use the browser's own dialog, which keeps focus inside and closes with Escape.
- **Plain words:** an error is shown next to the field it belongs to, in the database's own words. A state is never shown by colour alone, there is always a word as well (for example "due, not posted yet").
- **Consistent design:** every colour, font and size comes from one file of design tokens (`frontend/src/styles/tokens.css`).

## Bonus features

| Feature | Where |
|---|---|
| User experience | *User experience (UX)*, and the start page with online banking (*Sign in and online banking*) |
| CI/CD | *Continuous integration (CI)*, and automatic deployment to the server in *Cloud hosting* |
| Cloud hosting | *Cloud hosting* |
| Containerization | *Run with Docker* |
| E-mail notifications | *Email notifications* |

## Team Member Contributions (database)

| Person | Owns |
|---|---|
| Virun Gamage | Project lead: planning, design documents, PR reviews and merges. Schema (tables, keys, constraints, customer and agent triggers); account-opening and FD-opening procedures; online banking design |
| Shanujah Sivakumar | Planning, PR reviews and merges. FD closure, maturity and interest-posting procedures with the daily event; one-active-FD and balance-guard triggers; payout-due check on FD close; opening and closing FDs online (channel parameter) |
| Rookshi Suthakaran | Management reports, including separate savings and FD interest; registering-agent check in the customer trigger; transaction-immutability triggers; sample-data validator; Data checks views (`08_gap_queries.sql`); `APP_LOGIN` table and demo sign-ins |
| Sureshkumar Archchuthan | Transaction and fixed-deposit sample data; interest-posting, trigger and report SQL tests; transfers (`PROC_TRANSFER`, `09_transfer.sql`); GitHub Actions CI |
| Sameera Senanayaka | Branch, agent, customer and account sample data; deposit and withdrawal procedures; online channel rule (`PROC_CHECK_CHANNEL`) |

## Team Member Contributions (frontend & backend)
| Person | owns |
|---|---|
| Virun Gamage | Repository setup and README; backend core and tests; customer and account API; frontend setup; smoke test; review fixes; Docker, e-mail notifications, cloud hosting and deploy workflow; sign-in, online banking pages and My reports |
| Shanujah Sivakumar | Frontend core (design, shared components, page frame, Home); fixed deposits API and screens; deposit/withdrawal SQL tests |
| Rookshi Suthakaran | Reports and Data checks (API, screens, views); charts and CSV export; load/user scripts; account-opening tests and test runner |
| Sureshkumar Archchuthan | Transactions API, screen and passbook; report cross-check test |
| Sameera Senanayaka | Customers and account-opening screens, customer search and form rules; fixed-deposit SQL tests; QA guide; demo script |

## Overall contribution

**Agreed by the team:** Virun Gamage 26%, Shanujah Sivakumar 23%, Rookshi Suthakaran 19%, Sameera Senanayaka 16%, Sureshkumar Archchuthan 16%.

## Workflow

Work happens on a feature branch with a pull request into `main`, merged with "Create a merge commit".