DELIMITER $$

CREATE PROCEDURE PROC_CLOSE_FIXED_DEPOSIT (
    IN p_fd_id INT,
    IN p_customer_id INT,
    IN p_agent_id INT
)
BEGIN
    DECLARE v_account_id INT;
    DECLARE v_amount DECIMAL(14,2);
    DECLARE v_status VARCHAR(10);
    DECLARE v_is_primary INT;
    DECLARE v_ref_no VARCHAR(30);

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        RESIGNAL;
    END;

    START TRANSACTION;

    SELECT account_id, amount, status
    INTO v_account_id, v_amount, v_status
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

    UPDATE FIXED_DEPOSIT
    SET status = 'CLOSED',
        close_date = CURDATE(),
        next_payout_date = NULL
    WHERE fd_id = p_fd_id;

    SET v_ref_no = CONCAT('TXN-TEMP-', p_fd_id, '-', UNIX_TIMESTAMP());

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

DELIMITER ;


DELIMITER $$

CREATE PROCEDURE PROC_PROCESS_FD_MATURITY ()
BEGIN
    DECLARE done INT DEFAULT 0;
    DECLARE v_fd_id INT;
    DECLARE v_account_id INT;
    DECLARE v_amount DECIMAL(14,2);
    DECLARE v_ref_no VARCHAR(30);

    DECLARE cur CURSOR FOR
        SELECT fd_id, account_id, amount
        FROM FIXED_DEPOSIT
        WHERE status = 'ACTIVE'
          AND maturity_date <= CURDATE();
    DECLARE CONTINUE HANDLER FOR NOT FOUND SET done = 1;

    OPEN cur;

    read_loop: LOOP
        FETCH cur INTO v_fd_id, v_account_id, v_amount;
        IF done THEN
            LEAVE read_loop;
        END IF;

        UPDATE FIXED_DEPOSIT
        SET status = 'MATURED',
            close_date = maturity_date,
            next_payout_date = NULL
        WHERE fd_id = v_fd_id;

        SET v_ref_no = CONCAT('TXN-TEMP-', v_fd_id, '-', UNIX_TIMESTAMP());

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

    END LOOP;

    CLOSE cur;
END$$

DELIMITER ;