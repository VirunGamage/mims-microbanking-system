# MIMS QA User Guide — Verified against the running app

**Author:** Sameera  
**System:** B-Trust MIMS  
**Audience:** QA testers, branch agents, and viva reviewers  

---

## 1. The app has 7 screens, not 2

The UI currently includes these pages in the app shell:

1. Home
2. Customers
3. Open Account
4. Transactions
5. Fixed Deposits
6. Reports
7. Data checks (Tester view only)

The top bar includes:
- Acting as: agent selector
- View: Agent / Tester switch
- Branch open/closed status indicator

This is the current structure the QA guide must match.

---

## 2. Business rules currently enforced in the app

The live app and the SQL procedures enforce the following rules.

### Business hours
- Savings account opening and transaction work are only accepted Monday to Friday during business hours.
- The exact database message is:
  - "Transactions are only accepted Mon-Fri during business hours"
- This is enforced by the database, not just by the UI.

### Customer NIC rule
- Any customer aged 18 or over must have an NIC.
- The actual browser and database message is:
  - "NIC is required for customers aged 18 or over"

### Joint account rule
- A joint account must have two different customers.
- The actual validation message is:
  - "Joint holders must be two different customers"

### Opening deposit rule
- A deposit must be greater than zero.
- An opening deposit must also meet the plan minimum.
- The actual database message is:
  - "Opening deposit is below the plan minimum balance"

---

## 3. Savings plan values as they appear in the running app

The runtime values are taken from the database and verified in the app and schema.

| Plan | Age band / case | Interest rate | Minimum balance |
|---|---|---:|---:|
| Children | age <= 12 | 12.00% | 0.00 |
| Teen | age 13 to 17 | 11.00% | 500.00 |
| Adult | age 18 to 59 | 10.00% | 1000.00 |
| Senior | age 60+ | 13.00% | 1000.00 |
| Joint | second holder present | 7.00% | 5000.00 |

Important detail:
- The app does not call these values "Minor Savings".
- The stored procedure selects the plan based on the primary holder's age unless a second holder is provided, in which case it uses the Joint plan.

---

## 4. Customer management flow

### Search and view
1. Open Customers.
2. Search by customer name, NIC, phone number, or customer ID.
3. Select a customer to view the profile and account list.

### Register a new customer
1. Click Register a new customer.
2. Fill in first name, last name, DOB, and address.
3. If age is 18 or over, the NIC field is required.
4. The browser shows the same message as the database:
   - "NIC is required for customers aged 18 or over"
5. Submitting without the NIC is blocked before the DB accepts the record.

This matches the SQL trigger on CUSTOMER insert/update.

---

## 5. Open Account flow

### Step-by-step
1. Go to Open Account.
2. Choose the primary customer.
3. If the account is joint, tick Joint account and choose a second holder.
4. The app validates the pair and rejects the same customer twice with:
   - "Joint holders must be two different customers"
5. The plan preview is calculated automatically:
   - Joint when a second holder exists
   - otherwise, by the primary holder's age
6. Enter the opening deposit.
7. The amount must be greater than zero and must meet the selected plan minimum.

### Example plan preview values
- Child customer, single account: Children plan, 12.00%, minimum 0.00
- Teen customer, single account: Teen plan, 11.00%, minimum 500.00
- Adult customer, single account: Adult plan, 10.00%, minimum 1000.00
- Senior customer, single account: Senior plan, 13.00%, minimum 1000.00
- Joint account: Joint plan, 7.00%, minimum 5000.00

---

## 6. QA checks that match the real app

These are the checks to use in the viva or review.

### Check 1: adult without NIC
- Register a customer who is 18+ and leave NIC blank.
- Expected result:
  - "NIC is required for customers aged 18 or over"

### Check 2: opening amount below minimum
- Try opening an Adult account with 200.00.
- Expected result:
  - "Opening deposit is below the plan minimum balance"

### Check 3: same person on joint account
- Choose the same customer for both holders.
- Expected result:
  - "Joint holders must be two different customers"

### Check 4: business-hours refusal
- Attempt opening or deposit while outside Mon-Fri 09:00-16:00.
- Expected result:
  - "Transactions are only accepted Mon-Fri during business hours"

### Check 5: plan preview is age-based
- Use the app to confirm the plan names and boundaries in the live UI.
- Verify the exact age ranges before the guide is called correct.

---

## 7. Final note for the viva

The main correction is that the QA guide was describing an older version of the business rules. The verified app uses:
- Children / Teen / Adult / Senior / Joint plans
- actual rate values 12.00 / 11.00 / 10.00 / 13.00 / 7.00
- minimum balances 0.00 / 500.00 / 1000.00 / 1000.00 / 5000.00
- exact messages from the database and the browser checks
- the actual seven-page app structure in the current UI

That is the version the viva should describe and the review should approve.
