---
"awcms": minor
---

feat(hr_workforce): tell the requester how their attendance correction ended (#1044, follow-up to #998). After the settler consumer settles a correction it queues one e-mail to the requester through the optional `workflow_notification` capability (now provided by `email`): an outbox INSERT in the consumer's transaction, sent later by `email:dispatch`, never on the settlement path and never able to fail it. Three EN/ID templates (`hr.attendance_correction_applied` / `_rejected` / `_cancelled`) carry the employee's display name and the date, never the reason; one notice per (correction, outcome). The email workflow-notification adapter now renders the subject in the tenant's default locale. Migration `302` gives `awcms_worker` column-scoped INSERT on `awcms_email_messages` and SELECT on the requester/profile columns the enqueue reads. Tenants opt in by seeding the templates (`bun run email:templates:seed-defaults`).
