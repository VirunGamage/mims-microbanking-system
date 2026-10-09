-- Tests for the schema's triggers and checks, the gap views and the reports (sql/mims_schema.sql, procedures/04, 05 and 08,
-- reports/management_reports.sql). Owner: Archchu. The clock is pinned so ages are tested the same way on any day.
-- Run through tests/run_all.sql, or alone after tests/_helpers.sql:  mysql -u root -p --table < tests/test_triggers_and_reports.sql

-- This file checks whether the database triggers,validation rules,gap views, and reports work correctly.
-- It uses a fixed test time so date- and age-based checks give consistent results.


USE mims;
SET @suite = 'triggers_and_reports';
CALL mims_test.start_suite(@suite);

SET @need_nic  = 'NIC is required for customers aged 18 or over';
SET @dob_later = 'Date of birth cannot be in the future';

-- Test data, made on Monday 5 October 2026 at 10:00.
CALL mims_test.clock_at('2026-10-05 10:00:00');

INSERT INTO AGENT (first_name, last_name, status, branch_id) VALUES ('Test', 'Agent TR', 'ACTIVE', 1);
SET @agent = LAST_INSERT_ID();
INSERT INTO AGENT (first_name, last_name, status, branch_id) VALUES ('Test', 'On Leave TR', 'ON_LEAVE', 1);
SET @agent_on_leave = LAST_INSERT_ID();
INSERT INTO AGENT (first_name, last_name, status, branch_id) VALUES ('Test', 'Mover TR', 'ACTIVE', 1);
SET @agent_mover = LAST_INSERT_ID();

INSERT INTO CUSTOMER (first_name, last_name, NIC, DOB, registered_by_agent_id, registered_at_branch_id)
VALUES ('Test', 'Adult TR', mims_test.new_nic(), '1990-01-01', @agent, 1);
SET @adult = LAST_INSERT_ID();
INSERT INTO CUSTOMER (first_name, last_name, NIC, DOB, registered_by_agent_id, registered_at_branch_id)
VALUES ('Test', 'Teen TR', NULL, '2008-10-06', @agent, 1);                      -- 17 today, 18 tomorrow
SET @teen = LAST_INSERT_ID();
INSERT INTO CUSTOMER (first_name, last_name, NIC, DOB, registered_by_agent_id, registered_at_branch_id)
VALUES ('Test', 'Younger TR', NULL, '2010-01-01', @agent, 1);
SET @younger = LAST_INSERT_ID();

CALL PROC_OPEN_SAVINGS_ACCOUNT(@adult, NULL, 60000.00, @agent, @acc, @no, @acc_ref);
CALL PROC_OPEN_FIXED_DEPOSIT(@acc, @adult, (SELECT fd_plan_id FROM FD_PLAN WHERE term_name = '6_MONTH'), 40000.00, @agent, @fd, @ref, @bal);
CALL PROC_OPEN_SAVINGS_ACCOUNT(@teen, NULL, 1000.00, @agent, @teen_acc, @no, @ref);  -- Teen plan


-- TR01: a NIC is required from age 18 (trg_customer_bi)
CALL mims_test.expect_refusal(@suite, 'TR01', 'Registering an 18-year-old without a NIC is refused',
    "INSERT INTO mims.CUSTOMER (first_name, last_name, NIC, DOB, registered_by_agent_id, registered_at_branch_id)
     VALUES ('Test', 'Eighteen TR', NULL, '2008-10-05', @agent, 1)", @need_nic);
CALL mims_test.expect_ok(@suite, 'TR01', 'Registering a 17-year-old without a NIC is accepted',
    "INSERT INTO mims.CUSTOMER (first_name, last_name, NIC, DOB, registered_by_agent_id, registered_at_branch_id)
     VALUES ('Test', 'Seventeen TR', NULL, '2008-10-07', @agent, 1)");
CALL mims_test.expect_ok(@suite, 'TR01', 'Registering an adult with a NIC is accepted',
    "INSERT INTO mims.CUSTOMER (first_name, last_name, NIC, DOB, registered_by_agent_id, registered_at_branch_id)
     VALUES ('Test', 'With NIC TR', mims_test.new_nic(), '1970-01-01', @agent, 1)");

-- TR02: the same rule when a customer is changed (trg_customer_bu)
CALL mims_test.expect_refusal(@suite, 'TR02', 'Changing a date of birth so the customer is 18+ without a NIC is refused',
    "UPDATE mims.CUSTOMER SET DOB = '2000-01-01' WHERE customer_id = @younger", @need_nic);
CALL mims_test.expect_ok(@suite, 'TR02', 'The same change together with a NIC is accepted',
    "UPDATE mims.CUSTOMER SET DOB = '2000-01-01', NIC = mims_test.new_nic() WHERE customer_id = @younger");
CALL mims_test.expect_refusal(@suite, 'TR02', 'Removing an adult''s NIC is refused',
    "UPDATE mims.CUSTOMER SET NIC = NULL WHERE customer_id = @younger", @need_nic);

-- TR03: dates of birth
CALL mims_test.expect_refusal(@suite, 'TR03', 'A date of birth in the future is refused',
    "INSERT INTO mims.CUSTOMER (first_name, last_name, NIC, DOB, registered_by_agent_id, registered_at_branch_id)
     VALUES ('Test', 'Unborn TR', NULL, '2026-10-06', @agent, 1)", @dob_later);
CALL mims_test.expect_ok(@suite, 'TR03', 'A baby born today can be registered',
    "INSERT INTO mims.CUSTOMER (first_name, last_name, NIC, DOB, registered_by_agent_id, registered_at_branch_id)
     VALUES ('Test', 'Newborn TR', NULL, '2026-10-05', @agent, 1)");
CALL mims_test.expect_refusal(@suite, 'TR03', 'Changing a date of birth to the future is refused',
    "UPDATE mims.CUSTOMER SET DOB = '2027-01-01' WHERE customer_id = @adult", @dob_later);
CALL mims_test.expect_check_violation(@suite, 'TR03', 'A date of birth before 1900-01-01 is refused',
    "INSERT INTO mims.CUSTOMER (first_name, last_name, NIC, DOB, registered_by_agent_id, registered_at_branch_id)
     VALUES ('Test', 'Too Old TR', mims_test.new_nic(), '1899-12-31', @agent, 1)", 'chk_customer_dob_floor');

-- TR04: an agent record stays at its branch (trg_agent_branch_lock)
CALL mims_test.expect_refusal(@suite, 'TR04', 'Moving an agent to another branch is refused',
    "UPDATE mims.AGENT SET branch_id = 2 WHERE agent_id = @agent_mover",
    'An agent record cannot move branches; create a new agent record instead');
CALL mims_test.expect_ok(@suite, 'TR04', 'Changing an agent''s status (to TRANSFERRED) is accepted',
    "UPDATE mims.AGENT SET status = 'TRANSFERRED' WHERE agent_id = @agent_mover");

-- TR05: transactions are permanent (procedures/05_transaction_immutability.sql)
CALL mims_test.expect_refusal(@suite, 'TR05', 'Changing a transaction is refused',
    "UPDATE mims.`TRANSACTION` SET amount = amount + 1 WHERE reference_no = @acc_ref",
    'Transactions cannot be changed; post an offsetting transaction instead');
CALL mims_test.expect_refusal(@suite, 'TR05', 'Even an update that changes nothing is refused',
    "UPDATE mims.`TRANSACTION` SET amount = amount WHERE reference_no = @acc_ref",
    'Transactions cannot be changed; post an offsetting transaction instead');
CALL mims_test.expect_refusal(@suite, 'TR05', 'Deleting a transaction is refused',
    "DELETE FROM mims.`TRANSACTION` WHERE reference_no = @acc_ref",
    'Transactions cannot be deleted; post an offsetting transaction instead');
CALL mims_test.check_that(@suite, 'TR05', 'The transaction is still there, unchanged',
    (SELECT amount FROM `TRANSACTION` WHERE reference_no = @acc_ref) = 60000.00, CONCAT_WS(' ', 'reference', @acc_ref));

-- TR06: balances change only through the procedures (trg_savings_balance_guard)
SET @allow_balance_update = NULL;
CALL mims_test.expect_refusal(@suite, 'TR06', 'Changing a balance directly is refused',
    "UPDATE mims.SAVINGS_ACCOUNT SET balance = balance + 1.00 WHERE account_id = @acc",
    'Direct balance updates are not allowed; use a procedure');
CALL mims_test.expect_ok(@suite, 'TR06', 'Changing another column of the account is accepted',
    "UPDATE mims.SAVINGS_ACCOUNT SET status = 'ACTIVE' WHERE account_id = @acc");

-- TR07: one ACTIVE FD per account, even for a direct INSERT (trg_single_active_fd)
CALL mims_test.expect_refusal(@suite, 'TR07', 'A second ACTIVE FD inserted directly is refused',
    "INSERT INTO mims.FIXED_DEPOSIT (amount, interest_rate, start_date, maturity_date, status, next_payout_date, account_id, fd_plan_id)
     VALUES (1000.00, 13.00, '2026-10-05', '2027-04-03', 'ACTIVE', '2026-11-04', @acc, 1)",
    'This Savings Account already has an active Fixed Deposit.');

-- TR08: a BRANCH transaction needs an ACTIVE agent, even for a direct INSERT (trg_transaction_bi)
CALL mims_test.expect_refusal(@suite, 'TR08', 'A transaction inserted directly for an agent who is ON_LEAVE is refused',
    "INSERT INTO mims.`TRANSACTION` (transaction_type, amount, reference_no, channel, account_id, processed_by_agent_id)
     VALUES ('DEPOSIT', 100.00, CONCAT('TEST', UUID_SHORT()), 'BRANCH', @acc, @agent_on_leave)",
    'Processing agent is not ACTIVE');

-- TR09: only BRANCH transactions carry an agent (chk_txn_channel_agent), checked through the deposit procedure
CALL mims_test.expect_check_violation(@suite, 'TR09', 'An ONLINE deposit with an agent is refused',
    "CALL mims.PROC_PROCESS_DEPOSIT(@acc, 100.00, 'ONLINE', @agent, @ref, @bal)", 'chk_txn_channel_agent');
CALL mims_test.expect_check_violation(@suite, 'TR09', 'A BRANCH deposit without an agent is refused',
    "CALL mims.PROC_PROCESS_DEPOSIT(@acc, 100.00, 'BRANCH', NULL, @ref, @bal)", 'chk_txn_channel_agent');
CALL mims_test.expect_ok(@suite, 'TR09', 'An ONLINE deposit without an agent is accepted',
    "CALL mims.PROC_PROCESS_DEPOSIT(@acc, 100.00, 'ONLINE', NULL, @ref, @bal)");

-- TR10: the gap views (procedures/08_gap_queries.sql). Tomorrow the Teen customer turns 18 with no NIC and a Teen account.
CALL mims_test.check_that(@suite, 'TR10', 'Today the 17-year-old is in neither gap view',
    (SELECT COUNT(*) FROM VW_GAP_NIC_AT_18 WHERE customer_id = @teen) = 0
    AND (SELECT COUNT(*) FROM VW_GAP_PLAN_OUTGROWN WHERE account_id = @teen_acc) = 0, 'listed too early');
CALL mims_test.clock_at('2026-10-06 10:00:00');
CALL mims_test.check_that(@suite, 'TR10', 'On the 18th birthday the customer is listed as an adult without a NIC',
    (SELECT current_age FROM VW_GAP_NIC_AT_18 WHERE customer_id = @teen) = 18, 'not listed');
CALL mims_test.check_that(@suite, 'TR10', '... and the Teen account is listed as outgrown (Adult for this age)',
    (SELECT COUNT(*) FROM VW_GAP_PLAN_OUTGROWN
     WHERE account_id = @teen_acc AND current_plan = 'Teen' AND plan_for_age_now = 'Adult') = 1, 'not listed');
CALL mims_test.clock_at('2026-10-05 10:00:00');

-- TR11: the active-FD view lists exactly the ACTIVE fixed deposits, with their own values
CALL mims_test.check_that(@suite, 'TR11', 'VW_ACTIVE_FD_PAYOUT_SCHEDULE lists every ACTIVE FD and nothing else',
    (SELECT COUNT(*) FROM VW_ACTIVE_FD_PAYOUT_SCHEDULE) = (SELECT COUNT(*) FROM FIXED_DEPOSIT WHERE status = 'ACTIVE')
    AND (SELECT COUNT(*) FROM VW_ACTIVE_FD_PAYOUT_SCHEDULE v
         JOIN FIXED_DEPOSIT fd ON fd.fd_id = v.fd_id
         JOIN SAVINGS_ACCOUNT sa ON sa.account_id = fd.account_id
         JOIN FD_PLAN fp ON fp.fd_plan_id = fd.fd_plan_id
         WHERE fd.status = 'ACTIVE' AND v.account_no = sa.account_no AND v.principal = fd.amount
           AND v.interest_rate = fd.interest_rate AND v.term = fp.term_name AND v.start_date = fd.start_date
           AND v.maturity_date = fd.maturity_date AND v.next_payout_date <=> fd.next_payout_date)
        = (SELECT COUNT(*) FROM FIXED_DEPOSIT WHERE status = 'ACTIVE'),
    CONCAT_WS(' ', 'view rows', (SELECT COUNT(*) FROM VW_ACTIVE_FD_PAYOUT_SCHEDULE),
              'ACTIVE FDs', (SELECT COUNT(*) FROM FIXED_DEPOSIT WHERE status = 'ACTIVE')));

-- TR12: every report runs. Their rows are printed above the results; the numbers are checked against the
-- transactions by backend/test/integration/reports.test.js (plain SQL cannot read what a procedure returns).
CALL mims_test.expect_ok(@suite, 'TR12', 'The agent-wise report runs',
    "CALL mims.RPT_AGENT_WISE_TRANSACTIONS('2026-10-05', '2026-10-05')");
CALL mims_test.expect_ok(@suite, 'TR12', 'The account-wise report runs (one branch)',
    "CALL mims.RPT_ACCOUNT_WISE_SUMMARY(3)");
CALL mims_test.expect_ok(@suite, 'TR12', 'The monthly interest report runs',
    "CALL mims.RPT_MONTHLY_INTEREST_DISTRIBUTION(2026, 9)");
CALL mims_test.expect_ok(@suite, 'TR12', 'The customer activity report runs',
    "CALL mims.RPT_CUSTOMER_ACTIVITY('2026-10-05', '2026-10-05')");

-- TR13: the whole database still balances
CALL mims_test.check_that(@suite, 'TR13', 'Every account''s balance in the database equals its transaction history',
    (SELECT COUNT(*) FROM SAVINGS_ACCOUNT WHERE balance <> mims_test.ledger_balance(account_id)) = 0,
    CONCAT_WS(' ', (SELECT COUNT(*) FROM SAVINGS_ACCOUNT WHERE balance <> mims_test.ledger_balance(account_id)),
              'accounts differ'));

CALL mims_test.clock_reset();
CALL mims_test.report(@suite);
