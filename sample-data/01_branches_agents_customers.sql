/* -------------------------------------------------
   BRANCHES (3)
   ------------------------------------------------- */
INSERT INTO BRANCH (branch_id, name, district) VALUES
    (1, 'Central Branch', 'Colombo'),
    (2, 'North Branch',   'Jaffna'),
    (3, 'South Branch',   'Galle');

/* -------------------------------------------------
   AGENTS (5 – all ACTIVE)
   ------------------------------------------------- */
INSERT INTO AGENT (agent_id, name, branch_id, status) VALUES
    (1, 'Alice Smith', 1, 'ACTIVE'),
    (2, 'Bob Johnson', 1, 'ACTIVE'),
    (3, 'Carol Lee',    2, 'ACTIVE'),
    (4, 'David Kim',   2, 'ACTIVE'),
    (5, 'Eve Patel',   3, 'ACTIVE');

/* -------------------------------------------------
   CUSTOMERS (15 – unique, sensible DOB)
   ------------------------------------------------- */
INSERT INTO CUSTOMER (customer_id, name, date_of_birth, contact_info, registered_by_agent_id, registered_at_branch_id) VALUES
    (1,  'Liam Brown',        '2020-03-15', '0700000001, Colombo', 1, 1),
    (2,  'Mia Davis',         '2018-07-22', '0700000002, Colombo', 1, 1),
    (3,  'Noah Miller',       '2015-12-05', '0700000003, Colombo', 2, 1),
    (4,  'Olivia Wilson',     '2008-09-10', '0700000004, Colombo', 2, 1),
    (5,  'Ethan Moore',       '2009-11-30', '0700000005, Jaffna',  3, 2),
    (6,  'Ava Taylor',        '1990-04-01', '0700000006, Jaffna',  3, 2),
    (7,  'Lucas Anderson',    '1985-06-20', '0700000007, Jaffna',  4, 2),
    (8,  'Sophia Thomas',     '1978-02-14', '0700000008, Jaffna',  4, 2),
    (9,  'Mason Jackson',     '1995-08-05', '0700000009, Galle',   5, 3),
    (10, 'Emma White',        '1955-05-10', '0700000010, Galle',   5, 3),
    (11, 'Oliver Harris',     '1960-01-01', '0700000011, Colombo', 1, 1),
    (12, 'Isabella Martin',   '1992-03-12', '0700000012, Colombo', 2, 1),
    (13, 'Jacob Thompson',    '1980-10-25', '0700000013, Jaffna',  3, 2),
    (14, 'Charlotte Garcia',  '1998-12-31', '0700000014, Jaffna',  4, 2),
    (15, 'William Martinez',  '1993-07-07', '0700000015, Galle',   5, 3);