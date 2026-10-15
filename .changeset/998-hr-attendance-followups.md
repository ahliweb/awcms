---
"awcms": minor
---

feat(hr-workforce): attendance follow-ups from the #990 review (#998, ADR-0132).

- **Audit for events recorded for somebody else.** Every `supervisor` event and every `kiosk`/`import` event flagged `late` writes `hr_workforce.attendance_event.recorded_for_other` (ids, kind, source, `late`; the recorder is the actor). `self` events and punctual kiosk/import taps stay un-audited (high volume); a replay adds no second row. The README now says the seven-day replay window bypasses correction approval by design.
- **Settle guard scope.** The self-approval guard on `POST .../attendance-corrections/{id}/settle` now applies to a pending or approved instance only. A requester (or the employee concerned) holding `corrections.approve` may settle their own `rejected` / `cancelled` correction (nothing is applied); approving stays segregated, in the handler and in the database.
- **Automatic settlement.** The domain-event consumer `hr_workforce.attendance_correction_settler` applies a finished approval's verdict (`awcms.workflow.instance.approved` / `.rejected` / `.cancelled`) through the same `settleCorrection`, with no acting user (`trigger = workflow_event` on the audit row). A refusal leaves the correction `pending`, writes an `auto_settle_skipped` warning audit row and is not retried; `settle` remains the manual fallback.
- Migration 280 grants `awcms_worker` exactly what that needs (column-scoped UPDATE on corrections, `SELECT`/`INSERT` on events restricted by a trigger to `source = 'correction'`, column-scoped read access that omits the correction `reason` and the workflow decisions' `reason`/`override_reason`; the correction-only rule holds for every member of `awcms_worker`, not just the role itself). Migration 281 lets `decided_by` be NULL on a rejected/withdrawn correction nobody decided, instead of recording the settler as its decider. `hr_workforce` now depends on `domain_event_runtime`.

**Upgrade note.** Run `bun run db:migrate` (migration 280). Settlement follows the decision only where `bun run domain-events:dispatch` runs on a schedule; workflow instances that finished before this release have no delivery and are settled by hand once. With `WORKER_DATABASE_URL` set, the dispatcher needs migration 280's grants.
