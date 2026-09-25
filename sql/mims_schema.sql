DROP DATABASE IF EXISTS mims;
CREATE DATABASE mims
    DEFAULT CHARACTER SET utf8mb4
    DEFAULT COLLATE utf8mb4_unicode_ci;
USE mims;

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 1;

CREATE TABLE ORGANIZATION (
    org_id              INT AUTO_INCREMENT PRIMARY KEY,
    org_name            VARCHAR(150) NOT NULL,
    registration_no     VARCHAR(30)  NOT NULL,
    license_no          VARCHAR(30)  NOT NULL,
    head_office_address VARCHAR(150),
    established_date    DATE,
    CONSTRAINT uq_org_registration_no UNIQUE (registration_no),
    CONSTRAINT uq_org_license_no      UNIQUE (license_no)
) ENGINE=InnoDB;

CREATE TABLE BRANCH (
    branch_id    INT AUTO_INCREMENT PRIMARY KEY,
    branch_name  VARCHAR(100) NOT NULL,
    district     VARCHAR(50)  NOT NULL,
    address      VARCHAR(150),
    org_id       INT NOT NULL,
    CONSTRAINT uq_branch_name UNIQUE (branch_name),
    CONSTRAINT fk_branch_org
        FOREIGN KEY (org_id) REFERENCES ORGANIZATION(org_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB;

CREATE INDEX idx_branch_org_id ON BRANCH(org_id);

CREATE TABLE AGENT (
    agent_id    INT AUTO_INCREMENT PRIMARY KEY,
    first_name  VARCHAR(50) NOT NULL,
    last_name   VARCHAR(50) NOT NULL,
    phone       VARCHAR(20),
    email       VARCHAR(100),
    status      ENUM('ACTIVE','ON_LEAVE','TRANSFERRED','TERMINATED')
                NOT NULL DEFAULT 'ACTIVE',
    branch_id   INT NOT NULL,
    email_in_service VARCHAR(100)
        GENERATED ALWAYS AS (CASE WHEN status IN ('ACTIVE','ON_LEAVE') THEN email END) STORED,
    CONSTRAINT uq_agent_email_in_service UNIQUE (email_in_service),
    CONSTRAINT fk_agent_branch
        FOREIGN KEY (branch_id) REFERENCES BRANCH(branch_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB;

CREATE INDEX idx_agent_branch_id ON AGENT(branch_id);
CREATE INDEX idx_agent_status    ON AGENT(status);

CREATE TABLE CUSTOMER (
    customer_id             INT AUTO_INCREMENT PRIMARY KEY,
    first_name              VARCHAR(50) NOT NULL,
    last_name               VARCHAR(50) NOT NULL,
    NIC                     VARCHAR(12),
    DOB                     DATE NOT NULL,
    address                 VARCHAR(150),
    phone                   VARCHAR(20),
    email                   VARCHAR(100),
    registered_by_agent_id  INT NOT NULL,
    registered_at_branch_id INT NOT NULL,
    CONSTRAINT uq_customer_nic UNIQUE (NIC),
    CONSTRAINT chk_customer_dob_floor CHECK (DOB >= '1900-01-01'),
    CONSTRAINT fk_customer_registering_agent
        FOREIGN KEY (registered_by_agent_id) REFERENCES AGENT(agent_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_customer_registered_branch
        FOREIGN KEY (registered_at_branch_id) REFERENCES BRANCH(branch_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB;

CREATE INDEX idx_customer_registering_agent ON CUSTOMER(registered_by_agent_id);
CREATE INDEX idx_customer_registered_branch ON CUSTOMER(registered_at_branch_id);

CREATE TABLE SAVINGS_PLAN (
    plan_id          INT AUTO_INCREMENT PRIMARY KEY,
    plan_name        VARCHAR(50)   NOT NULL,
    interest_rate    DECIMAL(5,2)  NOT NULL,
    minimum_balance  DECIMAL(12,2) NOT NULL,
    CONSTRAINT uq_plan_name UNIQUE (plan_name),
    CONSTRAINT chk_plan_rate        CHECK (interest_rate > 0),
    CONSTRAINT chk_plan_min_balance CHECK (minimum_balance >= 0)
) ENGINE=InnoDB;

INSERT INTO SAVINGS_PLAN (plan_id, plan_name, interest_rate, minimum_balance) VALUES
    (1, 'Children', 12.00,    0.00),
    (2, 'Teen',     11.00,  500.00),
    (3, 'Adult',    10.00, 1000.00),
    (4, 'Senior',   13.00, 1000.00),
    (5, 'Joint',     7.00, 5000.00);

CREATE TABLE FD_PLAN (
    fd_plan_id     INT AUTO_INCREMENT PRIMARY KEY,
    term_name      VARCHAR(10)  NOT NULL,
    duration_days  INT          NOT NULL,
    interest_rate  DECIMAL(5,2) NOT NULL,
    CONSTRAINT uq_fd_plan_term     UNIQUE (term_name),
    CONSTRAINT uq_fd_plan_duration UNIQUE (duration_days),
    CONSTRAINT chk_fd_plan_term     CHECK (term_name IN ('6_MONTH','1_YEAR','3_YEAR')),
    CONSTRAINT chk_fd_plan_duration CHECK (duration_days > 0 AND MOD(duration_days, 30) = 0),
    CONSTRAINT chk_fd_plan_rate     CHECK (interest_rate > 0)
) ENGINE=InnoDB;

INSERT INTO FD_PLAN (fd_plan_id, term_name, duration_days, interest_rate) VALUES
    (1, '6_MONTH',  180, 13.00),
    (2, '1_YEAR',   360, 14.00),
    (3, '3_YEAR',  1080, 15.00);

CREATE TABLE SAVINGS_ACCOUNT (
    account_id   INT AUTO_INCREMENT PRIMARY KEY,
    account_no   VARCHAR(20)   NOT NULL,
    balance      DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    open_date    DATE          NOT NULL DEFAULT (CURRENT_DATE),
    status       ENUM('ACTIVE','CLOSED','FROZEN') NOT NULL DEFAULT 'ACTIVE',
    plan_id      INT NOT NULL,
    CONSTRAINT uq_account_no UNIQUE (account_no),
    CONSTRAINT chk_account_no_format CHECK (account_no REGEXP '^SA[0-9]{7}$'),
    CONSTRAINT chk_account_balance_nonneg CHECK (balance >= 0),
    CONSTRAINT fk_account_plan
        FOREIGN KEY (plan_id) REFERENCES SAVINGS_PLAN(plan_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB;

CREATE INDEX idx_account_plan_id ON SAVINGS_ACCOUNT(plan_id);
CREATE INDEX idx_account_status  ON SAVINGS_ACCOUNT(status);

CREATE TABLE ACCOUNT_HOLDER (
    customer_id  INT NOT NULL,
    account_id   INT NOT NULL,
    role         ENUM('PRIMARY','SECONDARY') NOT NULL DEFAULT 'PRIMARY',
    PRIMARY KEY (customer_id, account_id),
    CONSTRAINT fk_holder_customer
        FOREIGN KEY (customer_id) REFERENCES CUSTOMER(customer_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_holder_account
        FOREIGN KEY (account_id) REFERENCES SAVINGS_ACCOUNT(account_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB;

CREATE INDEX idx_holder_account_id ON ACCOUNT_HOLDER(account_id);

CREATE TABLE FIXED_DEPOSIT (
    fd_id             INT AUTO_INCREMENT PRIMARY KEY,
    amount            DECIMAL(14,2) NOT NULL,
    interest_rate     DECIMAL(5,2)  NOT NULL,
    start_date        DATE NOT NULL,
    maturity_date     DATE NOT NULL,
    status            ENUM('ACTIVE','MATURED','CLOSED') NOT NULL DEFAULT 'ACTIVE',
    next_payout_date  DATE,
    close_date        DATE,
    account_id        INT NOT NULL,
    fd_plan_id        INT NOT NULL,
    CONSTRAINT chk_fd_amount_positive CHECK (amount > 0),
    CONSTRAINT chk_fd_rate_positive   CHECK (interest_rate > 0),
    CONSTRAINT chk_fd_dates           CHECK (maturity_date > start_date),
    CONSTRAINT chk_fd_close_date      CHECK (close_date IS NULL OR close_date >= start_date),
    CONSTRAINT fk_fd_account
        FOREIGN KEY (account_id) REFERENCES SAVINGS_ACCOUNT(account_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_fd_plan
        FOREIGN KEY (fd_plan_id) REFERENCES FD_PLAN(fd_plan_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB;

CREATE INDEX idx_fd_account_id    ON FIXED_DEPOSIT(account_id);
CREATE INDEX idx_fd_plan_id       ON FIXED_DEPOSIT(fd_plan_id);
CREATE INDEX idx_fd_status_payout ON FIXED_DEPOSIT(status, next_payout_date);

CREATE TABLE `TRANSACTION` (
    transaction_id         BIGINT AUTO_INCREMENT PRIMARY KEY,
    transaction_type       VARCHAR(16)   NOT NULL,
    amount                 DECIMAL(14,2) NOT NULL,
    txn_timestamp          DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    reference_no           VARCHAR(30)   NOT NULL,
    channel                ENUM('BRANCH','ONLINE','MOBILE','ATM','SYSTEM')
                           NOT NULL DEFAULT 'BRANCH',
    review_flag            TINYINT(1)    NOT NULL DEFAULT 0,
    account_id             INT           NOT NULL,
    processed_by_agent_id  INT NULL,
    fd_id                  INT NULL,
    CONSTRAINT uq_txn_reference UNIQUE (reference_no),
    CONSTRAINT chk_txn_type
        CHECK (transaction_type IN ('DEPOSIT','WITHDRAWAL','SAVINGS_INTEREST',
                                    'FD_OPEN','FD_INTEREST','FD_CLOSURE')),
    CONSTRAINT chk_txn_amount_positive CHECK (amount > 0),
    CONSTRAINT chk_txn_review_flag CHECK (review_flag IN (0,1)),
    CONSTRAINT chk_txn_channel_agent CHECK (
        (channel = 'BRANCH' AND processed_by_agent_id IS NOT NULL)
        OR
        (channel <> 'BRANCH' AND processed_by_agent_id IS NULL)
    ),
    CONSTRAINT chk_txn_fd_link CHECK (
        (transaction_type IN ('FD_OPEN','FD_INTEREST','FD_CLOSURE') AND fd_id IS NOT NULL)
        OR
        (transaction_type IN ('DEPOSIT','WITHDRAWAL','SAVINGS_INTEREST') AND fd_id IS NULL)
    ),
    CONSTRAINT chk_txn_interest_channel CHECK (
        transaction_type NOT IN ('FD_INTEREST','SAVINGS_INTEREST') OR channel = 'SYSTEM'
    ),
    CONSTRAINT fk_txn_account
        FOREIGN KEY (account_id) REFERENCES SAVINGS_ACCOUNT(account_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_txn_agent
        FOREIGN KEY (processed_by_agent_id) REFERENCES AGENT(agent_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_txn_fd
        FOREIGN KEY (fd_id) REFERENCES FIXED_DEPOSIT(fd_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB;

CREATE INDEX idx_txn_account_date ON `TRANSACTION`(account_id, txn_timestamp);
CREATE INDEX idx_txn_agent_date   ON `TRANSACTION`(processed_by_agent_id, txn_timestamp);
CREATE INDEX idx_txn_type_date    ON `TRANSACTION`(transaction_type, txn_timestamp);
CREATE INDEX idx_txn_fd_id        ON `TRANSACTION`(fd_id);

CREATE TABLE SYSTEM_CONFIG (
    config_key    VARCHAR(50)  PRIMARY KEY,
    config_value  VARCHAR(100) NOT NULL,
    description   VARCHAR(200)
) ENGINE=InnoDB;

INSERT INTO SYSTEM_CONFIG (config_key, config_value, description) VALUES
    ('business_day_start',       '09:00',    'Earliest time deposits/withdrawals are accepted (Mon-Fri)'),
    ('business_day_end',         '16:00',    'Latest time deposits/withdrawals are accepted (Mon-Fri)'),
    ('daily_withdrawal_limit',   '100000.00','Max LKR withdrawn per account per day'),
    ('large_deposit_threshold',  '1000000.00','Deposits above this LKR amount are flagged for review'),
    ('fd_interest_cycle_days',   '30',       'Days between FD interest postings'),
    ('savings_interest_cycle_days','30',      'Days between savings-account interest postings'),
    ('interest_day_count_basis', '365',      'Denominator in interest = base x rate x cycle_days / basis (FD and savings)'),
    ('age_child_max',            '12',       'Highest age eligible for the Children plan'),
    ('age_teen_min',             '13',       'Lowest age eligible for the Teen plan'),
    ('age_teen_max',             '17',       'Highest age eligible for the Teen plan'),
    ('age_adult_min',            '18',       'Lowest age eligible for the Adult plan (NIC also required)'),
    ('age_senior_min',           '60',       'Lowest age eligible for the Senior plan');

DELIMITER $$

CREATE TRIGGER trg_customer_bi BEFORE INSERT ON CUSTOMER
FOR EACH ROW
BEGIN
    IF NEW.DOB > CURDATE() THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Date of birth cannot be in the future';
    END IF;
    IF NEW.NIC IS NULL AND TIMESTAMPDIFF(YEAR, NEW.DOB, CURDATE()) >= 18 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'NIC is required for customers aged 18 or over';
    END IF;
END$$

CREATE TRIGGER trg_customer_bu BEFORE UPDATE ON CUSTOMER
FOR EACH ROW
BEGIN
    IF NEW.DOB > CURDATE() THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Date of birth cannot be in the future';
    END IF;
    IF NEW.NIC IS NULL AND TIMESTAMPDIFF(YEAR, NEW.DOB, CURDATE()) >= 18 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'NIC is required for customers aged 18 or over';
    END IF;
END$$

CREATE TRIGGER trg_transaction_bi BEFORE INSERT ON `TRANSACTION`
FOR EACH ROW
BEGIN
    IF NEW.channel = 'BRANCH' AND
       (SELECT status FROM AGENT WHERE agent_id = NEW.processed_by_agent_id) <> 'ACTIVE' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Processing agent is not ACTIVE';
    END IF;
END$$

DELIMITER ;
