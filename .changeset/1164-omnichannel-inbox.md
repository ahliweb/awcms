---
"awcms": minor
---

feat(omnichannel-inbox): tenant-scoped conversation projection, assignment, tags and SLA policies (Issue #1164, ADR-0160 Accepted). A new `experimental` module, off by default (`OMNICHANNEL_INBOX_ENABLED`), that projects the verified Telegram and website inbound envelopes into body-free conversation rows (idempotent by value, rebuildable from the event log), with staff assignment and history, tags, status and first/next-response SLA on a working calendar; the SLA job applies missed customer-state changes, unassigns ineligible assignees and notifies only the assignee through the existing e-mail port. The projector runs under the domain-event dispatcher as `awcms_worker` on column-level grants (no assignee, no response stamps). Only a caller who is not scope-confined and holds the permission on a tenant-wide grant acts tenant-wide. Migrations `sql/382`-`sql/384`. It sends nothing to a customer.
