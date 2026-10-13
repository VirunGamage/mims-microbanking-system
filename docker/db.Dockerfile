# The MIMS database image, used by docker-compose.yml: MySQL 8.0.46 (the version the project is tested on) with the
# schema, procedures, reports, sample data and SQL tests copied in. The first time the container starts with an empty
# data volume, docker/db-init.sh loads them exactly as the README does by hand.
FROM mysql:8.0.46

# Sri Lanka time, so business hours (Mon-Fri 09:00-16:00) and "today" follow the bank's clock
ENV TZ=Asia/Colombo

WORKDIR /mims
COPY sql/ sql/
COPY sample-data/ sample-data/
COPY procedures/ procedures/
COPY reports/ reports/
COPY tests/ tests/
COPY scripts/load_all.sql scripts/create_app_user.sql scripts/

# The MySQL image runs every script in /docker-entrypoint-initdb.d once, on the first start.
COPY docker/db-init.sh /docker-entrypoint-initdb.d/10-load-mims.sh
COPY docker/run-tests.sh /usr/local/bin/mims-tests

# Files checked out on Windows can have CRLF line endings; bash and the mysql client here expect plain LF.
RUN sed -i 's/\r$//' /mims/*/*.sql /docker-entrypoint-initdb.d/10-load-mims.sh /usr/local/bin/mims-tests \
 && chmod 755 /docker-entrypoint-initdb.d/10-load-mims.sh /usr/local/bin/mims-tests
