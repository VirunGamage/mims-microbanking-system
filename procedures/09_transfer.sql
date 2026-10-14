-- Transfers between savings accounts (online banking, or at a branch). Both halves of a transfer are saved together or not at all.
-- Needs mims_schema.sql, the trg_savings_balance_guard trigger (04_triggers.sql) and PROC_CHECK_CHANNEL and-- PROC_NEXT_TXN_REF (01_deposit_withdrawal.sql).

USE mims;

DROP PROCEDURE IF EXISTS PROC_TRANSFER;

DELIMITER $$
-- Moves money from one savings account to another. A transfer is stored as the two movements it is made of: a WITHDRAWAL
-- from the first account and a DEPOSIT into the second. The daily withdrawal limit, the review flag, the reports and every
-- balance check then treat it like any other withdrawal and deposit, and the schema needs no new transaction type.
-- The sending side follows the withdrawal rules (ACTIVE account, the customer is a holder, plan minimum, daily limit) and
-- the receiving side the deposit rules (ACTIVE account, flagged for review above the large-deposit threshold). Any ACTIVE
-- account can receive, whoever holds it. The channel, the agent and the hours follow PROC_CHECK_CHANNEL: online at any
-- hour, at a branch only during business hours.
-- Calling PROC_PROCESS_WITHDRAWAL and then PROC_PROCESS_DEPOSIT would not be safe: each commits on its own, so if the
-- deposit were refused (say the other account is FROZEN) the money would already have left the first account.
--
-- Lock order: the two accounts are locked lowest account_id first. Two opposite transfers at the same moment (A to B and-- B to A) then wait for the same first lock, instead of each holding one account and waiting for the other (a deadlock).
-- Gives back both reference numbers and the new balance of the sending account.
CREATE PROCEDURE PROC_TRANSFER (
    IN  p_from_account_id  INT,
    IN  p_customer_id      INT,
    IN  p_to_account_id    INT,
    IN  p_amount           DECIMAL(14,2),
    IN  p_channel          VARCHAR(10),
    IN  p_agent_id         INT,
    OUT p_withdrawal_ref   VARCHAR(30),
    OUT p_deposit_ref      VARCHAR(30),
    OUT p_new_balance      DECIMAL(14,2)
)
BEGIN
    DECLARE v_locked       INT;
    DECLARE v_from_status  VARCHAR(10) DEFAULT NULL;
    DECLARE v_to_status    VARCHAR(10) DEFAULT NULL;
    DECLARE v_balance      DECIMAL(14,2);
    DECLARE v_min_balance  DECIMAL(12,2);
    DECLARE v_is_holder    INT;
    DECLARE v_daily_limit  DECIMAL(14,2);
    DECLARE v_withdrawn    DECIMAL(14,2);
    DECLARE v_threshold    DECIMAL(14,2);
    DECLARE v_review_flag  TINYINT DEFAULT 0;
    -- Same clean up as in PROC_PROCESS_DEPOSIT: both halves are undone together
    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        SET @allow_balance_update = 0;
        ROLLBACK;
        RESIGNAL;
    END;
    
    START TRANSACTION;

    IF p_amount IS NULL OR p_amount <= 0 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Transfer amount must be greater than zero';
    END IF;
    CALL PROC_CHECK_CHANNEL(p_channel, p_agent_id);   -- At a branch: business hours and an ACTIVE agent. Online: any hour, no agent
    IF p_from_account_id = p_to_account_id THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'A transfer needs two different accounts';
    END IF;

    -- Both accounts are locked, the lower account_id first (see the lock order above). An account that does not exist
    -- locks nothing and is reported below.
    SELECT account_id INTO v_locked FROM SAVINGS_ACCOUNT
    WHERE account_id = LEAST(p_from_account_id, p_to_account_id) FOR UPDATE;
    SELECT account_id INTO v_locked FROM SAVINGS_ACCOUNT
    WHERE account_id = GREATEST(p_from_account_id, p_to_account_id) FOR UPDATE;

    -- These are locking reads too, so they see the latest committed balances (a plain SELECT would read an older snapshot,
    -- see PROC_PROCESS_WITHDRAWAL). This transaction already holds both locks, so they do not wait.
    SELECT sa.status, sa.balance, sp.minimum_balance
    INTO   v_from_status, v_balance, v_min_balance
    FROM   SAVINGS_ACCOUNT sa
    JOIN   SAVINGS_PLAN sp ON sp.plan_id = sa.plan_id
    WHERE  sa.account_id = p_from_account_id
    FOR UPDATE OF sa;

    SELECT status INTO v_to_status
    FROM SAVINGS_ACCOUNT
    WHERE account_id = p_to_account_id
    FOR UPDATE;

    -- The sending side: the same checks and messages as a withdrawal
    IF v_from_status IS NULL THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Account not found';
    END IF;
    IF v_from_status <> 'ACTIVE' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Account is not active';
    END IF;

    SELECT COUNT(*) INTO v_is_holder
    FROM ACCOUNT_HOLDER
    WHERE account_id = p_from_account_id AND customer_id = p_customer_id;
    IF v_is_holder = 0 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Customer is not a holder of this account';
    END IF;

    -- The receiving side
    IF v_to_status IS NULL THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'The account to transfer to was not found';
    END IF;
    IF v_to_status <> 'ACTIVE' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'The account to transfer to is not active';
    END IF;
    IF v_balance - p_amount < v_min_balance THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Transfer would take the balance below the plan minimum';
    END IF;

    -- Money sent today counts towards the daily withdrawal limit, together with today's withdrawals (the WITHDRAWAL half
    -- of a transfer is a WITHDRAWAL row). FOR SHARE and the range on txn_timestamp: see PROC_PROCESS_WITHDRAWAL.
    SELECT CAST(config_value AS DECIMAL(14,2)) INTO v_daily_limit
    FROM SYSTEM_CONFIG WHERE config_key = 'daily_withdrawal_limit';

    SELECT COALESCE(SUM(amount), 0) INTO v_withdrawn
    FROM `TRANSACTION`
    WHERE account_id = p_from_account_id
      AND transaction_type = 'WITHDRAWAL'
      AND txn_timestamp >= CURDATE()
      AND txn_timestamp < CURDATE() + INTERVAL 1 DAY
    FOR SHARE;

    IF v_withdrawn + p_amount > v_daily_limit THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Daily withdrawal limit exceeded';
    END IF;

    -- A large amount arriving is accepted but flagged for review, as for a deposit
    SELECT CAST(config_value AS DECIMAL(14,2)) INTO v_threshold
    FROM SYSTEM_CONFIG WHERE config_key = 'large_deposit_threshold';
    IF p_amount > v_threshold THEN
        SET v_review_flag = 1;
    END IF;

    CALL PROC_NEXT_TXN_REF(p_withdrawal_ref);
    INSERT INTO `TRANSACTION`
        (transaction_type, amount, reference_no, channel, review_flag,
          account_id, processed_by_agent_id)
    VALUES
        ('WITHDRAWAL', p_amount, p_withdrawal_ref, p_channel, 0,
          p_from_account_id, p_agent_id);
    CALL PROC_NEXT_TXN_REF(p_deposit_ref);
    INSERT INTO `TRANSACTION`
        (transaction_type, amount, reference_no, channel, review_flag,
          account_id, processed_by_agent_id)
    VALUES
       ('DEPOSIT', p_amount, p_deposit_ref, p_channel, v_review_flag,
         p_to_account_id, p_agent_id);
    -- Guard flag is on only for these two UPDATEs, see PROC_PROCESS_DEPOSIT
    SET @allow_balance_update = 1;
    UPDATE SAVINGS_ACCOUNT
    SET balance = balance - p_amount
    WHERE account_id = p_from_account_id;
    UPDATE SAVINGS_ACCOUNT
    SET balance = balance + p_amount
    WHERE account_id = p_to_account_id;
    SET @allow_balance_update = 0;

    SELECT balance INTO p_new_balance
    FROM SAVINGS_ACCOUNT WHERE account_id = p_from_account_id;
    
    COMMIT;
END$$
DELIMITER ;