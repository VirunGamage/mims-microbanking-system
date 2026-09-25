-- reports/management_reports.sql
-- Group 27 - Management Reports (REQ-RPT-01 to REQ-RPT-06)

DELIMITER $$

-- Report 1: Agent-wise transaction report
DROP PROCEDURE IF EXISTS RPT_AGENT_WISE_TRANSACTIONS$$
CREATE PROCEDURE RPT_AGENT_WISE_TRANSACTIONS(
    IN p_start_date DATE,
    IN p_end_date   DATE
)
BEGIN
    SELECT
        a.agent_id,
        CONCAT(a.first_name, ' ', a.last_name) AS agent_name,
        b.branch_name,
        COUNT(t.transaction_id)     AS total_transactions,
        COALESCE(SUM(t.amount), 0)  AS total_value
    FROM AGENT a
    JOIN BRANCH b
        ON b.branch_id = a.branch_id
    LEFT JOIN `TRANSACTION` t
        ON t.processed_by_agent_id = a.agent_id
       AND DATE(t.txn_timestamp) BETWEEN p_start_date AND p_end_date
    GROUP BY a.agent_id, agent_name, b.branch_name
    ORDER BY total_value DESC;
END$$


-- Report 2: Account-wise transaction summary
DROP PROCEDURE IF EXISTS RPT_ACCOUNT_WISE_SUMMARY$$
CREATE PROCEDURE RPT_ACCOUNT_WISE_SUMMARY(
    IN p_branch_id INT
)
BEGIN
    SELECT
        sa.account_no,
        sa.status,
        sp.plan_name,
        sa.balance AS current_balance,
        COALESCE(SUM(CASE WHEN t.transaction_type = 'DEPOSIT'    THEN t.amount END), 0) AS total_deposits,
        COALESCE(SUM(CASE WHEN t.transaction_type = 'WITHDRAWAL' THEN t.amount END), 0) AS total_withdrawals,
        COALESCE(SUM(CASE WHEN t.transaction_type IN ('SAVINGS_INTEREST','FD_INTEREST')
                           THEN t.amount END), 0) AS total_interest_credited
    FROM SAVINGS_ACCOUNT sa
    JOIN SAVINGS_PLAN sp
        ON sp.plan_id = sa.plan_id
    LEFT JOIN `TRANSACTION` t
        ON t.account_id = sa.account_id
    LEFT JOIN ACCOUNT_HOLDER ah
        ON ah.account_id = sa.account_id
       AND ah.role = 'PRIMARY'
    LEFT JOIN CUSTOMER c
        ON c.customer_id = ah.customer_id
    WHERE p_branch_id IS NULL OR c.registered_at_branch_id = p_branch_id
    GROUP BY sa.account_id, sa.account_no, sa.status, sp.plan_name, sa.balance
    ORDER BY sa.account_no;
END$$


-- Report 3: Active FD payout schedule
DROP VIEW IF EXISTS VW_ACTIVE_FD_PAYOUT_SCHEDULE$$
CREATE VIEW VW_ACTIVE_FD_PAYOUT_SCHEDULE AS
SELECT
    fd.fd_id,
    sa.account_no,
    fd.amount        AS principal,
    fd.interest_rate,
    fp.term_name      AS term,
    fd.start_date,
    fd.maturity_date,
    fd.next_payout_date
FROM FIXED_DEPOSIT fd
JOIN SAVINGS_ACCOUNT sa
    ON sa.account_id = fd.account_id
JOIN FD_PLAN fp
    ON fp.fd_plan_id = fd.fd_plan_id
WHERE fd.status = 'ACTIVE'
ORDER BY fd.next_payout_date$$


-- Report 4: Monthly interest distribution
DROP PROCEDURE IF EXISTS RPT_MONTHLY_INTEREST_DISTRIBUTION$$
CREATE PROCEDURE RPT_MONTHLY_INTEREST_DISTRIBUTION(
    IN p_year  INT,
    IN p_month INT
)
BEGIN
    SELECT
        sp.plan_name,
        COUNT(DISTINCT t.account_id) AS accounts_credited,
        SUM(t.amount)                AS total_interest_paid
    FROM `TRANSACTION` t
    JOIN SAVINGS_ACCOUNT sa
        ON sa.account_id = t.account_id
    JOIN SAVINGS_PLAN sp
        ON sp.plan_id = sa.plan_id
    WHERE t.transaction_type IN ('SAVINGS_INTEREST','FD_INTEREST')
      AND YEAR(t.txn_timestamp)  = p_year
      AND MONTH(t.txn_timestamp) = p_month
    GROUP BY sp.plan_name
    ORDER BY total_interest_paid DESC;
END$$


-- Report 5: Customer activity report
DROP PROCEDURE IF EXISTS RPT_CUSTOMER_ACTIVITY$$
CREATE PROCEDURE RPT_CUSTOMER_ACTIVITY(
    IN p_start_date DATE,
    IN p_end_date   DATE
)
BEGIN
    SELECT
        c.customer_id,
        CONCAT(c.first_name, ' ', c.last_name) AS customer_name,
        c.NIC,
        COALESCE(SUM(CASE WHEN t.transaction_type = 'DEPOSIT'    THEN t.amount END), 0) AS total_deposits,
        COALESCE(SUM(CASE WHEN t.transaction_type = 'WITHDRAWAL' THEN t.amount END), 0) AS total_withdrawals,
        COALESCE(SUM(CASE WHEN t.transaction_type = 'DEPOSIT'    THEN t.amount END), 0)
            - COALESCE(SUM(CASE WHEN t.transaction_type = 'WITHDRAWAL' THEN t.amount END), 0)
            AS net_balance_change
    FROM CUSTOMER c
    JOIN ACCOUNT_HOLDER ah
        ON ah.customer_id = c.customer_id
    JOIN `TRANSACTION` t
        ON t.account_id = ah.account_id
       AND DATE(t.txn_timestamp) BETWEEN p_start_date AND p_end_date
       AND t.transaction_type IN ('DEPOSIT', 'WITHDRAWAL')
    GROUP BY c.customer_id, customer_name, c.NIC
    ORDER BY c.customer_id;
END$$

DELIMITER ;
