---
"awcms": minor
---

security(channel_accounts): explicit `access_mode` on accounts with a fail-closed default, a last-owner rule, and an immutable business scope (Issue #1215 M-c, owner decision of 11 November 2026). `CHANNEL_ACCOUNTS_ENABLED` is still off by default, so no live deployment changes behaviour until the module is switched on.

**Behaviour change once the module is on.** Who may see and operate an account used to be inferred from the absence of assignment rows: an account with no assignee was open to every holder of the permission, so removing the last assignee (or erasing the person who was it) silently opened a sender identity to the whole tenant. It is now a column, `awcms_channel_accounts.access_mode`: `assigned` (the default) means only the account's assignees and the holders of `assignments.assign` reach it, so an assigned account with no assignee is administrators-only; `tenant_wide` is the old open behaviour, chosen on purpose. A new account is `assigned` and **its creator becomes its first owner**. Every account that existed before the migration became `assigned`.

**Last owner.** The last owner of an `assigned` account cannot be removed or demoted through the API (`409 LAST_OWNER`; the writers serialise on the account row lock). The database refuses an unowned switch to `assigned` and a demotion of the last owner. Erasure of a person must always complete, so deleting the last owner is not refused by the database: it leaves one `warning` audit row, `channel_accounts.account.owner_orphaned`, carrying the account id only. The owner rows the guards count are share-locked, so an erasure racing a demotion, a mode switch or an unassignment waits for it and the trace is never lost.

**API:** new `PUT /api/v1/channel-accounts/accounts/{id}/access-mode` (`assignments.assign`, `Idempotency-Key`, `warning` audit on a real change, `422 OWNER_REQUIRED`); the account view gains `accessMode`; the assignment endpoints gain `409 LAST_OWNER`. The OpenAPI fragment and bundle are regenerated.

**Migrations (forward-only):** `sql/398` adds the column with a `CHECK`, makes the account's business scope immutable for every role and refuses an unowned switch to `assigned`; `sql/399` guards assignments (immutable account and person, no demotion of the last owner) and writes the orphan audit row. Operator action: run `bun run db:migrate`.

**Not done here, deliberately:** external-id squatting needs an owner decision (options on the issue), so the issue stays open.
