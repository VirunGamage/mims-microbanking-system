# MIMS demo script (about 12 minutes)

This document guides the team step-by-step through the 12-minute viva presentation of the MIMS application. It outlines each team member's speaking order, live UI actions (including searching customers, registering members, opening savings accounts, and transactions), and fallback procedures if the presentation takes place outside business hours.

Each person presents their own part, so everyone shows what they can explain. Sample data names are from a freshly loaded database.

## Before the viva (15 minutes earlier)

1. `mysql -u root -p < scripts/load_all.sql` — fresh sample data (15 customers, 13 accounts, 10 FDs, 230 transactions).
2. Start the backend (`npm run dev` in `backend/`) and the frontend (`npm run dev` in `frontend/`); open http://localhost:5173.
3. `node scripts/smoke-test.mjs` — every line PASS or SKIP.
4. In the app: **Acting as** Alice Smith (Central Branch), **View: Agent**.
5. Check the **Branch open / closed** light. If the viva is outside Monday–Friday 09:00–16:00, use the *closed branch* notes below: never change the hours for a demo.
6. Have a terminal ready in the repository folder for step 8.

## 1. What MIMS is — Virun (1 minute)

"MIMS is B-Trust's central database. Every rule lives in MySQL: 18 procedures and functions, 8 triggers and the CHECK constraints. The web app is a thin layer: the browser calls a small Express API, which only calls our procedures. Its database user, `mims_app`, can read, call procedures and add a customer, but it cannot change a balance or a transaction, even by mistake."

## 2. Home and customers — Shanuja, then Sameera (2 minutes)

- **Shanuja, Home:** the branch light comes from the database clock; the rules, plans and FD terms are read from `SYSTEM_CONFIG`, `SAVINGS_PLAN` and `FD_PLAN`, so the page always matches what the database enforces.
- **Sameera, Customers:** search `wilson` → Ethan Wilson, 16. Register *Nimal Perera*, born 1994-03-12, **without** a NIC → stopped beside the NIC box: *NIC is required for customers aged 18 or over*. "The page checks early; the database has the same rule in the trigger `trg_customer_bi`, so even a direct INSERT is refused — our SQL tests prove it." Add NIC `199407201234` → saved at Central Branch, Alice's branch.

## 3. Open an account — Sameera (1 minute)

Open an account for Nimal Perera with LKR 50,000. "We don't send a plan: the procedure picks Adult from his age. Account, holder and opening deposit are one transaction — if any step fails, nothing is saved." Show the card: SA number, TXN reference, plan Adult.

*Closed branch:* the database refuses with the business-hours message. Say: "This is the rule working: the procedure checks the database clock first." Then open SA0000007 (Sophia Thomas) on the Transactions page for step 4 instead.

## 4. Deposits, withdrawals and the passbook — Archchu (2 minutes)

On **Transactions**, choose the new account (or SA0000007):

1. Deposit 10,000 → *Deposit recorded*, new balance, reference.
2. Withdraw 60,000 → stopped beside the amount: the balance can't go below the Adult minimum of LKR 1,000. "The page checks the same rule early; the database has the final word."
3. Withdraw 2,000 → recorded.
4. The **passbook**: newest first, a running balance after every row, and the last balance equals the balance at the top. "The running balance is a window function over the transaction log, so it proves the stored balance equals the history."

*Closed branch:* show the passbook of SA0000013 (a joint account: two holders) and the *branch is closed* note above the forms.

## 5. Fixed deposits — Shanuja (2 minutes)

1. Open a 6-month FD of 20,000 from the new account (or SA0000007) → the savings balance drops by 20,000 (FD_OPEN); the preview showed LKR 213.70 every 30 days.
2. In the list, FD 9 (SA0000012) shows *due, not posted yet*. Press **Close early**: the dialog states the rule (the unfinished 30-day cycle is forfeited) and warns that a payout is due; the database refuses to close it until the interest is posted.
3. Cancel. "Only the primary holder can close it" — choose Harper Garcia (second holder) to show the refusal if time allows.

## 6. Interest and data checks — Rukshi (2 minutes)

1. Switch **View: Tester**. Open **Data checks**: both checks are empty for the sample data, which is the right answer; explain the two known gaps (NIC at 18, outgrown plans).
2. **Run interest** for today → confirm → FD payouts posted (FD interest, then maturity, then savings interest, in the database's own order). Run it again → 0, 0, 0: "each posting moves the due date on, so nothing is paid twice."
3. Back on Fixed deposits, FD 9 is no longer due; close it as Lucas Thompson → LKR 15,000 back to SA0000012. (Works in or out of hours: closing has no hours check today, a known gap.)
4. The *What was sent / what the database returned* panel shows the procedure name, the parameters and the OUT values.

## 7. Reports — Rukshi (1 minute)

Agent activity from 1 January to 30 September 2026 (switch count/value), Monthly interest for September 2026, then **Download CSV** and open it in Excel. "Every chart has the same numbers in a table underneath; the numbers are cross-checked against the transaction log by a database test."

## 8. How we know it works — Virun (1 minute)

In the terminal: `mysql -u root -p --table < tests/run_all.sql`. While it runs (a few seconds): "Each test pins its session clock to a fixed moment, so business hours, ages and interest dates are tested the same way at any time. To prove the tests would catch a mistake, we broke each rule on purpose in a throw-away copy — 68 breakages, all caught." Show the last line: **ALL 166 CHECKS PASS**. (It reloads the sample data at the end.)

## If something goes wrong

| What you see | What to do |
|---|---|
| *The branch is closed* | It's the rule; say so and continue with the closed-branch notes |
| *The server is not answering* | Start the backend again (`npm run dev` in `backend/`) |
| A number differs from this script | Someone used the app before the demo: reload the database (step 1 of the preparation) |
| The smoke test says FAIL | Read its "Fix:" line; it names the setting to change |
