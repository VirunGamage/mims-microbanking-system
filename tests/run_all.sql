-- Runs every SQL test on a freshly loaded database, then reloads it so the app has the plain sample data again. Owner: Rukshi.
-- Run from the repository root:  mysql -u root -p --table < tests/run_all.sql   (the last two tables are the summary)
-- This file runs all five SQL test suites on a clean database and reloads the sample data after testing.

SOURCE scripts/load_all.sql;
SOURCE tests/_helpers.sql;

SOURCE tests/test_open_savings_account.sql;
SOURCE tests/test_deposit_withdraw.sql;
SOURCE tests/test_fd_procs.sql;
SOURCE tests/test_interest_posting.sql;
SOURCE tests/test_triggers_and_reports.sql;

-- Test data cannot be deleted (transactions are permanent), so the database is loaded again. The results are kept,
-- because they are in the mims_test schema.
SOURCE scripts/load_all.sql;

SELECT suite, SUM(result = 'PASS') AS passed, SUM(result = 'FAIL') AS failed
FROM mims_test.results GROUP BY suite ORDER BY MIN(id);
SELECT IF(SUM(result = 'FAIL') = 0, CONCAT('ALL ', COUNT(*), ' CHECKS PASS'),
          CONCAT(SUM(result = 'FAIL'), ' OF ', COUNT(*), ' CHECKS FAIL')) AS overall
FROM mims_test.results;
