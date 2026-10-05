-- Two read-only views for the Data Checks page (accepted gaps G1 and G2). Owner: Rukshi.
-- Used by GET /api/tester/gap/nic-at-18 and GET /api/tester/gap/plan-outgrown. They only read, they never change data.
-- This file defines read-only views that identify the accepted data gaps G1 and G2 for the tester data-check endpoints.

USE mims;

DROP VIEW IF EXISTS VW_GAP_NIC_AT_18;
DROP VIEW IF EXISTS VW_GAP_PLAN_OUTGROWN;

-- Customers who are now 18 or older but still have no NIC. The trigger only checks NIC when a row is inserted or
-- updated, so someone registered as a child is never flagged when they grow up (gap G1).
CREATE VIEW VW_GAP_NIC_AT_18 AS
SELECT c.customer_id,
       c.first_name,
       c.last_name,
       c.DOB,
       TIMESTAMPDIFF(YEAR, c.DOB, CURDATE()) AS current_age,
       b.branch_name AS registered_branch
FROM CUSTOMER c
JOIN BRANCH b ON b.branch_id = c.registered_at_branch_id
WHERE c.NIC IS NULL
  AND TIMESTAMPDIFF(YEAR, c.DOB, CURDATE()) >=
      (SELECT CAST(config_value AS UNSIGNED) FROM SYSTEM_CONFIG WHERE config_key = 'age_adult_min');

-- ACTIVE individual accounts whose PRIMARY holder's age no longer fits the plan the account was opened under (gap G2).
-- The age bands come from SYSTEM_CONFIG, the same place the account-opening procedure reads them from.
CREATE VIEW VW_GAP_PLAN_OUTGROWN AS
SELECT x.account_id,
       x.account_no,
       x.current_plan,
       x.customer_id,
       x.first_name,
       x.last_name,
       x.current_age,
       CASE WHEN x.current_age <= x.child_max  THEN 'Children'
            WHEN x.current_age <= x.teen_max   THEN 'Teen'
            WHEN x.current_age <  x.senior_min THEN 'Adult'
            ELSE 'Senior' END AS plan_for_age_now
FROM (
    SELECT a.account_id,
           a.account_no,
           sp.plan_name AS current_plan,
           c.customer_id,
           c.first_name,
           c.last_name,
           TIMESTAMPDIFF(YEAR, c.DOB, CURDATE()) AS current_age,
           (SELECT CAST(config_value AS UNSIGNED) FROM SYSTEM_CONFIG WHERE config_key = 'age_child_max')  AS child_max,
           (SELECT CAST(config_value AS UNSIGNED) FROM SYSTEM_CONFIG WHERE config_key = 'age_teen_min')   AS teen_min,
           (SELECT CAST(config_value AS UNSIGNED) FROM SYSTEM_CONFIG WHERE config_key = 'age_teen_max')   AS teen_max,
           (SELECT CAST(config_value AS UNSIGNED) FROM SYSTEM_CONFIG WHERE config_key = 'age_senior_min') AS senior_min
    FROM SAVINGS_ACCOUNT a
    JOIN SAVINGS_PLAN sp   ON sp.plan_id = a.plan_id
    JOIN ACCOUNT_HOLDER h  ON h.account_id = a.account_id AND h.role = 'PRIMARY'
    JOIN CUSTOMER c        ON c.customer_id = h.customer_id
    WHERE a.status = 'ACTIVE'
      AND sp.plan_name <> 'Joint'   -- Joint accounts are not age restricted
) x
WHERE (x.current_plan = 'Children' AND x.current_age > x.child_max)
   OR (x.current_plan = 'Teen'     AND x.current_age NOT BETWEEN x.teen_min AND x.teen_max)
   OR (x.current_plan = 'Adult'    AND x.current_age >= x.senior_min)
   OR (x.current_plan = 'Senior'   AND x.current_age <  x.senior_min);
