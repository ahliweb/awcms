-- Bind every queued push message to the tenant user it was addressed to
-- (Issue #1098, security audit M1/L1).
--
-- awcms_push_messages carried only `subscription_id`, so the dispatcher could
-- not tell WHO a message was for. A device (endpoint) can move between tenant
-- users (re-registration by another user of a shared browser), and a message
-- queued for the previous owner was then delivered to the new owner, encrypted
-- with the new owner's secret. With the recipient on the row the dispatcher
-- refuses any message whose recipient is no longer the subscription's owner.
--
-- Ordering (safe on a populated table):
--   1. add the column NULLABLE (no rewrite, no scan);
--   2. backfill existing rows from their subscription's CURRENT owner;
--   3. SET NOT NULL (every row now has a value).
-- Existing rows are bound to the current owner, which is the only information
-- available; a row queued before a transfer that has not yet been delivered is
-- the pre-existing exposure and is bounded by queue retention.
--
-- The composite FK mirrors awcms_push_subscriptions_tenant_user_fk: a plain
-- reference to awcms_tenant_users (id) would accept another tenant's user.
-- RLS is unchanged (the table is already tenant-isolated, FORCE) and the
-- table-level grants of sql/093 cover the new column for awcms_app and
-- awcms_worker.

ALTER TABLE awcms_push_messages
  ADD COLUMN IF NOT EXISTS recipient_tenant_user_id uuid;

UPDATE awcms_push_messages AS m
SET recipient_tenant_user_id = s.tenant_user_id
FROM awcms_push_subscriptions AS s
WHERE s.tenant_id = m.tenant_id
  AND s.id = m.subscription_id
  AND m.recipient_tenant_user_id IS NULL;

ALTER TABLE awcms_push_messages
  ALTER COLUMN recipient_tenant_user_id SET NOT NULL;

ALTER TABLE awcms_push_messages
  ADD CONSTRAINT awcms_push_messages_recipient_fk
  FOREIGN KEY (tenant_id, recipient_tenant_user_id)
  REFERENCES awcms_tenant_users (tenant_id, id);
