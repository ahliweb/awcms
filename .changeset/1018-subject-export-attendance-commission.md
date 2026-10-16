---
"awcms": minor
---

feat(data_lifecycle): subject-access export reaches attendance events, attendance corrections and commission accruals through the employment, and stops matching employment headers by actor stamp (#1018, ADR-0142 addendum). Correction free-text `reason` is withheld from the export. Commission accruals sit on the payroll boundary: the export route now requires `hr_commission.accruals.read` IN ADDITION to `data_lifecycle.subject_request.export`, otherwise the table is withheld and named under the new `withheld` response field (replays re-check), and every earnings read is recorded as a sensitive read (ids and a count, no amount). `awcms_hr_employments` no longer treats `created_by`/`updated_by`/`deleted_by`/`restored_by` as subject columns, so an HR user's export no longer carries the headers they entered for other people. No migration.

Audit follow-up: the join uses `profile_id` only (a corrected mislinked login no longer exports a colleague's rows); the 30-day idempotency record keeps payroll tables as ids only and a replay re-reads them under a fresh permission check; payroll detection is by table name OR owner module; `beneficiary_tenant_user_id` is redacted; the admin page shows withheld and truncated tables (EN/ID).
