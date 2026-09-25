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

