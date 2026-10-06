/* =====================================================================
   validate_sample_data.sql  -  MIMS v3 (Group 27)
   Read-only. Run AFTER loading the sample data:
       mysql -u root -p mims < validate_sample_data.sql
   Every row must show PASS. 'violations' = how many rows/items break the rule.
   ===================================================================== */
USE mims;

SELECT check_name, violations, IF(violations = 0, 'PASS', 'FAIL') AS result
FROM (

/* ---------- volume requirements (SRS 6.4) ---------- */
SELECT 'V01 at least 3 branches' AS check_name, GREATEST(0, 3 - COUNT(*)) AS violations FROM BRANCH
UNION ALL SELECT 'V02 at least 5 agents', GREATEST(0, 5 - COUNT(*)) FROM AGENT
UNION ALL SELECT 'V03 exactly 15 customers', ABS(15 - COUNT(*)) FROM CUSTOMER
UNION ALL SELECT 'V04 at least 2 joint accounts with 2+ holders', GREATEST(0, 2 - COUNT(*))
  FROM (SELECT a.account_id
        FROM SAVINGS_ACCOUNT a
        JOIN SAVINGS_PLAN p ON p.plan_id = a.plan_id
        JOIN ACCOUNT_HOLDER h ON h.account_id = a.account_id
        WHERE p.plan_name = 'Joint'
        GROUP BY a.account_id HAVING COUNT(*) >= 2) j
UNION ALL SELECT 'V05 exactly 10 fixed deposits', ABS(10 - COUNT(*)) FROM FIXED_DEPOSIT
UNION ALL SELECT 'V06 all 3 FD plans used', 3 - COUNT(DISTINCT fd_plan_id) FROM FIXED_DEPOSIT
UNION ALL SELECT 'V07 at least 100 transactions', GREATEST(0, 100 - COUNT(*)) FROM `TRANSACTION`
UNION ALL SELECT 'V08 transactions span at least 3 months',
       GREATEST(0, 3 - COUNT(DISTINCT DATE_FORMAT(txn_timestamp, '%Y-%m'))) FROM `TRANSACTION`
UNION ALL SELECT 'V09 mix: deposit, withdrawal, savings interest, FD open and FD interest all present',
       5 - COUNT(DISTINCT CASE WHEN transaction_type IN ('DEPOSIT','WITHDRAWAL','SAVINGS_INTEREST','FD_OPEN','FD_INTEREST')
                               THEN transaction_type END)
  FROM `TRANSACTION`

/* ---------- holders and plans ---------- */
UNION ALL SELECT 'H01 every account has exactly one PRIMARY holder', COUNT(*)
  FROM (SELECT a.account_id
        FROM SAVINGS_ACCOUNT a
        LEFT JOIN ACCOUNT_HOLDER h ON h.account_id = a.account_id AND h.role = 'PRIMARY'
        GROUP BY a.account_id HAVING COUNT(h.customer_id) <> 1) x
UNION ALL SELECT 'H02 Joint plan has 2+ holders, other plans exactly 1', COUNT(*)
  FROM (SELECT a.account_id, p.plan_name, COUNT(h.customer_id) AS n
        FROM SAVINGS_ACCOUNT a
        JOIN SAVINGS_PLAN p ON p.plan_id = a.plan_id
        LEFT JOIN ACCOUNT_HOLDER h ON h.account_id = a.account_id
        GROUP BY a.account_id, p.plan_name
        HAVING (p.plan_name = 'Joint' AND n < 2) OR (p.plan_name <> 'Joint' AND n <> 1)) x
UNION ALL SELECT 'H03 age fits plan at open_date (PRIMARY holder; Joint not age-limited)', COUNT(*)
  FROM SAVINGS_ACCOUNT a
  JOIN SAVINGS_PLAN p ON p.plan_id = a.plan_id
  JOIN ACCOUNT_HOLDER h ON h.account_id = a.account_id AND h.role = 'PRIMARY'
  JOIN CUSTOMER c ON c.customer_id = h.customer_id
  WHERE (p.plan_name = 'Children'
           AND TIMESTAMPDIFF(YEAR, c.DOB, a.open_date) > (SELECT CAST(config_value AS UNSIGNED) FROM SYSTEM_CONFIG WHERE config_key = 'age_child_max'))
     OR (p.plan_name = 'Teen'
           AND TIMESTAMPDIFF(YEAR, c.DOB, a.open_date) NOT BETWEEN
               (SELECT CAST(config_value AS UNSIGNED) FROM SYSTEM_CONFIG WHERE config_key = 'age_teen_min')
           AND (SELECT CAST(config_value AS UNSIGNED) FROM SYSTEM_CONFIG WHERE config_key = 'age_teen_max'))
     OR (p.plan_name = 'Adult'
           AND (TIMESTAMPDIFF(YEAR, c.DOB, a.open_date) < (SELECT CAST(config_value AS UNSIGNED) FROM SYSTEM_CONFIG WHERE config_key = 'age_adult_min')
             OR TIMESTAMPDIFF(YEAR, c.DOB, a.open_date) >= (SELECT CAST(config_value AS UNSIGNED) FROM SYSTEM_CONFIG WHERE config_key = 'age_senior_min')))
     OR (p.plan_name = 'Senior'
           AND TIMESTAMPDIFF(YEAR, c.DOB, a.open_date) < (SELECT CAST(config_value AS UNSIGNED) FROM SYSTEM_CONFIG WHERE config_key = 'age_senior_min'))
UNION ALL SELECT 'H04 customer registered at the same branch as their agent', COUNT(*)
  FROM CUSTOMER c JOIN AGENT g ON g.agent_id = c.registered_by_agent_id
  WHERE c.registered_at_branch_id <> g.branch_id

/* ---------- balances ---------- */
UNION ALL SELECT 'B01 balance = sum of its transactions (REQ-HIS-03)', COUNT(*)
  FROM (SELECT a.account_id, a.balance,
               COALESCE(SUM(CASE WHEN t.transaction_type IN ('DEPOSIT','SAVINGS_INTEREST','FD_INTEREST','FD_CLOSURE')
                                 THEN t.amount ELSE -t.amount END), 0) AS derived
        FROM SAVINGS_ACCOUNT a
        LEFT JOIN `TRANSACTION` t ON t.account_id = a.account_id
        GROUP BY a.account_id, a.balance
        HAVING a.balance <> derived) x
UNION ALL SELECT 'B02 balance >= plan minimum balance', COUNT(*)
  FROM SAVINGS_ACCOUNT a JOIN SAVINGS_PLAN p ON p.plan_id = a.plan_id
  WHERE a.balance < p.minimum_balance
UNION ALL SELECT 'B03 no transaction dated before the account was opened', COUNT(*)
  FROM `TRANSACTION` t JOIN SAVINGS_ACCOUNT a ON a.account_id = t.account_id
  WHERE DATE(t.txn_timestamp) < a.open_date

/* ---------- fixed deposits ---------- */
UNION ALL SELECT 'F01 at most one ACTIVE FD per account', COUNT(*)
  FROM (SELECT account_id FROM FIXED_DEPOSIT WHERE status = 'ACTIVE'
        GROUP BY account_id HAVING COUNT(*) > 1) x
UNION ALL SELECT 'F02 maturity_date = start_date + plan duration_days', COUNT(*)
  FROM FIXED_DEPOSIT f JOIN FD_PLAN p ON p.fd_plan_id = f.fd_plan_id
  WHERE f.maturity_date <> DATE_ADD(f.start_date, INTERVAL p.duration_days DAY)
UNION ALL SELECT 'F03 FD rate snapshot equals its plan rate', COUNT(*)
  FROM FIXED_DEPOSIT f JOIN FD_PLAN p ON p.fd_plan_id = f.fd_plan_id
  WHERE f.interest_rate <> p.interest_rate
UNION ALL SELECT 'F04 an ACTIVE FD sits on an ACTIVE savings account', COUNT(*)
  FROM FIXED_DEPOSIT f JOIN SAVINGS_ACCOUNT a ON a.account_id = f.account_id
  WHERE f.status = 'ACTIVE' AND a.status <> 'ACTIVE'
UNION ALL SELECT 'F05 FD_INTEREST amount = amount x rate x 30 / 365 (rounded)', COUNT(*)
  FROM `TRANSACTION` t JOIN FIXED_DEPOSIT f ON f.fd_id = t.fd_id
  WHERE t.transaction_type = 'FD_INTEREST'
    AND t.amount <> ROUND(f.amount * f.interest_rate / 100
        * (SELECT CAST(config_value AS UNSIGNED) FROM SYSTEM_CONFIG WHERE config_key = 'fd_interest_cycle_days')
        / (SELECT CAST(config_value AS UNSIGNED) FROM SYSTEM_CONFIG WHERE config_key = 'interest_day_count_basis'), 2)
UNION ALL SELECT 'F06 FD transactions belong to the same account as the FD', COUNT(*)
  FROM `TRANSACTION` t JOIN FIXED_DEPOSIT f ON f.fd_id = t.fd_id
  WHERE t.account_id <> f.account_id
UNION ALL SELECT 'F07 FD_INTEREST dated within the FD term', COUNT(*)
  FROM `TRANSACTION` t JOIN FIXED_DEPOSIT f ON f.fd_id = t.fd_id
  WHERE t.transaction_type = 'FD_INTEREST'
    AND (DATE(t.txn_timestamp) <= f.start_date OR DATE(t.txn_timestamp) > f.maturity_date)

/* ---------- business rules on transactions ---------- */
UNION ALL SELECT 'T01 deposits/withdrawals/FD opens inside Mon-Fri business hours', COUNT(*)
  FROM `TRANSACTION`
  WHERE transaction_type IN ('DEPOSIT','WITHDRAWAL','FD_OPEN')
    AND (DAYOFWEEK(txn_timestamp) IN (1, 7)
      OR TIME(txn_timestamp) < CAST((SELECT config_value FROM SYSTEM_CONFIG WHERE config_key = 'business_day_start') AS TIME)
      OR TIME(txn_timestamp) > CAST((SELECT config_value FROM SYSTEM_CONFIG WHERE config_key = 'business_day_end') AS TIME))
UNION ALL SELECT 'T02 daily withdrawals per account within the limit', COUNT(*)
  FROM (SELECT account_id, DATE(txn_timestamp) AS d, SUM(amount) AS total
        FROM `TRANSACTION` WHERE transaction_type = 'WITHDRAWAL'
        GROUP BY account_id, DATE(txn_timestamp)
        HAVING total > (SELECT CAST(config_value AS DECIMAL(14,2)) FROM SYSTEM_CONFIG WHERE config_key = 'daily_withdrawal_limit')) x
UNION ALL SELECT 'T03 review_flag = 1 only for deposits above the threshold', COUNT(*)
  FROM `TRANSACTION`
  WHERE review_flag <> IF(transaction_type = 'DEPOSIT'
        AND amount > (SELECT CAST(config_value AS DECIMAL(14,2)) FROM SYSTEM_CONFIG WHERE config_key = 'large_deposit_threshold'), 1, 0)
UNION ALL SELECT 'T04 interest transactions use channel SYSTEM', COUNT(*)
  FROM `TRANSACTION` WHERE transaction_type IN ('FD_INTEREST','SAVINGS_INTEREST') AND channel <> 'SYSTEM'

/* ---------- Model A: FD money moves out of savings and back ---------- */
UNION ALL SELECT 'F08 every FD has exactly one FD_OPEN (same account, same amount, on start_date)', COUNT(*)
  FROM FIXED_DEPOSIT f
  WHERE (SELECT COUNT(*) FROM `TRANSACTION` t
         WHERE t.fd_id = f.fd_id AND t.transaction_type = 'FD_OPEN'
           AND t.account_id = f.account_id AND t.amount = f.amount
           AND DATE(t.txn_timestamp) = f.start_date) <> 1
UNION ALL SELECT 'F09 MATURED/CLOSED FD has exactly one FD_CLOSURE for its amount; ACTIVE FD has none', COUNT(*)
  FROM FIXED_DEPOSIT f
  WHERE (SELECT COUNT(*) FROM `TRANSACTION` t
         WHERE t.fd_id = f.fd_id AND t.transaction_type = 'FD_CLOSURE' AND t.amount = f.amount)
        <> IF(f.status = 'ACTIVE', 0, 1)
UNION ALL SELECT 'F10 no two FDs on one account overlap in time', COUNT(*)
  FROM FIXED_DEPOSIT f1 JOIN FIXED_DEPOSIT f2
    ON f1.account_id = f2.account_id AND f1.fd_id < f2.fd_id
  WHERE f1.start_date < IFNULL(f2.close_date, f2.maturity_date)
    AND f2.start_date < IFNULL(f1.close_date, f1.maturity_date)

/* ---------- savings interest ---------- */
UNION ALL SELECT 'S01 SAVINGS_INTEREST = balance just before x plan rate x cycle / basis (rounded)', COUNT(*)
  FROM `TRANSACTION` t
  JOIN SAVINGS_ACCOUNT a ON a.account_id = t.account_id
  JOIN SAVINGS_PLAN p ON p.plan_id = a.plan_id
  WHERE t.transaction_type = 'SAVINGS_INTEREST'
    AND t.amount <> ROUND(
          (SELECT COALESCE(SUM(CASE WHEN t2.transaction_type IN ('DEPOSIT','SAVINGS_INTEREST','FD_INTEREST','FD_CLOSURE')
                                    THEN t2.amount ELSE -t2.amount END), 0)
           FROM `TRANSACTION` t2
           WHERE t2.account_id = t.account_id
             AND (t2.txn_timestamp < t.txn_timestamp
                  OR (t2.txn_timestamp = t.txn_timestamp AND t2.transaction_id < t.transaction_id)))
          * p.interest_rate / 100
          * (SELECT CAST(config_value AS UNSIGNED) FROM SYSTEM_CONFIG WHERE config_key = 'savings_interest_cycle_days')
          / (SELECT CAST(config_value AS UNSIGNED) FROM SYSTEM_CONFIG WHERE config_key = 'interest_day_count_basis'), 2)
UNION ALL SELECT 'S02 SAVINGS_INTEREST only on accounts opened at least one cycle earlier', COUNT(*)
  FROM `TRANSACTION` t JOIN SAVINGS_ACCOUNT a ON a.account_id = t.account_id
  WHERE t.transaction_type = 'SAVINGS_INTEREST'
    AND DATE(t.txn_timestamp) < DATE_ADD(a.open_date,
        INTERVAL (SELECT CAST(config_value AS UNSIGNED) FROM SYSTEM_CONFIG WHERE config_key = 'savings_interest_cycle_days') DAY)
UNION ALL SELECT 'S03 at most one SAVINGS_INTEREST per account per day', COUNT(*)
  FROM (SELECT account_id, DATE(txn_timestamp) d FROM `TRANSACTION`
        WHERE transaction_type = 'SAVINGS_INTEREST'
        GROUP BY account_id, DATE(txn_timestamp) HAVING COUNT(*) > 1) x
UNION ALL SELECT 'S04 consecutive SAVINGS_INTEREST postings per account are >= one cycle apart', COUNT(*)
  FROM (SELECT account_id, txn_timestamp,
               LAG(txn_timestamp) OVER (PARTITION BY account_id ORDER BY txn_timestamp) AS prev_ts
        FROM `TRANSACTION`
        WHERE transaction_type = 'SAVINGS_INTEREST') x
  WHERE prev_ts IS NOT NULL
    AND DATEDIFF(txn_timestamp, prev_ts) < (SELECT CAST(config_value AS UNSIGNED) FROM SYSTEM_CONFIG WHERE config_key = 'savings_interest_cycle_days')
UNION ALL SELECT 'F11 consecutive FD_INTEREST postings per FD are >= one cycle apart', COUNT(*)
  FROM (SELECT fd_id, txn_timestamp,
               LAG(txn_timestamp) OVER (PARTITION BY fd_id ORDER BY txn_timestamp) AS prev_ts
        FROM `TRANSACTION`
        WHERE transaction_type = 'FD_INTEREST') x
  WHERE prev_ts IS NOT NULL
    AND DATEDIFF(txn_timestamp, prev_ts) < (SELECT CAST(config_value AS UNSIGNED) FROM SYSTEM_CONFIG WHERE config_key = 'fd_interest_cycle_days')

/* ---------- running balance never below plan minimum after a debit ---------- */
UNION ALL SELECT 'T05 balance stays at or above plan minimum after every withdrawal / FD open', COUNT(*)
  FROM `TRANSACTION` t
  JOIN SAVINGS_ACCOUNT a ON a.account_id = t.account_id
  JOIN SAVINGS_PLAN p ON p.plan_id = a.plan_id
  WHERE t.transaction_type IN ('WITHDRAWAL','FD_OPEN')
    AND (SELECT COALESCE(SUM(CASE WHEN t2.transaction_type IN ('DEPOSIT','SAVINGS_INTEREST','FD_INTEREST','FD_CLOSURE')
                                  THEN t2.amount ELSE -t2.amount END), 0)
         FROM `TRANSACTION` t2
         WHERE t2.account_id = t.account_id
           AND (t2.txn_timestamp < t.txn_timestamp
                OR (t2.txn_timestamp = t.txn_timestamp AND t2.transaction_id <= t.transaction_id)))
        < p.minimum_balance

) checks
ORDER BY check_name;
