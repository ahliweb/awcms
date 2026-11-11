---
"awcms": minor
---

feat(omnichannel-inbox): tenant-scoped conversation projection, assignment, tags and SLA policies (Issue #1164, ADR-0160 Proposed). A new `experimental` module, off by default (`OMNICHANNEL_INBOX_ENABLED`), that projects the verified Telegram and website inbound envelopes into body-free conversation rows (idempotent by value, rebuildable from the event log), with staff assignment and history, tags, status and first/next-response SLA on a working calendar; the SLA job unassigns ineligible assignees and notifies only the assignee through the existing e-mail port. Migrations `sql/382`-`sql/384`. It sends nothing to a customer.
