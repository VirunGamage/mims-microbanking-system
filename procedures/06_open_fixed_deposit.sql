-- Opens a Fixed Deposit (REQ-FD-03, REQ-FD-09). The FD row, the FD_OPEN transaction and the balance debit are saved together or not at all.
-- Needs mims_schema.sql, the trg_savings_balance_guard trigger (04_triggers.sql) and the helper procedures
-- PROC_CHECK_BUSINESS_HOURS and PROC_NEXT_TXN_REF (01_deposit_withdrawal.sql) to be in place.

USE mims;

DROP PROCEDURE IF EXISTS PROC_OPEN_FIXED_DEPOSIT;

DELIMITER $$

-- Opens an FD on a savings account and takes the amount out of the savings balance (Model A). It only goes through if the account is
-- ACTIVE, the customer is the PRIMARY holder, the account has no other ACTIVE FD and the balance after the debit stays at or above
-- the plan minimum. If any rule fails nothing is saved and an error is raised.
-- The FD starts today, its rate is copied from FD_PLAN, maturity is today + the plan's duration and the first payout is one cycle away.
-- It is always a BRANCH transaction, so an ACTIVE agent is required.
-- Gives back the new fd_id, the reference number of the FD_OPEN transaction and the new savings balance.
CREATE PROCEDURE PROC_OPEN_FIXED_DEPOSIT (
    IN  p_account_id    INT,
    IN  p_customer_id   INT,
    IN  p_fd_plan_id    INT,
    IN  p_amount        DECIMAL(14,2),
    IN  p_agent_id      INT,
    OUT p_fd_id         INT,
    OUT p_reference_no  VARCHAR(30),
    OUT p_new_balance   DECIMAL(14,2)
)
BEGIN
    DECLARE v_agent_status  VARCHAR(12) DEFAULT NULL;
    DECLARE v_status        VARCHAR(10) DEFAULT NULL;
    DECLARE v_balance       DECIMAL(14,2);
    DECLARE v_min_balance   DECIMAL(12,2);
    DECLARE v_role          VARCHAR(10) DEFAULT NULL;
    DECLARE v_duration      INT         DEFAULT NULL;
    DECLARE v_rate          DECIMAL(5,2);
    DECLARE v_cycle_days    INT;
    DECLARE v_active_fds    INT;

    -- If anything fails: turn the balance guard back on, undo every change made so far and pass the error to the caller.
    -- The flag has to be reset here because ROLLBACK does not undo session variables.
    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        SET @allow_balance_update = 0;
        ROLLBACK;
        RESIGNAL;
    END;

    START TRANSACTION;

    IF p_amount IS NULL OR p_amount <= 0 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Fixed Deposit amount must be greater than zero';
    END IF;

    CALL PROC_CHECK_BUSINESS_HOURS();   -- Same business hours as a deposit or withdrawal

    SELECT status INTO v_agent_status FROM AGENT WHERE agent_id = p_agent_id;
    IF v_agent_status IS NULL THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Agent not found';
    END IF;
    IF v_agent_status <> 'ACTIVE' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Processing agent is not ACTIVE';
    END IF;

    -- OF sa locks only the account row, so nobody else can change this balance or open an FD on it until the transaction ends
    SELECT sa.status, sa.balance, sp.minimum_balance
    INTO   v_status, v_balance, v_min_balance
    FROM   SAVINGS_ACCOUNT sa
    JOIN   SAVINGS_PLAN sp ON sp.plan_id = sa.plan_id
    WHERE  sa.account_id = p_account_id
    FOR UPDATE OF sa;

    IF v_status IS NULL THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Account not found';
    END IF;
    IF v_status <> 'ACTIVE' THEN   -- Nothing in the schema stops an FD on a CLOSED or FROZEN account, so it is checked here
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Account is not active';
    END IF;

    -- Unlike deposits and withdrawals, only the PRIMARY holder of a joint account can open an FD
    SELECT role INTO v_role
    FROM ACCOUNT_HOLDER
    WHERE account_id = p_account_id AND customer_id = p_customer_id;
    IF v_role IS NULL THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Customer is not a holder of this account';
    END IF;
    IF v_role <> 'PRIMARY' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Only the PRIMARY holder can open a Fixed Deposit';
    END IF;

    SELECT duration_days, interest_rate INTO v_duration, v_rate
    FROM FD_PLAN WHERE fd_plan_id = p_fd_plan_id;
    IF v_duration IS NULL THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Fixed Deposit plan not found';
    END IF;

    -- Only one ACTIVE FD per account (trg_single_active_fd enforces it too, this gives a clearer error first).
    -- FOR UPDATE makes this a locking read. A plain SELECT reads an older snapshot from before the lock wait and could miss
    -- an FD another agent just committed.
    SELECT COUNT(*) INTO v_active_fds
    FROM FIXED_DEPOSIT
    WHERE account_id = p_account_id AND status = 'ACTIVE'
    FOR UPDATE;
    IF v_active_fds > 0 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'This Savings Account already has an active Fixed Deposit.';
    END IF;

    -- The balance left after the debit cannot drop below the plan minimum
    IF v_balance - p_amount < v_min_balance THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Fixed Deposit would take the balance below the plan minimum';
    END IF;

    SELECT CAST(config_value AS UNSIGNED) INTO v_cycle_days
    FROM SYSTEM_CONFIG WHERE config_key = 'fd_interest_cycle_days';

    -- The FD row comes first because the FD_OPEN transaction below points to its fd_id
    INSERT INTO FIXED_DEPOSIT
        (amount, interest_rate, start_date, maturity_date, status, next_payout_date,
         close_date, account_id, fd_plan_id)
    VALUES
        (p_amount, v_rate, CURDATE(), DATE_ADD(CURDATE(), INTERVAL v_duration DAY), 'ACTIVE',
         DATE_ADD(CURDATE(), INTERVAL v_cycle_days DAY), NULL, p_account_id, p_fd_plan_id);
    SET p_fd_id = LAST_INSERT_ID();   -- Read straight away because PROC_NEXT_TXN_REF changes LAST_INSERT_ID

    CALL PROC_NEXT_TXN_REF(p_reference_no);

    INSERT INTO `TRANSACTION`
        (transaction_type, amount, reference_no, channel, review_flag,
         account_id, processed_by_agent_id, fd_id)
    VALUES
        ('FD_OPEN', p_amount, p_reference_no, 'BRANCH', 0,
         p_account_id, p_agent_id, p_fd_id);

    -- Guard flag is on only for this one UPDATE, see PROC_PROCESS_DEPOSIT
    SET @allow_balance_update = 1;
    UPDATE SAVINGS_ACCOUNT
    SET balance = balance - p_amount
    WHERE account_id = p_account_id;
    SET @allow_balance_update = 0;

    SELECT balance INTO p_new_balance
    FROM SAVINGS_ACCOUNT WHERE account_id = p_account_id;

    COMMIT;
END$$

DELIMITER ;
