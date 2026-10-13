#!/bin/bash
# Loads MIMS into the database container. The MySQL image runs this once, the first time the container starts with an
# empty data volume, so restarting the container keeps everything entered through the app.
# Same steps as the README: scripts/load_all.sql, then scripts/create_app_user.sql for the app's limited user.
set -e
cd /mims
export MYSQL_PWD="$MYSQL_ROOT_PASSWORD"   # the password travels in the environment, not on the command line

mysql -uroot < scripts/load_all.sql

# The password goes into an SQL string, so a backslash or a ' in it is escaped first
app_password=${APP_DB_PASSWORD//\\/\\\\}
app_password=${app_password//\'/\'\'}

# @app_host = '%' lets mims_app connect from the app container, which has its own network address
mysql -uroot <<SQL
SET @app_password = '${app_password}';
SET @app_host = '%';
SOURCE scripts/create_app_user.sql;
SQL

# On a cloud server the daily interest event can run by itself (docker-compose.cloud.yml, MIMS_DAILY_INTEREST=on).
# procedures/07_interest_posting.sql creates it switched off, and MySQL 8.0 runs its event scheduler by default.
if [ "${MIMS_DAILY_INTEREST:-off}" = "on" ]; then
  mysql -uroot -e "ALTER EVENT mims.ev_daily_interest ENABLE;"
  echo "The daily interest event is switched on: interest is posted every day at 03:00."
fi

echo "MIMS database loaded: schema, procedures, reports, sample data and the mims_app user."
