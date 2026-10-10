-- Runs all MIMS SQL tests in the required order.
-- Run from the repository root with:
-- mysql -u root -p --table < tests/run_all.sql

SOURCE tests/_helpers.sql;
SOURCE tests/test_deposit_withdraw.sql;
SOURCE tests/test_interest_posting.sql;
SOURCE tests/test_fd_procs.sql;
SOURCE tests/test_open_savings_account.sql;
SOURCE tests/test_triggers_and_reports.sql;
SOURCE tests/validate_sample_data.sql;