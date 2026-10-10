# SRS v3.1 revision — replacement text

<!-- The replacement text for every passage of the SRS, the Briefing, the Viva Guide and the design documents that describes the system before the procedures and the app were built, so the documents can be regenerated from it. -->

The SRS v3.0 (24 September 2026), the Briefing, the Viva Guide and the design documents describe the system before the procedures and the app existed. This file gives the replacement text for every outdated passage, so the PDFs can be regenerated as **v3.1**. Each numbered section is one commit. Numbers in this file were checked against the repository and a freshly loaded database (MySQL 8.0.46).

**Facts the new text relies on** (all verifiable with `scripts/load_all.sql` and `tests/run_all.sql`):

| Item | v3.0 said | Now |
|---|---|---|
| Tables | 11 | 13: the 11 business tables, plus `TXN_REF_SEQ` and `ACCOUNT_NO_SEQ`, which hand out reference and account numbers |
| Triggers | 3 | 8: `trg_customer_bi`, `trg_customer_bu`, `trg_transaction_bi`, `trg_agent_branch_lock` (schema); `trg_single_active_fd`, `trg_savings_balance_guard` (procedures/04); `trg_transaction_bu`, `trg_transaction_bd` (procedures/05) |
| Routines | not yet written | 18 (procedures and one function), 3 views, 1 event (created disabled) |
| Sample transactions | about 150 | 230 |
| Validator checks | 33 (SRS) / 34 (Briefing, Viva Guide) | 36 |
| Tests | — | 166 SQL checks in `tests/` and 18 database checks in `backend/test/integration/`; every rule was also broken on purpose to prove its test fails (68 breakages, all caught) |
| QA UI | Python/Streamlit, no API tier | React web pages + a thin Node.js/Express API that only calls the database's procedures |

---

## 1. SRS revision history (front matter)

**Add a row:**

| Name | Date | Reason for changes | Version |
|---|---|---|---|
| Group 27 | *date of the commit* | Aligned with the implemented system: the QA UI is a React web app with a thin Node.js/Express API tier (it only calls the database's procedures); procedures, functions, triggers, views and tests are implemented; counts updated (13 tables, 8 triggers, 230 sample transactions, 36 validation checks); requirement wording aligned with the implementation. Full list in Appendix E. | 3.1 |

**Why:** the Viva Guide (§17) and TBD item 7 promised that any change to the UI's scope would be recorded here.

## 2. SRS §2.4 Operating Environment

**Replace** "It is accessed via SQL and, for QA purposes, through a lightweight desktop or web-based UI (Python with Streamlit) communicating with the database over a standard client driver."

**With:** "It is accessed via SQL and, for QA purposes, through a lightweight web application: React pages served by Vite (port 5173) in the browser, and a small Node.js (24 LTS) + Express API (port 3001) that connects to MySQL with the `mysql2` driver as a limited database user (`mims_app`). Both run on the tester's own computer. The system was tested on MySQL 8.0.46 with Node.js 24 and 22."

## 3. SRS §3.1 User Interfaces

**Replace the paragraph with:**

"The lightweight UI is a web application with two views: an **Agent view** for the everyday tasks and a **Tester view** that adds a *What was sent / what the database returned* panel and a Data Checks page. A header shows the agent the user is acting as (only ACTIVE agents are offered) and whether the branch is open. The screens are: (a) Home: the business rules in plain words, read from `SYSTEM_CONFIG`, `SAVINGS_PLAN` and `FD_PLAN`; (b) Customers: search, details with accounts, and registration; (c) Open account: individual or joint (two holders); the database chooses the plan from the primary holder's age (Joint when there is a second holder), and the screen shows the plan it expects; (d) Transactions: deposit and withdrawal with immediate balance and limit feedback, and a passbook with a running balance; (e) Fixed deposits: opening, the list with the next payout date, and early closure with a dialog that states the forfeiture rule; (f) Reports: the five management reports, each with its filters (date range, branch, or month), a chart, a table and CSV export; (g) Data checks (Tester view): the two known-gap queries and a QA-only interest run. Error messages from constraints, procedures and triggers (e.g. "Withdrawal would take the balance below the plan minimum") are shown in plain language beside the field they concern, never as SQL error codes."

**Why:** the screens grew as TBD 7 allowed, and §3.1(b) said "plan selection" although `PROC_OPEN_SAVINGS_ACCOUNT` has no plan parameter: the database picks the plan.

## 4. SRS §3.3 Software Interfaces

**Replace the paragraph with:**

"The browser cannot connect to MySQL directly, so a thin API tier sits between them: the React pages call a Node.js/Express API over HTTP/JSON, and the API calls the database through the `mysql2` connector. The API holds no business rules. It only (a) calls the stored procedures (deposit, withdrawal, account opening, FD opening and closing, interest posting, reports), (b) runs read-only `SELECT` statements for look-ups and lists, and (c) inserts a new customer with one parameterised `INSERT` (the customer triggers still check it). It connects as `mims_app`, a database user that may only `SELECT`, `EXECUTE` routines and `INSERT` into `CUSTOMER`, so it cannot change a balance or a transaction even by mistake. All business logic that must guarantee correctness and ACID properties stays inside the database as procedures, functions and triggers; the database is still the backend for every rule."

## 5. SRS §3.4 Communications Interfaces

**Replace the first sentence with:** "For this academic submission the browser, the API and the database run on the same machine: the browser talks to the API over HTTP on `localhost` (the Vite development server forwards `/api` to port 3001), and the API talks to MySQL over its standard TCP protocol on `127.0.0.1:3306`; no external network, e-mail or web-service communication is required." (Keep the TLS sentence.)

## 6. Requirement wording (§4)

| Requirement | Replace | With |
|---|---|---|
| REQ-CUS-04 | "matches the selected plan's eligibility" | "decides the plan: `PROC_OPEN_SAVINGS_ACCOUNT` chooses Children, Teen, Adult or Senior from the PRIMARY holder's age on the opening day (bands in `SYSTEM_CONFIG`), and Joint when a second holder is given; Joint accounts are not age-restricted" |
| REQ-CUS-05 | "The system shall enforce, via a trigger, that a Joint Savings Account has at least two linked customers…" | "The account-opening procedure shall link exactly one PRIMARY holder, plus exactly one SECONDARY holder for a Joint account, and shall finish by checking (`PROC_VERIFY_JOINT_HOLDERS`) that a Joint account has at least two holders, rolling back the whole opening otherwise. A trigger cannot do this check, because holders are inserted one at a time. The application's database user cannot add holders directly." |
| REQ-BRA-05 (last sentence) | — | Add: "For branch transactions this is enforced by `trg_transaction_bi`; for customer registration it is enforced by `trg_customer_bi` (and checked first by the API)." |
| REQ-TXN-04 | "…that is not accompanied by a corresponding TRANSACTION insert within the same transaction scope." | "…unless the change comes from one of the balance procedures: `trg_savings_balance_guard` refuses any balance change while the session flag `@allow_balance_update` is not set, and the procedures set it only around their own balance update, inside the same database transaction that inserts the matching TRANSACTION row." |
| REQ-TXN-05 | — | Add: "Enforced by `trg_transaction_bu` and `trg_transaction_bd`, which refuse every UPDATE and DELETE on `TRANSACTION`." |
| REQ-FD-06 | — | Add: "`PROC_PROCESS_FD_MATURITY` does this; it runs after the FD interest posting, so the last payout (on the maturity date) is posted first." |
| REQ-RPT-05 | "net balance" | "net change (deposits minus withdrawals in the period); a joint account's transactions count for each of its holders" |

**§2.7 "Joint accounts"** — replace "has two or more customers as joint holders" with "has two customers as joint holders (one PRIMARY, one SECONDARY)", and in the Glossary entry *Joint Account* replace "two or more" with "two". BR-05 ("at least two") stays true as written.

## 7. SRS §5.3 NFR-SEC-03

**Replace with:** "NFR-SEC-03: Role-based access shall distinguish an administrative/DBA role (full schema access, used to load the database and run the tests) from the application role `mims_app`, which has `SELECT` and `EXECUTE` on the `mims` schema and `INSERT` on `CUSTOMER` only. It cannot update or delete any row, so balances and transactions change only through the procedures (NFR-SEC-01)."

**Why:** the app needs to read tables for look-ups and to register customers, which is more than "execute-only and read-only on reporting views".

## 8. SRS §6.1 and §6.2

- §6.1, last bullet: replace "joint-holder counts" with "(the joint-holder count is checked by a procedure, see REQ-CUS-05)", and add "immutability of `TRANSACTION`, and that an agent record never changes branch".
- §6.2, second bullet: replace "(a) automatic transaction logging where not already handled inline by the procedure" with "(a) refusing any change to a logged transaction (logging itself is done inline by each procedure)".
- §6.2, third bullet: replace with "A stored function (`FUNC_CALC_INTEREST`) holds the one interest formula used by every posting. Balance reconstruction from the transaction log is done by the validation script and the tests (every account's balance must equal the signed sum of its transactions)."

## 9. Sample-data numbers (SRS §6.4 and Appendix D row 17)

- §6.4: replace "(the data set contains about 150)" with "(the data set contains 230)".
- Appendix D row 17: replace "(about 150 in the data set) … validation script has 33 checks" with "(230 in the data set) … validation script has 36 checks".

## 10. Appendix B

- Replace "procedures, functions and further triggers are being developed as the next deliverable" with "the procedures, functions, triggers, views and the daily interest event are implemented in `procedures/` and `reports/`".
- **SAVINGS_ACCOUNT**: add the row `next_interest_date | date | | yes | | the next savings-interest due date; set to open date + 30 days at opening and moved on by each posting`, and the index `idx_account_status_interest (status, next_interest_date)`.
- Add a short note: "Two helper tables, `TXN_REF_SEQ` and `ACCOUNT_NO_SEQ`, hand out reference numbers and account numbers through AUTO_INCREMENT. They are not part of the business model." (Regenerate the tables from the running database, as decided in Viva Guide §1.)

## 11. Appendix C (TBD list), item 7

**Replace with:** "7. ~~Final depth of the lightweight QA UI.~~ **Resolved in v3.1:** a web app with an Agent view and a Tester view covering every operation, the five reports with charts and CSV export, and the two data checks (see §3.1)."

## 12. Appendix D row 18, and a new Appendix E

- Row 18: replace "(Python); no API tier" with "(Python at the time of v3.0; replaced in v3.1 by a React web app with a thin Node.js/Express API, see Appendix E)".
- **Add Appendix E, "Change log: v3.0 to v3.1"**, one row per section of this file (2–11), each with the area and a one-line summary.

## 13. Project Briefing

- **§1**, replace "plus one lightweight QA screen in Python that calls the database directly. There is no separate API tier. The depth of the QA screen is flexible…" with: "plus a lightweight QA web app: React pages and a thin Node.js/Express API that only calls the database's procedures. The app has an Agent view and a Tester view."
- **§2**: "11 tables" → "11 business tables (plus two helper tables for reference and account numbers)"; "one PRIMARY, one or more SECONDARY holders" → "one PRIMARY and one SECONDARY holder".
- **§3 Files**: validator "34 read-only checks" → "36"; add rows for `procedures/`, `reports/`, `scripts/load_all.sql`, `tests/run_all.sql`, `backend/`, `frontend/`, `docs/`.
- **§4 Next steps**: replace with: "1. Each member merges their slice (see START_HERE). 2. Run `tests/run_all.sql` (ALL 166 CHECKS PASS) and the validator (36 PASS). 3. Apply the proposed SQL changes in the owners' own commits. 4. Rehearse the demo (`docs/DEMO_SCRIPT.md`)."

## 14. Viva Guide

- **Part 1, first bullets**: "11 tables and 3 triggers" → "13 tables (11 business + 2 helper) and 8 triggers"; "all 34 checks pass" → "all 36 checks pass on the sample data (230 transactions)".
- **Part 1, "honest gaps"**: delete "Procedures, functions and most triggers … are specified in the SRS but not yet written" and "The QA UI is not started". Replace "about 150 transactions" with "230 transactions". Add the current honest gaps: the two data checks (NIC at 18, outgrown plans) are on-demand only; closing an FD does not check business hours; the daily interest event is created disabled (the Tester view's Run interest does the same three steps).
- **§15, last sentence**: replace "Today this is a rule for procedures; the database does not yet block UPDATE or DELETE on this table (a protecting trigger is planned)." with "Two triggers (`trg_transaction_bu`, `trg_transaction_bd`) refuse every UPDATE and DELETE on this table, and the app's database user has no UPDATE or DELETE rights at all."
- **§17 Decision**: replace "a lightweight QA UI in Python. The UI calls the database directly; there is no separate API tier." with "a lightweight QA web app: React pages and a thin Node.js/Express API. The API only calls the procedures, reads, and registers customers; it connects as `mims_app`, which cannot change balances." Keep the sentence about flexible scope and add "(recorded as SRS v3.1)".
- **§17 "Where is the backend?"**: new answer: "The rules are in the database: procedures, functions and triggers. The Node server is only a pass-through, because a browser cannot talk to MySQL directly; it calls the procedures and returns their answer, and its database user isn't even allowed to edit a balance."
- **§18**: "passes all 34 validation checks" → "passes all 36 validation checks; 166 SQL test checks and 18 database checks pass, and each test was shown to fail when its rule was deliberately broken (68 breakages)".
- **Part 4 table**: "How do you stop two ACTIVE FDs on one account?" → "The opening procedure checks it, and `trg_single_active_fd` refuses a second ACTIVE FD even on a direct insert (two layers)." "What is not finished?" → "Nothing required; the known gaps are listed in Part 1." "How does an FD affect the savings balance?" → drop "(the procedures will guarantee it…)" and say "the procedures guarantee it and the tests check every account".

## 15. ERD, Data Dictionary and Schema-vs-ERD Audit

- ERD and Data Dictionary: add `SAVINGS_ACCOUNT.next_interest_date` (date, nullable) and its index; mention the two helper tables in a note (not as entities).
- Data Dictionary §2.11 and §3, Audit §5: replace each "not yet written" statement with the implemented routine's name (see the table at the top of this file).

## 16. GitHub repository "About" text

**Replace** "…MySQL and Python/Streamlit…" **with:** "MIMS: the central MySQL 8.0 database for B-Trust microfinance (Sri Lanka) — schema, stored procedures, triggers, reports and tests — with a QA web app (React + a thin Node.js/Express API)."
