---
"awcms": minor
---

feat(data_lifecycle): a subject-data descriptor can reach the person through one parent row (#985, ADR-0142, `MODULE_CONTRACT_VERSION` 4.6.0). `SubjectDataDescriptor.subjectVia` names a foreign key to another descriptor's table and which of that parent's subject columns mean "about the person"; the planner emits `column IN (SELECT id FROM parent WHERE tenant AND match)`. It excludes the table's own actor stamps, so a recorder's export never carries other people's rows, and erasure does NOT follow the join (the registry gate requires `retain_under_obligation`). `subject-data:registry:check` proves the foreign key, the parent and its columns. `hr_workforce` employment terms and shift assignments become exportable: an employee's subject-access export now carries their own terms history and schedule, and nothing of a colleague's or another tenant's. Attendance events and corrections stay a recorded follow-up. No migration.
