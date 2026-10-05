-- Tests for interest posting and FD maturity (procedures/07_interest_posting.sql and 03_fixed_deposit.sql). Owner: Archchu.
-- Each test pins this session's clock to a fixed day, so the due dates are tested without waiting for them.
-- Run through tests/run_all.sql, or alone after tests/_helpers.sql:  mysql -u root -p --table < tests/test_interest_posting.sql

--Checks that savings and fixed-deposit interest are calculated,posted and matured correctly on the required dates.

USE mims;
SET @suite = 'interest_posting';
CALL mims_test.start_suite(@suite);

SET @future     = 'Run date cannot be in the future';
SET @six_months = (SELECT fd_plan_id FROM FD_PLAN WHERE term_name = '6_MONTH');   -- 180 days at 13.00%

-- Test data, made on Monday 5 October 2026 at 10:00. Savings interest is first due 30 days later, on 2026-11-04,
-- and so is the first payout of each FD. The FDs mature 180 days later, on 2027-04-03.
CALL mims_test.clock_at('2026-10-05 10:00:00');

INSERT INTO AGENT (first_name, last_name, status, branch_id) VALUES ('Test', 'Agent IP', 'ACTIVE', 1);
SET @agent = LAST_INSERT_ID();
INSERT INTO CUSTOMER (first_name, last_name, NIC, DOB, registered_by_agent_id, registered_at_branch_id)
VALUES ('Test', 'Adult IP', mims_test.new_nic(), '1990-01-01', @agent, 1);
SET @adult = LAST_INSERT_ID();
INSERT INTO CUSTOMER (first_name, last_name, NIC, DOB, registered_by_agent_id, registered_at_branch_id)
VALUES ('Test', 'Child IP', NULL, '2018-01-01', @agent, 1);
SET @child = LAST_INSERT_ID();

CALL PROC_OPEN_SAVINGS_ACCOUNT(@adult, NULL, 10000.00, @agent, @acc, @no, @ref);        -- Adult plan, 10.00%
CALL PROC_OPEN_SAVINGS_ACCOUNT(@adult, NULL, 10000.00, @agent, @late, @no, @ref);       -- left alone until a late run
CALL PROC_OPEN_SAVINGS_ACCOUNT(@child, NULL, 0.01, @agent, @tiny, @no, @ref);           -- Children plan, earns 0.00
CALL PROC_OPEN_SAVINGS_ACCOUNT(@adult, NULL, 10000.00, @agent, @frozen, @no, @ref);
CALL PROC_OPEN_SAVINGS_ACCOUNT(@adult, NULL, 60000.00, @agent, @fd_acc, @no, @ref);
CALL PROC_OPEN_FIXED_DEPOSIT(@fd_acc, @adult, @six_months, 40000.00, @agent, @fd, @ref, @bal);
CALL PROC_OPEN_SAVINGS_ACCOUNT(@adult, NULL, 60000.00, @agent, @fd2_acc, @no, @ref);
CALL PROC_OPEN_FIXED_DEPOSIT(@fd2_acc, @adult, @six_months, 40000.00, @agent, @fd2, @ref, @bal);
CALL PROC_OPEN_SAVINGS_ACCOUNT(@adult, NULL, 60000.00, @agent, @fd3_acc, @no, @ref);
CALL PROC_OPEN_FIXED_DEPOSIT(@fd3_acc, @adult, @six_months, 40000.00, @agent, @fd3, @ref, @bal);
UPDATE SAVINGS_ACCOUNT SET status = 'FROZEN' WHERE account_id IN (@frozen, @fd3_acc);


-- IP01: the interest formula, base x rate / 100 x 30 / 365, rounded to 2 decimals
CALL mims_test.check_that(@suite, 'IP01', '50,000.00 at 13% for 30 days earns 534.25',
    FUNC_CALC_INTEREST(50000.00, 13.00, 30) = 534.25, CONCAT('got ', FUNC_CALC_INTEREST(50000.00, 13.00, 30)));
CALL mims_test.check_that(@suite, 'IP01', '15,000.00 at 15% for 30 days earns 184.93',
    FUNC_CALC_INTEREST(15000.00, 15.00, 30) = 184.93, CONCAT('got ', FUNC_CALC_INTEREST(15000.00, 15.00, 30)));
CALL mims_test.check_that(@suite, 'IP01', '10,000.00 at 10% for 30 days earns 82.19',
    FUNC_CALC_INTEREST(10000.00, 10.00, 30) = 82.19, CONCAT('got ', FUNC_CALC_INTEREST(10000.00, 10.00, 30)));
CALL mims_test.check_that(@suite, 'IP01', '1,253,029.59 at 12% for 30 days earns 12,358.65',
    FUNC_CALC_INTEREST(1253029.59, 12.00, 30) = 12358.65, CONCAT('got ', FUNC_CALC_INTEREST(1253029.59, 12.00, 30)));
CALL mims_test.check_that(@suite, 'IP01', '40,000.00 at 13% for 30 days earns 427.40',
    FUNC_CALC_INTEREST(40000.00, 13.00, 30) = 427.40, CONCAT('got ', FUNC_CALC_INTEREST(40000.00, 13.00, 30)));
CALL mims_test.check_that(@suite, 'IP01', '100.00 at 10% for 30 days earns 0.82',
    FUNC_CALC_INTEREST(100.00, 10.00, 30) = 0.82, CONCAT('got ', FUNC_CALC_INTEREST(100.00, 10.00, 30)));
CALL mims_test.check_that(@suite, 'IP01', '1.00 at 7% for 30 days earns 0.01 (0.00575 rounds up)',
    FUNC_CALC_INTEREST(1.00, 7.00, 30) = 0.01, CONCAT('got ', FUNC_CALC_INTEREST(1.00, 7.00, 30)));
CALL mims_test.check_that(@suite, 'IP01', '0.00 earns 0.00',
    FUNC_CALC_INTEREST(0.00, 12.00, 30) = 0.00, CONCAT('got ', FUNC_CALC_INTEREST(0.00, 12.00, 30)));

-- IP02: interest cannot be paid ahead of time, and a run needs a date
CALL mims_test.expect_refusal(@suite, 'IP02', 'Posting savings interest for tomorrow is refused',
    "CALL mims.PROC_POST_SAVINGS_INTEREST(@acc, '2026-10-06', @n)", @future);
CALL mims_test.expect_refusal(@suite, 'IP02', 'Posting FD interest for tomorrow is refused',
    "CALL mims.PROC_POST_FD_INTEREST(@fd, '2026-10-06', @n)", @future);
CALL mims_test.expect_refusal(@suite, 'IP02', 'A savings run without a date is refused',
    "CALL mims.PROC_RUN_SAVINGS_INTEREST(NULL, @n)", 'Run date is required');
CALL mims_test.expect_refusal(@suite, 'IP02', 'An FD run without a date is refused',
    "CALL mims.PROC_RUN_FD_INTEREST(NULL, @n)", 'Run date is required');

-- IP03: nothing is due the day before
CALL mims_test.clock_at('2026-11-03 10:00:00');
SET @n = NULL;
CALL mims_test.try_sql("CALL mims.PROC_POST_SAVINGS_INTEREST(@acc, '2026-11-03', @n)", @state, @message);
CALL mims_test.check_that(@suite, 'IP03', 'On 2026-11-03 no savings interest is due yet',
    @state = '00000' AND @n = 0
    AND (SELECT next_interest_date FROM SAVINGS_ACCOUNT WHERE account_id = @acc) = '2026-11-04'
    AND (SELECT COUNT(*) FROM `TRANSACTION` WHERE account_id = @acc AND transaction_type = 'SAVINGS_INTEREST') = 0,
    CONCAT_WS(' ', @state, @message, 'postings', @n));
SET @n = NULL;
CALL mims_test.try_sql("CALL mims.PROC_POST_FD_INTEREST(@fd, '2026-11-03', @n)", @state, @message);
CALL mims_test.check_that(@suite, 'IP03', 'On 2026-11-03 no FD payout is due yet',
    @state = '00000' AND @n = 0 AND (SELECT next_payout_date FROM FIXED_DEPOSIT WHERE fd_id = @fd) = '2026-11-04',
    CONCAT_WS(' ', @state, @message, 'postings', @n));

-- IP04 to IP08: the due day, 2026-11-04, posted in the daily order (FD interest first, then savings interest)
CALL mims_test.clock_at('2026-11-04 10:00:00');

SET @n = NULL;
CALL mims_test.try_sql("CALL mims.PROC_POST_FD_INTEREST(@fd, '2026-11-04', @n)", @state, @message);
CALL mims_test.check_that(@suite, 'IP04', 'The FD payout (427.40) is posted at 02:00 on its due day as a SYSTEM FD_INTEREST',
    @state = '00000' AND @n = 1
    AND (SELECT COUNT(*) FROM `TRANSACTION`
         WHERE fd_id = @fd AND account_id = @fd_acc AND transaction_type = 'FD_INTEREST' AND amount = 427.40
           AND txn_timestamp = '2026-11-04 02:00:00' AND channel = 'SYSTEM' AND processed_by_agent_id IS NULL) = 1
    AND (SELECT next_payout_date FROM FIXED_DEPOSIT WHERE fd_id = @fd) = '2026-12-04'
    AND (SELECT balance FROM SAVINGS_ACCOUNT WHERE account_id = @fd_acc) = 20427.40,
    CONCAT_WS(' ', @state, @message, 'postings', @n));
SET @n = NULL;
CALL mims_test.try_sql("CALL mims.PROC_POST_FD_INTEREST(@fd, '2026-11-04', @n)", @state, @message);
CALL mims_test.check_that(@suite, 'IP04', 'Posting the same FD day again pays nothing',
    @state = '00000' AND @n = 0
    AND (SELECT COUNT(*) FROM `TRANSACTION` WHERE fd_id = @fd AND transaction_type = 'FD_INTEREST') = 1,
    CONCAT_WS(' ', @state, @message, 'postings', @n));

SET @n = NULL;
CALL mims_test.try_sql("CALL mims.PROC_POST_SAVINGS_INTEREST(@acc, '2026-11-04', @n)", @state, @message);
CALL mims_test.check_that(@suite, 'IP05', 'Savings interest (82.19 on 10,000.00 at 10%) is posted at 01:00 on its due day',
    @state = '00000' AND @n = 1
    AND (SELECT COUNT(*) FROM `TRANSACTION`
         WHERE account_id = @acc AND transaction_type = 'SAVINGS_INTEREST' AND amount = 82.19 AND fd_id IS NULL
           AND txn_timestamp = '2026-11-04 01:00:00' AND channel = 'SYSTEM' AND processed_by_agent_id IS NULL) = 1
    AND (SELECT balance FROM SAVINGS_ACCOUNT WHERE account_id = @acc) = 10082.19
    AND (SELECT next_interest_date FROM SAVINGS_ACCOUNT WHERE account_id = @acc) = '2026-12-04',
    CONCAT_WS(' ', @state, @message, 'postings', @n, 'balance', (SELECT balance FROM SAVINGS_ACCOUNT WHERE account_id = @acc)));
SET @n = NULL;
CALL mims_test.try_sql("CALL mims.PROC_POST_SAVINGS_INTEREST(@acc, '2026-11-04', @n)", @state, @message);
CALL mims_test.check_that(@suite, 'IP05', 'Posting the same savings day again pays nothing',
    @state = '00000' AND @n = 0 AND (SELECT balance FROM SAVINGS_ACCOUNT WHERE account_id = @acc) = 10082.19,
    CONCAT_WS(' ', @state, @message, 'postings', @n));

SET @n = NULL;
CALL mims_test.try_sql("CALL mims.PROC_POST_SAVINGS_INTEREST(@fd_acc, '2026-11-04', @n)", @state, @message);
CALL mims_test.check_that(@suite, 'IP06', 'Savings interest uses the balance at 01:00 (20,000.00 -> 164.38), not the FD payout made at 02:00',
    @state = '00000' AND @n = 1
    AND (SELECT amount FROM `TRANSACTION` WHERE account_id = @fd_acc AND transaction_type = 'SAVINGS_INTEREST') = 164.38,
    CONCAT_WS(' ', @state, @message, 'interest',
              (SELECT GROUP_CONCAT(amount) FROM `TRANSACTION` WHERE account_id = @fd_acc AND transaction_type = 'SAVINGS_INTEREST')));

SET @n = NULL;
CALL mims_test.try_sql("CALL mims.PROC_POST_SAVINGS_INTEREST(@frozen, '2026-11-04', @n)", @state, @message);
CALL mims_test.check_that(@suite, 'IP07', 'A FROZEN account earns no savings interest and keeps its due date',
    @state = '00000' AND @n = 0
    AND (SELECT next_interest_date FROM SAVINGS_ACCOUNT WHERE account_id = @frozen) = '2026-11-04'
    AND (SELECT COUNT(*) FROM `TRANSACTION` WHERE account_id = @frozen AND transaction_type = 'SAVINGS_INTEREST') = 0,
    CONCAT_WS(' ', @state, @message, 'postings', @n));
SET @n = NULL;
CALL mims_test.try_sql("CALL mims.PROC_POST_FD_INTEREST(@fd3, '2026-11-04', @n)", @state, @message);
CALL mims_test.check_that(@suite, 'IP07', 'An FD on a FROZEN account pays nothing and keeps its due date',
    @state = '00000' AND @n = 0 AND (SELECT next_payout_date FROM FIXED_DEPOSIT WHERE fd_id = @fd3) = '2026-11-04'
    AND (SELECT COUNT(*) FROM `TRANSACTION` WHERE fd_id = @fd3 AND transaction_type = 'FD_INTEREST') = 0,
    CONCAT_WS(' ', @state, @message, 'postings', @n));

SET @n = NULL;
CALL mims_test.try_sql("CALL mims.PROC_POST_SAVINGS_INTEREST(@tiny, '2026-11-04', @n)", @state, @message);
CALL mims_test.check_that(@suite, 'IP08', 'Interest that rounds to 0.00 is not posted, but the due date still moves on',
    @state = '00000' AND @n = 0
    AND (SELECT COUNT(*) FROM `TRANSACTION` WHERE account_id = @tiny AND transaction_type = 'SAVINGS_INTEREST') = 0
    AND (SELECT next_interest_date FROM SAVINGS_ACCOUNT WHERE account_id = @tiny) = '2026-12-04',
    CONCAT_WS(' ', @state, @message, 'postings', @n,
              'next date', (SELECT next_interest_date FROM SAVINGS_ACCOUNT WHERE account_id = @tiny)));

-- IP09: a late run on 2027-01-05 posts every missed cycle, each on the balance just before it (interest on interest)
CALL mims_test.clock_at('2027-01-05 10:00:00');
CALL mims_test.try_sql("CALL mims.PROC_RUN_SAVINGS_INTEREST('2027-01-05', @n)", @state, @message);
SET @postings = (SELECT GROUP_CONCAT(CONCAT(DATE_FORMAT(txn_timestamp, '%Y-%m-%d %H:%i'), ' ', amount) ORDER BY txn_timestamp SEPARATOR ', ')
                 FROM `TRANSACTION` WHERE account_id = @late AND transaction_type = 'SAVINGS_INTEREST');
CALL mims_test.check_that(@suite, 'IP09', 'A late run posts the 3 missed cycles: 82.19, 82.87 and 83.55 on their own due days',
    @state = '00000' AND @postings = '2026-11-04 01:00 82.19, 2026-12-04 01:00 82.87, 2027-01-03 01:00 83.55'
    AND (SELECT balance FROM SAVINGS_ACCOUNT WHERE account_id = @late) = 10248.61
    AND (SELECT next_interest_date FROM SAVINGS_ACCOUNT WHERE account_id = @late) = '2027-02-02',
    CONCAT_WS(' ', @state, @message, 'got', @postings));

-- IP10: running a whole job twice for the same day posts nothing the second time
CALL mims_test.try_sql("CALL mims.PROC_RUN_SAVINGS_INTEREST('2027-01-05', @n)", @state, @message);
CALL mims_test.check_that(@suite, 'IP10', 'The savings job run again for the same day posts nothing',
    @state = '00000' AND @n = 0, CONCAT_WS(' ', @state, @message, 'postings', @n));
CALL mims_test.try_sql("CALL mims.PROC_RUN_FD_INTEREST('2027-01-05', @n)", @state, @message);
CALL mims_test.try_sql("CALL mims.PROC_RUN_FD_INTEREST('2027-01-05', @n)", @state, @message);
CALL mims_test.check_that(@suite, 'IP10', 'The FD job run again for the same day posts nothing',
    @state = '00000' AND @n = 0, CONCAT_WS(' ', @state, @message, 'postings', @n));

-- IP11 and IP12: on 2027-06-10 the FDs are past their maturity date (2027-04-03)
CALL mims_test.clock_at('2027-06-10 10:00:00');
CALL mims_test.try_sql("CALL mims.PROC_PROCESS_FD_MATURITY()", @state, @message);
CALL mims_test.check_that(@suite, 'IP11', 'Maturity waits while payouts up to the maturity date are still unposted',
    @state = '00000' AND (SELECT status FROM FIXED_DEPOSIT WHERE fd_id = @fd2) = 'ACTIVE'
    AND (SELECT COUNT(*) FROM `TRANSACTION` WHERE fd_id = @fd2 AND transaction_type = 'FD_CLOSURE') = 0,
    CONCAT_WS(' ', @state, @message, 'status', (SELECT status FROM FIXED_DEPOSIT WHERE fd_id = @fd2)));

-- The daily order: FD interest, then FD maturity, then savings interest
CALL mims_test.try_sql("CALL mims.PROC_RUN_FD_INTEREST('2027-06-10', @n)", @state, @message);
CALL mims_test.try_sql("CALL mims.PROC_PROCESS_FD_MATURITY()", @state2, @message2);
CALL mims_test.try_sql("CALL mims.PROC_RUN_SAVINGS_INTEREST('2027-06-10', @n)", @state3, @message3);
CALL mims_test.check_that(@suite, 'IP12', 'The daily jobs run without errors',
    @state = '00000' AND @state2 = '00000' AND @state3 = '00000',
    CONCAT_WS(' ', @state, @message, @state2, @message2, @state3, @message3));
CALL mims_test.check_that(@suite, 'IP12', 'A 180-day FD gets exactly 6 payouts of 427.40, the last on the maturity date',
    (SELECT COUNT(*) FROM `TRANSACTION` WHERE fd_id = @fd AND transaction_type = 'FD_INTEREST' AND amount = 427.40) = 6
    AND (SELECT COUNT(*) FROM `TRANSACTION` WHERE fd_id = @fd AND transaction_type = 'FD_INTEREST') = 6
    AND (SELECT MAX(txn_timestamp) FROM `TRANSACTION` WHERE fd_id = @fd AND transaction_type = 'FD_INTEREST') = '2027-04-03 02:00:00',
    CONCAT_WS(' ', 'payouts', (SELECT COUNT(*) FROM `TRANSACTION` WHERE fd_id = @fd AND transaction_type = 'FD_INTEREST'),
              'last', (SELECT MAX(txn_timestamp) FROM `TRANSACTION` WHERE fd_id = @fd AND transaction_type = 'FD_INTEREST')));
CALL mims_test.check_that(@suite, 'IP12', 'At maturity the FD is MATURED on its maturity date and the principal is paid back by SYSTEM',
    (SELECT COUNT(*) FROM FIXED_DEPOSIT
     WHERE fd_id IN (@fd, @fd2) AND status = 'MATURED' AND close_date = '2027-04-03' AND next_payout_date IS NULL) = 2
    AND (SELECT COUNT(*) FROM `TRANSACTION`
         WHERE fd_id IN (@fd, @fd2) AND transaction_type = 'FD_CLOSURE' AND amount = 40000.00
           AND channel = 'SYSTEM' AND processed_by_agent_id IS NULL) = 2,
    CONCAT_WS(' ', 'status', (SELECT status FROM FIXED_DEPOSIT WHERE fd_id = @fd), (SELECT status FROM FIXED_DEPOSIT WHERE fd_id = @fd2)));
CALL mims_test.check_that(@suite, 'IP12', 'An FD on a FROZEN account is neither paid nor matured',
    (SELECT status FROM FIXED_DEPOSIT WHERE fd_id = @fd3) = 'ACTIVE'
    AND (SELECT COUNT(*) FROM `TRANSACTION` WHERE fd_id = @fd3 AND transaction_type <> 'FD_OPEN') = 0,
    CONCAT_WS(' ', 'status', (SELECT status FROM FIXED_DEPOSIT WHERE fd_id = @fd3)));

-- IP13: every posting kept the balance equal to the transaction history
CALL mims_test.check_that(@suite, 'IP13', 'Every test account''s balance equals its transaction history',
    (SELECT COUNT(*) FROM SAVINGS_ACCOUNT
     WHERE account_id IN (@acc, @late, @tiny, @frozen, @fd_acc, @fd2_acc, @fd3_acc)
       AND balance = mims_test.ledger_balance(account_id)) = 7,
    'at least one balance differs from its transactions');

CALL mims_test.clock_reset();
CALL mims_test.report(@suite);
