# MIMS Walkthrough — Customer Management & Account Opening

**Owner:** Sameera (Customers & Account Opening Module Owner)  
**System:** B-Trust Microbanking and Interest Management System (MIMS)  

This document details my specific viva presentation walkthrough, technical architecture, and explanation notes for the Customer Management and Savings Account Opening modules in MIMS.

---

## 1. Summary of Ownership & Files

| Component / Layer | File Path | Description |
|---|---|---|
| **Sample Data** | [`sample-data/01_branches_agents_customers.sql`](file:///c:/Users/LapMart/Desktop/B-TRUST%20bank%20db/mims-microbanking-system/sample-data/01_branches_agents_customers.sql) | Initial sample data for Bank, Branches, Agents, and Customers. |
| **Sample Data** | [`sample-data/02_savings_accounts_holders.sql`](file:///c:/Users/LapMart/Desktop/B-TRUST%20bank%20db/mims-microbanking-system/sample-data/02_savings_accounts_holders.sql) | Initial sample data for Savings Accounts and Joint/Single Account Holders (with `next_interest_date`). |
| **API Client** | [`frontend/src/api/customers.js`](file:///c:/Users/LapMart/Desktop/B-TRUST%20bank%20db/mims-microbanking-system/frontend/src/api/customers.js) | Client API helpers for searching customers, loading profiles, registering customers, and opening accounts. |
| **Validation Rules** | [`frontend/src/utils/accountRules.js`](file:///c:/Users/LapMart/Desktop/B-TRUST%20bank%20db/mims-microbanking-system/frontend/src/utils/accountRules.js) | Browser-side business rules (Age calculation, NIC requirements, plan selection, minimum opening deposit). |
| **Unit Tests** | [`frontend/test/accountRules.test.js`](file:///c:/Users/LapMart/Desktop/B-TRUST%20bank%20db/mims-microbanking-system/frontend/test/accountRules.test.js) | 15 automated unit tests validating browser-side rules. |
| **UI Components** | [`frontend/src/components/customers/CustomerPicker.jsx`](file:///c:/Users/LapMart/Desktop/B-TRUST%20bank%20db/mims-microbanking-system/frontend/src/components/customers/CustomerPicker.jsx) | Auto-complete customer search picker component reusable across pages. |
| **UI Pages** | [`frontend/src/pages/Customers.jsx`](file:///c:/Users/LapMart/Desktop/B-TRUST%20bank%20db/mims-microbanking-system/frontend/src/pages/Customers.jsx) | Customers search, profile view, and customer registration modal. |
| **UI Pages** | [`frontend/src/pages/OpenAccount.jsx`](file:///c:/Users/LapMart/Desktop/B-TRUST%20bank%20db/mims-microbanking-system/frontend/src/pages/OpenAccount.jsx) | Savings account opening screen with automatic plan selection and joint account support. |
| **UI Styles** | [`frontend/src/styles/customers.css`](file:///c:/Users/LapMart/Desktop/B-TRUST%20bank%20db/mims-microbanking-system/frontend/src/styles/customers.css) | Plan preview and customer picker styling. |

---

## 2. Live Presentation Script & Speaking Steps (2 Minutes)

### Step 1: Customer Search & Profile View
1. Navigate to **Customers** (`/customers`).
2. Type `wilson` in the search box.
3. **Demonstrate:** The live search fetches up to 20 matching records from `/api/customers?search=wilson` and displays **Ethan Wilson (Age 16)**.
4. **Speaking Point:** *"The Customer page maintains its state in URL search parameters (`?q=`, `?customer=`), so browser navigation buttons work seamlessly and customer profiles can be directly bookmarked or linked."*

### Step 2: Registering a New Customer (Validation & Database Trigger Alignment)
1. Click **Register New Customer**.
2. Enter Name: **Nimal Perera**, Date of Birth: `1994-03-12` (Age 32), and **leave the NIC field empty**.
3. Click **Register Customer**.
4. **Demonstrate:** The form stops beside the NIC box with message: *"NIC is required for customers aged 18 or over."*
5. **Speaking Point:** *"The frontend validates rules early via `accountRules.js` for instant feedback. Crucially, the MySQL database enforces the exact same rule in trigger `trg_customer_bi`. Even if a user bypasses the browser and executes a direct SQL INSERT, the database will refuse it — as verified by our automated SQL tests."*
6. Enter NIC: `199407201234` and submit. Customer is successfully registered under Alice Smith's branch (Central Branch).

### Step 3: Opening a Savings Account (`/open-account`)
1. Navigate to **Open Account** (`/open-account`).
2. Select **Nimal Perera** using the `CustomerPicker`.
3. Enter Opening Deposit: **LKR 50,000.00**.
4. **Speaking Point:** *"Notice that we do not manually specify a savings plan. The stored procedure `PROC_OPEN_SAVINGS_ACCOUNT` automatically evaluates Nimal's age (32) and assigns the Adult Savings Plan. The creation of the savings account, account holder link, and initial deposit transaction are executed in a single atomic database transaction — if any step fails, the entire transaction is rolled back."*
5. Click **Open Account**. The success card displays the assigned Account Number (e.g. `SA0000014`), transaction reference, and Adult plan details.

*Note for Closed Branch (Outside Mon-Fri 09:00-16:00):*  
If the viva takes place outside business hours, stored procedure `PROC_OPEN_SAVINGS_ACCOUNT` will throw a 422 exception: *"Deposits and new accounts are accepted only during business hours."* State during the demo: *"This demonstrates the database enforcing business hour rules directly at the stored procedure level."*

---

## 3. Technical Architecture Questions & Answers

### Q1: How does the application ensure an adult cannot be registered without an NIC?
**Answer:** Validation happens in two layers:
1. **Frontend:** `customerFormErrors()` in `accountRules.js` checks if `ageFromDob(dob) >= 18` and requires `nic`.
2. **Database:** Before-INSERT trigger `trg_customer_bi` checks `TIMESTAMPDIFF(YEAR, dob, CURDATE()) >= 18` and throws `SQLSTATE '45000'` if `nic` is `NULL`.

### Q2: How are savings plans assigned when opening an account?
**Answer:** The frontend previews the plan using `expectedPlan(age)` (Minor $< 18$, Adult $18-59$, Senior $\ge 60$). However, the database is the authoritative source: `PROC_OPEN_SAVINGS_ACCOUNT` queries `SAVINGS_PLAN` and matches the plan ID based on customer age at the time of execution.

### Q3: How is joint account ownership represented in the database?
**Answer:** Joint accounts use `SAVINGS_PLAN` ID 5 ('Joint') and link two customer IDs in the `ACCOUNT_HOLDER` junction table with roles `'PRIMARY'` and `'SECONDARY'`.
