/* -------------------------------------------------
   SAVINGS_ACCOUNT records (using valid plan_code FKs)
   ------------------------------------------------- */
INSERT INTO SAVINGS_ACCOUNT (account_id, plan_code, balance, status, opened_date) VALUES
    (1,  'CHILD',  0.00,    'ACTIVE', CURRENT_DATE),
    (2,  'CHILD',  0.00,    'ACTIVE', CURRENT_DATE),
    (3,  'CHILD',  0.00,    'ACTIVE', CURRENT_DATE),
    (4,  'TEEN',   500.00,  'ACTIVE', CURRENT_DATE),
    (5,  'TEEN',   500.00,  'ACTIVE', CURRENT_DATE),
    (6,  'ADULT',  1000.00, 'ACTIVE', CURRENT_DATE),
    (7,  'ADULT',  1200.00, 'ACTIVE', CURRENT_DATE),
    (8,  'ADULT',  1500.00, 'ACTIVE', CURRENT_DATE),
    (9,  'ADULT',  1100.00, 'ACTIVE', CURRENT_DATE),
    (10, 'SENIOR', 1200.00, 'ACTIVE', CURRENT_DATE),
    (11, 'SENIOR', 1300.00, 'ACTIVE', CURRENT_DATE),
    (12, 'JOINT',  5000.00, 'ACTIVE', CURRENT_DATE),
    (13, 'JOINT',  6000.00, 'ACTIVE', CURRENT_DATE);

/* -------------------------------------------------
   ACCOUNT_HOLDER bridge (roles: PRIMARY / SECONDARY)
   ------------------------------------------------- */
INSERT INTO ACCOUNT_HOLDER (account_id, customer_id, role) VALUES
    -- Single-holder accounts
    (1, 1, 'PRIMARY'),   (2, 2, 'PRIMARY'),   (3, 3, 'PRIMARY'),
    (4, 4, 'PRIMARY'),   (5, 5, 'PRIMARY'),   (6, 6, 'PRIMARY'),
    (7, 7, 'PRIMARY'),   (8, 8, 'PRIMARY'),   (9, 9, 'PRIMARY'),
    (10, 10, 'PRIMARY'), (11, 11, 'PRIMARY'),

    -- Joint account A (account_id = 12)
    (12, 12, 'PRIMARY'), (12, 13, 'SECONDARY'),

    -- Joint account B (account_id = 13)
    (13, 14, 'PRIMARY'), (13, 15, 'SECONDARY');