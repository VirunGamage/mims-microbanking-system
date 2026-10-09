-- Tests for opening and closing fixed deposits (procedures/06_open_fixed_deposit.sql and 03_fixed_deposit.sql). Owner: Sameera.
-- Each test pins this session's clock to a fixed moment, so business hours and FD dates are tested the same way on any day.
-- Run through tests/run_all.sql, or alone after tests/_helpers.sql:  mysql -u root -p --table < tests/test_fd_procs.sql
-- Covers business-hours enforcement, plan rate locking, balance deduction, the one-FD-per-account limit, early closure
-- (with and without payouts due), the primary-holder-only close rule, agent-status checks, and full rollback on failure.
-- Every test sets its own session clock and cleans up its own data, so this file can run on its own or via run_all.sql.

USE mims;
SET @suite = 'fixed_deposits';
CALL mims_test.start_suite(@suite);

SET @hours       = 'Transactions are only accepted Mon-Fri during business hours';
SET @one_active  = 'This Savings Account already has an active Fixed Deposit.';
SET @below_min   = 'Fixed Deposit would take the balance below the plan minimum';
SET @six_months  = (SELECT fd_plan_id FROM FD_PLAN WHERE term_name = '6_MONTH');   -- 180 days at 13.00%

-- Test data, made on Monday 5 October 2026 at 10:00: two agents, three customers, five accounts.
CALL mims_test.clock_at('2026-10-05 10:00:00');

INSERT INTO AGENT (first_name, last_name, status, branch_id) VALUES ('Test', 'Agent FD', 'ACTIVE', 3);
SET @agent = LAST_INSERT_ID();
INSERT INTO AGENT (first_name, last_name, status, branch_id) VALUES ('Test', 'On Leave FD', 'ON_LEAVE', 3);
SET @agent_on_leave = LAST_INSERT_ID();

INSERT INTO CUSTOMER (first_name, last_name, NIC, DOB, registered_by_agent_id, registered_at_branch_id)
VALUES ('Test', 'Primary FD', mims_test.new_nic(), '1980-02-02', @agent, 3);
SET @primary = LAST_INSERT_ID();
INSERT INTO CUSTOMER (first_name, last_name, NIC, DOB, registered_by_agent_id, registered_at_branch_id)
VALUES ('Test', 'Second FD', mims_test.new_nic(), '1982-04-04', @agent, 3);
SET @second = LAST_INSERT_ID();
INSERT INTO CUSTOMER (first_name, last_name, NIC, DOB, registered_by_agent_id, registered_at_branch_id)
VALUES ('Test', 'Stranger FD', mims_test.new_nic(), '1979-06-06', @agent, 3);
SET @stranger = LAST_INSERT_ID();

CALL PROC_OPEN_SAVINGS_ACCOUNT(@primary, NULL, 100000.00, @agent, @acc, @no, @ref);       -- Adult plan, minimum 1,000.00
CALL PROC_OPEN_SAVINGS_ACCOUNT(@primary, @second, 100000.00, @agent, @joint, @no, @ref);  -- Joint: @second is SECONDARY
CALL PROC_OPEN_SAVINGS_ACCOUNT(@primary, NULL, 50000.00, @agent, @min_acc, @no, @ref);
CALL PROC_OPEN_SAVINGS_ACCOUNT(@primary, NULL, 50000.00, @agent, @spare, @no, @ref);
CALL PROC_OPEN_SAVINGS_ACCOUNT(@stranger, NULL, 20000.00, @agent, @frozen, @no, @ref);
UPDATE SAVINGS_ACCOUNT SET status = 'FROZEN' WHERE account_id = @frozen;


-- FD01: opening an FD
SET @fd = NULL, @ref = NULL, @bal = NULL;
CALL mims_test.try_sql("CALL mims.PROC_OPEN_FIXED_DEPOSIT(@acc, @primary, @six_months, 40000.00, @agent, @fd, @ref, @bal)",
                       @state, @message);
CALL mims_test.check_that(@suite, 'FD01', 'Opening a 40,000.00 FD takes it out of the savings balance',
    @state = '00000' AND @bal = 60000.00 AND (SELECT balance FROM SAVINGS_ACCOUNT WHERE account_id = @acc) = 60000.00,
    CONCAT_WS(' ', @state, @message, 'new balance', @bal));
CALL mims_test.check_that(@suite, 'FD01', 'The FD starts today, matures in 180 days, first payout in 30 days, rate copied from the plan',
    (SELECT COUNT(*) FROM FIXED_DEPOSIT
     WHERE fd_id = @fd AND account_id = @acc AND fd_plan_id = @six_months AND amount = 40000.00 AND interest_rate = 13.00
       AND status = 'ACTIVE' AND start_date = '2026-10-05' AND maturity_date = '2027-04-03'
       AND next_payout_date = '2026-11-04' AND close_date IS NULL) = 1,
    CONCAT_WS(' ', 'fd', @fd));
CALL mims_test.check_that(@suite, 'FD01', 'It is logged as one FD_OPEN transaction by the agent, linked to the FD',
    (SELECT COUNT(*) FROM `TRANSACTION`
     WHERE reference_no = @ref AND account_id = @acc AND fd_id = @fd AND transaction_type = 'FD_OPEN' AND amount = 40000.00
       AND channel = 'BRANCH' AND processed_by_agent_id = @agent) = 1,
    CONCAT_WS(' ', 'reference', @ref));

-- FD02: only one ACTIVE FD per account
SET @before = (SELECT balance FROM SAVINGS_ACCOUNT WHERE account_id = @acc);
CALL mims_test.expect_refusal(@suite, 'FD02', 'A second FD on the same account is refused while the first is ACTIVE',
    "CALL mims.PROC_OPEN_FIXED_DEPOSIT(@acc, @primary, @six_months, 1000.00, @agent, @fd_x, @ref, @bal)", @one_active);
CALL mims_test.check_that(@suite, 'FD02', '... and nothing is saved',
    (SELECT balance FROM SAVINGS_ACCOUNT WHERE account_id = @acc) = @before
    AND (SELECT COUNT(*) FROM FIXED_DEPOSIT WHERE account_id = @acc) = 1, 'the balance or the FD count changed');

-- FD03: who can open an FD
CALL mims_test.expect_refusal(@suite, 'FD03', 'Someone who is not a holder cannot open an FD',
    "CALL mims.PROC_OPEN_FIXED_DEPOSIT(@spare, @stranger, @six_months, 1000.00, @agent, @fd_x, @ref, @bal)",
    'Customer is not a holder of this account');
CALL mims_test.expect_refusal(@suite, 'FD03', 'The SECONDARY holder of a joint account cannot open an FD',
    "CALL mims.PROC_OPEN_FIXED_DEPOSIT(@joint, @second, @six_months, 1000.00, @agent, @fd_x, @ref, @bal)",
    'Only the PRIMARY holder can open a Fixed Deposit');
SET @fd_joint = NULL;
CALL mims_test.try_sql("CALL mims.PROC_OPEN_FIXED_DEPOSIT(@joint, @primary, @six_months, 10000.00, @agent, @fd_joint, @ref, @bal)",
                       @state, @message);
CALL mims_test.check_that(@suite, 'FD03', 'The PRIMARY holder of a joint account can open an FD',
    @state = '00000' AND (SELECT status FROM FIXED_DEPOSIT WHERE fd_id = @fd_joint) = 'ACTIVE', CONCAT_WS(' ', @state, @message));

-- FD04: the FD keeps the rate it was opened with. The plan rate is raised for this test and put back straight after.
CALL mims_test.clock_at('2026-11-04 10:00:00');
UPDATE FD_PLAN SET interest_rate = 13.50 WHERE fd_plan_id = @six_months;
CALL mims_test.try_sql("CALL mims.PROC_POST_FD_INTEREST(@fd, '2026-11-04', @n)", @state, @message);
SET @fd_new = NULL;
CALL mims_test.try_sql("CALL mims.PROC_OPEN_FIXED_DEPOSIT(@spare, @primary, @six_months, 10000.00, @agent, @fd_new, @ref, @bal)",
                       @state2, @message2);
UPDATE FD_PLAN SET interest_rate = 13.00 WHERE fd_plan_id = @six_months;
CALL mims_test.check_that(@suite, 'FD04', 'After the plan rate changes, an existing FD is still paid at its own rate (427.40 at 13.00%)',
    @state = '00000' AND @n = 1
    AND (SELECT amount FROM `TRANSACTION` WHERE fd_id = @fd AND transaction_type = 'FD_INTEREST') = 427.40,
    CONCAT_WS(' ', @state, @message, 'payout', (SELECT GROUP_CONCAT(amount) FROM `TRANSACTION` WHERE fd_id = @fd AND transaction_type = 'FD_INTEREST')));
CALL mims_test.check_that(@suite, 'FD04', 'A new FD gets the new plan rate (13.50%)',
    @state2 = '00000' AND (SELECT interest_rate FROM FIXED_DEPOSIT WHERE fd_id = @fd_new) = 13.50,
    CONCAT_WS(' ', @state2, @message2, 'rate', (SELECT interest_rate FROM FIXED_DEPOSIT WHERE fd_id = @fd_new)));
CALL mims_test.clock_at('2026-10-05 10:00:00');

-- FD05: the savings balance cannot drop below the plan minimum (Adult 1,000.00). @min_acc holds 50,000.00.
CALL mims_test.expect_refusal(@suite, 'FD05', 'An FD of 49,000.01 (would leave 999.99) is refused',
    "CALL mims.PROC_OPEN_FIXED_DEPOSIT(@min_acc, @primary, @six_months, 49000.01, @agent, @fd_x, @ref, @bal)", @below_min);
SET @fd_min = NULL;
CALL mims_test.try_sql("CALL mims.PROC_OPEN_FIXED_DEPOSIT(@min_acc, @primary, @six_months, 49000.00, @agent, @fd_min, @ref, @bal)",
                       @state, @message);
CALL mims_test.check_that(@suite, 'FD05', 'An FD that leaves exactly the minimum is accepted',
    @state = '00000' AND (SELECT balance FROM SAVINGS_ACCOUNT WHERE account_id = @min_acc) = 1000.00,
    CONCAT_WS(' ', @state, @message, 'balance', (SELECT balance FROM SAVINGS_ACCOUNT WHERE account_id = @min_acc)));

-- FD06 to FD10: the other checks when opening
CALL mims_test.expect_refusal(@suite, 'FD06', 'An FD on a FROZEN account is refused',
    "CALL mims.PROC_OPEN_FIXED_DEPOSIT(@frozen, @stranger, @six_months, 1000.00, @agent, @fd_x, @ref, @bal)", 'Account is not active');
CALL mims_test.expect_refusal(@suite, 'FD06', 'An FD on an account that does not exist is refused',
    "CALL mims.PROC_OPEN_FIXED_DEPOSIT(999999, @primary, @six_months, 1000.00, @agent, @fd_x, @ref, @bal)", 'Account not found');
CALL mims_test.expect_refusal(@suite, 'FD07', 'An FD of 0.00 is refused',
    "CALL mims.PROC_OPEN_FIXED_DEPOSIT(@acc, @primary, @six_months, 0.00, @agent, @fd_x, @ref, @bal)",
    'Fixed Deposit amount must be greater than zero');
CALL mims_test.expect_refusal(@suite, 'FD07', 'An FD with no amount is refused',
    "CALL mims.PROC_OPEN_FIXED_DEPOSIT(@acc, @primary, @six_months, NULL, @agent, @fd_x, @ref, @bal)",
    'Fixed Deposit amount must be greater than zero');
CALL mims_test.clock_at('2026-10-10 10:00:00');
CALL mims_test.expect_refusal(@suite, 'FD08', 'Opening an FD on a Saturday is refused',
    "CALL mims.PROC_OPEN_FIXED_DEPOSIT(@spare, @primary, @six_months, 1000.00, @agent, @fd_x, @ref, @bal)", @hours);
CALL mims_test.clock_at('2026-10-05 16:00:01');
CALL mims_test.expect_refusal(@suite, 'FD08', 'Opening an FD at 16:00:01 is refused',
    "CALL mims.PROC_OPEN_FIXED_DEPOSIT(@spare, @primary, @six_months, 1000.00, @agent, @fd_x, @ref, @bal)", @hours);
CALL mims_test.clock_at('2026-10-05 10:00:00');
CALL mims_test.expect_refusal(@suite, 'FD09', 'An FD by an agent who is ON_LEAVE is refused',
    "CALL mims.PROC_OPEN_FIXED_DEPOSIT(@spare, @primary, @six_months, 1000.00, @agent_on_leave, @fd_x, @ref, @bal)",
    'Processing agent is not ACTIVE');
CALL mims_test.expect_refusal(@suite, 'FD09', 'An FD by an agent who does not exist is refused',
    "CALL mims.PROC_OPEN_FIXED_DEPOSIT(@spare, @primary, @six_months, 1000.00, 999999, @fd_x, @ref, @bal)", 'Agent not found');
CALL mims_test.expect_refusal(@suite, 'FD10', 'An FD plan that does not exist is refused',
    "CALL mims.PROC_OPEN_FIXED_DEPOSIT(@acc, @primary, 99, 1000.00, @agent, @fd_x, @ref, @bal)", 'Fixed Deposit plan not found');

-- FD11: closing early. The 11-04 payout was posted in FD04; on 20 November the half-finished cycle earns nothing.
CALL mims_test.clock_at('2026-11-20 10:00:00');
SET @before = (SELECT balance FROM SAVINGS_ACCOUNT WHERE account_id = @acc);
CALL mims_test.try_sql("CALL mims.PROC_CLOSE_FIXED_DEPOSIT(@fd, @primary, @agent)", @state, @message);
CALL mims_test.check_that(@suite, 'FD11', 'Closing early marks the FD CLOSED today and stops its payouts',
    @state = '00000'
    AND (SELECT COUNT(*) FROM FIXED_DEPOSIT
         WHERE fd_id = @fd AND status = 'CLOSED' AND close_date = '2026-11-20' AND next_payout_date IS NULL) = 1,
    CONCAT_WS(' ', @state, @message));
CALL mims_test.check_that(@suite, 'FD11', 'The principal goes back to savings as one FD_CLOSURE by the agent',
    (SELECT balance FROM SAVINGS_ACCOUNT WHERE account_id = @acc) = @before + 40000.00
    AND (SELECT COUNT(*) FROM `TRANSACTION`
         WHERE fd_id = @fd AND transaction_type = 'FD_CLOSURE' AND amount = 40000.00 AND channel = 'BRANCH'
           AND processed_by_agent_id = @agent AND txn_timestamp = '2026-11-20 10:00:00') = 1,
    CONCAT_WS(' ', 'balance', (SELECT balance FROM SAVINGS_ACCOUNT WHERE account_id = @acc), 'before', @before));
CALL mims_test.check_that(@suite, 'FD11', 'No interest is paid for the unfinished cycle (still one payout in total)',
    (SELECT COUNT(*) FROM `TRANSACTION` WHERE fd_id = @fd AND transaction_type = 'FD_INTEREST') = 1,
    CONCAT_WS(' ', 'payouts', (SELECT COUNT(*) FROM `TRANSACTION` WHERE fd_id = @fd AND transaction_type = 'FD_INTEREST')));

-- FD12 and FD13: who can close, and what
CALL mims_test.expect_refusal(@suite, 'FD12', 'The SECONDARY holder of a joint account cannot close its FD',
    "CALL mims.PROC_CLOSE_FIXED_DEPOSIT(@fd_joint, @second, @agent)", 'Only the PRIMARY holder can close this Fixed Deposit');
CALL mims_test.expect_refusal(@suite, 'FD12', 'Someone who is not a holder cannot close it',
    "CALL mims.PROC_CLOSE_FIXED_DEPOSIT(@fd_joint, @stranger, @agent)", 'Only the PRIMARY holder can close this Fixed Deposit');
CALL mims_test.expect_refusal(@suite, 'FD13', 'An FD that is already CLOSED cannot be closed again',
    "CALL mims.PROC_CLOSE_FIXED_DEPOSIT(@fd, @primary, @agent)", 'Fixed Deposit is not ACTIVE');
CALL mims_test.expect_refusal(@suite, 'FD13', 'An FD that does not exist cannot be closed',
    "CALL mims.PROC_CLOSE_FIXED_DEPOSIT(999999, @primary, @agent)", 'Fixed Deposit not found');

-- FD14: all or nothing. PROC_CLOSE_FIXED_DEPOSIT updates the FD and the balance before it inserts the FD_CLOSURE row;
-- an ON_LEAVE agent is refused at that insert (trg_transaction_bi), so both updates must be undone.
-- The payouts due by today are posted first, so these closes test only their own rule.
CALL PROC_POST_FD_INTEREST(@fd_min, '2026-11-20', @n);
CALL PROC_POST_FD_INTEREST(@fd_joint, '2026-11-20', @n);
SET @before = (SELECT balance FROM SAVINGS_ACCOUNT WHERE account_id = @min_acc);
CALL mims_test.expect_refusal(@suite, 'FD14', 'Closing with an agent who is ON_LEAVE is refused',
    "CALL mims.PROC_CLOSE_FIXED_DEPOSIT(@fd_min, @primary, @agent_on_leave)", 'Processing agent is not ACTIVE');
CALL mims_test.check_that(@suite, 'FD14', '... and the FD and the balance are left exactly as they were',
    @allow_balance_update = 0
    AND (SELECT COUNT(*) FROM FIXED_DEPOSIT
         WHERE fd_id = @fd_min AND status = 'ACTIVE' AND close_date IS NULL AND next_payout_date = '2026-12-04') = 1
    AND (SELECT balance FROM SAVINGS_ACCOUNT WHERE account_id = @min_acc) = @before
    AND (SELECT COUNT(*) FROM `TRANSACTION` WHERE fd_id = @fd_min AND transaction_type = 'FD_CLOSURE') = 0,
    CONCAT_WS(' ', 'status', (SELECT status FROM FIXED_DEPOSIT WHERE fd_id = @fd_min),
              'balance', (SELECT balance FROM SAVINGS_ACCOUNT WHERE account_id = @min_acc)));

-- FD15: PROC_CLOSE_FIXED_DEPOSIT has no business-hours check, so this records today's behaviour.
-- If the check is added, change this to expect_refusal with the business-hours message.
CALL mims_test.clock_at('2026-11-21 10:00:00');
CALL mims_test.expect_ok(@suite, 'FD15', 'Closing an FD on a Saturday works (today the close has no business-hours check)',
    "CALL mims.PROC_CLOSE_FIXED_DEPOSIT(@fd_joint, @primary, @agent)");

-- FD16: balances and the one-FD rule still hold
CALL mims_test.check_that(@suite, 'FD16', 'Every test account''s balance equals its transaction history',
    (SELECT COUNT(*) FROM SAVINGS_ACCOUNT
     WHERE account_id IN (@acc, @joint, @min_acc, @spare, @frozen) AND balance = mims_test.ledger_balance(account_id)) = 5,
    'at least one balance differs from its transactions');
CALL mims_test.check_that(@suite, 'FD16', 'No account in the database has more than one ACTIVE FD',
    (SELECT COUNT(*) FROM (SELECT account_id FROM FIXED_DEPOSIT WHERE status = 'ACTIVE'
                           GROUP BY account_id HAVING COUNT(*) > 1) x) = 0,
    'an account has two ACTIVE FDs');

CALL mims_test.clock_reset();
CALL mims_test.report(@suite);
