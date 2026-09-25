-- =====================================================================
-- 02_savings_accounts_holders.sql (Schema v3 Compatible)
-- =====================================================================
USE mims;

-- 1. SAVINGS_ACCOUNT (13 accounts, plan_id 1..5, account_no SA+7digits)
INSERT INTO SAVINGS_ACCOUNT (account_no, balance, open_date, status, plan_id) VALUES
('SA0000001', 0.00, '2024-01-15', 'ACTIVE', 1), -- Children (Customer 1)
('SA0000002', 0.00, '2024-02-10', 'ACTIVE', 1), -- Children (Customer 2)
('SA0000003', 0.00, '2024-03-05', 'ACTIVE', 1), -- Children (Customer 3)
('SA0000004', 0.00, '2024-01-20', 'ACTIVE', 2), -- Teen (Customer 4)
('SA0000005', 0.00, '2024-02-15', 'ACTIVE', 2), -- Teen (Customer 5)
('SA0000006', 0.00, '2023-05-10', 'ACTIVE', 3), -- Adult (Customer 6)
('SA0000007', 0.00, '2023-06-12', 'ACTIVE', 3), -- Adult (Customer 7)
('SA0000008', 0.00, '2023-07-01', 'ACTIVE', 3), -- Adult (Customer 8)
('SA0000009', 0.00, '2023-08-15', 'ACTIVE', 3), -- Adult (Customer 9)
('SA0000010', 0.00, '2022-01-10', 'ACTIVE', 4), -- Senior (Customer 10)
('SA0000011', 0.00, '2022-05-20', 'ACTIVE', 4), -- Senior (Customer 11)
('SA0000012', 0.00, '2023-01-10', 'ACTIVE', 5), -- Joint (Customers 12 & 13)
('SA0000013', 0.00, '2023-02-15', 'ACTIVE', 5); -- Joint (Customers 14 & 15)

-- 2. ACCOUNT_HOLDER (Linking customers to accounts)
INSERT INTO ACCOUNT_HOLDER (customer_id, account_id, role) VALUES
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
(12, 12, 'PRIMARY'),
(13, 12, 'SECONDARY'), -- Joint Account 12
(14, 13, 'PRIMARY'),
(15, 13, 'SECONDARY'); -- Joint Account 13