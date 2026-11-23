-- telegram_engagement -- session timeouts for the customer Telegram
-- dispatcher's dedicated role (defence in depth; the same settings sql/428 gave
-- the social dispatcher). Forward-only.
--
-- `awcms_telegram_engagement_report_bot_health` (sql/436) and the contact block take row
-- locks. A session of the dispatch role must not be able to hold such a lock
-- open against an operator's disconnect, revoke or erasure. Two role-level
-- settings, applied by the server when a session LOGS IN as the role (which is
-- how `telegram-engagement:dispatch` connects; `assertConnectedAsDedicatedRole`
-- requires session_user = the role):
--
--   * `idle_in_transaction_session_timeout = 15s`;
--   * `transaction_timeout = 30s` (PostgreSQL 17+).
--
-- The dispatcher never needs more: it claims in a short transaction, calls
-- Telegram OUTSIDE any transaction (10 s client timeout), and finalises in
-- another short one. `security:readiness` pins both values exactly and refuses
-- a per-database override.
--
-- No explicit BEGIN/COMMIT: the migration runner wraps each file.

ALTER ROLE awcms_telegram_engagement_dispatch
  SET idle_in_transaction_session_timeout = '15s';
ALTER ROLE awcms_telegram_engagement_dispatch SET transaction_timeout = '30s';
