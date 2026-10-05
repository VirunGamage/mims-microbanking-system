-- Makes TRANSACTION an append only log (REQ-TXN-05). A committed row can never be changed or deleted, a mistake is fixed
-- by posting a new offsetting transaction instead.
-- Needs mims_schema.sql. The procedures and sample data only INSERT into TRANSACTION, so this can be loaded any time after the schema.

USE mims;

DROP TRIGGER IF EXISTS trg_transaction_bu;
DROP TRIGGER IF EXISTS trg_transaction_bd;

DELIMITER $$

-- Refuses every UPDATE on TRANSACTION. There is no condition on purpose, it fires even if the new value equals the old one.
CREATE TRIGGER trg_transaction_bu BEFORE UPDATE ON `TRANSACTION`
FOR EACH ROW
BEGIN
    SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'Transactions cannot be changed; post an offsetting transaction instead';
END$$

-- Refuses every DELETE on TRANSACTION. TRUNCATE and DROP TABLE skip triggers, so the application's MySQL account should not have those privileges.
CREATE TRIGGER trg_transaction_bd BEFORE DELETE ON `TRANSACTION`
FOR EACH ROW
BEGIN
    SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'Transactions cannot be deleted; post an offsetting transaction instead';
END$$

DELIMITER ;
