-- Interest posting for savings accounts (REQ-PLN-05) and Fixed Deposits (REQ-FD-04, REQ-FD-05). Every interest credit is its own
-- SYSTEM transaction and raises the savings balance in the same unit.
-- Needs mims_schema.sql, the trg_savings_balance_guard trigger (04_triggers.sql) and PROC_NEXT_TXN_REF (01_deposit_withdrawal.sql).
--
-- Daily run order:
--   1. CALL PROC_RUN_FD_INTEREST(CURDATE(), @n);
--   2. CALL PROC_PROCESS_FD_MATURITY();
--   3. CALL PROC_RUN_SAVINGS_INTEREST(CURDATE(), @n);
-- FD interest goes before maturity because the last payout falls on the maturity date, and a matured FD is no longer ACTIVE.
-- Savings interest goes last because it is worked out on the balance at its due date, which has to include the earlier FD
-- interest (validator check S01 fails otherwise).
-- Each procedure moves the due date forward as it posts, so a rerun never pays a cycle twice and a late run posts every missed cycle.

USE mims;

DROP FUNCTION  IF EXISTS FUNC_CALC_INTEREST;
DROP PROCEDURE IF EXISTS PROC_POST_SAVINGS_INTEREST;
DROP PROCEDURE IF EXISTS PROC_RUN_SAVINGS_INTEREST;
DROP PROCEDURE IF EXISTS PROC_POST_FD_INTEREST;
DROP PROCEDURE IF EXISTS PROC_RUN_FD_INTEREST;
DROP EVENT     IF EXISTS ev_daily_interest;

DELIMITER $$

-- The one place the interest formula lives: base x rate / 100 x cycle days / day count basis, rounded to 2 decimals.
-- The basis (365) comes from SYSTEM_CONFIG, the cycle length is passed in because savings and FD each have their own setting.
CREATE FUNCTION FUNC_CALC_INTEREST (
    p_base         DECIMAL(14,2),
    p_annual_rate  DECIMAL(5,2),
    p_cycle_days   INT
)
RETURNS DECIMAL(14,2)
READS SQL DATA   -- Reads SYSTEM_CONFIG, so it cannot be declared DETERMINISTIC
BEGIN
    DECLARE v_basis INT;

    SELECT CAST(config_value AS UNSIGNED) INTO v_basis
    FROM SYSTEM_CONFIG WHERE config_key = 'interest_day_count_basis';

    RETURN ROUND(p_base * p_annual_rate / 100 * p_cycle_days / v_basis, 2);
END$$

-- Posts every savings interest cycle due on one account up to p_run_date, saved together or not at all. Interest is on the balance
-- just before the posting at the plan rate. A 0.00 result is not posted (REQ-PLN-05) but the due date still moves on.
-- Accounts that are not ACTIVE, or have no next_interest_date, are skipped.
-- Each posting is stamped 01:00 on its due date (like the sample data) so the 30 day spacing stays exact after a late run.
-- Gives back how many interest transactions were posted.
CREATE PROCEDURE PROC_POST_SAVINGS_INTEREST (
    IN  p_account_id  INT,
    IN  p_run_date    DATE,
    OUT p_postings    INT
)
BEGIN
    DECLARE v_status        VARCHAR(10) DEFAULT NULL;
    DECLARE v_due           DATE;
    DECLARE v_rate          DECIMAL(5,2);
    DECLARE v_cycle_days    INT;
    DECLARE v_stamp         DATETIME;
    DECLARE v_base          DECIMAL(14,2);
    DECLARE v_interest      DECIMAL(14,2);
    DECLARE v_reference_no  VARCHAR(30);

    -- Same clean up as in the deposit and withdrawal procedures
    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        SET @allow_balance_update = 0;
        ROLLBACK;
        RESIGNAL;
    END;

    SET p_postings = 0;

    IF p_run_date IS NULL THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Run date is required';
    END IF;
    IF p_run_date > CURDATE() THEN   -- Interest cannot be paid ahead of time
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Run date cannot be in the future';
    END IF;

    START TRANSACTION;

    -- Locks the account row, so a second run at the same time waits here and then sees the new due date
    SELECT sa.status, sa.next_interest_date, sp.interest_rate
    INTO   v_status, v_due, v_rate
    FROM   SAVINGS_ACCOUNT sa
    JOIN   SAVINGS_PLAN sp ON sp.plan_id = sa.plan_id
    WHERE  sa.account_id = p_account_id
    FOR UPDATE OF sa;

    IF v_status IS NULL THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Account not found';
    END IF;

    IF v_status = 'ACTIVE' AND v_due IS NOT NULL THEN
        SELECT CAST(config_value AS UNSIGNED) INTO v_cycle_days
        FROM SYSTEM_CONFIG WHERE config_key = 'savings_interest_cycle_days';

        WHILE v_due <= p_run_date DO
            SET v_stamp = TIMESTAMP(v_due, '01:00:00');

            -- Balance just before this posting, worked out from the ledger and not from SAVINGS_ACCOUNT.balance,
            -- so a late run uses the balance the account had on the due day
            SELECT COALESCE(SUM(CASE WHEN transaction_type IN ('DEPOSIT','SAVINGS_INTEREST','FD_INTEREST','FD_CLOSURE')
                                     THEN amount ELSE -amount END), 0)
            INTO   v_base
            FROM   `TRANSACTION`
            WHERE  account_id = p_account_id AND txn_timestamp <= v_stamp;

            SET v_interest = FUNC_CALC_INTEREST(v_base, v_rate, v_cycle_days);

            IF v_interest > 0 THEN   -- chk_txn_amount_positive does not allow a 0.00 transaction
                CALL PROC_NEXT_TXN_REF(v_reference_no);

                INSERT INTO `TRANSACTION`
                    (transaction_type, amount, txn_timestamp, reference_no, channel, review_flag,
                     account_id, processed_by_agent_id, fd_id)
                VALUES
                    ('SAVINGS_INTEREST', v_interest, v_stamp, v_reference_no, 'SYSTEM', 0,
                     p_account_id, NULL, NULL);

                -- Guard flag is on only for this one UPDATE, see PROC_PROCESS_DEPOSIT
                SET @allow_balance_update = 1;
                UPDATE SAVINGS_ACCOUNT
                SET balance = balance + v_interest
                WHERE account_id = p_account_id;
                SET @allow_balance_update = 0;

                SET p_postings = p_postings + 1;
            END IF;

            SET v_due = DATE_ADD(v_due, INTERVAL v_cycle_days DAY);   -- Counts from the due date so the rhythm never drifts
        END WHILE;

        UPDATE SAVINGS_ACCOUNT SET next_interest_date = v_due WHERE account_id = p_account_id;
    END IF;

    COMMIT;
END$$

-- Posts savings interest for every ACTIVE account due on p_run_date or earlier. Each account is its own unit of work, so if one
-- fails the earlier ones stay posted and the job can simply be run again.
-- Walks the accounts by account_id instead of using a cursor, because the rows change as it goes. Call it outside a transaction.
-- Gives back the total number of interest transactions posted.
CREATE PROCEDURE PROC_RUN_SAVINGS_INTEREST (
    IN  p_run_date  DATE,
    OUT p_postings  INT
)
BEGIN
    DECLARE v_account_id  INT DEFAULT 0;
    DECLARE v_count       INT;

    SET p_postings = 0;

    IF p_run_date IS NULL THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Run date is required';
    END IF;

    account_loop: LOOP
        SELECT MIN(account_id) INTO v_account_id   -- The next due account after the one just done (NULL when none are left)
        FROM SAVINGS_ACCOUNT
        WHERE status = 'ACTIVE' AND next_interest_date <= p_run_date AND account_id > v_account_id;

        IF v_account_id IS NULL THEN
            LEAVE account_loop;
        END IF;

        CALL PROC_POST_SAVINGS_INTEREST(v_account_id, p_run_date, v_count);
        SET p_postings = p_postings + v_count;
    END LOOP;
END$$

-- Posts every FD interest payout due on one FD up to p_run_date, saved together or not at all. A payout is amount x rate x cycle / basis
-- (using the rate copied into the FD) and is credited to the savings account as an FD_INTEREST transaction with the fd_id.
-- Only ACTIVE FDs on ACTIVE accounts with a next_payout_date are touched.
-- Payouts stop at the maturity date and next_payout_date becomes NULL after the last one. The FD stays ACTIVE until
-- PROC_PROCESS_FD_MATURITY pays the principal back.
-- Each posting is stamped 02:00 on its due date, like the sample data. Gives back how many interest transactions were posted.
CREATE PROCEDURE PROC_POST_FD_INTEREST (
    IN  p_fd_id     INT,
    IN  p_run_date  DATE,
    OUT p_postings  INT
)
BEGIN
    DECLARE v_status          VARCHAR(10) DEFAULT NULL;
    DECLARE v_amount          DECIMAL(14,2);
    DECLARE v_rate            DECIMAL(5,2);
    DECLARE v_due             DATE;
    DECLARE v_maturity        DATE;
    DECLARE v_account_id      INT;
    DECLARE v_account_status  VARCHAR(10) DEFAULT NULL;
    DECLARE v_cycle_days      INT;
    DECLARE v_stamp           DATETIME;
    DECLARE v_interest        DECIMAL(14,2);
    DECLARE v_reference_no    VARCHAR(30);

    -- Same clean up as in the deposit and withdrawal procedures
    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        SET @allow_balance_update = 0;
        ROLLBACK;
        RESIGNAL;
    END;

    SET p_postings = 0;

    IF p_run_date IS NULL THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Run date is required';
    END IF;
    IF p_run_date > CURDATE() THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Run date cannot be in the future';
    END IF;

    START TRANSACTION;

    SELECT status, amount, interest_rate, next_payout_date, maturity_date, account_id
    INTO   v_status, v_amount, v_rate, v_due, v_maturity, v_account_id
    FROM   FIXED_DEPOSIT
    WHERE  fd_id = p_fd_id
    FOR UPDATE;

    IF v_status IS NULL THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Fixed Deposit not found';
    END IF;

    -- The FD is locked first and then its account, the same order PROC_CLOSE_FIXED_DEPOSIT uses, so the two cannot deadlock
    SELECT status INTO v_account_status
    FROM SAVINGS_ACCOUNT
    WHERE account_id = v_account_id
    FOR UPDATE;

    IF v_status = 'ACTIVE' AND v_due IS NOT NULL AND v_account_status = 'ACTIVE' THEN
        SELECT CAST(config_value AS UNSIGNED) INTO v_cycle_days
        FROM SYSTEM_CONFIG WHERE config_key = 'fd_interest_cycle_days';

        WHILE v_due <= p_run_date AND v_due <= v_maturity DO
            SET v_stamp    = TIMESTAMP(v_due, '02:00:00');
            SET v_interest = FUNC_CALC_INTEREST(v_amount, v_rate, v_cycle_days);

            IF v_interest > 0 THEN
                CALL PROC_NEXT_TXN_REF(v_reference_no);

                INSERT INTO `TRANSACTION`
                    (transaction_type, amount, txn_timestamp, reference_no, channel, review_flag,
                     account_id, processed_by_agent_id, fd_id)
                VALUES
                    ('FD_INTEREST', v_interest, v_stamp, v_reference_no, 'SYSTEM', 0,
                     v_account_id, NULL, p_fd_id);

                SET @allow_balance_update = 1;
                UPDATE SAVINGS_ACCOUNT
                SET balance = balance + v_interest
                WHERE account_id = v_account_id;
                SET @allow_balance_update = 0;

                SET p_postings = p_postings + 1;
            END IF;

            SET v_due = DATE_ADD(v_due, INTERVAL v_cycle_days DAY);
        END WHILE;

        IF v_due > v_maturity THEN   -- The payout on the maturity date was the last one, nothing is left to schedule
            SET v_due = NULL;
        END IF;

        UPDATE FIXED_DEPOSIT SET next_payout_date = v_due WHERE fd_id = p_fd_id;
    END IF;

    COMMIT;
END$$

-- Posts FD interest for every ACTIVE FD due on p_run_date or earlier. Each FD is its own unit of work, see PROC_RUN_SAVINGS_INTEREST.
-- Call it outside a transaction. Gives back the total number of interest transactions posted.
CREATE PROCEDURE PROC_RUN_FD_INTEREST (
    IN  p_run_date  DATE,
    OUT p_postings  INT
)
BEGIN
    DECLARE v_fd_id  INT DEFAULT 0;
    DECLARE v_count  INT;

    SET p_postings = 0;

    IF p_run_date IS NULL THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Run date is required';
    END IF;

    fd_loop: LOOP
        SELECT MIN(fd_id) INTO v_fd_id
        FROM FIXED_DEPOSIT
        WHERE status = 'ACTIVE' AND next_payout_date <= p_run_date AND fd_id > v_fd_id;

        IF v_fd_id IS NULL THEN
            LEAVE fd_loop;
        END IF;

        CALL PROC_POST_FD_INTEREST(v_fd_id, p_run_date, v_count);
        SET p_postings = p_postings + v_count;
    END LOOP;
END$$

-- The daily job as a MySQL event (REQ-FD-04). It is created DISABLED so loading this file never changes the data. To switch it on:
--     SET GLOBAL event_scheduler = ON;   (needs a privileged MySQL account)
--     ALTER EVENT ev_daily_interest ENABLE;
-- It runs every day from 03:00 tomorrow. The maturity call is commented out because PROC_PROCESS_FD_MATURITY is in
-- 03_fixed_deposit.sql, so remove the two dashes once that file is loaded.
CREATE EVENT ev_daily_interest
ON SCHEDULE EVERY 1 DAY
STARTS TIMESTAMP(CURRENT_DATE + INTERVAL 1 DAY, '03:00:00')
DISABLE
DO
BEGIN
    CALL PROC_RUN_FD_INTEREST(CURDATE(), @fd_interest_postings);
    -- CALL PROC_PROCESS_FD_MATURITY();
    CALL PROC_RUN_SAVINGS_INTEREST(CURDATE(), @savings_interest_postings);
END$$

DELIMITER ;
