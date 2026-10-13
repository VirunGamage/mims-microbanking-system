-- Deposit and withdrawal procedures for the savings accounts. Every deposit and withdrawal goes through these so the rules
-- (business hours, minimum balance, daily limit) are checked in one place and the balance never disagrees with the TRANSACTION log.
-- Needs mims_schema.sql and the trg_savings_balance_guard trigger (04_triggers.sql) to be in place.

USE mims;

-- Hands out the numbers used for reference_no. AUTO_INCREMENT never gives the same number twice, even when a transaction is
-- rolled back, so reference_no stays unique across the whole bank (it is UNIQUE in TRANSACTION).
CREATE TABLE IF NOT EXISTS TXN_REF_SEQ (
    seq_id      BIGINT AUTO_INCREMENT PRIMARY KEY,
    created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- If transactions already exist (eg. sample data), the sequence starts after the highest TXN number already used
-- so new reference numbers can never clash with old ones. Does nothing if the sequence already has rows.
INSERT INTO TXN_REF_SEQ (seq_id)
SELECT x.m
FROM (SELECT MAX(CAST(SUBSTRING(reference_no, 4) AS UNSIGNED)) AS m
      FROM `TRANSACTION`
      WHERE reference_no REGEXP '^TXN[0-9]+$') x
WHERE x.m IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM TXN_REF_SEQ);

DROP PROCEDURE IF EXISTS PROC_NEXT_TXN_REF;
DROP PROCEDURE IF EXISTS PROC_CHECK_CHANNEL;
DROP PROCEDURE IF EXISTS PROC_CHECK_BUSINESS_HOURS;
DROP PROCEDURE IF EXISTS PROC_PROCESS_DEPOSIT;
DROP PROCEDURE IF EXISTS PROC_PROCESS_WITHDRAWAL;

DELIMITER $$

-- Gives the next reference number in the format TXN + 7 digits (eg. TXN0000001). Every procedure that inserts into
-- TRANSACTION calls this so the format is the same everywhere.
CREATE PROCEDURE PROC_NEXT_TXN_REF (OUT p_reference_no VARCHAR(30))
BEGIN
    INSERT INTO TXN_REF_SEQ () VALUES ();
    SET p_reference_no = CONCAT('TXN', LPAD(LAST_INSERT_ID(), 7, '0'));   -- LAST_INSERT_ID is per connection, so two users never get the same number
END$$

-- Every BRANCH transaction (through PROC_CHECK_CHANNEL) and account opening call this, so the rule is written only once.
-- Online banking (ONLINE, MOBILE, ATM) is open at any hour, so it does not come through here.
CREATE PROCEDURE PROC_CHECK_BUSINESS_HOURS ()
BEGIN
    DECLARE v_start TIME;
    DECLARE v_end   TIME;

    SELECT CAST(config_value AS TIME) INTO v_start
    FROM SYSTEM_CONFIG WHERE config_key = 'business_day_start';
    SELECT CAST(config_value AS TIME) INTO v_end
    FROM SYSTEM_CONFIG WHERE config_key = 'business_day_end';

    IF DAYOFWEEK(NOW()) IN (1, 7)   -- 1 is Sunday and 7 is Saturday
       OR TIME(NOW()) < v_start
       OR TIME(NOW()) > v_end THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Transactions are only accepted Mon-Fri during business hours';
    END IF;
END$$

-- Checks who can move money on which channel, and when, so every procedure that moves money applies the same rule.
-- A BRANCH transaction happens at the counter: only during business hours, and processed by an agent who must exist and
-- be ACTIVE. An ONLINE, MOBILE or ATM transaction is made by the customer themselves: at any hour, and with no agent
-- (chk_txn_channel_agent says the same; this gives a clear message before anything is changed). SYSTEM is not accepted:
-- only the bank's own postings (interest, maturity) use it.
-- trg_transaction_bi checks the agent again when the row is inserted, so a direct INSERT cannot skip the rule either.
CREATE PROCEDURE PROC_CHECK_CHANNEL (
IN p_channel VARCHAR(10),
IN p_agent_id INT
)
BEGIN
DECLARE v_agent_status VARCHAR(12) DEFAULT NULL;
IF p_channel IS NULL OR p_channel NOT IN ('BRANCH', 'ONLINE', 'MOBILE', 'ATM') THEN
SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Channel must be BRANCH, ONLINE, MOBILE or ATM';
END IF;
IF p_channel = 'BRANCH' THEN
CALL PROC_CHECK_BUSINESS_HOURS();
SELECT status INTO v_agent_status FROM AGENT WHERE agent_id = p_agent_id;
IF v_agent_status IS NULL THEN -- No agent given, or no agent with this id
SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Agent not found';
END IF;
IF v_agent_status <> 'ACTIVE' THEN
SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Processing agent is not ACTIVE';
END IF;
ELSEIF p_agent_id IS NOT NULL THEN
SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'An ONLINE, MOBILE or ATM transaction has no agent';
END IF;
END$$

-- Adds money to a savings account and logs it as a DEPOSIT, all as one unit: if any check fails nothing is saved.
-- Any holder of a joint account can deposit, so there is no holder check here. p_agent_id is the ACTIVE agent for the
-- BRANCH channel and NULL for ONLINE, MOBILE and ATM, the customer's own channels (PROC_CHECK_CHANNEL).
-- Gives back the new reference number and the new balance.
CREATE PROCEDURE PROC_PROCESS_DEPOSIT (
    IN  p_account_id    INT,
    IN  p_amount        DECIMAL(14,2),
    IN  p_channel       VARCHAR(10),
    IN  p_agent_id      INT,
    OUT p_reference_no  VARCHAR(30),
    OUT p_new_balance   DECIMAL(14,2)
)
BEGIN
    DECLARE v_status       VARCHAR(10) DEFAULT NULL;
    DECLARE v_threshold    DECIMAL(14,2);
    DECLARE v_review_flag  TINYINT DEFAULT 0;

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
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Deposit amount must be greater than zero';
    END IF;

    CALL PROC_CHECK_CHANNEL(p_channel, p_agent_id); -- At a branch: business hours and an ACTIVE agent. Online: any hour, no agent

    -- Locks this account row until the transaction ends, so two deposits at the same time cannot overwrite each other's balance
    SELECT status INTO v_status
    FROM SAVINGS_ACCOUNT
    WHERE account_id = p_account_id
    FOR UPDATE;

    IF v_status IS NULL THEN   -- No row came back, so the account does not exist
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Account not found';
    END IF;
    IF v_status <> 'ACTIVE' THEN   -- Nothing in the schema stops a deposit into a CLOSED or FROZEN account, so it is checked here
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Account is not active';
    END IF;

    -- A large deposit is still accepted but flagged for manual review
    SELECT CAST(config_value AS DECIMAL(14,2)) INTO v_threshold
    FROM SYSTEM_CONFIG WHERE config_key = 'large_deposit_threshold';
    IF p_amount > v_threshold THEN
        SET v_review_flag = 1;
    END IF;

    CALL PROC_NEXT_TXN_REF(p_reference_no);

    INSERT INTO `TRANSACTION`
        (transaction_type, amount, reference_no, channel, review_flag,
         account_id, processed_by_agent_id)
    VALUES
        ('DEPOSIT', p_amount, p_reference_no, p_channel, v_review_flag,
         p_account_id, p_agent_id);

    -- trg_savings_balance_guard blocks any balance change unless this flag is 1, so it is only
    -- switched on for the one UPDATE below and switched off straight after
    SET @allow_balance_update = 1;
    UPDATE SAVINGS_ACCOUNT
    SET balance = balance + p_amount
    WHERE account_id = p_account_id;
    SET @allow_balance_update = 0;

    SELECT balance INTO p_new_balance
    FROM SAVINGS_ACCOUNT WHERE account_id = p_account_id;

    COMMIT;
END$$

-- Takes money out of a savings account and logs it as a WITHDRAWAL, all as one unit. It only goes through if the account is
-- ACTIVE, the customer is a holder of it, the balance stays at or above the plan's minimum balance and the daily limit is not
-- passed. If any rule fails, nothing is saved and an error is raised.
-- Gives back the new reference number and the new balance.
CREATE PROCEDURE PROC_PROCESS_WITHDRAWAL (
    IN  p_account_id    INT,
    IN  p_customer_id   INT,
    IN  p_amount        DECIMAL(14,2),
    IN  p_channel       VARCHAR(10),
    IN  p_agent_id      INT,
    OUT p_reference_no  VARCHAR(30),
    OUT p_new_balance   DECIMAL(14,2)
)
BEGIN
    DECLARE v_status        VARCHAR(10) DEFAULT NULL;
    DECLARE v_balance       DECIMAL(14,2);
    DECLARE v_min_balance   DECIMAL(12,2);
    DECLARE v_daily_limit   DECIMAL(14,2);
    DECLARE v_withdrawn     DECIMAL(14,2);
    DECLARE v_is_holder     INT;

    -- Same clean up as in PROC_PROCESS_DEPOSIT
    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        SET @allow_balance_update = 0;
        ROLLBACK;
        RESIGNAL;
    END;

    START TRANSACTION;

    IF p_amount IS NULL OR p_amount <= 0 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Withdrawal amount must be greater than zero';
    END IF;

    CALL PROC_CHECK_CHANNEL(p_channel, p_agent_id); -- At a branch: business hours and an ACTIVE agent. Online: any hour, no agent

    -- OF sa locks only the account row, not the plan row, so withdrawals on other accounts of the same plan are not held up
    SELECT sa.status, sa.balance, sp.minimum_balance
    INTO   v_status, v_balance, v_min_balance
    FROM   SAVINGS_ACCOUNT sa
    JOIN   SAVINGS_PLAN sp ON sp.plan_id = sa.plan_id
    WHERE  sa.account_id = p_account_id
    FOR UPDATE OF sa;

    IF v_status IS NULL THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Account not found';
    END IF;
    IF v_status <> 'ACTIVE' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Account is not active';
    END IF;

    -- Any holder of the account can withdraw (PRIMARY or SECONDARY), so being linked in ACCOUNT_HOLDER is enough
    SELECT COUNT(*) INTO v_is_holder
    FROM ACCOUNT_HOLDER
    WHERE account_id = p_account_id AND customer_id = p_customer_id;
    IF v_is_holder = 0 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Customer is not a holder of this account';
    END IF;

    -- The balance left after the withdrawal cannot drop below the plan's minimum balance
    IF v_balance - p_amount < v_min_balance THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Withdrawal would take the balance below the plan minimum';
    END IF;

    -- The daily limit is a running total for the day, not a limit per withdrawal, so what was already
    -- withdrawn today is added to this withdrawal before comparing
    SELECT CAST(config_value AS DECIMAL(14,2)) INTO v_daily_limit
    FROM SYSTEM_CONFIG WHERE config_key = 'daily_withdrawal_limit';

    -- FOR SHARE makes this a locking read. A plain SELECT reads an older snapshot from before the lock wait and could miss a withdrawal
    -- another agent just committed, so two withdrawals at the same time could both pass the limit.
    -- "Today" is written as a range on txn_timestamp so idx_txn_account_date finds only today's rows (DATE(txn_timestamp) = CURDATE()
    -- would read, and lock, the account's whole history).
    SELECT COALESCE(SUM(amount), 0) INTO v_withdrawn
    FROM `TRANSACTION`
    WHERE account_id = p_account_id
      AND transaction_type = 'WITHDRAWAL'
      AND txn_timestamp >= CURDATE()
      AND txn_timestamp < CURDATE() + INTERVAL 1 DAY
    FOR SHARE;

    IF v_withdrawn + p_amount > v_daily_limit THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Daily withdrawal limit exceeded';
    END IF;

    CALL PROC_NEXT_TXN_REF(p_reference_no);

    INSERT INTO `TRANSACTION`
        (transaction_type, amount, reference_no, channel, review_flag,
         account_id, processed_by_agent_id)
    VALUES
        ('WITHDRAWAL', p_amount, p_reference_no, p_channel, 0,
         p_account_id, p_agent_id);

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
