---
"awcms": minor
---

Tenant-module matrix and per-module audit summary — the rest of #261.

`GET /api/v1/tenant/modules/matrix` returns every module with this tenant's
enabled state, its protected flag, and two lifecycle warnings computed by
re-running the REAL `evaluateModuleEnable`/`evaluateModuleDisable` rather than a
UI-side re-derivation that would drift from the endpoints. Two queries total;
the rest is pure.

The warnings are one-directional on purpose — `dependencyWarning` only for a
disabled module, `reverseDependencyWarning` only for an enabled one. The other
combinations cannot arise, and asking `evaluateModuleEnable` about an
already-enabled module short-circuits to `MODULE_ALREADY_ENABLED`: an answer
that looks like a check and is not one.

No health column, unlike awcms-micro's matrix: that one is fed by a batched
health reader this base does not have, and a per-row read would be 21 queries
inside one transaction.

`GET /api/v1/modules/{moduleKey}/audit` returns recent module-management
activity for one module, guarded by `logging.audit_trail.read` — these are
audit-log rows, so the audit-log permission governs them. The caller-supplied
`?limit=` is clamped to 1..50, with NaN/Infinity falling back to the default.
