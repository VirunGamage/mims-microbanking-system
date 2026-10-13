-- Fixed Deposit closure and maturity (REQ-FD-06, REQ-FD-08). Both pay the principal back into the savings account as an FD_CLOSURE transaction.
-- Needs mims_schema.sql, the trg_savings_balance_guard trigger (04_triggers.sql) and PROC_NEXT_TXN_REF and PROC_CHECK_BUSINESS_HOURS (01_deposit_withdrawal.sql).
-- PROC_PROCESS_FD_MATURITY has to run after PROC_RUN_FD_INTEREST (07_interest_posting.sql).

USE mims;

DROP PROCEDURE IF EXISTS PROC_CLOSE_FIXED_DEPOSIT;
DROP PROCEDURE IF EXISTS PROC_PROCESS_FD_MATURITY;

DELIMITER $$

-- Closes an ACTIVE FD early. Only the PRIMARY holder can do it, during business hours, while the savings account is ACTIVE. 
-- The principal goes back to the savings balance and the interest of the unfinished 30 day cycle is forfeited, no penalty (REQ-FD-08).
--
-- Lock order: every procedure that touches both locks the savings account first and the FD second (PROC_OPEN_FIXED_DEPOSIT, PROC_POST_FD_INTEREST and PROC_PROCESS_FD_MATURITY too). 
-- If two procedures took them in opposite orders, an open and a close on the same account at the same moment could each hold one lock and wait for the other and MySQL would kill one (deadlock).

CREATE PROCEDURE PROC_CLOSE_FIXED_DEPOSIT (
    IN p_fd_id INT,
    IN p_customer_id INT,
    IN p_agent_id INT
)
BEGIN
    DECLARE v_account_id INT DEFAULT NULL; 
    DECLARE v_account_status VARCHAR(10);
    DECLARE v_amount DECIMAL(14,2);
    DECLARE v_status VARCHAR(10) DEFAULT NULL;
    DECLARE v_is_primary INT;
    DECLARE v_ref_no VARCHAR(30);
    DECLARE v_next_payout DATE;
    DECLARE v_maturity DATE;

    -- If anything fails, turn the balance guard back on, undo every change made so far and pass the error to the caller.
    -- The flag has to be reset here because ROLLBACK does not undo session variables.

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        SET @allow_balance_update = 0;
        ROLLBACK;
        RESIGNAL;
    END;

    START TRANSACTION;

    CALL PROC_CHECK_BUSINESS_HOURS();   -- Same business hours as every other money movement made by an agent

    -- An FD never moves to another account, so its account can be read before any lock is taken 
    SELECT account_id INTO v_account_id FROM FIXED_DEPOSIT WHERE fd_id = p_fd_id; 
    IF v_account_id IS NULL THEN   -- No row came back, so the FD does not exist.
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Fixed Deposit not found';
    END IF;

    -- The savings account first, then the FD (see the lock order above) 
    SELECT status INTO v_account_status 
    FROM SAVINGS_ACCOUNT 
    WHERE account_id = v_account_id 
    FOR UPDATE; 
    
    SELECT amount, status, next_payout_date, maturity_date 
    INTO v_amount, v_status, v_next_payout, v_maturity 
    FROM FIXED_DEPOSIT 
    WHERE fd_id = p_fd_id 
    FOR UPDATE;

    IF v_status <> 'ACTIVE' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Fixed Deposit is not ACTIVE';
    END IF;

    SELECT COUNT(*) INTO v_is_primary
    FROM ACCOUNT_HOLDER
    WHERE account_id = v_account_id
      AND customer_id = p_customer_id
      AND role = 'PRIMARY';

    IF v_is_primary = 0 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Only the PRIMARY holder can close this Fixed Deposit';
    END IF;

    -- No money moves in or out of a FROZEN or CLOSED account (the same rule as deposits and withdrawals) 
    IF v_account_status <> 'ACTIVE' THEN 
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Account is not active'; 
    END IF;

    IF v_next_payout IS NOT NULL AND v_next_payout <= CURDATE() THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Interest is due on this Fixed Deposit; post the interest before closing it';
    END IF;
    
    -- A Fixed Deposit that has reached its maturity date is paid back by PROC_PROCESS_FD_MATURITY (status MATURED), not closed early.
    IF v_maturity <= CURDATE() THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'This Fixed Deposit has reached maturity; run the maturity step instead of closing it';
    END IF;
    
    UPDATE FIXED_DEPOSIT
    SET status = 'CLOSED',
        close_date = CURDATE(),
        next_payout_date = NULL
    WHERE fd_id = p_fd_id;

    CALL PROC_NEXT_TXN_REF(v_ref_no);  -- Same TXN + 7 digits format as every other transaction.

    -- The transaction row goes in before the balance changes, the same order as every other procedure.
    -- trg_transaction_bi refuses it here if the agent is not ACTIVE and the handler undoes the FD update above.
    INSERT INTO `TRANSACTION` (
        transaction_type, amount, reference_no, channel,
        account_id, processed_by_agent_id, fd_id
    ) VALUES (
        'FD_CLOSURE', v_amount, v_ref_no, 'BRANCH',
        v_account_id, p_agent_id, p_fd_id
    );
    -- Guard flag is on only for this one UPDATE, see PROC_PROCESS_DEPOSIT. 
    SET @allow_balance_update = 1; 
    UPDATE SAVINGS_ACCOUNT 
    SET balance = balance + v_amount 
    WHERE account_id = v_account_id; 
    SET @allow_balance_update = 0;

    COMMIT;
END$$

-- Matures every ACTIVE FD whose maturity date has come: status MATURED, close date = maturity date and the principal goes back to the savings account as an FD_CLOSURE (channel SYSTEM).
-- Each FD is its own unit of work, so if one fails the earlier ones stay matured and the procedure can simply be run again.
-- An FD whose last interest payout is not posted yet is skipped and picked up on the next run, so that payout is never lost.

CREATE PROCEDURE PROC_PROCESS_FD_MATURITY ()
BEGIN
    DECLARE done INT DEFAULT 0;
    DECLARE v_fd_id INT;
    DECLARE v_account_id INT;
    DECLARE v_amount DECIMAL(14,2);
    DECLARE v_ref_no VARCHAR(30);
    DECLARE v_still_active INT;
    DECLARE v_locked_account INT;

    DECLARE cur CURSOR FOR
        SELECT fd_id, account_id, amount
        FROM FIXED_DEPOSIT
        WHERE status = 'ACTIVE'
          AND maturity_date <= CURDATE()
          AND (next_payout_date IS NULL OR next_payout_date > maturity_date);
    DECLARE CONTINUE HANDLER FOR NOT FOUND SET done = 1;
    
    -- Same clean up as in PROC_CLOSE_FIXED_DEPOSIT.
    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        SET @allow_balance_update = 0;
        ROLLBACK;
        RESIGNAL;
    END;

    OPEN cur;

    read_loop: LOOP
        FETCH cur INTO v_fd_id, v_account_id, v_amount;
        IF done THEN
            LEAVE read_loop;
        END IF;

        START TRANSACTION;

        -- The savings account is locked before the FD, the same order as PROC_CLOSE_FIXED_DEPOSIT (no deadlock) 
        SELECT account_id INTO v_locked_account 
        FROM SAVINGS_ACCOUNT 
        WHERE account_id = v_account_id 
        FOR UPDATE;
        
        -- Checked again under a lock because the FD may have been closed early since the cursor opened.
        -- Stops the principal being paid back twice.
        SELECT COUNT(*) INTO v_still_active
        FROM FIXED_DEPOSIT
        WHERE fd_id = v_fd_id AND status = 'ACTIVE'
        FOR UPDATE;

        IF v_still_active = 1 THEN
            UPDATE FIXED_DEPOSIT
            SET status = 'MATURED',
                close_date = maturity_date,
                next_payout_date = NULL
            WHERE fd_id = v_fd_id;

            CALL PROC_NEXT_TXN_REF(v_ref_no);

            SET @allow_balance_update = 1;
            UPDATE SAVINGS_ACCOUNT
            SET balance = balance + v_amount
            WHERE account_id = v_account_id;
            SET @allow_balance_update = 0;

            INSERT INTO `TRANSACTION` (
                transaction_type, amount, reference_no, channel,
                account_id, fd_id
            ) VALUES (
                'FD_CLOSURE', v_amount, v_ref_no, 'SYSTEM',
                v_account_id, v_fd_id
            );
        END IF;

        COMMIT;
    END LOOP;

    CLOSE cur;
END$$

DELIMITER ;