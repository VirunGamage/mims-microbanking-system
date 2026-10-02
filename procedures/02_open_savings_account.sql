-- Account opening for the savings accounts. Opens the account, links its holder(s) and posts the opening deposit as one unit,
-- so a half opened account can never be left behind.
-- Needs mims_schema.sql, the trg_savings_balance_guard trigger (04_triggers.sql) and the helper procedures
-- PROC_CHECK_BUSINESS_HOURS and PROC_NEXT_TXN_REF (01_deposit_withdrawal.sql) to be in place.

USE mims;

-- Hands out the numbers used for the printed account_no (SA + 7 digits). AUTO_INCREMENT never gives the same number twice,
-- even when an opening is rolled back, so account_no stays unique (it is UNIQUE in SAVINGS_ACCOUNT).
CREATE TABLE IF NOT EXISTS ACCOUNT_NO_SEQ (
    seq_id      BIGINT AUTO_INCREMENT PRIMARY KEY,
    created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- If accounts already exist (eg. sample data), the sequence starts after the highest account number already used
-- so new accounts can never clash with old ones. Does nothing if the sequence already has rows.
INSERT INTO ACCOUNT_NO_SEQ (seq_id)
SELECT x.m
FROM (SELECT MAX(CAST(SUBSTRING(account_no, 3) AS UNSIGNED)) AS m FROM SAVINGS_ACCOUNT) x
WHERE x.m IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM ACCOUNT_NO_SEQ);

DROP PROCEDURE IF EXISTS PROC_VERIFY_JOINT_HOLDERS;
DROP PROCEDURE IF EXISTS PROC_OPEN_SAVINGS_ACCOUNT;

DELIMITER $$

-- Checks that a Joint account has at least 2 holders. This is a procedure and not a trigger because the holders are inserted
-- one at a time, so a trigger would block the very first holder and the account could never be opened.
-- PROC_OPEN_SAVINGS_ACCOUNT calls it as its last step.
CREATE PROCEDURE PROC_VERIFY_JOINT_HOLDERS (
    IN p_account_id INT
)
BEGIN
    DECLARE v_plan_name VARCHAR(50);
    DECLARE v_holder_count INT;

    SELECT sp.plan_name INTO v_plan_name
    FROM SAVINGS_ACCOUNT sa
    JOIN SAVINGS_PLAN sp ON sa.plan_id = sp.plan_id
    WHERE sa.account_id = p_account_id;

    IF v_plan_name = 'Joint' THEN
        SELECT COUNT(*) INTO v_holder_count
        FROM ACCOUNT_HOLDER
        WHERE account_id = p_account_id;

        IF v_holder_count < 2 THEN
            SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'A Joint account must have at least 2 linked holders.';
        END IF;
    END IF;
END$$

-- Opens a savings account for a customer, or for two customers if p_secondary_customer_id is given (Joint plan).
-- Account, holders and opening deposit are saved together or not at all, because the last step (the Joint holder check)
-- can fail after everything else has been inserted. A Joint account here always has exactly two holders.
-- The plan is not chosen by the caller: Joint when a second holder is given, otherwise it comes from the PRIMARY
-- holder's age using the age bands in SYSTEM_CONFIG (Joint accounts are not age restricted).
-- Gives back the new account_id, the printed account_no and the reference number of the opening deposit.
CREATE PROCEDURE PROC_OPEN_SAVINGS_ACCOUNT (
    IN  p_primary_customer_id    INT,
    IN  p_secondary_customer_id  INT,
    IN  p_opening_amount         DECIMAL(14,2),
    IN  p_agent_id               INT,
    OUT p_account_id             INT,
    OUT p_account_no             VARCHAR(20),
    OUT p_reference_no           VARCHAR(30)
)
BEGIN
    DECLARE v_agent_status   VARCHAR(12) DEFAULT NULL;
    DECLARE v_dob            DATE        DEFAULT NULL;
    DECLARE v_age            INT;
    DECLARE v_count          INT;
    DECLARE v_plan_name      VARCHAR(50);
    DECLARE v_plan_id        INT;
    DECLARE v_min_balance    DECIMAL(12,2);
    DECLARE v_child_max      INT;
    DECLARE v_teen_min       INT;
    DECLARE v_teen_max       INT;
    DECLARE v_adult_min      INT;
    DECLARE v_senior_min     INT;
    DECLARE v_cycle_days     INT;
    DECLARE v_threshold      DECIMAL(14,2);
    DECLARE v_review_flag    TINYINT DEFAULT 0;

    -- If anything fails: turn the balance guard back on, undo every change made so far and pass the error to the caller.
    -- The flag has to be reset here because ROLLBACK does not undo session variables.
    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        SET @allow_balance_update = 0;
        ROLLBACK;
        RESIGNAL;
    END;

    START TRANSACTION;

    -- Balances start at 0 and the opening deposit is what brings them up, so it has to be a real amount (chk_txn_amount_positive)
    IF p_opening_amount IS NULL OR p_opening_amount <= 0 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Opening deposit must be greater than zero';
    END IF;

    CALL PROC_CHECK_BUSINESS_HOURS();   -- The opening deposit follows the same business hours as any other deposit

    SELECT status INTO v_agent_status FROM AGENT WHERE agent_id = p_agent_id;
    IF v_agent_status IS NULL THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Agent not found';
    END IF;
    IF v_agent_status <> 'ACTIVE' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Processing agent is not ACTIVE';
    END IF;

    -- The PRIMARY holder's date of birth is needed for the age bands, so the customer has to exist
    SELECT DOB INTO v_dob FROM CUSTOMER WHERE customer_id = p_primary_customer_id;
    IF v_dob IS NULL THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Primary customer not found';
    END IF;

    IF p_secondary_customer_id IS NOT NULL THEN
        IF p_secondary_customer_id = p_primary_customer_id THEN   -- Same person twice would not be a joint account
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'Joint holders must be two different customers';
        END IF;
        SELECT COUNT(*) INTO v_count FROM CUSTOMER WHERE customer_id = p_secondary_customer_id;
        IF v_count = 0 THEN
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Secondary customer not found';
        END IF;
        SET v_plan_name = 'Joint';
    ELSE
        SELECT CAST(config_value AS UNSIGNED) INTO v_child_max
            FROM SYSTEM_CONFIG WHERE config_key = 'age_child_max';
        SELECT CAST(config_value AS UNSIGNED) INTO v_teen_min
            FROM SYSTEM_CONFIG WHERE config_key = 'age_teen_min';
        SELECT CAST(config_value AS UNSIGNED) INTO v_teen_max
            FROM SYSTEM_CONFIG WHERE config_key = 'age_teen_max';
        SELECT CAST(config_value AS UNSIGNED) INTO v_adult_min
            FROM SYSTEM_CONFIG WHERE config_key = 'age_adult_min';
        SELECT CAST(config_value AS UNSIGNED) INTO v_senior_min
            FROM SYSTEM_CONFIG WHERE config_key = 'age_senior_min';

        SET v_age = TIMESTAMPDIFF(YEAR, v_dob, CURDATE());   -- Age is worked out from DOB at opening, it is never stored

        IF v_age <= v_child_max THEN
            SET v_plan_name = 'Children';
        ELSEIF v_age >= v_teen_min AND v_age <= v_teen_max THEN
            SET v_plan_name = 'Teen';
        ELSEIF v_age >= v_senior_min THEN   -- Senior is checked before Adult because Adult covers everything from 18 upwards
            SET v_plan_name = 'Senior';
        ELSEIF v_age >= v_adult_min THEN
            SET v_plan_name = 'Adult';
        ELSE
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'No savings plan matches this age';
        END IF;
    END IF;

    SELECT plan_id, minimum_balance INTO v_plan_id, v_min_balance
    FROM SAVINGS_PLAN WHERE plan_name = v_plan_name;

    -- The account must never sit below its plan's minimum balance, not even at the start, so the opening deposit has to cover it
    IF p_opening_amount < v_min_balance THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Opening deposit is below the plan minimum balance';
    END IF;

    INSERT INTO ACCOUNT_NO_SEQ () VALUES ();
    SET p_account_no = CONCAT('SA', LPAD(LAST_INSERT_ID(), 7, '0'));   -- Matches chk_account_no_format: SA followed by 7 digits

    SELECT CAST(config_value AS UNSIGNED) INTO v_cycle_days
    FROM SYSTEM_CONFIG WHERE config_key = 'savings_interest_cycle_days';

    -- next_interest_date is one interest cycle after opening, this is what the interest job uses to avoid posting twice
    INSERT INTO SAVINGS_ACCOUNT
        (account_no, balance, open_date, next_interest_date, status, plan_id)
    VALUES
        (p_account_no, 0.00, CURDATE(), DATE_ADD(CURDATE(), INTERVAL v_cycle_days DAY),
         'ACTIVE', v_plan_id);
    SET p_account_id = LAST_INSERT_ID();   -- Read straight away because later inserts change LAST_INSERT_ID

    INSERT INTO ACCOUNT_HOLDER (customer_id, account_id, role)
    VALUES (p_primary_customer_id, p_account_id, 'PRIMARY');
    IF p_secondary_customer_id IS NOT NULL THEN
        INSERT INTO ACCOUNT_HOLDER (customer_id, account_id, role)
        VALUES (p_secondary_customer_id, p_account_id, 'SECONDARY');
    END IF;

    -- The opening deposit is done here and not by calling PROC_PROCESS_DEPOSIT, because that procedure starts its own
    -- transaction, which would end this one early and break the all or nothing rollback
    SELECT CAST(config_value AS DECIMAL(14,2)) INTO v_threshold
    FROM SYSTEM_CONFIG WHERE config_key = 'large_deposit_threshold';
    IF p_opening_amount > v_threshold THEN   -- Large deposits are accepted but flagged for manual review
        SET v_review_flag = 1;
    END IF;

    CALL PROC_NEXT_TXN_REF(p_reference_no);

    INSERT INTO `TRANSACTION`
        (transaction_type, amount, reference_no, channel, review_flag,
         account_id, processed_by_agent_id)
    VALUES
        ('DEPOSIT', p_opening_amount, p_reference_no, 'BRANCH', v_review_flag,
         p_account_id, p_agent_id);

    -- trg_savings_balance_guard blocks any balance change unless this flag is 1, so it is only
    -- switched on for the one UPDATE below and switched off straight after
    SET @allow_balance_update = 1;
    UPDATE SAVINGS_ACCOUNT
    SET balance = p_opening_amount
    WHERE account_id = p_account_id;
    SET @allow_balance_update = 0;

    -- Has to be last, once every holder row exists. If it fails, the rollback removes the account, holders and opening deposit
    CALL PROC_VERIFY_JOINT_HOLDERS(p_account_id);

    COMMIT;
END$$

DELIMITER ;
