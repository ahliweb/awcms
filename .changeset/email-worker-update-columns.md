---
"awcms": patch
---

security(email): `awcms_worker`'s UPDATE on `awcms_email_messages` is narrowed from the whole table (sql/022) to the seven columns the dispatcher writes (`status`, `next_attempt_at`, `retry_count`, `last_error`, `sent_at`, `provider_name`, `provider_message_id`) by the new `sql/415`. A compromised worker can no longer rewrite the recipient, subject, variables, template or category of a queued message after the insert guard (`sql/410`) admitted it. `WORKER_ROLE_GRANTS` drops UPDATE for the table and `WORKER_COLUMN_GRANTS` pins the column list, so `security:readiness` fails on a table-wide or wider column grant. DB-gated test proves the dispatcher's transitions still work and the rewrites are refused. Closes #1364.
