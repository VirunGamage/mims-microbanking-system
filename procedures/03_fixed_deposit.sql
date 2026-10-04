-- Fixed Deposit closure and maturity (REQ-FD-06, REQ-FD-08). Both pay the principal back into the savings account as an FD_CLOSURE transaction.
-- Needs mims_schema.sql, the trg_savings_balance_guard trigger (04_triggers.sql) and PROC_NEXT_TXN_REF (01_deposit_withdrawal.sql).
-- PROC_PROCESS_FD_MATURITY has to run after PROC_RUN_FD_INTEREST (07_interest_posting.sql).

USE mims;

DROP PROCEDURE IF EXISTS PROC_CLOSE_FIXED_DEPOSIT;
DROP PROCEDURE IF EXISTS PROC_PROCESS_FD_MATURITY;

DELIMITER $$

-- Closes an ACTIVE FD early. Only the PRIMARY holder can do it. 
-- The principal goes back to the savings balance and the interest of the unfinished 30 day cycle is forfeited, no penalty (REQ-FD-08).

CREATE PROCEDURE PROC_CLOSE_FIXED_DEPOSIT (
    IN p_fd_id INT,
    IN p_customer_id INT,
    IN p_agent_id INT
)
BEGIN
    DECLARE v_account_id INT;
    DECLARE v_amount DECIMAL(14,2);
    DECLARE v_status VARCHAR(10) DEFAULT NULL;
    DECLARE v_is_primary INT;
    DECLARE v_ref_no VARCHAR(30);

    -- If anything fails, turn the balance guard back on, undo every change made so far and pass the error to the caller.
    -- The flag has to be reset here because ROLLBACK does not undo session variables.

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        SET @allow_balance_update = 0;
        ROLLBACK;
        RESIGNAL;
    END;

    START TRANSACTION;

    SELECT account_id, amount, status
    INTO v_account_id, v_amount, v_status
    FROM FIXED_DEPOSIT
    WHERE fd_id = p_fd_id
    FOR UPDATE;

    IF v_status IS NULL THEN   -- No row came back, so the FD does not exist.
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Fixed Deposit not found';
    END IF;

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

    UPDATE FIXED_DEPOSIT
    SET status = 'CLOSED',
        close_date = CURDATE(),
        next_payout_date = NULL
    WHERE fd_id = p_fd_id;

    CALL PROC_NEXT_TXN_REF(v_ref_no);  -- Same TXN + 7 digits format as every other transaction.

    -- Guard flag is on only for this one UPDATE, see PROC_PROCESS_DEPOSIT.
    SET @allow_balance_update = 1;
    UPDATE SAVINGS_ACCOUNT
    SET balance = balance + v_amount
    WHERE account_id = v_account_id;
    SET @allow_balance_update = 0;

    INSERT INTO `TRANSACTION` (
        transaction_type, amount, reference_no, channel,
        account_id, processed_by_agent_id, fd_id
    ) VALUES (
        'FD_CLOSURE', v_amount, v_ref_no, 'BRANCH',
        v_account_id, p_agent_id, p_fd_id
    );

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