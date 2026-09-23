---
"awcms": minor
---

feat(control-center): owner/operator API for OMES projections and safe operations (ahliweb/omes#198)

Implements the authenticated owner/operator REST API the OMES Control Center uses against the `omes_control` module (ADR-0122, schema/permissions from ahliweb/omes#196): tenant-wide fleet overview; server registration/decommission; enrollment-challenge issuance/revocation (one-time raw challenge, only its sha256 hash persisted — `sql/157`); desired-vs-observed deployment views (rendered as separate fields, never merged); allowlisted safe-operation submission (`status`/`preflight`/`start`/`stop`/`restart`/`update`/`backup`/`rollback`, copied byte-for-byte from the OMES contract's `operation-request.schema.json` enum); worker job listing, cancel, and retry-approval; and health/backup/audit projections.

Every endpoint reuses the existing `defineTenantRoute` (`withTenant` + `authorizeInTransaction` + canonical response envelope) chokepoint and default-deny RBAC against the permissions sql/155 already seeded. Destructive operations (`stop`, `rollback`, and the new `POST /api/v1/omes/backups/{id}/restore`) route through the existing `workflow-approval` engine (module key `workflow`, workflow key `omes_control.destructive_operation`) rather than a second approval authority — refused with `409 APPROVAL_WORKFLOW_NOT_CONFIGURED` and nothing persisted when no active definition is published. Mutations require `Idempotency-Key` and replay the shared `awcms_idempotency_keys` store; registration, enrollment-challenge issuance, operation submission, and backup restore are additionally rate-limited per actor. Every jsonb evidence field is redacted defense-in-depth; every mutation and authorization decision is recorded to `awcms_audit_events`.

AWCMS never executes anything on a host — every mutating endpoint only records intent as an `awcms_omes_operation_requests` row; OMES's own pull worker (`ahliweb/omes#199`) is the only future reader that turns an approved row into real host work.

`identity-access`'s `AccessAction` union grows three literals (`register`, `operate`, `rollback`) that the new `omes_control` guards needed, added to `HIGH_RISK_ACTIONS`.

Contract-shape validation against the vendored OMES contracts (`ahliweb/omes#197`, run in parallel) is intentionally not duplicated here — see `src/modules/omes-control/README.md`'s "omes#197 integration seam" section for exactly where its validator plugs in.
