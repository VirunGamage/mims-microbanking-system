-- 01_branches_agents_customers.sql
-- Sample data for Bank, Branches, Agents, and Customers

-- choose database
USE mims;

-- Session safeguards & transaction block
SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;
START TRANSACTION;

-- Bank organization details
INSERT INTO ORGANIZATION (org_id, org_name, registration_no, license_no, head_office_address, established_date) VALUES
(1, 'B-Trust Bank', 'REG-2020-001', 'LIC-2020-888', '123 Main Street, Colombo 03', '2020-01-01');

-- Bank branch locations
INSERT INTO BRANCH (branch_id, branch_name, district, address, org_id) VALUES
(1, 'Central Branch', 'Colombo', '100 Galle Road, Colombo 03', 1),
(2, 'North Branch',   'Jaffna',  '45 Hospital St, Jaffna',    1),
(3, 'South Branch',   'Galle',   '12 Main St, Galle',         1);

-- Bank agents assigned to branches
INSERT INTO AGENT (agent_id, first_name, last_name, phone, email, status, branch_id) VALUES
(1, 'Alice', 'Smith',   '0711111111', 'alice.smith@btrust.lk', 'ACTIVE', 1),
(2, 'Bob',   'Johnson', '0722222222', 'bob.johnson@btrust.lk', 'ACTIVE', 1),
(3, 'Carol', 'Lee',     '0733333333', 'carol.lee@btrust.lk',   'ACTIVE', 2),
(4, 'David', 'Kim',     '0744444444', 'david.kim@btrust.lk',   'ACTIVE', 2),
(5, 'Eve',   'Patel',   '0755555555', 'eve.patel@btrust.lk',   'ACTIVE', 3);

-- Customer profiles (Minors without NIC and Adults with NIC)
INSERT INTO CUSTOMER (customer_id, first_name, last_name, NIC, DOB, address, phone, email, registered_by_agent_id, registered_at_branch_id) VALUES
-- Minor customers (Under 18 years)
(1,  'Liam',      'Brown',     NULL,           '2018-05-10', '12 Lake Rd, Colombo',   '0700000001', 'liam@mail.com',    1, 1),
(2,  'Mia',       'Davis',     NULL,           '2019-08-12', '34 Park Ave, Colombo',  '0700000002', 'mia@mail.com',     1, 1),
(3,  'Noah',      'Miller',    NULL,           '2016-11-20', '56 Hill St, Colombo',   '0700000003', 'noah@mail.com',    2, 1),
(4,  'Ethan',     'Wilson',    NULL,           '2010-03-15', '78 Station Rd, Colombo','0700000004', 'ethan@mail.com',   2, 1),
(5,  'Olivia',    'Taylor',    NULL,           '2010-09-10', '90 Beach Rd, Jaffna',   '0700000005', 'olivia@mail.com',  3, 2),

-- Adult customers (18 years and above)
(6,  'James',     'Anderson',  '199210300100', '1992-04-12', '12 Main St, Jaffna',    '0700000006', 'james@mail.com',   3, 2),
(7,  'Sophia',    'Thomas',    '199520400200', '1995-07-22', '34 Temple Rd, Jaffna',  '0700000007', 'sophia@mail.com',  3, 2),
(8,  'Benjamin',  'Jackson',   '198830500300', '1988-12-05', '56 Cross St, Jaffna',   '0700000008', 'benjamin@mail.com',4, 2),
(9,  'Charlotte', 'White',     '199040600400', '1990-01-30', '78 School Ln, Jaffna',  '0700000009', 'charlotte@mail.com',4,2),
(10, 'William',   'Harris',    '195550700500', '1955-06-18', '12 Fort Rd, Galle',     '0700000010', 'william@mail.com',  5, 3),
(11, 'Ava',       'Martin',    '196060800600', '1960-02-14', '34 Harbor Rd, Galle',   '0700000011', 'ava@mail.com',      5, 3),
(12, 'Lucas',     'Thompson',  '198570900700', '1985-09-09', '56 Sea St, Colombo',    '0700000012', 'lucas@mail.com',    1, 1),
(13, 'Harper',    'Garcia',    '198781000800', '1987-10-10', '56 Sea St, Colombo',    '0700000013', 'harper@mail.com',   1, 1),
(14, 'Mason',     'Martinez',  '198391100900', '1983-11-11', '78 High St, Colombo',   '0700000014', 'mason@mail.com',    2, 1),
(15, 'Ella',      'Robinson',  '198601200100', '1986-04-05', '78 High St, Colombo',   '0700000015', 'ella@mail.com',     2, 1);

SET FOREIGN_KEY_CHECKS = 1;
COMMIT;