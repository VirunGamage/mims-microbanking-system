-- Creates the limited MySQL user the backend uses (mims_app): it may read, call procedures and register customers,
-- but it can never UPDATE a balance or DELETE anything. Owner: Rukshi. Run as root, after scripts/load_all.sql:
--   mysql -u root -p      then at the mysql> prompt:   SET @app_password = 'your-own-password';   SOURCE scripts/create_app_user.sql;
-- This script creates the restricted mims_app user, sets its password safely, and grants only the permissions needed by the backend.

-- The password must be at least 8 characters. If it is missing or shorter, every statement text below is NULL,
-- MySQL refuses to prepare it, and no user is created or changed.
SET @password_ok = CHAR_LENGTH(COALESCE(@app_password, '')) >= 8;
SELECT IF(@password_ok, 'Creating mims_app ...',
          'STOP: first run  SET @app_password = ''a password of at least 8 characters'';  and then SOURCE this file again.')
       AS message;

-- The password arrives in a variable so it is never typed into a file that could be committed.
-- QUOTE() wraps it safely in quotes, so a password containing ' still works.
-- Two host names: 'localhost' for the mysql command line, '127.0.0.1' for the backend, which connects over TCP.
SET @create_sql = IF(@password_ok, CONCAT('CREATE USER IF NOT EXISTS ''mims_app''@''localhost'' IDENTIFIED BY ', QUOTE(@app_password)), NULL);
PREPARE stmt FROM @create_sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @create_sql = IF(@password_ok, CONCAT('ALTER USER ''mims_app''@''localhost'' IDENTIFIED BY ', QUOTE(@app_password)), NULL);
PREPARE stmt FROM @create_sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @create_sql = IF(@password_ok, CONCAT('CREATE USER IF NOT EXISTS ''mims_app''@''127.0.0.1'' IDENTIFIED BY ', QUOTE(@app_password)), NULL);
PREPARE stmt FROM @create_sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @create_sql = IF(@password_ok, CONCAT('ALTER USER ''mims_app''@''127.0.0.1'' IDENTIFIED BY ', QUOTE(@app_password)), NULL);
PREPARE stmt FROM @create_sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @create_sql = NULL, @password_ok = NULL;

-- SELECT and EXECUTE on the whole database, INSERT only on CUSTOMER (registration). No UPDATE or DELETE anywhere,
-- so balances can only change through the stored procedures.
GRANT SELECT, EXECUTE ON mims.* TO 'mims_app'@'localhost';
GRANT INSERT ON mims.CUSTOMER TO 'mims_app'@'localhost';
GRANT SELECT, EXECUTE ON mims.* TO 'mims_app'@'127.0.0.1';
GRANT INSERT ON mims.CUSTOMER TO 'mims_app'@'127.0.0.1';

SHOW GRANTS FOR 'mims_app'@'127.0.0.1';
