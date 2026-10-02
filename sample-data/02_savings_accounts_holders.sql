-- =====================================================================
-- 02_savings_accounts_holders.sql
-- Sample data for Savings Accounts and Account Holders
-- =====================================================================
USE mims;

-- Savings accounts linked to specific plans
INSERT INTO SAVINGS_ACCOUNT (account_no, balance, open_date, status, plan_id) VALUES
('SA0000001', 0.00, '2024-01-15', 'ACTIVE', 1), -- Child account
('SA0000002', 0.00, '2024-02-10', 'ACTIVE', 1), -- Child account
('SA0000003', 0.00, '2024-03-05', 'ACTIVE', 1), -- Child account
('SA0000004', 0.00, '2024-01-20', 'ACTIVE', 2), -- Teen account
('SA0000005', 0.00, '2024-02-15', 'ACTIVE', 2), -- Teen account
('SA0000006', 0.00, '2023-05-10', 'ACTIVE', 3), -- Adult account
('SA0000007', 0.00, '2023-06-12', 'ACTIVE', 3), -- Adult account
('SA0000008', 0.00, '2023-07-01', 'ACTIVE', 3), -- Adult account
('SA0000009', 0.00, '2023-08-15', 'ACTIVE', 3), -- Adult account
('SA0000010', 0.00, '2022-01-10', 'ACTIVE', 4), -- Senior account
('SA0000011', 0.00, '2022-05-20', 'ACTIVE', 4), -- Senior account
('SA0000012', 0.00, '2023-01-10', 'ACTIVE', 5), -- Joint account
('SA0000013', 0.00, '2023-02-15', 'ACTIVE', 5); -- Joint account

-- Link customers to their savings accounts
INSERT INTO ACCOUNT_HOLDER (customer_id, account_id, role) VALUES
-- Individual account holders
(1,  1,  'PRIMARY'),
(2,  2,  'PRIMARY'),
(3,  3,  'PRIMARY'),
(4,  4,  'PRIMARY'),
(5,  5,  'PRIMARY'),
(6,  6,  'PRIMARY'),
(7,  7,  'PRIMARY'),
(8,  8,  'PRIMARY'),
(9,  9,  'PRIMARY'),
(10, 10, 'PRIMARY'),
(11, 11, 'PRIMARY'),

-- Joint account holders
(12, 12, 'PRIMARY'),   -- Primary owner
(13, 12, 'SECONDARY'), -- Secondary owner
(14, 13, 'PRIMARY'),   -- Primary owner
(15, 13, 'SECONDARY'); -- Secondary owner