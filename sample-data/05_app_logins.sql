-- 05_app_logins.sql
-- Demo sign-ins for the web app: one admin, two agents and four customers. Every demo password is demo1234
-- Only the salted scrypt hash of each password is stored (made by backend/src/session.js, hashPassword).

USE mims;

INSERT INTO APP_LOGIN (username, role, customer_id, agent_id, password_hash) VALUES
    ('admin', 'ADMIN', NULL, NULL,
     'scrypt$16384$8$1$9rJzTxMnUU2M4hBMdFJyFg==$gzeaj/3knqIcTUXfQpDf/rL+Hp2STeYu54P2DkED5K0='),

    ('alice', 'AGENT', NULL, 1,
     'scrypt$16384$8$1$cMMFaySOjSH2oaFUdlOxmw==$KMjSXR6mqg9KISDPzBRQgTMNjca8bIgbSmnuyxFCYo8='),

    ('carol', 'AGENT', NULL, 3,
     'scrypt$16384$8$1$oWT09yllW5tHVBVWZUcyHg==$A0eEAm8RW3O/qE8RJD7GZYSUVJLTG1O8O4/88uSSr6M='),

    ('james', 'CUSTOMER', 6, NULL,
     'scrypt$16384$8$1$B25eeAQw+NtbA59eN5dD8w==$qqowttCE4PvPYEbzAgjwxrOkJSUYRmV6UqT23dwP/5E='),

    ('sophia', 'CUSTOMER', 7, NULL,
     'scrypt$16384$8$1$pIc6LhFzUqPEPyTzhdejRw==$qN9WkMSrjE/vXaOYF4rba7N0KqcmxNFLyM6GAk2A/Dc='),

    ('lucas', 'CUSTOMER', 12, NULL,
     'scrypt$16384$8$1$nTq+yWlZzCtAykMx1xUNDg==$JrikD7TuI2QZLqYJSL2dbTgvqBD9UUhO+Mx2LOTVkjE='),

    ('harper', 'CUSTOMER', 13, NULL,
     'scrypt$16384$8$1$Tgt5FLoTBcVaPRBbaOJUAg==$yx6gvxuM0f9onEAnsL0ctmwappKRmsp0wMxjrp3gu0U=');