-- Rebuilds the whole mims database from the repo files, in the only order that works. Owner: Rukshi.
-- Run from the repository root:  mysql -u root -p < scripts/load_all.sql   (on Windows use Command Prompt, not PowerShell)
-- WARNING: this drops and recreates the mims database, so anything added through the app is lost.
-- This script rebuilds the MIMS database by loading the schema, sample data, procedures, triggers, gap queries, and management reports in the required order.

SOURCE sql/mims_schema.sql;
USE mims;

-- Sample data goes in before the procedures and triggers, because trg_savings_balance_guard would block
-- the balance fix-up UPDATE at the end of 03_transactions.sql.
SOURCE sample-data/01_branches_agents_customers.sql;
SOURCE sample-data/02_savings_accounts_holders.sql;
-- 04 before 03: transactions point at fixed deposits (foreign key fk_txn_fd), so the FDs must exist first.
SOURCE sample-data/04_fixed_deposits.sql;
SOURCE sample-data/03_transactions.sql;

SOURCE procedures/01_deposit_withdrawal.sql;
SOURCE procedures/02_open_savings_account.sql;
SOURCE procedures/03_fixed_deposit.sql;
SOURCE procedures/04_triggers.sql;
SOURCE procedures/05_transaction_immutability.sql;
SOURCE procedures/06_open_fixed_deposit.sql;
SOURCE procedures/07_interest_posting.sql;
SOURCE procedures/08_gap_queries.sql;
-- management_reports.sql has no USE mims; of its own, it relies on the USE above.
SOURCE reports/management_reports.sql;

-- Quick confirmation: expect 15 customers, 13 accounts, 10 fixed deposits and 230 transactions.
SELECT (SELECT COUNT(*) FROM CUSTOMER)        AS customers,
       (SELECT COUNT(*) FROM SAVINGS_ACCOUNT) AS accounts,
       (SELECT COUNT(*) FROM FIXED_DEPOSIT)   AS fixed_deposits,
       (SELECT COUNT(*) FROM `TRANSACTION`)   AS transactions;
