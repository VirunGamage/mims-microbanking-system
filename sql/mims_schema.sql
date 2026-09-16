CREATE DATABASE IF NOT EXISTS mims
    DEFAULT CHARACTER SET utf8mb4
    DEFAULT COLLATE utf8mb4_unicode_ci;

USE mims;

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 1;

CREATE TABLE BRANCH (
    branch_id   INT AUTO_INCREMENT PRIMARY KEY,
    name        VARCHAR(100) NOT NULL,
    district    VARCHAR(100) NOT NULL,
    UNIQUE KEY uq_branch_name (name)
) ENGINE=InnoDB;

CREATE TABLE AGENT (
    agent_id    INT AUTO_INCREMENT PRIMARY KEY,
    name        VARCHAR(100) NOT NULL,
    branch_id   INT NOT NULL,
    status      ENUM('ACTIVE','ON_LEAVE','TRANSFERRED','TERMINATED')
                NOT NULL DEFAULT 'ACTIVE',
    end_date    DATE NULL,
    CONSTRAINT fk_agent_branch
        FOREIGN KEY (branch_id) REFERENCES BRANCH(branch_id)
        ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB;

CREATE INDEX idx_agent_branch_id ON AGENT(branch_id);
CREATE INDEX idx_agent_status ON AGENT(status);

CREATE TABLE SAVINGS_PLAN (
    plan_code       VARCHAR(10) PRIMARY KEY,
    plan_name       VARCHAR(50) NOT NULL,
    interest_rate   DECIMAL(5,2) NOT NULL,
    minimum_balance DECIMAL(12,2) NOT NULL,
    CONSTRAINT chk_plan_rate CHECK (interest_rate > 0),
    CONSTRAINT chk_plan_min_balance CHECK (minimum_balance >= 0)
) ENGINE=InnoDB;

INSERT INTO SAVINGS_PLAN (plan_code, plan_name, interest_rate, minimum_balance) VALUES
    ('CHILD',  'Children', 12.00,    0.00),
    ('TEEN',   'Teen',     11.00,  500.00),
    ('ADULT',  'Adult',    10.00, 1000.00),
    ('SENIOR', 'Senior',   13.00, 1000.00),
    ('JOINT',  'Joint',     7.00, 5000.00);

CREATE TABLE CUSTOMER (
    customer_id             INT AUTO_INCREMENT PRIMARY KEY,
    name                    VARCHAR(100) NOT NULL,
    date_of_birth           DATE NOT NULL,
    contact_info            VARCHAR(255),
    registered_by_agent_id  INT NOT NULL,
    registered_at_branch_id INT NOT NULL,
    CONSTRAINT fk_customer_registering_agent
        FOREIGN KEY (registered_by_agent_id) REFERENCES AGENT(agent_id)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_customer_registered_branch
        FOREIGN KEY (registered_at_branch_id) REFERENCES BRANCH(branch_id)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT chk_customer_dob CHECK (date_of_birth <= CURDATE())
) ENGINE=InnoDB;

CREATE INDEX idx_customer_registering_agent ON CUSTOMER(registered_by_agent_id);
CREATE INDEX idx_customer_registered_branch ON CUSTOMER(registered_at_branch_id);

CREATE TABLE SAVINGS_ACCOUNT (
    account_id      INT AUTO_INCREMENT PRIMARY KEY,
    plan_code       VARCHAR(10) NOT NULL,
    balance         DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    status          ENUM('ACTIVE','CLOSED','FROZEN') NOT NULL DEFAULT 'ACTIVE',
    opened_date     DATE NOT NULL DEFAULT (CURRENT_DATE),
    CONSTRAINT fk_account_plan
        FOREIGN KEY (plan_code) REFERENCES SAVINGS_PLAN(plan_code)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT chk_account_balance_nonneg CHECK (balance >= 0)
) ENGINE=InnoDB;

CREATE INDEX idx_account_plan_code ON SAVINGS_ACCOUNT(plan_code);
CREATE INDEX idx_account_status ON SAVINGS_ACCOUNT(status);

CREATE TABLE ACCOUNT_HOLDER (
    account_id      INT NOT NULL,
    customer_id     INT NOT NULL,
    role            ENUM('PRIMARY','SECONDARY') NOT NULL DEFAULT 'PRIMARY',
    PRIMARY KEY (account_id, customer_id),
    CONSTRAINT fk_holder_account
        FOREIGN KEY (account_id) REFERENCES SAVINGS_ACCOUNT(account_id)
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_holder_customer
        FOREIGN KEY (customer_id) REFERENCES CUSTOMER(customer_id)
        ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB;

CREATE INDEX idx_holder_customer_id ON ACCOUNT_HOLDER(customer_id);

CREATE TABLE FIXED_DEPOSIT (
    fd_id             INT AUTO_INCREMENT PRIMARY KEY,
    account_id        INT NOT NULL,
    principal         DECIMAL(14,2) NOT NULL,
    term              VARCHAR(10) NOT NULL,
    interest_rate     DECIMAL(5,2) NOT NULL,
    start_date        DATE NOT NULL,
    maturity_date     DATE NOT NULL,
    status            ENUM('ACTIVE','MATURED','CLOSED') NOT NULL DEFAULT 'ACTIVE',
    next_payout_date  DATE,
    closure_date      DATE NULL,
    closed_by_agent_id INT NULL,
    CONSTRAINT fk_fd_account
        FOREIGN KEY (account_id) REFERENCES SAVINGS_ACCOUNT(account_id)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_fd_closed_by_agent
        FOREIGN KEY (closed_by_agent_id) REFERENCES AGENT(agent_id)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT chk_fd_principal_positive CHECK (principal > 0),
    CONSTRAINT chk_fd_term CHECK (term IN ('6_MONTH','1_YEAR','3_YEAR')),
    CONSTRAINT chk_fd_rate_positive CHECK (interest_rate > 0),
    CONSTRAINT chk_fd_dates CHECK (maturity_date > start_date)
) ENGINE=InnoDB;

CREATE INDEX idx_fd_account_id ON FIXED_DEPOSIT(account_id);
CREATE INDEX idx_fd_status_payout ON FIXED_DEPOSIT(status, next_payout_date);

CREATE TABLE TRANSACTIONS (
    transaction_id       BIGINT AUTO_INCREMENT PRIMARY KEY,
    account_id           INT NOT NULL,
    type                 VARCHAR(20) NOT NULL,
    amount               DECIMAL(14,2) NOT NULL,
    txn_timestamp        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    reference_number     VARCHAR(30) NOT NULL,
    channel              ENUM('BRANCH','ONLINE','MOBILE','ATM') NOT NULL DEFAULT 'BRANCH',
    processed_by_agent_id INT NULL,
    fd_id                INT NULL,
    CONSTRAINT fk_txn_account
        FOREIGN KEY (account_id) REFERENCES SAVINGS_ACCOUNT(account_id)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_txn_processing_agent
        FOREIGN KEY (processed_by_agent_id) REFERENCES AGENT(agent_id)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_txn_fd
        FOREIGN KEY (fd_id) REFERENCES FIXED_DEPOSIT(fd_id)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT chk_txn_type
        CHECK (type IN ('DEPOSIT','WITHDRAWAL','FD_INTEREST','FD_CLOSURE')),
    CONSTRAINT chk_txn_amount_positive CHECK (amount > 0),
    CONSTRAINT chk_txn_channel_agent
        CHECK (
            (channel = 'BRANCH' AND processed_by_agent_id IS NOT NULL)
            OR
            (channel IN ('ONLINE','MOBILE','ATM') AND processed_by_agent_id IS NULL)
        ),
    CONSTRAINT uq_txn_reference UNIQUE (reference_number)
) ENGINE=InnoDB;

CREATE INDEX idx_txn_account_date ON TRANSACTIONS(account_id, txn_timestamp);
CREATE INDEX idx_txn_type_date ON TRANSACTIONS(type, txn_timestamp);
