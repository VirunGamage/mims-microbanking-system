-- Tests for deposits and withdrawals (procedures/01_deposit_withdrawal.sql).
-- Each test pins this session's clock to a fixed moment, so business hours and the daily limit are tested the same way at any hour.
-- Run through tests/run_all.sql, or alone after tests/_helpers.sql:  mysql -u root -p --table < tests/test_deposit_withdraw.sql
-- This file tests the deposit and withdrawal procedures: amounts, business hours, the daily limit, the minimum balance, who may withdraw and that a failed step leaves nothing saved.

USE mims;
SET @suite = 'deposit_withdraw';
CALL mims_test.start_suite(@suite);
DROP TRIGGER IF EXISTS test_fault_after_balance_update;

SET @hours        = 'Transactions are only accepted Mon-Fri during business hours';
SET @deposit_zero = 'Deposit amount must be greater than zero';
SET @withdraw_zero = 'Withdrawal amount must be greater than zero';
SET @below_min    = 'Withdrawal would take the balance below the plan minimum';
SET @fault        = 'Test fault after the balance update';

-- Test data, made on Monday 5 October 2026 at 10:00 (inside business hours): two agents, four customers, five accounts.
CALL mims_test.clock_at('2026-10-05 10:00:00');

INSERT INTO AGENT (first_name, last_name, status, branch_id) VALUES ('Test', 'Agent DW', 'ACTIVE', 1);
SET @agent = LAST_INSERT_ID();
INSERT INTO AGENT (first_name, last_name, status, branch_id) VALUES ('Test', 'On Leave DW', 'ON_LEAVE', 1);
SET @agent_on_leave = LAST_INSERT_ID();

INSERT INTO CUSTOMER (first_name, last_name, NIC, DOB, registered_by_agent_id, registered_at_branch_id)
VALUES ('Test', 'Holder DW', mims_test.new_nic(), '1990-01-01', @agent, 1);
SET @holder = LAST_INSERT_ID();
INSERT INTO CUSTOMER (first_name, last_name, NIC, DOB, registered_by_agent_id, registered_at_branch_id)
VALUES ('Test', 'Second DW', mims_test.new_nic(), '1985-05-05', @agent, 1);
SET @second = LAST_INSERT_ID();
INSERT INTO CUSTOMER (first_name, last_name, NIC, DOB, registered_by_agent_id, registered_at_branch_id)
VALUES ('Test', 'Stranger DW', mims_test.new_nic(), '1980-03-03', @agent, 1);
SET @stranger = LAST_INSERT_ID();
INSERT INTO CUSTOMER (first_name, last_name, NIC, DOB, registered_by_agent_id, registered_at_branch_id)
VALUES ('Test', 'Frozen DW', mims_test.new_nic(), '1975-07-07', @agent, 1);
SET @frozen_holder = LAST_INSERT_ID();

CALL PROC_OPEN_SAVINGS_ACCOUNT(@holder, NULL, 50000.00, @agent, @acc, @no, @ref);       -- Adult plan, minimum 1,000.00
CALL PROC_OPEN_SAVINGS_ACCOUNT(@holder, NULL, 5000.00, @agent, @small, @no, @ref);
CALL PROC_OPEN_SAVINGS_ACCOUNT(@holder, NULL, 300000.00, @agent, @big, @no, @ref);
CALL PROC_OPEN_SAVINGS_ACCOUNT(@holder, @second, 20000.00, @agent, @joint, @no, @ref);  -- Joint: @second is SECONDARY
CALL PROC_OPEN_SAVINGS_ACCOUNT(@frozen_holder, NULL, 10000.00, @agent, @frozen, @no, @ref);
UPDATE SAVINGS_ACCOUNT SET status = 'FROZEN' WHERE account_id = @frozen;                  -- status only, so the balance guard allows it


-- DW01: a deposit
SET @before = (SELECT balance FROM SAVINGS_ACCOUNT WHERE account_id = @acc), @ref = NULL, @bal = NULL;
CALL mims_test.try_sql("CALL mims.PROC_PROCESS_DEPOSIT(@acc, 2500.00, 'BRANCH', @agent, @ref, @bal)", @state, @message);
CALL mims_test.check_that(@suite, 'DW01', 'A deposit raises the balance and logs one DEPOSIT row',
    @state = '00000' AND @bal = @before + 2500.00
    AND (SELECT balance FROM SAVINGS_ACCOUNT WHERE account_id = @acc) = @before + 2500.00
    AND (SELECT COUNT(*) FROM `TRANSACTION`
         WHERE reference_no = @ref AND account_id = @acc AND transaction_type = 'DEPOSIT' AND amount = 2500.00
           AND channel = 'BRANCH' AND processed_by_agent_id = @agent AND review_flag = 0 AND fd_id IS NULL
           AND txn_timestamp = '2026-10-05 10:00:00') = 1,
    CONCAT_WS(' ', @state, @message, 'new balance', @bal, 'reference', @ref));

-- DW02: reference numbers
SET @first_ref = @ref, @ref = NULL;
CALL mims_test.try_sql("CALL mims.PROC_PROCESS_DEPOSIT(@acc, 100.00, 'BRANCH', @agent, @ref, @bal)", @state, @message);
CALL mims_test.check_that(@suite, 'DW02', 'Reference numbers are TXN + 7 digits and never repeat',
    @state = '00000' AND @first_ref REGEXP '^TXN[0-9]{7}$' AND @ref REGEXP '^TXN[0-9]{7}$' AND @ref > @first_ref,
    CONCAT_WS(' ', @state, @message, @first_ref, 'then', @ref));

-- DW03: the amount must be above zero
CALL mims_test.expect_refusal(@suite, 'DW03', 'A deposit of 0.00 is refused',
    "CALL mims.PROC_PROCESS_DEPOSIT(@acc, 0.00, 'BRANCH', @agent, @ref, @bal)", @deposit_zero);
CALL mims_test.expect_refusal(@suite, 'DW03', 'A negative deposit is refused',
    "CALL mims.PROC_PROCESS_DEPOSIT(@acc, -50.00, 'BRANCH', @agent, @ref, @bal)", @deposit_zero);
CALL mims_test.expect_refusal(@suite, 'DW03', 'A deposit with no amount is refused',
    "CALL mims.PROC_PROCESS_DEPOSIT(@acc, NULL, 'BRANCH', @agent, @ref, @bal)", @deposit_zero);

-- DW04: large deposits are accepted, and flagged only above 1,000,000.00
SET @ref = NULL;
CALL mims_test.try_sql("CALL mims.PROC_PROCESS_DEPOSIT(@acc, 1000000.00, 'BRANCH', @agent, @ref, @bal)", @state, @message);
CALL mims_test.check_that(@suite, 'DW04', 'A deposit of exactly 1,000,000.00 is accepted and not flagged',
    @state = '00000' AND (SELECT review_flag FROM `TRANSACTION` WHERE reference_no = @ref) = 0,
    CONCAT_WS(' ', @state, @message, 'flag', (SELECT review_flag FROM `TRANSACTION` WHERE reference_no = @ref)));
SET @ref = NULL;
CALL mims_test.try_sql("CALL mims.PROC_PROCESS_DEPOSIT(@acc, 1000000.01, 'BRANCH', @agent, @ref, @bal)", @state, @message);
CALL mims_test.check_that(@suite, 'DW04', 'A deposit of 1,000,000.01 is accepted but flagged for review',
    @state = '00000' AND (SELECT review_flag FROM `TRANSACTION` WHERE reference_no = @ref) = 1,
    CONCAT_WS(' ', @state, @message, 'flag', (SELECT review_flag FROM `TRANSACTION` WHERE reference_no = @ref)));

-- DW05: only an existing ACTIVE account takes deposits
CALL mims_test.expect_refusal(@suite, 'DW05', 'A deposit into a FROZEN account is refused',
    "CALL mims.PROC_PROCESS_DEPOSIT(@frozen, 100.00, 'BRANCH', @agent, @ref, @bal)", 'Account is not active');
CALL mims_test.expect_refusal(@suite, 'DW05', 'A deposit into an account that does not exist is refused',
    "CALL mims.PROC_PROCESS_DEPOSIT(999999, 100.00, 'BRANCH', @agent, @ref, @bal)", 'Account not found');

-- DW06: the agent must be ACTIVE (checked by trg_transaction_bi when the row is inserted)
SET @before = (SELECT balance FROM SAVINGS_ACCOUNT WHERE account_id = @acc),
    @rows_before = (SELECT COUNT(*) FROM `TRANSACTION` WHERE account_id = @acc);
CALL mims_test.expect_refusal(@suite, 'DW06', 'A deposit by an agent who is ON_LEAVE is refused',
    "CALL mims.PROC_PROCESS_DEPOSIT(@acc, 100.00, 'BRANCH', @agent_on_leave, @ref, @bal)", 'Processing agent is not ACTIVE');
CALL mims_test.check_that(@suite, 'DW06', '... and nothing is saved',
    (SELECT balance FROM SAVINGS_ACCOUNT WHERE account_id = @acc) = @before
    AND (SELECT COUNT(*) FROM `TRANSACTION` WHERE account_id = @acc) = @rows_before,
    'the balance or the transaction count changed');

-- DW07: business hours are Monday to Friday, 09:00:00 to 16:00:00
CALL mims_test.clock_at('2026-10-10 10:00:00');
CALL mims_test.expect_refusal(@suite, 'DW07', 'A deposit on a Saturday is refused',
    "CALL mims.PROC_PROCESS_DEPOSIT(@acc, 100.00, 'BRANCH', @agent, @ref, @bal)", @hours);
CALL mims_test.clock_at('2026-10-11 10:00:00');
CALL mims_test.expect_refusal(@suite, 'DW07', 'A deposit on a Sunday is refused',
    "CALL mims.PROC_PROCESS_DEPOSIT(@acc, 100.00, 'BRANCH', @agent, @ref, @bal)", @hours);
CALL mims_test.clock_at('2026-10-05 08:59:59');
CALL mims_test.expect_refusal(@suite, 'DW07', 'A deposit at 08:59:59 on a Monday is refused',
    "CALL mims.PROC_PROCESS_DEPOSIT(@acc, 100.00, 'BRANCH', @agent, @ref, @bal)", @hours);
CALL mims_test.clock_at('2026-10-05 09:00:00');
CALL mims_test.expect_ok(@suite, 'DW07', 'A deposit at 09:00:00 is accepted',
    "CALL mims.PROC_PROCESS_DEPOSIT(@acc, 100.00, 'BRANCH', @agent, @ref, @bal)");
CALL mims_test.clock_at('2026-10-05 16:00:00');
CALL mims_test.expect_ok(@suite, 'DW07', 'A deposit at 16:00:00 is accepted',
    "CALL mims.PROC_PROCESS_DEPOSIT(@acc, 100.00, 'BRANCH', @agent, @ref, @bal)");
CALL mims_test.clock_at('2026-10-05 16:00:01');
CALL mims_test.expect_refusal(@suite, 'DW07', 'A deposit at 16:00:01 is refused',
    "CALL mims.PROC_PROCESS_DEPOSIT(@acc, 100.00, 'BRANCH', @agent, @ref, @bal)", @hours);
CALL mims_test.clock_at('2026-10-05 10:00:00');

-- DW08: a withdrawal
SET @before = (SELECT balance FROM SAVINGS_ACCOUNT WHERE account_id = @acc), @ref = NULL, @bal = NULL;
CALL mims_test.try_sql("CALL mims.PROC_PROCESS_WITHDRAWAL(@acc, @holder, 1000.00, 'BRANCH', @agent, @ref, @bal)", @state, @message);
CALL mims_test.check_that(@suite, 'DW08', 'A withdrawal lowers the balance and logs one WITHDRAWAL row',
    @state = '00000' AND @bal = @before - 1000.00
    AND (SELECT balance FROM SAVINGS_ACCOUNT WHERE account_id = @acc) = @before - 1000.00
    AND (SELECT COUNT(*) FROM `TRANSACTION`
         WHERE reference_no = @ref AND account_id = @acc AND transaction_type = 'WITHDRAWAL' AND amount = 1000.00
           AND channel = 'BRANCH' AND processed_by_agent_id = @agent AND fd_id IS NULL) = 1,
    CONCAT_WS(' ', @state, @message, 'new balance', @bal));

-- DW09: the balance can reach the plan minimum (Adult 1,000.00) but not go below it. @small holds 5,000.00.
CALL mims_test.expect_refusal(@suite, 'DW09', 'A withdrawal that would leave 999.99 (Adult minimum 1,000.00) is refused',
    "CALL mims.PROC_PROCESS_WITHDRAWAL(@small, @holder, 4000.01, 'BRANCH', @agent, @ref, @bal)", @below_min);
CALL mims_test.try_sql("CALL mims.PROC_PROCESS_WITHDRAWAL(@small, @holder, 4000.00, 'BRANCH', @agent, @ref, @bal)", @state, @message);
CALL mims_test.check_that(@suite, 'DW09', 'A withdrawal that leaves exactly the minimum is accepted',
    @state = '00000' AND (SELECT balance FROM SAVINGS_ACCOUNT WHERE account_id = @small) = 1000.00,
    CONCAT_WS(' ', @state, @message, 'balance', (SELECT balance FROM SAVINGS_ACCOUNT WHERE account_id = @small)));

-- DW10: the daily limit (100,000.00) is a running total for the day. Tuesday 6 October: no withdrawals yet on @big.
CALL mims_test.clock_at('2026-10-06 10:00:00');
CALL mims_test.expect_ok(@suite, 'DW10', 'Withdrawing 60,000.00 is accepted',
    "CALL mims.PROC_PROCESS_WITHDRAWAL(@big, @holder, 60000.00, 'BRANCH', @agent, @ref, @bal)");
CALL mims_test.expect_ok(@suite, 'DW10', 'Another 40,000.00 the same day is accepted (100,000.00 in total)',
    "CALL mims.PROC_PROCESS_WITHDRAWAL(@big, @holder, 40000.00, 'BRANCH', @agent, @ref, @bal)");
SET @before = (SELECT balance FROM SAVINGS_ACCOUNT WHERE account_id = @big),
    @rows_before = (SELECT COUNT(*) FROM `TRANSACTION` WHERE account_id = @big);
CALL mims_test.expect_refusal(@suite, 'DW10', 'Another 0.01 the same day is refused',
    "CALL mims.PROC_PROCESS_WITHDRAWAL(@big, @holder, 0.01, 'BRANCH', @agent, @ref, @bal)", 'Daily withdrawal limit exceeded');
CALL mims_test.check_that(@suite, 'DW10', '... and nothing is saved',
    (SELECT balance FROM SAVINGS_ACCOUNT WHERE account_id = @big) = @before
    AND (SELECT COUNT(*) FROM `TRANSACTION` WHERE account_id = @big) = @rows_before,
    'the balance or the transaction count changed');
CALL mims_test.expect_refusal(@suite, 'DW10', 'A withdrawal that breaks both rules gets the minimum-balance message first',
    "CALL mims.PROC_PROCESS_WITHDRAWAL(@big, @holder, @before, 'BRANCH', @agent, @ref, @bal)", @below_min);
CALL mims_test.clock_at('2026-10-07 10:00:00');
CALL mims_test.expect_ok(@suite, 'DW10', 'The next day the limit starts again (50,000.00 accepted)',
    "CALL mims.PROC_PROCESS_WITHDRAWAL(@big, @holder, 50000.00, 'BRANCH', @agent, @ref, @bal)");
CALL mims_test.clock_at('2026-10-05 10:00:00');

-- DW11 to DW14: who can withdraw, and from which account
CALL mims_test.expect_refusal(@suite, 'DW11', 'A withdrawal by someone who is not a holder is refused',
    "CALL mims.PROC_PROCESS_WITHDRAWAL(@acc, @stranger, 100.00, 'BRANCH', @agent, @ref, @bal)",
    'Customer is not a holder of this account');

SET @ref = NULL;
CALL mims_test.try_sql("CALL mims.PROC_PROCESS_WITHDRAWAL(@joint, @second, 1000.00, 'BRANCH', @agent, @ref, @bal)", @state, @message);
CALL mims_test.check_that(@suite, 'DW12', 'The SECONDARY holder of a joint account can withdraw',
    @state = '00000' AND (SELECT balance FROM SAVINGS_ACCOUNT WHERE account_id = @joint) = 19000.00
    AND (SELECT COUNT(*) FROM `TRANSACTION` WHERE reference_no = @ref AND transaction_type = 'WITHDRAWAL') = 1,
    CONCAT_WS(' ', @state, @message));

CALL mims_test.expect_refusal(@suite, 'DW13', 'A withdrawal of 0.00 is refused',
    "CALL mims.PROC_PROCESS_WITHDRAWAL(@acc, @holder, 0.00, 'BRANCH', @agent, @ref, @bal)", @withdraw_zero);
CALL mims_test.expect_refusal(@suite, 'DW13', 'A withdrawal with no amount is refused',
    "CALL mims.PROC_PROCESS_WITHDRAWAL(@acc, @holder, NULL, 'BRANCH', @agent, @ref, @bal)", @withdraw_zero);

CALL mims_test.expect_refusal(@suite, 'DW14', 'A withdrawal from a FROZEN account is refused',
    "CALL mims.PROC_PROCESS_WITHDRAWAL(@frozen, @frozen_holder, 100.00, 'BRANCH', @agent, @ref, @bal)", 'Account is not active');
CALL mims_test.clock_at('2026-10-10 10:00:00');
CALL mims_test.expect_refusal(@suite, 'DW14', 'A withdrawal on a Saturday is refused',
    "CALL mims.PROC_PROCESS_WITHDRAWAL(@acc, @holder, 100.00, 'BRANCH', @agent, @ref, @bal)", @hours);
CALL mims_test.clock_at('2026-10-05 10:00:00');

-- DW15: all or nothing. A test trigger makes the balance UPDATE fail, after the TRANSACTION row has been inserted.
CREATE TRIGGER test_fault_after_balance_update AFTER UPDATE ON SAVINGS_ACCOUNT FOR EACH ROW
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Test fault after the balance update';

SET @before = (SELECT balance FROM SAVINGS_ACCOUNT WHERE account_id = @acc),
    @rows_before = (SELECT COUNT(*) FROM `TRANSACTION` WHERE account_id = @acc);
CALL mims_test.try_sql("CALL mims.PROC_PROCESS_DEPOSIT(@acc, 700.00, 'BRANCH', @agent, @ref, @bal)", @state, @message);
CALL mims_test.check_that(@suite, 'DW15', 'A deposit that fails at its last step leaves nothing behind',
    @message = @fault AND @allow_balance_update = 0
    AND (SELECT balance FROM SAVINGS_ACCOUNT WHERE account_id = @acc) = @before
    AND (SELECT COUNT(*) FROM `TRANSACTION` WHERE account_id = @acc) = @rows_before,
    CONCAT_WS(' ', 'got:', @state, @message, 'rows', (SELECT COUNT(*) FROM `TRANSACTION` WHERE account_id = @acc), 'before', @rows_before));
CALL mims_test.try_sql("CALL mims.PROC_PROCESS_WITHDRAWAL(@acc, @holder, 700.00, 'BRANCH', @agent, @ref, @bal)", @state, @message);
CALL mims_test.check_that(@suite, 'DW15', 'A withdrawal that fails at its last step leaves nothing behind',
    @message = @fault AND @allow_balance_update = 0
    AND (SELECT balance FROM SAVINGS_ACCOUNT WHERE account_id = @acc) = @before
    AND (SELECT COUNT(*) FROM `TRANSACTION` WHERE account_id = @acc) = @rows_before,
    CONCAT_WS(' ', 'got:', @state, @message, 'rows', (SELECT COUNT(*) FROM `TRANSACTION` WHERE account_id = @acc), 'before', @rows_before));

DROP TRIGGER IF EXISTS test_fault_after_balance_update;

-- DW16: the stored balance always equals the transaction history
CALL mims_test.check_that(@suite, 'DW16', 'Every test account''s balance equals its transaction history',
    (SELECT COUNT(*) FROM SAVINGS_ACCOUNT
     WHERE account_id IN (@acc, @small, @big, @joint, @frozen) AND balance = mims_test.ledger_balance(account_id)) = 5,
    'at least one balance differs from its transactions');

CALL mims_test.clock_reset();
CALL mims_test.report(@suite);
