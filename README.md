# MIMS — Microbanking and Interest Management System (B-Trust)

MIMS is the central database for B-Trust, a microfinance bank in Sri Lanka. It records branches and agents, customers, savings accounts (single and joint), fixed deposits and every money movement, and it posts interest every 30 days. **All business rules live in the MySQL database** (stored procedures, functions and triggers). The small web app in `backend/` and `frontend/` lets QA testers and branch agents use those rules; it never changes a balance by itself.

Group 27 — Database Systems project.

## What is in this repository

| Folder | What it holds |
|---|---|
| `sql/` | `mims_schema.sql`: the tables, keys, checks and the first triggers |
| `sample-data/` | Sample branches, agents, customers, accounts, fixed deposits and 230 transactions |
| `procedures/` | Stored procedures, functions, triggers, the daily interest event and the Data Checks views |
| `reports/` | The five management reports |
| `scripts/` | `load_all.sql` (rebuild the database), `create_app_user.sql` (the app's limited MySQL user), `smoke-test.mjs` (environment check) |
| `tests/` | `validate_sample_data.sql` (36 data checks), `run_all.sql` with the five SQL test files and their helpers |
| `backend/` | Node.js + Express API on port 3001: it only calls stored procedures and runs read-only queries |
| `frontend/` | React + Vite web pages on port 5173 |
| `docs/` | QA user guide, demo script, SRS revision notes, and a walkthrough of each person's files |
| `.github/workflows/` | `ci.yml`: the automatic checks that run on every push and pull request (see *Continuous integration*) |
| `Dockerfile`, `docker-compose.yml`, `docker/` | The two container images (the app, and MySQL with the MIMS database) and the file that starts both; see *Run with Docker* |

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

Then open **http://localhost:5173**. To stop either one, press `Ctrl + C` in its window.

**Check your setup** at any time with `node scripts/smoke-test.mjs` (run from the repository folder while both are running; it changes no data). Every line should say PASS or SKIP (SKIP = that part is not merged yet); a FAIL line says what to fix.

**Business hours are a rule, not a bug:** deposits, withdrawals, new accounts and new fixed deposits are only accepted Monday to Friday, 09:00–16:00 (database time).

## Tests

| What | Command | Needs |
|---|---|---|
| Sample-data checks (36) | `mysql -u root -p mims < tests/validate_sample_data.sql` | a freshly loaded database |
| SQL tests for every procedure, trigger, view and report (166 checks) | `mysql -u root -p --table < tests/run_all.sql` | MySQL (run from the repository folder) |
| Backend unit tests | `cd backend` then `npm test` | nothing else |
| Backend database tests (connection, report numbers) | `cd backend` then `npm run test:db` | MySQL, `backend/.env` |
| Frontend tests and build | `cd frontend` then `npm test` and `npm run build` | nothing else |

The data checks expect exactly 15 customers and 10 fixed deposits, so reload the database before running them if you have used the app.

**About the SQL tests.** Each test sets its own session clock to a fixed moment, so business hours, ages and interest dates give the same result at any time of day. `run_all.sql` loads the database, runs the five test files and loads the database again at the end (test transactions cannot be deleted), so it also wipes anything entered through the app. The last table must say `ALL 166 CHECKS PASS`. To run one file on its own, load `tests/_helpers.sql` first.

## Continuous integration (CI)

Every push to `main` and every pull request starts GitHub Actions (`.github/workflows/ci.yml`). It runs three jobs on a clean machine:

| Job | What it runs |
|---|---|
| Frontend tests and build | `npm ci`, `npm test` and `npm run build` in `frontend/` |
| Backend unit tests | `npm ci` and `npm test` in `backend/` |
| SQL tests (166 checks) | starts a fresh MySQL 8.0 service, runs `tests/run_all.sql`, and fails unless the result is `ALL 166 CHECKS PASS` |

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
| User experience | *User experience (UX)* |
| CI/CD | *Continuous integration (CI)* |
| Containerization | *Run with Docker* |
| E-mail notifications | *Email notifications* |

## Team Member Contributions (database)

| Person | Owns |
|---|---|
| Virun Gamage | Project lead: planning, design documents, PR reviews and merges. Schema (tables, keys, constraints, customer and agent triggers); account-opening and FD-opening procedures |
| Shanujah Sivakumar | Planning, PR reviews and merges. FD closure, maturity and interest-posting procedures with the daily event; one-active-FD and balance-guard triggers; payout-due check on FD close |
| Rookshi Suthakaran | Management reports, including separate savings and FD interest; registering-agent check in the customer trigger; transaction-immutability triggers; sample-data validator |
| Sureshkumar Archchuthan | Transaction and fixed-deposit sample data; interest-posting, trigger and report SQL tests |
| Sameera Senanayaka | Branch, agent, customer and account sample data; deposit and withdrawal procedures |

## AI contributions

An AI coding assistant drafted the web app (the Node.js/Express backend and the React frontend), the automated tests (SQL tests, backend and frontend tests), the database load and app-user scripts, the Data checks views, the smoke test, and drafts of the documents in `docs/`. Team members reviewed this work, ran and tested it against the database, and committed it under their own names; each can explain the parts below.

| Person | Reviewed, tested and committed |
|---|---|
| Virun Gamage | Repository setup and README; backend core and tests; customer and account API; frontend setup; smoke test; review fixes |
| Shanujah Sivakumar | Frontend core (design, shared components, page frame, Home); fixed deposits API and screens; deposit/withdrawal SQL tests |
| Rookshi Suthakaran | Reports and Data checks (API, screens, views); charts and CSV export; load/user scripts; account-opening tests and test runner |
| Sureshkumar Archchuthan | Transactions API, screen and passbook; report cross-check test |
| Sameera Senanayaka | Customers and account-opening screens, customer search and form rules; fixed-deposit SQL tests; QA guide; demo script |

## Overall contribution

**Agreed by the team:** Virun Gamage 26%, Shanujah Sivakumar 23%, Rookshi Suthakaran 19%, Sameera Senanayaka 16%, Sureshkumar Archchuthan 16%.

## Workflow

Work happens on a feature branch with a pull request into `main`, merged with "Create a merge commit".