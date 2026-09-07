-- Runs once on first initdb (alphabetical order).
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;        -- envelope encryption (pgp_sym_encrypt)
CREATE EXTENSION IF NOT EXISTS citext;          -- case-insensitive emails
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";     -- uuid_generate_v4()
CREATE EXTENSION IF NOT EXISTS pg_trgm;         -- trigram indexes for FTS
