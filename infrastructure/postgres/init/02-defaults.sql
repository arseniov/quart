-- Locale + audit defaults. ALTER DATABASE cannot run in a transaction in initdb context.

ALTER DATABASE quart SET timezone TO 'UTC';
ALTER DATABASE quart SET statement_timeout TO '10s';
ALTER DATABASE quart SET idle_in_transaction_session_timeout TO '60s';
ALTER DATABASE quart SET log_min_duration_statement TO '500ms';
