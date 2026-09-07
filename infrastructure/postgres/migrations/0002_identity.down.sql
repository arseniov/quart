-- 0002_identity.down.sql
DROP TABLE IF EXISTS mfa_challenges;
DROP TABLE IF EXISTS mfa_factors;
DROP TABLE IF EXISTS auth_sessions;
DROP TABLE IF EXISTS user_identities;
DROP TABLE IF EXISTS users;