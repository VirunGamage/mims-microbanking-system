-- InnoDB is the storage engine used for these tables. It supports foreign keys and enforces them properly.

-- WARNING: this script DROPS the whole mims database if it exists. Running it wipes all existing data.
DROP DATABASE IF EXISTS mims;
CREATE DATABASE mims
    DEFAULT CHARACTER SET utf8mb4   -- utf8mb4 lets us store all characters (names, symbols, emojis) safely without corruption
    DEFAULT COLLATE utf8mb4_unicode_ci; -- Sorts and compares text case-insensitively (and accent-insensitively)
USE mims;

SET NAMES utf8mb4;  -- Sets the character set of the connection between the client and the database to utf8mb4 as well
SET FOREIGN_KEY_CHECKS = 1; -- This is on by default, this is just an explicit turn on. It checks that a record points to an existing record
                            -- in another table

-- Stores the bank's own details without hardcoding them
-- Only one row will be here (B-Trust). Branch points to this
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

-- Stores each physical branch of the bank.
-- An organization cannot be deleted or have its ID changed while branches still reference it (RESTRICT)
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

-- InnoDB already creates an index on every foreign key column automatically, so this one is technically redundant.
-- It is kept explicitly so the indexing is visible in the schema.
CREATE INDEX idx_branch_org_id ON BRANCH(org_id);

-- Stores every agent who has ever worked in this bank. Agents are never deleted and are handled by status so that past transactions have an agent.
CREATE TABLE AGENT (
    agent_id    INT AUTO_INCREMENT PRIMARY KEY,
    first_name  VARCHAR(50) NOT NULL,
    last_name   VARCHAR(50) NOT NULL,
    phone       VARCHAR(20),
    email       VARCHAR(100),
    status      ENUM('ACTIVE','ON_LEAVE','TRANSFERRED','TERMINATED')    -- ENUM prevents any other word being typed here except these, which reduces errors
                NOT NULL DEFAULT 'ACTIVE', -- This field cannot be null, if it is left empty the default value "ACTIVE" is used
    branch_id   INT NOT NULL,

    -- This was added to avoid email collisions when agents transfer. It copies email into email_in_service only if the status is
    -- "ACTIVE" or "ON_LEAVE", otherwise it is NULL. The UNIQUE constraint ignores NULLs, so a TRANSFERRED or TERMINATED agent
    -- no longer blocks their old email from being reused.
    -- STORED means the computed value is saved on disk when the row is written, whereas VIRTUAL (the default) is computed
    -- each time the row is read.
    email_in_service VARCHAR(100)
        GENERATED ALWAYS AS (CASE WHEN status IN ('ACTIVE','ON_LEAVE') THEN email END) STORED,
    CONSTRAINT uq_agent_email_in_service UNIQUE (email_in_service),

    CONSTRAINT fk_agent_branch
        FOREIGN KEY (branch_id) REFERENCES BRANCH(branch_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB;

-- Indexes for branch_id and status lookups.
-- idx_agent_branch_id is technically redundant because InnoDB auto-indexes foreign key columns, it is kept for clarity.
CREATE INDEX idx_agent_branch_id ON AGENT(branch_id);
CREATE INDEX idx_agent_status    ON AGENT(status);

-- Everyone the bank has registered as a customer, whether they hold accounts alone or jointly with others.
CREATE TABLE CUSTOMER (
    customer_id             INT AUTO_INCREMENT PRIMARY KEY,
    first_name              VARCHAR(50) NOT NULL,
    last_name               VARCHAR(50) NOT NULL,

    -- NIC will be asked for by the UI when a teenager turns 18.
    NIC                     VARCHAR(12),    -- Can be NULL because children and teens might not have an NIC yet
    DOB                     DATE NOT NULL,
    address                 VARCHAR(150),
    phone                   VARCHAR(20),
    email                   VARCHAR(100),
    registered_by_agent_id  INT NOT NULL,   -- A historical record, to know which agent registered the customer
    registered_at_branch_id INT NOT NULL,   -- A historical record, to know which branch the customer registered at
    CONSTRAINT uq_customer_nic UNIQUE (NIC),
    CONSTRAINT chk_customer_dob_floor CHECK (DOB >= '1900-01-01'),  -- DOB cannot be unrealistic
    CONSTRAINT fk_customer_registering_agent
        FOREIGN KEY (registered_by_agent_id) REFERENCES AGENT(agent_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_customer_registered_branch
        FOREIGN KEY (registered_at_branch_id) REFERENCES BRANCH(branch_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB;

-- Indexes on registered_by_agent_id and registered_at_branch_id.
-- Both are foreign key columns, so InnoDB would auto-index them anyway, they are kept explicitly for clarity.
CREATE INDEX idx_customer_registering_agent ON CUSTOMER(registered_by_agent_id);
CREATE INDEX idx_customer_registered_branch ON CUSTOMER(registered_at_branch_id);

-- Stores the five savings account plans (Children, Teen, Adult, Senior, Joint) with their rate and minimum balance.
-- SAVINGS_ACCOUNT points to this to know which plan an account is under
CREATE TABLE SAVINGS_PLAN (
    plan_id          INT AUTO_INCREMENT PRIMARY KEY,
    plan_name        VARCHAR(50)   NOT NULL,
    interest_rate    DECIMAL(5,2)  NOT NULL,
    minimum_balance  DECIMAL(12,2) NOT NULL,
    CONSTRAINT uq_plan_name UNIQUE (plan_name),
    CONSTRAINT chk_plan_rate        CHECK (interest_rate > 0),  -- Rate cannot be 0 or negative
    CONSTRAINT chk_plan_min_balance CHECK (minimum_balance >= 0)    -- Cannot be negative, 0 is allowed (Children plan)
) ENGINE=InnoDB;

-- The five actual plans, rates and minimum balances.
INSERT INTO SAVINGS_PLAN (plan_id, plan_name, interest_rate, minimum_balance) VALUES
    (1, 'Children', 12.00,    0.00),
    (2, 'Teen',     11.00,  500.00),
    (3, 'Adult',    10.00, 1000.00),
    (4, 'Senior',   13.00, 1000.00),
    (5, 'Joint',     7.00, 5000.00);

-- Stores the three FD terms (6 months, 1 year, 3 years) with their duration and rate.
-- FIXED_DEPOSIT points to this to know which term an FD is under
CREATE TABLE FD_PLAN (
    fd_plan_id     INT AUTO_INCREMENT PRIMARY KEY,
    term_name      VARCHAR(10)  NOT NULL,
    duration_days  INT          NOT NULL,
    interest_rate  DECIMAL(5,2) NOT NULL,
    CONSTRAINT uq_fd_plan_term     UNIQUE (term_name),
    CONSTRAINT uq_fd_plan_duration UNIQUE (duration_days),
    CONSTRAINT chk_fd_plan_term     CHECK (term_name IN ('6_MONTH','1_YEAR','3_YEAR')),   -- Only these three terms are allowed
    CONSTRAINT chk_fd_plan_duration CHECK (duration_days > 0 AND MOD(duration_days, 30) = 0),   -- Must be positive and a clean multiple of 30, since interest cycles are 30 days
    CONSTRAINT chk_fd_plan_rate     CHECK (interest_rate > 0)   -- Rate cannot be 0 or negative
) ENGINE=InnoDB;

-- The three actual terms, durations and rates.
INSERT INTO FD_PLAN (fd_plan_id, term_name, duration_days, interest_rate) VALUES
    (1, '6_MONTH',  180, 13.00),
    (2, '1_YEAR',   360, 14.00),
    (3, '3_YEAR',  1080, 15.00);

-- Stores every savings account, its balance and which plan it follows.
-- ACCOUNT_HOLDER links this to customers (can be more than one customer per account for joint accounts)
CREATE TABLE SAVINGS_ACCOUNT (
    account_id   INT AUTO_INCREMENT PRIMARY KEY,
    account_no   VARCHAR(20)   NOT NULL,
    balance      DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    open_date    DATE          NOT NULL DEFAULT (CURRENT_DATE),
    next_interest_date DATE,    -- Needed to avoid double posting of interest
    status       ENUM('ACTIVE','CLOSED','FROZEN') NOT NULL DEFAULT 'ACTIVE',
    plan_id      INT NOT NULL,
    CONSTRAINT uq_account_no UNIQUE (account_no),
    CONSTRAINT chk_account_no_format CHECK (account_no REGEXP '^SA[0-9]{7}$'),   -- account_no must always be "SA" followed by 7 digits
    CONSTRAINT chk_account_balance_nonneg CHECK (balance >= 0),   -- Balance can never go negative
    CONSTRAINT fk_account_plan
        FOREIGN KEY (plan_id) REFERENCES SAVINGS_PLAN(plan_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB;

-- Indexes for plan_id and status lookups.
-- idx_account_plan_id is technically redundant (InnoDB auto-indexes foreign key columns), kept for clarity.
-- idx_account_status is also covered by idx_account_status_interest below, since MySQL can use the leftmost
-- column of a composite index, it is kept for clarity.
CREATE INDEX idx_account_plan_id ON SAVINGS_ACCOUNT(plan_id);
CREATE INDEX idx_account_status  ON SAVINGS_ACCOUNT(status);
-- This one is for the interest posting job specifically, it needs to find all ACTIVE accounts whose
-- next_interest_date is due, so indexing both columns together makes that search fast
CREATE INDEX idx_account_status_interest ON SAVINGS_ACCOUNT(status, next_interest_date);

-- Links customers to the savings accounts they hold. One row per customer per account, so a joint
-- account just has two rows here instead of one.
CREATE TABLE ACCOUNT_HOLDER (
    customer_id  INT NOT NULL,
    account_id   INT NOT NULL,
    role         ENUM('PRIMARY','SECONDARY') NOT NULL DEFAULT 'PRIMARY',   -- Only the PRIMARY holder can open/close an FD or close the account
    PRIMARY KEY (customer_id, account_id),   -- Composite key, stops the same customer being added twice to the same account
    CONSTRAINT fk_holder_customer
        FOREIGN KEY (customer_id) REFERENCES CUSTOMER(customer_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_holder_account
        FOREIGN KEY (account_id) REFERENCES SAVINGS_ACCOUNT(account_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB;

-- For looking up all holders of an account. The primary key only helps when searching by customer_id first, so this
-- index covers the account_id side (it is also a foreign key column, which InnoDB would auto-index anyway).
CREATE INDEX idx_holder_account_id ON ACCOUNT_HOLDER(account_id);

-- Stores every fixed deposit. Each FD is funded from a savings account and gets paid back into the
-- same account when it matures or is closed early.
CREATE TABLE FIXED_DEPOSIT (
    fd_id             INT AUTO_INCREMENT PRIMARY KEY,
    amount            DECIMAL(14,2) NOT NULL,
    interest_rate     DECIMAL(5,2)  NOT NULL,   -- Snapshot of the plan's rate at the time, so later rate changes don't affect this FD
    start_date        DATE NOT NULL,
    maturity_date     DATE NOT NULL,
    status            ENUM('ACTIVE','MATURED','CLOSED') NOT NULL DEFAULT 'ACTIVE',
    next_payout_date  DATE,    -- Same reason as next_interest_date on SAVINGS_ACCOUNT, needed to avoid double posting of interest
    close_date        DATE,
    account_id        INT NOT NULL,
    fd_plan_id        INT NOT NULL,
    CONSTRAINT chk_fd_amount_positive CHECK (amount > 0),   -- Cannot open an FD with 0 or negative amount
    CONSTRAINT chk_fd_rate_positive   CHECK (interest_rate > 0),   -- Rate cannot be 0 or negative
    CONSTRAINT chk_fd_dates           CHECK (maturity_date > start_date),   -- Maturity has to be after the start, not the same day or before
    CONSTRAINT chk_fd_close_date      CHECK (close_date IS NULL OR close_date >= start_date),   -- Can't close before it even started
    CONSTRAINT fk_fd_account
        FOREIGN KEY (account_id) REFERENCES SAVINGS_ACCOUNT(account_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_fd_plan
        FOREIGN KEY (fd_plan_id) REFERENCES FD_PLAN(fd_plan_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB;

-- account_id and fd_plan_id are foreign key columns, so InnoDB would auto-index them anyway, these are kept for clarity.
CREATE INDEX idx_fd_account_id    ON FIXED_DEPOSIT(account_id);
CREATE INDEX idx_fd_plan_id       ON FIXED_DEPOSIT(fd_plan_id);
-- Same idea as idx_account_status_interest, this is for the FD interest job to quickly find ACTIVE
-- FDs that are due a payout
CREATE INDEX idx_fd_status_payout ON FIXED_DEPOSIT(status, next_payout_date);

-- The single log of every money movement in the bank, deposits, withdrawals, interest postings,
-- FD opens and closures, everything goes through this one table.
CREATE TABLE `TRANSACTION` (
    transaction_id         BIGINT AUTO_INCREMENT PRIMARY KEY,
    transaction_type       VARCHAR(16)   NOT NULL,
    amount                 DECIMAL(14,2) NOT NULL,
    txn_timestamp          DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    reference_no           VARCHAR(30)   NOT NULL,
    channel                ENUM('BRANCH','ONLINE','MOBILE','ATM','SYSTEM')
                           NOT NULL DEFAULT 'BRANCH',
    review_flag            TINYINT(1)    NOT NULL DEFAULT 0,   -- Gets set to 1 when the amount crosses the large_deposit_threshold in SYSTEM_CONFIG
    account_id             INT           NOT NULL,
    processed_by_agent_id  INT NULL,   -- NULL unless the channel is BRANCH, see chk_txn_channel_agent below
    fd_id                  INT NULL,   -- Only filled in for FD-related transactions, see chk_txn_fd_link below
    CONSTRAINT uq_txn_reference UNIQUE (reference_no),
    CONSTRAINT chk_txn_type
        CHECK (transaction_type IN ('DEPOSIT','WITHDRAWAL','SAVINGS_INTEREST',
                                    'FD_OPEN','FD_INTEREST','FD_CLOSURE')),   -- Only these six types are allowed
    CONSTRAINT chk_txn_amount_positive CHECK (amount > 0),   -- Cannot be 0 or negative
    CONSTRAINT chk_txn_review_flag CHECK (review_flag IN (0,1)),   -- Only 0 or 1, nothing else
    CONSTRAINT chk_txn_channel_agent CHECK (
        (channel = 'BRANCH' AND processed_by_agent_id IS NOT NULL)
        OR
        (channel <> 'BRANCH' AND processed_by_agent_id IS NULL)
    ),   -- If it's a BRANCH transaction it must have an agent, if it's any other channel it must not
    CONSTRAINT chk_txn_fd_link CHECK (
        (transaction_type IN ('FD_OPEN','FD_INTEREST','FD_CLOSURE') AND fd_id IS NOT NULL)
        OR
        (transaction_type IN ('DEPOSIT','WITHDRAWAL','SAVINGS_INTEREST') AND fd_id IS NULL)
    ),   -- FD related transactions must point to an fd_id, normal savings transactions must not
    CONSTRAINT chk_txn_interest_channel CHECK (
        transaction_type NOT IN ('FD_INTEREST','SAVINGS_INTEREST') OR channel = 'SYSTEM'
    ),   -- Interest is always posted by the system, never by an agent or through ONLINE/MOBILE/ATM
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

-- Indexes made to make lookups faster, each one matches a common query pattern
CREATE INDEX idx_txn_account_date ON `TRANSACTION`(account_id, txn_timestamp);   -- Get an account's transaction history in order
CREATE INDEX idx_txn_agent_date   ON `TRANSACTION`(processed_by_agent_id, txn_timestamp);   -- Get an agent's processed transactions in order
CREATE INDEX idx_txn_type_date    ON `TRANSACTION`(transaction_type, txn_timestamp);   -- Filter by type (eg. all SAVINGS_INTEREST postings)
CREATE INDEX idx_txn_fd_id        ON `TRANSACTION`(fd_id);   -- Get all transactions tied to one FD (fd_id is a foreign key, so InnoDB would auto-index it anyway, kept for clarity)

-- Holds bank wide settings as key value pairs so things like business hours and interest cycle
-- lengths aren't hardcoded anywhere, they can just be looked up from here
CREATE TABLE SYSTEM_CONFIG (
    config_key    VARCHAR(50)  PRIMARY KEY,
    config_value  VARCHAR(100) NOT NULL,
    description   VARCHAR(200)
) ENGINE=InnoDB;

-- The 12 actual settings, values given directly in the brief
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

-- Before a new customer row is added, checks two things: DOB isn't in the future, and if the customer
-- is already 18+ they must have an NIC (kids/teens are allowed to have NULL)
CREATE TRIGGER trg_customer_bi BEFORE INSERT ON CUSTOMER
FOR EACH ROW
BEGIN
    IF NEW.DOB > CURDATE() THEN   -- DOB can't be in the future
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Date of birth cannot be in the future';
    END IF;
    IF NEW.NIC IS NULL AND TIMESTAMPDIFF(YEAR, NEW.DOB, CURDATE()) >= 18 THEN   -- Age is calculated from DOB, not stored
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'NIC is required for customers aged 18 or over';
    END IF;
END$$

-- Same two checks as trg_customer_bi but runs on UPDATE instead of INSERT, so this still gets caught
-- even if someone edits a customer row later (eg. correcting a wrong DOB)
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

-- Before a new transaction is added, if it's a BRANCH transaction it checks the agent processing it
-- is actually ACTIVE right now (an ON_LEAVE/TRANSFERRED/TERMINATED agent shouldn't be able to process one)
CREATE TRIGGER trg_transaction_bi BEFORE INSERT ON `TRANSACTION`
FOR EACH ROW
BEGIN
    IF NEW.channel = 'BRANCH' AND
       (SELECT status FROM AGENT WHERE agent_id = NEW.processed_by_agent_id) <> 'ACTIVE' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Processing agent is not ACTIVE';
    END IF;
END$$

-- Runs before every UPDATE on the AGENT table and stops an agent's branch_id from being changed.
CREATE TRIGGER trg_agent_branch_lock BEFORE UPDATE ON AGENT
FOR EACH ROW    -- The trigger runs once for every row the UPDATE touches (an UPDATE hitting 10 agents fires it 10 times)
BEGIN
    IF NEW.branch_id <> OLD.branch_id THEN  -- branch_id is being changed, so refuse the update
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'An agent record cannot move branches; create a new agent record instead';   -- Raises this error message and cancels the change
    END IF;
END$$

DELIMITER ;
