-- Two triggers: only one ACTIVE FD per savings account and no direct edits of a savings balance (REQ-FD-02, REQ-TXN-04).
-- Needs mims_schema.sql. Load it AFTER the sample data because the sample data updates balances directly and the balance guard would block that.

USE mims;

DROP TRIGGER IF EXISTS trg_single_active_fd;
DROP TRIGGER IF EXISTS trg_savings_balance_guard;

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

-- Blocks any direct UPDATE that changes SAVINGS_ACCOUNT.balance unless the procedure doing it has set the @allow_balance_update flag first (REQ-TXN-04). Stops a bug or a bypass from
-- silently changing a balance without a matching TRANSACTION row.

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