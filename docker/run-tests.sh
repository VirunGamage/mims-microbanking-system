#!/bin/bash
# Runs every SQL test inside the database container:   docker compose exec db mims-tests
# Like tests/run_all.sql run by hand, it reloads the sample data before and after the tests, so anything entered
# through the app is wiped. Then it checks the sample data (36 checks).
set -e
cd /mims
export MYSQL_PWD="$MYSQL_ROOT_PASSWORD"
mysql -uroot --table < tests/run_all.sql
mysql -uroot --table mims < tests/validate_sample_data.sql
