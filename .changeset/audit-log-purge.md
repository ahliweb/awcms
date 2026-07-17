---
"awcms": minor
---

Implement audit log retention — `AUDIT_LOG_RETENTION_DAYS` is no longer a
silent no-op (Issue #146).

The variable was documented in `.env.example`, validated as an integer >= 1 by
`scripts/validate-env.ts`, and described in doc 18 as being "dipakai job purge
audit log". No such job existed. An operator who set it got unbounded growth of
`awcms_audit_events` plus false confidence — worse than having no knob at all.
Login now writes audit events without authentication (PR #157), so the table
grows from unauthenticated traffic too.

New `bun run logs:audit:purge` (`scripts/audit-log-purge.ts` +
`src/modules/logging/application/audit-purge.ts`, ported from awcms-mini):

- Deletes `awcms_audit_events` rows past the retention cutoff for every active
  tenant, in bounded batches (`DELETE ... LIMIT 5000`, oldest first) so a large
  backlog never holds one transaction open or locks the table unpredictably.
- **Self-auditing**: each non-empty batch records its own purge as a new audit
  event in the same transaction (counts and cutoff only) — the table can never
  be emptied to "no evidence a purge happened".
- Retention resolves as `--retention-days=<n>` > `AUDIT_LOG_RETENTION_DAYS` >
  730 days (2 years, the midpoint of doc 04's "1-5 tahun" range).
- `--dry-run` counts what would be purged without deleting anything, sharing
  the cutoff computation with the real path so the preview cannot drift.
- Runs through the shared job runner: advisory lock (no two concurrent runs on
  the same backlog), timeout, correlation id threaded into each purge event,
  structured telemetry, and `status: "partial"` when a tenant's backlog was not
  fully drained.
- Registered as a `logging` module job descriptor; recommended daily, off-peak.

Scope: `awcms_audit_events` only. `awcms_abac_decision_logs` (~8.6M rows/day at
100 req/s) is deliberately untouched — it needs its own retention decision, and
quietly bundling a delete policy for it here would be the wrong way to make it.

Unlike mini's version, `purgeExpiredAuditEvents` takes no `LegalHoldGuardPort`:
this base has no `data_lifecycle` module or legal-hold registry, and a guard
with nothing behind it would always answer "not held" — a fake gate is worse
than an honest absence. When a legal-hold registry lands, this function is the
enforcement point and the parameter should be required, not optional.
