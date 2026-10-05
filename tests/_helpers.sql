-- Shared helpers for the SQL tests. They live in their own schema, mims_test, so the mims database never keeps test objects. Owner: Rukshi.
-- tests/run_all.sql loads this first. To run one test file on its own:  mysql -u root -p < tests/_helpers.sql  and then the file.
-- This helper file creates the mims_test schema and shared test utilities for recording results, checking expected SQL outcomes, controlling test time, and calculating test values.

DROP SCHEMA IF EXISTS mims_test;
CREATE SCHEMA mims_test;
USE mims_test;

-- One row per check. A test file clears its own suite first and prints it at the end.
CREATE TABLE results (
    id           INT AUTO_INCREMENT PRIMARY KEY,
    suite        VARCHAR(40)  NOT NULL,
    test_id      VARCHAR(8)   NOT NULL,
    description  VARCHAR(200) NOT NULL,
    result       ENUM('PASS','FAIL') NOT NULL,
    detail       VARCHAR(600)
);

DELIMITER $$

-- Runs one statement (usually a CALL) and reports how it ended: SQLSTATE '00000' when it worked, otherwise the error's
-- SQLSTATE and message. This is what lets a test expect a refusal without the whole script stopping.
-- Inside a procedure the default database is mims_test, so the statements name their objects as mims.NAME.
-- INVOKER: the statement runs with the rights of whoever runs the test, never with more.
CREATE PROCEDURE try_sql (
    IN  p_sql      TEXT,
    OUT p_state    CHAR(5),
    OUT p_message  VARCHAR(512)
)
SQL SECURITY INVOKER
BEGIN
    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        GET DIAGNOSTICS CONDITION 1 p_state = RETURNED_SQLSTATE, p_message = MESSAGE_TEXT;
    END;
    SET p_state = '00000', p_message = NULL;
    SET @mims_test_sql = p_sql;
    PREPARE mims_test_stmt FROM @mims_test_sql;
    EXECUTE mims_test_stmt;
    DEALLOCATE PREPARE mims_test_stmt;
END$$

-- Records one check. p_ok decides PASS or FAIL (NULL counts as FAIL); p_detail is what a FAIL row shows.
CREATE PROCEDURE check_that (
    IN p_suite        VARCHAR(40),
    IN p_test_id      VARCHAR(8),
    IN p_description  VARCHAR(200),
    IN p_ok           BOOLEAN,
    IN p_detail       TEXT
)
BEGIN
    INSERT INTO results (suite, test_id, description, result, detail)
    VALUES (p_suite, p_test_id, p_description, IF(COALESCE(p_ok, FALSE), 'PASS', 'FAIL'), LEFT(p_detail, 600));
END$$

-- The statement must work.
CREATE PROCEDURE expect_ok (
    IN p_suite        VARCHAR(40),
    IN p_test_id      VARCHAR(8),
    IN p_description  VARCHAR(200),
    IN p_sql          TEXT
)
BEGIN
    CALL try_sql(p_sql, @state, @message);
    CALL check_that(p_suite, p_test_id, p_description, @state = '00000',
                    CONCAT('refused: ', @state, ' ', COALESCE(@message, '')));
END$$

-- The statement must be refused by one of our rules (SQLSTATE 45000) with exactly this message.
CREATE PROCEDURE expect_refusal (
    IN p_suite        VARCHAR(40),
    IN p_test_id      VARCHAR(8),
    IN p_description  VARCHAR(200),
    IN p_sql          TEXT,
    IN p_message      VARCHAR(512)
)
BEGIN
    CALL try_sql(p_sql, @state, @message);
    CALL check_that(p_suite, p_test_id, p_description, @state = '45000' AND @message = p_message,
                    IF(@state = '00000', 'it worked, but it should have been refused',
                       CONCAT('got: ', @state, ' ', COALESCE(@message, ''))));
END$$

-- The statement must break this CHECK constraint of the schema (MySQL error 3819).
CREATE PROCEDURE expect_check_violation (
    IN p_suite        VARCHAR(40),
    IN p_test_id      VARCHAR(8),
    IN p_description  VARCHAR(200),
    IN p_sql          TEXT,
    IN p_constraint   VARCHAR(64)
)
BEGIN
    CALL try_sql(p_sql, @state, @message);
    CALL check_that(p_suite, p_test_id, p_description,
                    @state = 'HY000' AND @message = CONCAT('Check constraint ''', p_constraint, ''' is violated.'),
                    IF(@state = '00000', 'it worked, but it should have been refused',
                       CONCAT('got: ', @state, ' ', COALESCE(@message, ''))));
END$$

-- Sets this session's clock (NOW, CURDATE and new txn_timestamp values) to a fixed moment, so a rule that depends on
-- the time (business hours, the daily limit, interest dates) is tested at a known moment. Only this session is affected;
-- nothing in the database is changed. clock_reset() goes back to the real time.
CREATE PROCEDURE clock_at (IN p_moment DATETIME)
BEGIN
    SET timestamp = UNIX_TIMESTAMP(p_moment);
END$$

CREATE PROCEDURE clock_reset ()
BEGIN
    SET timestamp = DEFAULT;
END$$

CREATE PROCEDURE start_suite (IN p_suite VARCHAR(40))
BEGIN
    DELETE FROM results WHERE suite = p_suite;
END$$

-- Prints one row per check (the detail only for a FAIL) and a summary row.
CREATE PROCEDURE report (IN p_suite VARCHAR(40))
BEGIN
    SELECT CONCAT(test_id, ' ', description) AS test, result, IF(result = 'FAIL', detail, '') AS detail
    FROM results WHERE suite = p_suite ORDER BY id;

    SELECT p_suite AS suite, CONCAT(SUM(result = 'PASS'), ' of ', COUNT(*), ' PASS') AS summary,
           IF(SUM(result = 'FAIL') = 0, 'ALL PASS', CONCAT(SUM(result = 'FAIL'), ' FAIL')) AS result
    FROM results WHERE suite = p_suite;
END$$

-- A NIC no real customer has (T + 11 digits), different on every call, so test customers never clash.
CREATE FUNCTION new_nic () RETURNS VARCHAR(12)
NOT DETERMINISTIC NO SQL
BEGIN
    RETURN CONCAT('T', LPAD(UUID_SHORT() MOD 100000000000, 11, '0'));
END$$

-- An account's balance worked out from its TRANSACTION rows. It must always equal SAVINGS_ACCOUNT.balance.
CREATE FUNCTION ledger_balance (p_account_id INT) RETURNS DECIMAL(14,2)
NOT DETERMINISTIC READS SQL DATA
BEGIN
    RETURN (SELECT COALESCE(SUM(CASE WHEN transaction_type IN ('DEPOSIT','SAVINGS_INTEREST','FD_INTEREST','FD_CLOSURE')
                                     THEN amount ELSE -amount END), 0)
            FROM mims.`TRANSACTION` WHERE account_id = p_account_id);
END$$

-- The name of an account's savings plan (NULL if the account does not exist).
CREATE FUNCTION plan_of (p_account_id INT) RETURNS VARCHAR(50)
NOT DETERMINISTIC READS SQL DATA
BEGIN
    RETURN (SELECT sp.plan_name FROM mims.SAVINGS_ACCOUNT sa JOIN mims.SAVINGS_PLAN sp ON sp.plan_id = sa.plan_id
            WHERE sa.account_id = p_account_id);
END$$

DELIMITER ;
