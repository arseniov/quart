-- 0042_devices.down.sql
SET search_path = public, quart_security;

DROP POLICY IF EXISTS devices_scope ON devices;
DROP TABLE IF EXISTS devices;