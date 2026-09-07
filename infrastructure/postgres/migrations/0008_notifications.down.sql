-- 0008_notifications.down.sql
-- Drop in reverse FK order: notification_deliveries depends on both
-- notifications and push_subscriptions.
DROP TABLE IF EXISTS notification_deliveries;
DROP TABLE IF EXISTS push_subscriptions;
DROP TABLE IF EXISTS notifications;
