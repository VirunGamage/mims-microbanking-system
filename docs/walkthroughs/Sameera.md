# MIMS Walkthrough — Customer Management & Account Opening

**Owner:** Sameera  
**Module:** Customers & Account Opening  

My part of the project is everything to do with bringing a customer into the system and opening their first savings account — the sample data, the API helpers, the browser-side validation rules and their unit tests, and the two UI pages.

---

## 1. Files I Own

| Layer | File | What it does |
|---|---|---|
| Sample data | `sample-data/01_branches_agents_customers.sql` | Inserts the three branches, five agents and fifteen sample customers. |
| Sample data | `sample-data/02_savings_accounts_holders.sql` | Inserts the thirteen savings accounts and links each one to its holder(s). Sets `next_interest_date = '2026-10-01'` on every account so that interest posting works immediately on a fresh load. |
| API helpers | `frontend/src/api/customers.js` | Four functions: search customers, load one customer's profile and accounts, register a new customer, and open a savings account. Each one builds the right URL or request body and returns the JSON the page needs. |
| Validation rules | `frontend/src/utils/accountRules.js` | Browser copies of the rules the database also enforces: calculate age from date of birth, decide which savings plan fits that age, check that an adult has a NIC, and check that the opening deposit meets the plan minimum. |
| Unit tests | `frontend/test/accountRules.test.js` | Fifteen Node.js tests that run with `npm test` in the `frontend/` folder. They cover age calculation edge cases, NIC requirements for adults and minors, plan selection at the three age boundaries, and minimum-deposit checks. All fifteen pass. |
| Shared component | `frontend/src/components/customers/CustomerPicker.jsx` | A reusable live-search field. As the agent types, it calls `/api/customers?search=...` and shows a dropdown of matches. Used on both pages. |
| Customers page | `frontend/src/pages/Customers.jsx` | Lets an agent search for customers, view a customer's details and all their accounts in one panel, or open the registration form. All state lives in URL parameters (`?q=`, `?customer=`, `?new=1`) so the browser back button and bookmarks work. |
| Account opening page | `frontend/src/pages/OpenAccount.jsx` | Lets an agent pick a primary holder (and an optional joint holder), shows a live plan preview with the interest rate and minimum deposit, and submits to `PROC_OPEN_SAVINGS_ACCOUNT`. |
| Styles | `frontend/src/styles/customers.css` | Styles the plan preview card and the customer picker dropdown. |
| SQL tests | `tests/test_fd_procs.sql` | Tests for the fixed deposit open and close procedures. Covers business-hours enforcement, plan-rate locking, balance deduction, the one-FD-per-account rule, early closure, and the primary-holder-only close rule. |

---

## 2. What I Show in the Demo (about 2 minutes)

**Search and view a customer.** I type `wilson` in the search box. The page calls `/api/customers?search=wilson`, gets back up to twenty matches, and I click Ethan Wilson (age 16) to open his profile and see his account.

**Register a new customer.** I click *Register new customer*, fill in Nimal Perera with date of birth 1994-03-12, and leave the NIC box empty. The form stops with "NIC is required for customers aged 18 or over." I explain that `accountRules.js` catches this in the browser for instant feedback, but the database trigger `trg_customer_bi` enforces the same rule at the SQL level — so even a direct INSERT with no NIC is refused. I add NIC `199407201234` and submit. Nimal is saved under Alice Smith's branch.

**Open a savings account.** I go to Open Account, pick Nimal, and type 50,000 as the opening deposit. The plan preview shows Adult Savings — I point out that I never selected a plan; the page reads the customer's age and picks the matching plan from the database. I click *Open Account*. The stored procedure `PROC_OPEN_SAVINGS_ACCOUNT` runs one atomic transaction that creates the account, links Nimal as the primary holder, and posts the opening deposit. If any of those three steps fails, none of them are saved. The success card shows the new account number, the transaction reference, and the plan.

*If the demo is outside Monday–Friday 09:00–16:00,* the procedure refuses with a business-hours message. I say that the rule lives in the procedure, not the page, which is why changing the UI alone cannot bypass it.

---

## 3. Questions I Expect and How I Answer Them

**How does a registration with no NIC fail?**  
In two places independently. `customerFormErrors()` in `accountRules.js` calls `ageFromDob(dob)` and, if the result is 18 or over and `nic` is blank, returns an error attached to the NIC field. If somehow the form data reaches the API anyway, the trigger `trg_customer_bi` recalculates the age with `TIMESTAMPDIFF(YEAR, dob, CURDATE())` and signals SQLSTATE 45000, which the backend turns into a 422 response.

**Why does the page show a plan before the account is created?**  
`expectedPlan(age)` in `accountRules.js` maps age to Minor, Adult, or Senior and looks up the matching minimum deposit and rate from constants that mirror the `SAVINGS_PLAN` table. It is only a preview; the stored procedure selects the real plan ID from `SAVINGS_PLAN` at the moment of execution, so the database is always authoritative.

**How are joint accounts stored?**  
A joint account uses `SAVINGS_PLAN` ID 5. Both holders are rows in `ACCOUNT_HOLDER` with the same `account_id` — one has `role = 'PRIMARY'` and the other `role = 'SECONDARY'`. The procedures that change the account (open an FD, close it early) check that the requesting customer is the PRIMARY holder before they proceed.
