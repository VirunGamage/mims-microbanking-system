-- Shows, with EXPLAIN ANALYZE, that the report and withdrawal filters use the indexes on TRANSACTION.
-- Run from the repository root after scripts/load_all.sql:   mysql -u root -p --table < scripts/perf_check.sql
-- It builds a throw-away schema, mims_perf, with a copy of TRANSACTION (same columns and indexes) holding 300,000 made-up
-- rows over about six years, because 230 sample rows are too few for MySQL to bother with an index. The mims database
-- is not touched. Each query is run twice: the old way (DATE(), YEAR(), MONTH() around txn_timestamp) and the way the
-- procedures now write it (a plain range on txn_timestamp). Compare "Table scan" / "rows=300000" with "Index range scan".
-- At the end the mims_perf schema is dropped again.

DROP SCHEMA IF EXISTS mims_perf;
CREATE SCHEMA mims_perf;
USE mims_perf;

CREATE TABLE T LIKE mims.`TRANSACTION`;   -- same columns and indexes, but no foreign keys or triggers

SET SESSION cte_max_recursion_depth = 300000;

INSERT INTO T (
    transaction_type,
    amount,
    txn_timestamp,
    reference_no,
    channel,
    review_flag,
    account_id,
    processed_by_agent_id,
    fd_id
)
WITH RECURSIVE n (i) AS (
    SELECT 1
    UNION ALL
    SELECT i + 1 FROM n WHERE i < 300000
)
SELECT
    ELT(1 + i % 4, 'DEPOSIT', 'WITHDRAWAL', 'SAVINGS_INTEREST', 'DEPOSIT'),
    100 + i % 5000,
    TIMESTAMP('2022-01-01') + INTERVAL (i * 600) SECOND,
    CONCAT('PERF', i),
    IF(i % 4 = 2, 'SYSTEM', 'BRANCH'),
    0,
    1 + i % 2000,
    IF(i % 4 = 2, NULL, 1 + i % 50),
    NULL
FROM n;

ANALYZE TABLE T;

SELECT 'Monthly interest report: YEAR()/MONTH() (old)' AS query;
EXPLAIN ANALYZE
SELECT SUM(amount) FROM T
WHERE transaction_type IN ('SAVINGS_INTEREST', 'FD_INTEREST')
  AND YEAR(txn_timestamp) = 2026
  AND MONTH(txn_timestamp) = 6;

SELECT 'Monthly interest report: range (now)' AS query;
EXPLAIN ANALYZE
SELECT SUM(amount) FROM T
WHERE transaction_type IN ('SAVINGS_INTEREST', 'FD_INTEREST')
  AND txn_timestamp >= '2026-06-01'
  AND txn_timestamp < '2026-06-01' + INTERVAL 1 MONTH;

SELECT 'Agent-wise report, one agent: DATE() BETWEEN (old)' AS query;
EXPLAIN ANALYZE
SELECT COUNT(*), SUM(amount) FROM T
WHERE processed_by_agent_id = 7
  AND DATE(txn_timestamp) BETWEEN '2026-05-01' AND '2026-05-31';

SELECT 'Agent-wise report, one agent: range (now)' AS query;
EXPLAIN ANALYZE
SELECT COUNT(*), SUM(amount) FROM T
WHERE processed_by_agent_id = 7
  AND txn_timestamp >= '2026-05-01'
  AND txn_timestamp < '2026-05-31' + INTERVAL 1 DAY;

SELECT 'Daily withdrawal limit, one account: DATE() = today (old)' AS query;
EXPLAIN ANALYZE
SELECT SUM(amount) FROM T
WHERE account_id = 42
  AND transaction_type = 'WITHDRAWAL'
  AND DATE(txn_timestamp) = '2026-05-12';

SELECT 'Daily withdrawal limit, one account: range (now)' AS query;
EXPLAIN ANALYZE
SELECT SUM(amount) FROM T
WHERE account_id = 42
  AND transaction_type = 'WITHDRAWAL'
  AND txn_timestamp >= '2026-05-12'
  AND txn_timestamp < '2026-05-12' + INTERVAL 1 DAY;

DROP SCHEMA mims_perf;