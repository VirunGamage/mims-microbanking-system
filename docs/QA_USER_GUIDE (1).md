# MIMS QA User Guide

**Author:** Sameera
**System:** B-Trust Microbanking and Interest Management System (MIMS)
**For:** QA testers and branch agents

This guide shows how to use each screen of the MIMS web app to check the requirements in the SRS. Every rule is enforced by the MySQL database (stored procedures and triggers); the pages only send requests and show the database's answer. The expected values below were checked on a freshly loaded database.

---

## 1. Before you start

1. **Load fresh sample data** (Command Prompt on Windows, from the repository folder): `mysql -u root -p < scripts/load_all.sql`. It ends by printing 15 customers, 13 accounts, 10 fixed deposits and 230 transactions. Testing changes data, so reload before every test round.
2. **Start the app:** `npm run dev` in `backend/`, then `npm run dev` in `frontend/`, and open http://localhost:5173.
3. **Acting as** (top bar): choose the agent who is doing the work. Only ACTIVE agents are listed. A new customer is registered at that agent's branch, and every deposit, withdrawal and fixed deposit records that agent.
4. **View** (top bar): *Agent* shows the everyday pages. *Tester* also shows the **Data checks** page and, under every page, a *What was sent / what the database returned* panel with the procedure name, its parameters and the values it returned. No SQL errors or stack traces are ever shown.
5. **Branch open / Branch closed** (top bar): the database decides this from its own clock. Deposits, withdrawals, new accounts and new fixed deposits are accepted only **Monday to Friday, 09:00–16:00** (database time). Outside those hours the procedures refuse them; see section 9.

---

## 2. Home (`/`)

Shows whether the branch is open, the database clock, and the rules read from the database (`SYSTEM_CONFIG`, `SAVINGS_PLAN`, `FD_PLAN`):

| Savings plan | Yearly rate | Minimum balance |
|---|---|---|
| Children (age 0–12) | 12% | LKR 0.00 |
| Teen (13–17) | 11% | LKR 500.00 |
| Adult (18–59) | 10% | LKR 1,000.00 |
| Senior (60+) | 13% | LKR 1,000.00 |
| Joint (any age, two holders) | 7% | LKR 5,000.00 |

| Fixed deposit term | Days | Yearly rate |
|---|---|---|
| 6 months | 180 | 13% |
| 1 year | 360 | 14% |
| 3 years | 1,080 | 15% |

Other rules: at most LKR 100,000.00 withdrawn per account per day; deposits above LKR 1,000,000.00 are accepted and flagged for review; savings and fixed deposit interest are paid every 30 days (amount × yearly rate × 30 ÷ 365).

**Check:** the tables above match the Home page.

---

## 3. Customers (`/customers`) — REQ-CUS-01, REQ-CUS-07, REQ-BRA-05

**Search:** type part of a name, a NIC, a phone number or a customer ID and press **Search**. Up to 50 customers are listed (newest first when the box is empty). Choose one to see their details and accounts.

**Register:** press **Register a new customer**. First name, last name and date of birth are required. NIC, phone, e-mail and address are optional, except that a NIC is required from age 18. The NIC is up to 12 characters and must be unique; the app checks no other format. The customer is registered at the branch of the agent in *Acting as*.

| Test | Steps | Expected result |
|---|---|---|
| Search | Search `wilson` | Ethan Wilson, ID 4, age 16, no NIC |
| Required fields | Press **Save customer** with an empty form | "First name is required", "Last name is required", "Date of birth is required" beside the fields |
| Future date of birth | Date of birth in the future | "Date of birth cannot be in the future" |
| Adult without NIC | Nimal Perera, born 1994-03-12, no NIC | "NIC is required for customers aged 18 or over" beside the NIC box; nothing saved |
| Duplicate NIC | Same customer with NIC `199210300100` (James Anderson's) | "A customer with this NIC is already registered" beside the NIC box |
| Successful registration | Same customer with NIC `199407201234` | *Customer registered* card with the new customer ID, registered at Central Branch by Alice Smith |
| Child without NIC | Kavya Perera, born 2019-02-01, no NIC | Saved; the NIC hint says it is not required yet |

The database checks the same rules again in the trigger `trg_customer_bi` (date of birth, NIC from 18, an ACTIVE registering agent at their own branch), so a direct INSERT that breaks them is refused too.

---

## 4. Open account (`/open-account`) — REQ-CUS-02 to REQ-CUS-05, REQ-HIS-03

1. **Primary holder:** type a name, NIC or ID, press **Find**, and choose the customer.
2. **Joint account:** tick *Joint account (add a second holder)* and choose the second holder. The primary holder is not offered again, so the two holders are always different people.
3. **Expected plan:** the database picks the plan; you never choose it. It is Joint when there is a second holder, otherwise it follows the primary holder's age.
4. **Opening deposit:** more than zero and at least the plan's minimum balance.
5. Press **Open account**. `PROC_OPEN_SAVINGS_ACCOUNT` creates the account, its holders and the opening deposit in one step: all of it is saved, or none of it.

| Test | Steps | Expected result |
|---|---|---|
| Plan from age | Choose Mia Davis (7) | Expected plan: Children, 12%, minimum LKR 0.00 |
| Below the minimum | Sophia Thomas (31), opening deposit 500 | "Opening deposit must be at least LKR 1,000.00 for the Adult plan" |
| Individual account | Sophia Thomas, 50,000 | *Account opened*: SA0000014, Adult (10% a year), opening balance LKR 50,000.00, a TXN reference |
| Joint below the minimum | Lucas Thompson + Benjamin Jackson, 4,000 | "Opening deposit must be at least LKR 5,000.00 for the Joint plan" |
| Joint account | Same holders, 10,000 | *Account opened*: SA0000015, Joint (7% a year), holders Lucas Thompson (primary) and Benjamin Jackson (second holder) |

---

## 5. Transactions (`/transactions`) — REQ-TXN-01 to REQ-TXN-09, REQ-HIS-02

Choose an account (account number, holder name or NIC). The page shows its balance, plan minimum and how much was withdrawn today, the deposit and withdrawal forms, and the **passbook**: every transaction, newest first, with the balance after each line worked out by the database.

| Test | Steps | Expected result |
|---|---|---|
| Deposit | SA0000014, deposit 10,000 | *Deposit recorded*, new balance LKR 60,000.00, a TXN reference; a new passbook line |
| Below the plan minimum | SA0000014, withdraw 60,000 | "This would take the balance below the plan minimum of LKR 1,000.00; at most LKR 59,000.00 can be withdrawn" |
| Withdrawal | SA0000014, withdraw 2,000 | *Withdrawal recorded*, new balance LKR 58,000.00 |
| Daily limit | SA0000001, withdraw 150,000 | "This would pass the daily limit of LKR 100,000.00; LKR 100,000.00 is left for today" |
| Large deposit | SA0000001, deposit 1,500,000 | *Deposit recorded* with "Above the large-deposit limit: saved and flagged for review." |
| Joint account | SA0000013 | Either holder can be chosen under *Holder taking the money out* |
| Passbook | Any account | The last balance in the passbook equals the account's balance at the top |

The page checks the plan minimum and the daily limit early, beside the field; `PROC_PROCESS_WITHDRAWAL` checks them again and has the final word.

---

## 6. Fixed deposits (`/fixed-deposits`) — REQ-FD-01 to REQ-FD-09

**Open:** choose the savings account, the holder asking (only the primary holder may open one), a term and an amount. The preview shows the interest per 30-day payout, the first payout date and the maturity date. Opening moves the amount out of the savings balance (FD_OPEN).

**List:** active fixed deposits first, with the next payout date and what has been paid so far. On fresh sample data the six active ones show *due, not posted yet*, because the interest job has not run.

**Close early:** press **Close early**, choose the holder asking, and confirm. The principal goes back to the savings account; the unfinished 30-day cycle earns nothing.

| Test | Steps | Expected result |
|---|---|---|
| One active FD per account | Choose SA0000012 | A note that it already has an active fixed deposit (FD 9) |
| Above the allowed amount | SA0000014 (balance 58,000 after section 5), 6 months, 60,000 | "At most LKR 57,000.00: the savings account must keep its LKR 1,000.00 minimum" |
| Open | Same, 20,000 | Preview about LKR 213.70 every 30 days; *Fixed deposit FD 11 opened*, SA0000014 balance now LKR 38,000.00 |
| Only the primary closes | FD 9, **Close early**, holder Harper Garcia | "Only the PRIMARY holder can close this Fixed Deposit" |
| Due payout first | FD 9, holder Lucas Thompson | The dialog warns that a payout is due; the database refuses: "Interest is due on this Fixed Deposit; post the interest before closing it" |
| Close | Run interest (section 8), then close FD 9 as Lucas Thompson | *FD 9 closed*; LKR 15,000.00 goes back to SA0000012 |

---

## 7. Reports (`/reports`) — REQ-RPT-01 to REQ-RPT-05

Each report is run by the database (a stored procedure, or the view for active fixed deposits). Every report has a chart, a table with the same numbers, and **Download CSV**.

Reload the database first: the Accounts and Active fixed deposits rows below count only the sample data.

| Report | Filter | Expected on fresh sample data |
|---|---|---|
| Agent activity | 1 Jan 2026 to 30 Sep 2026 | 5 agents; first row Carol Lee, North Branch, 6 transactions, LKR 158,145.54 |
| Accounts | Branch: Central Branch | 6 accounts (the branch of the primary holder's registration) |
| Active fixed deposits | — | 6 fixed deposits with their next payout dates |
| Monthly interest | June 2026 | Savings and FD interest per plan; first row Adult: savings LKR 1,260.45, FD LKR 1,458.90, total LKR 2,719.35 |
| Customer activity | 1 Jan 2026 to 30 Sep 2026 | 15 customers; first row Liam Brown, deposits LKR 1,266,000.00, withdrawals LKR 28,297.35 |

Note: in September 2026 the FD interest column is 0.00 until **Run interest** has posted the September payouts.

---

## 8. Data checks and Run interest (Tester view, `/data-checks`)

**Adults without a NIC** and **Accounts that have outgrown their plan** are the two known limitations, checked on demand. On the sample data both are empty, which is the correct answer.

**Run interest (testing only):** posts every payment due up to the chosen date, in the database's order: fixed deposit interest, then fixed deposits that have matured, then savings interest. It changes data; reload afterwards.

| Test | Steps | Expected result |
|---|---|---|
| Data checks | Open the page | "Nobody aged 18 or over is missing a NIC." and "Every account's plan still matches its primary holder's age." |
| First run | **Run interest…**, today's date, **Post interest** | Fixed deposit and savings payments are posted (on 12 Oct 2026: 7 fixed deposit payments, 0 matured, 13 savings payments; the numbers depend on the date) |
| No double posting | Run it again | 0, 0, 0 |

---

## 9. Outside business hours — REQ-TXN-03

Outside Monday to Friday 09:00–16:00 (database clock) the top bar says **Branch closed**, the forms show a note, and the database refuses deposits, withdrawals, new accounts and new fixed deposits with: "Transactions are only accepted Mon-Fri during business hours". The red box is titled *The branch is closed* and explains that this is the rule working, not a fault. Nothing is saved. Searching, the passbook, reports and Data checks still work.

Never change the business hours to make a test or a demo pass. Test the money actions on a weekday between 09:00 and 16:00.

---

## 10. After testing

Reload the database (`scripts/load_all.sql`). To check everything at once, run `mysql -u root -p --table < tests/run_all.sql`: the last line must say **ALL 166 CHECKS PASS**.
