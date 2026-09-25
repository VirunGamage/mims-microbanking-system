DELIMITER $$

CREATE TRIGGER trg_single_active_fd
BEFORE INSERT ON FIXED_DEPOSIT
FOR EACH ROW
BEGIN
    DECLARE active_fd_count INT;

    IF NEW.status = 'ACTIVE' THEN
        SELECT COUNT(*) INTO active_fd_count
        FROM FIXED_DEPOSIT
        WHERE account_id = NEW.account_id
          AND status = 'ACTIVE';

        IF active_fd_count > 0 THEN
            SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'This Savings Account already has an active Fixed Deposit.';
        END IF;
    END IF;
END$$

DELIMITER ;

DELIMITER $$

CREATE TRIGGER trg_joint_min_holders
AFTER INSERT ON ACCOUNT_HOLDER
FOR EACH ROW
BEGIN
    DECLARE v_plan_name VARCHAR(50);
    DECLARE v_holder_count INT;

    SELECT sp.plan_name INTO v_plan_name
    FROM SAVINGS_ACCOUNT sa
    JOIN SAVINGS_PLAN sp ON sa.plan_id = sp.plan_id
    WHERE sa.account_id = NEW.account_id;

    IF v_plan_name = 'Joint' THEN
        SELECT COUNT(*) INTO v_holder_count
        FROM ACCOUNT_HOLDER
        WHERE account_id = NEW.account_id;

        IF v_holder_count = 1 AND NEW.role = 'PRIMARY' THEN
            SELECT 1;
        END IF;
    END IF;
END$$

DELIMITER ;

DELIMITER $$

CREATE TRIGGER trg_savings_balance_guard
BEFORE UPDATE ON SAVINGS_ACCOUNT
FOR EACH ROW
BEGIN
    IF NEW.balance <> OLD.balance
       AND (@allow_balance_update IS NULL OR @allow_balance_update = 0) THEN
        SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'Direct balance updates are not allowed; use a procedure';
    END IF;
END$$

DELIMITER ;