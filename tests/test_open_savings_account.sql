-- Tests for opening a savings account (procedures/02_open_savings_account.sql). Owner: Rukshi.
-- Each test pins this session's clock to a fixed moment, so ages and business hours are tested the same way on any day.
-- Run through tests/run_all.sql, or alone after tests/_helpers.sql:  mysql -u root -p --table < tests/test_open_savings_account.sql
-- This file tests the savings account opening procedure, including plans, deposits, agents, joint holders and rollback behaviour.

USE mims;
SET @suite = 'open_savings_account';
CALL mims_test.start_suite(@suite);
DROP TRIGGER IF EXISTS test_fault_after_balance_update;

SET @hours     = 'Transactions are only accepted Mon-Fri during business hours';
SET @below_min = 'Opening deposit is below the plan minimum balance';
SET @zero      = 'Opening deposit must be greater than zero';

-- Test data, made on Monday 5 October 2026 at 10:00. The ages below are on that day.
CALL mims_test.clock_at('2026-10-05 10:00:00');

INSERT INTO AGENT (first_name, last_name, status, branch_id) VALUES ('Test', 'Agent OA', 'ACTIVE', 2);
SET @agent = LAST_INSERT_ID();
INSERT INTO AGENT (first_name, last_name, status, branch_id) VALUES ('Test', 'On Leave OA', 'ON_LEAVE', 2);
SET @agent_on_leave = LAST_INSERT_ID();

INSERT INTO CUSTOMER (first_name, last_name, NIC, DOB, registered_by_agent_id, registered_at_branch_id)
VALUES ('Test', 'Age 12 OA', NULL, '2014-10-05', @agent, 2);
SET @age12 = LAST_INSERT_ID();
INSERT INTO CUSTOMER (first_name, last_name, NIC, DOB, registered_by_agent_id, registered_at_branch_id)
VALUES ('Test', 'Age 13 OA', NULL, '2013-10-05', @agent, 2);
SET @age13 = LAST_INSERT_ID();
INSERT INTO CUSTOMER (first_name, last_name, NIC, DOB, registered_by_agent_id, registered_at_branch_id)
VALUES ('Test', 'Age 17 OA', NULL, '2009-10-05', @agent, 2);
SET @age17 = LAST_INSERT_ID();
INSERT INTO CUSTOMER (first_name, last_name, NIC, DOB, registered_by_agent_id, registered_at_branch_id)
VALUES ('Test', 'Age 17, 18 tomorrow OA', NULL, '2008-10-06', @agent, 2);
SET @age17b = LAST_INSERT_ID();
INSERT INTO CUSTOMER (first_name, last_name, NIC, DOB, registered_by_agent_id, registered_at_branch_id)
VALUES ('Test', 'Age 18 OA', mims_test.new_nic(), '2008-10-05', @agent, 2);
SET @age18 = LAST_INSERT_ID();
INSERT INTO CUSTOMER (first_name, last_name, NIC, DOB, registered_by_agent_id, registered_at_branch_id)
VALUES ('Test', 'Age 59 OA', mims_test.new_nic(), '1967-10-05', @agent, 2);
SET @age59 = LAST_INSERT_ID();
INSERT INTO CUSTOMER (first_name, last_name, NIC, DOB, registered_by_agent_id, registered_at_branch_id)
VALUES ('Test', 'Age 59, 60 tomorrow OA', mims_test.new_nic(), '1966-10-06', @agent, 2);
SET @age59b = LAST_INSERT_ID();
INSERT INTO CUSTOMER (first_name, last_name, NIC, DOB, registered_by_agent_id, registered_at_branch_id)
VALUES ('Test', 'Age 60 OA', mims_test.new_nic(), '1966-10-05', @agent, 2);
SET @age60 = LAST_INSERT_ID();
INSERT INTO CUSTOMER (first_name, last_name, NIC, DOB, registered_by_agent_id, registered_at_branch_id)
VALUES ('Test', 'Adult One OA', mims_test.new_nic(), '1990-01-01', @agent, 2);
SET @adult1 = LAST_INSERT_ID();
INSERT INTO CUSTOMER (first_name, last_name, NIC, DOB, registered_by_agent_id, registered_at_branch_id)
VALUES ('Test', 'Adult Two OA', mims_test.new_nic(), '1985-05-05', @agent, 2);
SET @adult2 = LAST_INSERT_ID();


-- OA01: the plan comes from the PRIMARY holder's age on the day of opening (Children up to 12, Teen 13-17, Adult 18-59, Senior 60+)
SET @acc = NULL;
CALL mims_test.try_sql("CALL mims.PROC_OPEN_SAVINGS_ACCOUNT(@age12, NULL, 1000.00, @agent, @acc, @no, @ref)", @state, @message);
CALL mims_test.check_that(@suite, 'OA01', 'Age 12 gets the Children plan', mims_test.plan_of(@acc) = 'Children',
    CONCAT_WS(' ', @state, @message, 'plan', mims_test.plan_of(@acc)));
SET @acc = NULL;
CALL mims_test.try_sql("CALL mims.PROC_OPEN_SAVINGS_ACCOUNT(@age13, NULL, 1000.00, @agent, @acc, @no, @ref)", @state, @message);
CALL mims_test.check_that(@suite, 'OA01', 'Age 13 gets the Teen plan', mims_test.plan_of(@acc) = 'Teen',
    CONCAT_WS(' ', @state, @message, 'plan', mims_test.plan_of(@acc)));
SET @acc = NULL;
CALL mims_test.try_sql("CALL mims.PROC_OPEN_SAVINGS_ACCOUNT(@age17, NULL, 1000.00, @agent, @acc, @no, @ref)", @state, @message);
CALL mims_test.check_that(@suite, 'OA01', 'Age 17 gets the Teen plan', mims_test.plan_of(@acc) = 'Teen',
    CONCAT_WS(' ', @state, @message, 'plan', mims_test.plan_of(@acc)));
SET @acc = NULL;
CALL mims_test.try_sql("CALL mims.PROC_OPEN_SAVINGS_ACCOUNT(@age17b, NULL, 1000.00, @agent, @acc, @no, @ref)", @state, @message);
CALL mims_test.check_that(@suite, 'OA01', 'Age 17 with the 18th birthday tomorrow still gets the Teen plan',
    mims_test.plan_of(@acc) = 'Teen', CONCAT_WS(' ', @state, @message, 'plan', mims_test.plan_of(@acc)));
SET @acc = NULL;
CALL mims_test.try_sql("CALL mims.PROC_OPEN_SAVINGS_ACCOUNT(@age18, NULL, 1000.00, @agent, @acc, @no, @ref)", @state, @message);
CALL mims_test.check_that(@suite, 'OA01', 'Age 18 (birthday today) gets the Adult plan', mims_test.plan_of(@acc) = 'Adult',
    CONCAT_WS(' ', @state, @message, 'plan', mims_test.plan_of(@acc)));
SET @acc = NULL;
CALL mims_test.try_sql("CALL mims.PROC_OPEN_SAVINGS_ACCOUNT(@age59, NULL, 1000.00, @agent, @acc, @no, @ref)", @state, @message);
CALL mims_test.check_that(@suite, 'OA01', 'Age 59 gets the Adult plan', mims_test.plan_of(@acc) = 'Adult',
    CONCAT_WS(' ', @state, @message, 'plan', mims_test.plan_of(@acc)));
SET @acc = NULL;
CALL mims_test.try_sql("CALL mims.PROC_OPEN_SAVINGS_ACCOUNT(@age59b, NULL, 1000.00, @agent, @acc, @no, @ref)", @state, @message);
CALL mims_test.check_that(@suite, 'OA01', 'Age 59 with the 60th birthday tomorrow still gets the Adult plan',
    mims_test.plan_of(@acc) = 'Adult', CONCAT_WS(' ', @state, @message, 'plan', mims_test.plan_of(@acc)));
SET @acc = NULL;
CALL mims_test.try_sql("CALL mims.PROC_OPEN_SAVINGS_ACCOUNT(@age60, NULL, 1000.00, @agent, @acc, @no, @ref)", @state, @message);
CALL mims_test.check_that(@suite, 'OA01', 'Age 60 (birthday today) gets the Senior plan', mims_test.plan_of(@acc) = 'Senior',
    CONCAT_WS(' ', @state, @message, 'plan', mims_test.plan_of(@acc)));

-- OA02: what a new account looks like
SET @acc = NULL, @no = NULL, @ref = NULL;
CALL mims_test.try_sql("CALL mims.PROC_OPEN_SAVINGS_ACCOUNT(@adult1, NULL, 2500.00, @agent, @acc, @no, @ref)", @state, @message);
CALL mims_test.check_that(@suite, 'OA02', 'A new account is ACTIVE, opened today, with the opening deposit as its balance',
    @state = '00000'
    AND (SELECT COUNT(*) FROM SAVINGS_ACCOUNT WHERE account_id = @acc AND account_no = @no AND status = 'ACTIVE'
           AND balance = 2500.00 AND open_date = '2026-10-05') = 1,
    CONCAT_WS(' ', @state, @message));
CALL mims_test.check_that(@suite, 'OA02', 'Its account number is SA + 7 digits', @no REGEXP '^SA[0-9]{7}$', CONCAT_WS(' ', 'got', @no));
CALL mims_test.check_that(@suite, 'OA02', 'Its first interest date is one 30-day cycle away (2026-11-04)',
    (SELECT next_interest_date FROM SAVINGS_ACCOUNT WHERE account_id = @acc) = '2026-11-04',
    CONCAT_WS(' ', 'got', (SELECT next_interest_date FROM SAVINGS_ACCOUNT WHERE account_id = @acc)));
CALL mims_test.check_that(@suite, 'OA02', 'It has exactly one holder, the PRIMARY one',
    (SELECT COUNT(*) FROM ACCOUNT_HOLDER WHERE account_id = @acc) = 1
    AND (SELECT COUNT(*) FROM ACCOUNT_HOLDER WHERE account_id = @acc AND customer_id = @adult1 AND role = 'PRIMARY') = 1,
    'wrong holder rows');
CALL mims_test.check_that(@suite, 'OA02', 'The opening deposit is its only transaction: a BRANCH DEPOSIT by the agent',
    (SELECT COUNT(*) FROM `TRANSACTION` WHERE account_id = @acc) = 1
    AND (SELECT COUNT(*) FROM `TRANSACTION`
         WHERE account_id = @acc AND reference_no = @ref AND transaction_type = 'DEPOSIT' AND amount = 2500.00
           AND channel = 'BRANCH' AND processed_by_agent_id = @agent AND review_flag = 0
           AND txn_timestamp = '2026-10-05 10:00:00') = 1,
    CONCAT_WS(' ', 'reference', @ref));

-- OA03: joint accounts
CALL mims_test.expect_refusal(@suite, 'OA03', 'A joint opening deposit of 4,999.99 is refused (Joint minimum 5,000.00)',
    "CALL mims.PROC_OPEN_SAVINGS_ACCOUNT(@adult1, @adult2, 4999.99, @agent, @acc, @no, @ref)", @below_min);
SET @acc = NULL;
CALL mims_test.try_sql("CALL mims.PROC_OPEN_SAVINGS_ACCOUNT(@adult1, @adult2, 5000.00, @agent, @acc, @no, @ref)", @state, @message);
CALL mims_test.check_that(@suite, 'OA03', 'A joint account gets the Joint plan, a PRIMARY and a SECONDARY holder',
    mims_test.plan_of(@acc) = 'Joint'
    AND (SELECT COUNT(*) FROM ACCOUNT_HOLDER WHERE account_id = @acc) = 2
    AND (SELECT role FROM ACCOUNT_HOLDER WHERE account_id = @acc AND customer_id = @adult1) = 'PRIMARY'
    AND (SELECT role FROM ACCOUNT_HOLDER WHERE account_id = @acc AND customer_id = @adult2) = 'SECONDARY',
    CONCAT_WS(' ', @state, @message, 'plan', mims_test.plan_of(@acc)));
SET @acc = NULL;
CALL mims_test.try_sql("CALL mims.PROC_OPEN_SAVINGS_ACCOUNT(@age13, @adult2, 5000.00, @agent, @acc, @no, @ref)", @state, @message);
CALL mims_test.check_that(@suite, 'OA03', 'Joint is not limited by age (a 13-year-old can be the PRIMARY holder)',
    mims_test.plan_of(@acc) = 'Joint', CONCAT_WS(' ', @state, @message, 'plan', mims_test.plan_of(@acc)));

-- OA04: the opening deposit must cover the plan's minimum balance
CALL mims_test.expect_refusal(@suite, 'OA04', 'Teen with 499.99 is refused (minimum 500.00)',
    "CALL mims.PROC_OPEN_SAVINGS_ACCOUNT(@age13, NULL, 499.99, @agent, @acc, @no, @ref)", @below_min);
CALL mims_test.expect_refusal(@suite, 'OA04', 'Adult with 999.99 is refused (minimum 1,000.00)',
    "CALL mims.PROC_OPEN_SAVINGS_ACCOUNT(@adult1, NULL, 999.99, @agent, @acc, @no, @ref)", @below_min);
CALL mims_test.expect_refusal(@suite, 'OA04', 'Senior with 999.99 is refused (minimum 1,000.00)',
    "CALL mims.PROC_OPEN_SAVINGS_ACCOUNT(@age60, NULL, 999.99, @agent, @acc, @no, @ref)", @below_min);
CALL mims_test.expect_ok(@suite, 'OA04', 'Children with 0.01 is accepted (minimum 0.00)',
    "CALL mims.PROC_OPEN_SAVINGS_ACCOUNT(@age12, NULL, 0.01, @agent, @acc, @no, @ref)");

-- OA05: the opening deposit must be above zero, even for the Children plan
CALL mims_test.expect_refusal(@suite, 'OA05', 'An opening deposit of 0.00 is refused',
    "CALL mims.PROC_OPEN_SAVINGS_ACCOUNT(@age12, NULL, 0.00, @agent, @acc, @no, @ref)", @zero);
CALL mims_test.expect_refusal(@suite, 'OA05', 'A negative opening deposit is refused',
    "CALL mims.PROC_OPEN_SAVINGS_ACCOUNT(@age12, NULL, -1.00, @agent, @acc, @no, @ref)", @zero);
CALL mims_test.expect_refusal(@suite, 'OA05', 'An opening deposit with no amount is refused',
    "CALL mims.PROC_OPEN_SAVINGS_ACCOUNT(@age12, NULL, NULL, @agent, @acc, @no, @ref)", @zero);

-- OA06: the agent must exist and be ACTIVE
CALL mims_test.expect_refusal(@suite, 'OA06', 'An agent who does not exist is refused',
    "CALL mims.PROC_OPEN_SAVINGS_ACCOUNT(@adult1, NULL, 2000.00, 999999, @acc, @no, @ref)", 'Agent not found');
CALL mims_test.expect_refusal(@suite, 'OA06', 'An agent who is ON_LEAVE is refused',
    "CALL mims.PROC_OPEN_SAVINGS_ACCOUNT(@adult1, NULL, 2000.00, @agent_on_leave, @acc, @no, @ref)",
    'Processing agent is not ACTIVE');

-- OA07: accounts are opened only in business hours
CALL mims_test.clock_at('2026-10-10 10:00:00');
CALL mims_test.expect_refusal(@suite, 'OA07', 'Opening an account on a Saturday is refused',
    "CALL mims.PROC_OPEN_SAVINGS_ACCOUNT(@adult1, NULL, 2000.00, @agent, @acc, @no, @ref)", @hours);
CALL mims_test.clock_at('2026-10-05 08:59:59');
CALL mims_test.expect_refusal(@suite, 'OA07', 'Opening an account at 08:59:59 is refused',
    "CALL mims.PROC_OPEN_SAVINGS_ACCOUNT(@adult1, NULL, 2000.00, @agent, @acc, @no, @ref)", @hours);
CALL mims_test.clock_at('2026-10-05 16:00:01');
CALL mims_test.expect_refusal(@suite, 'OA07', 'Opening an account at 16:00:01 is refused',
    "CALL mims.PROC_OPEN_SAVINGS_ACCOUNT(@adult1, NULL, 2000.00, @agent, @acc, @no, @ref)", @hours);
CALL mims_test.clock_at('2026-10-05 10:00:00');

-- OA08 and OA09: the holders must be real, different customers
CALL mims_test.expect_refusal(@suite, 'OA08', 'The same customer cannot be both holders',
    "CALL mims.PROC_OPEN_SAVINGS_ACCOUNT(@adult1, @adult1, 6000.00, @agent, @acc, @no, @ref)",
    'Joint holders must be two different customers');
CALL mims_test.expect_refusal(@suite, 'OA09', 'A PRIMARY holder who does not exist is refused',
    "CALL mims.PROC_OPEN_SAVINGS_ACCOUNT(999999, NULL, 2000.00, @agent, @acc, @no, @ref)", 'Primary customer not found');
CALL mims_test.expect_refusal(@suite, 'OA09', 'A SECONDARY holder who does not exist is refused',
    "CALL mims.PROC_OPEN_SAVINGS_ACCOUNT(@adult1, 999999, 6000.00, @agent, @acc, @no, @ref)", 'Secondary customer not found');

-- OA10: a large opening deposit is accepted, and flagged only above 1,000,000.00
SET @ref = NULL;
CALL mims_test.try_sql("CALL mims.PROC_OPEN_SAVINGS_ACCOUNT(@adult2, NULL, 1000000.00, @agent, @acc, @no, @ref)", @state, @message);
CALL mims_test.check_that(@suite, 'OA10', 'An opening deposit of exactly 1,000,000.00 is not flagged',
    @state = '00000' AND (SELECT review_flag FROM `TRANSACTION` WHERE reference_no = @ref) = 0, CONCAT_WS(' ', @state, @message));
SET @ref = NULL;
CALL mims_test.try_sql("CALL mims.PROC_OPEN_SAVINGS_ACCOUNT(@adult2, NULL, 1000000.01, @agent, @acc, @no, @ref)", @state, @message);
CALL mims_test.check_that(@suite, 'OA10', 'An opening deposit of 1,000,000.01 is accepted but flagged for review',
    @state = '00000' AND (SELECT review_flag FROM `TRANSACTION` WHERE reference_no = @ref) = 1, CONCAT_WS(' ', @state, @message));

-- OA11: all or nothing. A test trigger makes the balance UPDATE fail, after the account, both holders and the deposit exist.
CREATE TRIGGER test_fault_after_balance_update AFTER UPDATE ON SAVINGS_ACCOUNT FOR EACH ROW
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Test fault after the balance update';
SET @accounts_before = (SELECT COUNT(*) FROM SAVINGS_ACCOUNT),
    @holders_before  = (SELECT COUNT(*) FROM ACCOUNT_HOLDER),
    @txns_before     = (SELECT COUNT(*) FROM `TRANSACTION`);
CALL mims_test.try_sql("CALL mims.PROC_OPEN_SAVINGS_ACCOUNT(@adult1, @adult2, 6000.00, @agent, @acc, @no, @ref)", @state, @message);
DROP TRIGGER IF EXISTS test_fault_after_balance_update;
CALL mims_test.check_that(@suite, 'OA11', 'An opening that fails at its last steps leaves no account, holder or deposit behind',
    @message = 'Test fault after the balance update' AND @allow_balance_update = 0
    AND (SELECT COUNT(*) FROM SAVINGS_ACCOUNT) = @accounts_before
    AND (SELECT COUNT(*) FROM ACCOUNT_HOLDER) = @holders_before
    AND (SELECT COUNT(*) FROM `TRANSACTION`) = @txns_before,
    CONCAT_WS(' ', 'got:', @state, @message, 'accounts', (SELECT COUNT(*) FROM SAVINGS_ACCOUNT), 'before', @accounts_before));

-- OA12: the joint-holder check, called on a Joint account that has only one holder. Made inside a transaction that is
-- rolled back straight after, so nothing is kept.
START TRANSACTION;
INSERT INTO SAVINGS_ACCOUNT (account_no, balance, open_date, status, plan_id)
VALUES ('SA9999999', 0.00, '2026-10-05', 'ACTIVE', (SELECT plan_id FROM SAVINGS_PLAN WHERE plan_name = 'Joint'));
SET @lonely = LAST_INSERT_ID();
INSERT INTO ACCOUNT_HOLDER (customer_id, account_id, role) VALUES (@adult1, @lonely, 'PRIMARY');
CALL mims_test.try_sql("CALL mims.PROC_VERIFY_JOINT_HOLDERS(@lonely)", @state, @message);
ROLLBACK;
CALL mims_test.check_that(@suite, 'OA12', 'A Joint account with only one holder fails the joint-holder check',
    @state = '45000' AND @message = 'A Joint account must have at least 2 linked holders.',
    CONCAT_WS(' ', 'got:', @state, @message));

CALL mims_test.clock_reset();
CALL mims_test.report(@suite);
