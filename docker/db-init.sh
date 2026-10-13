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

echo "MIMS database loaded: schema, procedures, reports, sample data and the mims_app user."
