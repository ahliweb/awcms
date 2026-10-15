---
"awcms": patch
---

security(workflow_approval): `awcms_workflow_decisions` is now append-only, a final `awcms_workflow_tasks` row is frozen, and a terminal `awcms_workflow_instances` row is immutable for the runtime role (#999, audit F2 of #990, ADR-0144, `sql/252`). `awcms_app` loses `UPDATE`/`DELETE`/`TRUNCATE` on decisions and `DELETE`/`TRUNCATE` on instances, and triggers refuse the same for any role plus every update of an `approved`/`rejected`/`cancelled` instance. The separation-of-duties guarantee that HR attendance corrections rely on can no longer be undone by another module's bug. No behaviour change for the workflow engine's own writes.
