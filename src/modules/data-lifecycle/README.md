# Data Lifecycle

Ported from awcms-micro Issue #745 (ADR-0037). `type: "system"` — a System
Foundation module the same layer as `logging`/`sync_storage`/
`visitor_analytics`: platform governance infrastructure every tenant shares the
mechanism of, not a tenant-facing business feature.

## Why this module exists

This base already has several resource-specific retention/purge jobs
(`logs:audit:purge`, `analytics:purge`, ...), each hand-rolling its own
retention semantics, batching, and audit trail. As more high-volume tables
accumulate, that pattern doesn't scale — every module re-derives the same
governance questions (how long to keep data, whether to archive before deleting,
how legal holds interact with purge, how to batch safely) slightly differently.

This module adds a **module-contributed registry** (a static, code-only contract
each owning module declares about its own high-volume tables) plus a **safe
lifecycle engine** (dry-run planning, bounded archive/purge, legal holds) that
operates on that contract — never on another module's schema directly.

## What this module does NOT do

- **Own another module's table.** Per ADR-0013 §6 ("no shared-table write"),
  `data_lifecycle` never writes to `awcms_audit_events`, `awcms_visit_events`, or
  any other module's table directly. It owns exactly four tables of its own
  (below).
- **Duplicate an existing purge mechanism.** A table with an `executionMode:
"delegated"` descriptor (e.g. `logging.audit_events`) keeps its existing job
  (`bun run logs:audit:purge`) as the sole mutator — this module only reads it
  for dry-run backlog visibility. But the delegated adopter's OWN purge function
  is the real legal-hold enforcement point (see Legal holds below).
- **Assert one universal legal retention period.** Every descriptor declares its
  own `retentionClass`/bounds.
- **Automate partitioning.** `partition.eligible` is guidance/runbook metadata
  only — no descriptor triggers an actual `CREATE TABLE ... PARTITION OF`
  migration.

## The descriptor contract (`HighVolumeTableDescriptor`)

Defined in `src/modules/_shared/module-contract.ts` (alongside
`ModulePermissionDescriptor`/`ProjectionDescriptor`/etc. — same "module declares
its own array, a central aggregator reads `listModules()`" shape). A module
contributes one entry per high-volume table in its own `module.ts`'s
`dataLifecycle` array:

```ts
dataLifecycle: [
  {
    key: "logging.audit_events", // "<ownerModuleKey>.<tableShortName>", unique
    tableName: "awcms_audit_events",
    ownerModuleKey: "logging", // must equal this module's own key
    scope: "tenant", // "tenant" | "global"
    cursorColumn: "created_at", // batching/ordering column
    retentionClass: "audit_security",
    retentionMinDays: 365,
    retentionMaxDays: 1825,
    defaultRetentionDays: 730,
    partition: { eligible: true, granularity: "monthly", rationale: "..." },
    archive: { archivable: false, rationale: "..." },
    deletion: { mode: "hard_delete", rationale: "..." },
    legalHold: { applicable: true, precedence: "overrides_retention" },
    requiredIndexes: [{ columns: ["tenant_id", "created_at"], purpose: "..." }],
    batchLimit: 5000,
    backupRestoreNotes: "...",
    executionMode: "delegated",
    existingAdopter: {
      jobCommand: "bun run logs:audit:purge",
      purgeFunctionRef:
        "src/modules/logging/application/audit-purge.ts#purgeExpiredAuditEvents",
      description: "..."
    }
  }
];
```

This is **trusted code-only metadata** — never tenant/request-controlled, never
itself duplicated into a mutable settings table.

### `executionMode`: `"delegated"` vs `"generic"`

- **`"delegated"`** — the owning module already has its own hand-rolled purge
  function/job. `data_lifecycle`'s engine may READ the table for a dry-run count
  (safe, read-only) but never mutates it. Requires `existingAdopter`.
- **`"generic"`** — no existing mechanism; the owning module opts the table into
  `data_lifecycle`'s own bounded archive/purge execution, using ONLY the metadata
  declared right here (table/tenant/cursor column names, batch limit). Must NOT
  also declare `existingAdopter`.

**The one `"generic"` adopter is `data_lifecycle`'s own run-history table**
(`data_lifecycle.data_lifecycle_runs`, declared in this module's own `module.ts`)
— the module dogfoods its own generic engine on data it owns outright, the only
way to prove real (non-delegated) archive/purge execution without reaching into
another module's schema. Two existing tables are registered as `"delegated"`
adopters: `logging.audit_events` and `visitor_analytics.visit_events`.

## Registry validation gate

`domain/lifecycle-registry.ts`'s `validateLifecycleRegistry` — pure code, no I/O
— checks every contributed descriptor: unique `key`/`tableName`, `ownerModuleKey`
matches the declaring module, valid `scope`/`retentionClass`, `retentionMinDays
<= defaultRetentionDays <= retentionMaxDays`, partition/archive/deletion/legalHold
policies present and internally consistent (in particular: `legalHold.applicable:
true` MUST pair with `precedence: "overrides_retention"` — this cannot be
declared away), at least one required index (a tenant+cursor composite
specifically for `"generic"` descriptors), a sane `batchLimit`, and
`executionMode`/`existingAdopter` consistency.

Wired into `bun run check` via `bun run data-lifecycle:registry:check`
(`scripts/data-lifecycle-registry-check.ts`). Also re-checked by
`security:readiness`'s `checkDataLifecycleRegistryValid` (defense in depth:
visible from the go-live checklist too, not only CI).

## Legal holds

`domain/legal-hold.ts` (pure rules) + `application/legal-hold-service.ts`
(persistence + audit). A legal hold record — scope (a specific descriptor key, or
`null` for tenant-wide), reason, authority reference, start/end, approval, audit —
**overrides ordinary retention/purge** whenever it applies, checked BEFORE
anything else that could report a row purgeable.

**Cannot be silently bypassed**: `legalHold.applicable` on a descriptor is
documentation/guidance only, deliberately NOT consulted by the enforcement path
(`evaluateLegalHoldForDescriptor`) — an actual hold record targeting a
descriptor's `key` (or tenant-wide) always applies, regardless of what that
descriptor's own metadata claims. Nor can a `retentionDaysOverride` widen
eligibility around a hold — the hold check runs first and unconditionally.

**Enforcement across module boundaries** (`_shared/ports/legal-hold-guard-port.ts`):
a `"delegated"` adopter's OWN purge function is the real enforcement point for
its own table, because `data_lifecycle`'s engine never mutates a delegated table.
Each such purge function takes a `LegalHoldGuardPort` and skips its
descriptor-covered DELETE when that descriptor is held. The concrete adapter
(`application/legal-hold-guard-port-adapter.ts`) is wired at the composition roots
(`scripts/audit-log-purge.ts`, `scripts/visitor-analytics-purge.ts`,
`src/pages/api/v1/analytics/retention/purge.ts`) — never imported directly from
inside `logging`/`visitor_analytics`' `application`/`domain` trees, which would
create a forbidden circular import (ADR-0011).

**Default-deny release**: `legal_hold.create` and `legal_hold.release` are
separate permissions — a role holding `create` does not implicitly hold
`release`. The `data_lifecycle.legal_hold_maker_checker` SoD rule (`module.ts`)
enforces this as a genuine maker/checker conflict. Both are reason-required,
permission-gated, `Idempotency-Key`-required, and audited `critical`. `release`
is a high-risk `AccessAction` (`identity-access/domain/access-control.ts`).

## Dry-run lifecycle planning

`application/dry-run-planner.ts`'s `planLifecycleDryRun` — generic across any
`scope: "tenant"` descriptor, entirely `SELECT count(*)` statements, zero
mutation. Reports `eligibleCount`/`heldCount`/`archivedCount`/`purgeableCount`/
`blockedCount`. On-demand via `POST /api/v1/data-lifecycle/dry-run` (zero
persistence, no `Idempotency-Key` needed — genuinely zero side effect) or as part
of the scheduled job (which DOES persist a run-history row per descriptor per
tenant per invocation).

## Bounded archive/purge engine

`application/archive-purge-job.ts`'s `runDataLifecycleArchivePurge`, wrapped by
`scripts/data-lifecycle-archive-purge.ts` (`bun run data-lifecycle:archive-purge`)
using the shared worker runner (`src/lib/jobs/*`) — advisory lock, timeout,
SIGTERM/SIGINT-aware cancellation, JSON telemetry.

- Tenant-first iteration; legal holds re-fetched fresh per batch pass (a hold
  created mid-backlog takes effect on the very next pass).
- `"generic"` descriptors: bounded archive pass (SELECT batch -> write via the
  archive port OUTSIDE any DB transaction -> record manifest + advance cursor in
  a new transaction), then a bounded purge pass (single-transaction bounded
  `DELETE ... RETURNING`, purging only rows already covered by an archive manifest
  when `archive.archivable`). Only `deletion.mode === "hard_delete"` is executed.
- `"delegated"` descriptors: a dry-run snapshot only, recorded to
  `awcms_data_lifecycle_runs` — never mutated.

### Timestamp precision (read before touching cursor comparisons)

Every cursor-boundary comparison is padded by `CURSOR_BOUNDARY_SAFETY_MARGIN_MS`
(1ms, `domain/cursor-boundary.ts`). This is NOT decorative — `timestamptz` has
microsecond resolution but a value read back through Bun.SQL as a JS `Date` only
has millisecond resolution, silently truncating the true value DOWN. An earlier
version of this code compared un-padded truncated values directly, which
permanently excluded the boundary row (one row short every archive cycle) and
looped the archive resume on the same last row. If you touch the boundary logic,
re-run `tests/unit/data-lifecycle-cursor-boundary.test.ts` and the DB-gated
integration test.

## Provider-neutral archive port

`domain/archive-port.ts` (interface) +
`infrastructure/local-archive-adapter.ts` (the DEFAULT, only-implemented adapter):
filesystem JSONL/CSV artifacts under `DATA_LIFECYCLE_ARCHIVE_ROOT_PATH` (doc 18),
SHA-256 checksummed, one manifest row per artifact
(`awcms_data_lifecycle_archive_manifests`). `external_object_storage` is a valid
`archive.port` value a descriptor can declare (forward-compatible typing) but has
no concrete adapter yet.

### Restore procedure (local/offline archive)

`ArchivePort.read()` reads an artifact back for reconciliation/testing; it
deliberately never writes back into the source table itself. A real restore into
a live table is a manual, documented operator procedure: (1) locate the artifact
via its `awcms_data_lifecycle_archive_manifests` row (`artifact_location`,
`checksum_hex`); (2) verify its checksum with `ArchivePort.verify(location,
expectedHex)`; (3) read rows with `ArchivePort.read(location)` — values come back
as JSON/CSV-native types (a `timestamptz` column round-trips as an ISO string,
not a `Date`), so re-cast per column before INSERT; (4) INSERT into the OWNING
module's table via that module's own code (never a cross-module write), inside a
`withTenant` transaction for the artifact's tenant. This same "no shared-table
write" boundary (ADR-0013 §6) applies during a restore.

## Schema (migration `055_awcms_data_lifecycle_schema.sql`)

Four tenant-scoped tables (`ENABLE`+`FORCE ROW LEVEL SECURITY`, `tenant_isolation`
policy) — this module owns exactly these:

- **`awcms_data_lifecycle_legal_holds`** — the one genuine runtime/tenant
  override this system needs.
- **`awcms_data_lifecycle_cursors`** — bounded-job pause/resume state per
  (tenant, descriptor, phase).
- **`awcms_data_lifecycle_archive_manifests`** — archive artifact evidence.
- **`awcms_data_lifecycle_runs`** — dry-run/archive/purge execution history,
  categorized AGGREGATE counts only. Also a registered `"generic"` descriptor of
  its own.

`awcms_worker` (sql/022) grants are narrow and explicit: `SELECT` ONLY on legal
holds (the worker reads holds, never creates/releases them — that stays an
admin/API action), `SELECT,INSERT,UPDATE` on cursors/manifests, `SELECT,INSERT,
DELETE` on runs. `awcms_app` needs no explicit grant — all four tables are
RLS-FORCE'd tenant-scoped, already covered by sql/019's blanket `ALTER DEFAULT
PRIVILEGES`.

## Permission seed (migration `056_awcms_data_lifecycle_permissions.sql`)

Verbatim match to `domain/data-lifecycle-permissions.ts`'s
`DATA_LIFECYCLE_PERMISSIONS`:

| Permission key                      | Action    | Notes                                                 |
| ----------------------------------- | --------- | ----------------------------------------------------- |
| `data_lifecycle.registry.read`      | `read`    | Code-declared metadata only                           |
| `data_lifecycle.legal_hold.read`    | `read`    |                                                       |
| `data_lifecycle.legal_hold.create`  | `create`  | Does not imply release                                |
| `data_lifecycle.legal_hold.release` | `release` | New `AccessAction`; default-deny separate from create |
| `data_lifecycle.plan.analyze`       | `analyze` | On-demand dry-run trigger                             |
| `data_lifecycle.runs.read`          | `read`    | Aggregated counts only                                |

## API (`src/pages/api/v1/data-lifecycle/*`)

- `GET /api/v1/data-lifecycle/registry` — list descriptors (metadata only).
- `POST /api/v1/data-lifecycle/dry-run` — on-demand plan for one descriptor.
- `GET /api/v1/data-lifecycle/runs` — run history.
- `GET`/`POST /api/v1/data-lifecycle/legal-holds` — list/create.
- `POST /api/v1/data-lifecycle/legal-holds/{id}/release` — release.

Real archive/purge execution is deliberately **not** exposed over HTTP — an
unattended maintenance operation, not a user action.

## Configuration

One new env var: `DATA_LIFECYCLE_ARCHIVE_ROOT_PATH` (doc 18) — the local/offline
archive adapter's filesystem root. Everything else (retention days, batch limits)
is owned by each descriptor in code, or by a delegated adopter's own existing env
var (e.g. `AUDIT_LOG_RETENTION_DAYS`) — never re-declared here.

## Known limitations

- **Cross-tenant/global-scope execution**: `scope: "global"` descriptors are
  accepted by the registry validator (forward-compatible typing) but the dry-run
  planner and archive/purge engine only implement the `scope: "tenant"` path
  end-to-end — a global-scope descriptor is skipped, not silently mis-executed.
  No registered descriptor today declares `scope: "global"`.
- **Cursor ties / near-ties within 1ms**: see "Timestamp precision" above — a
  narrow, documented edge case not exercised by any registered descriptor's real
  write pattern.
- **External object-storage archive adapter**: not implemented — `local_offline`
  only.
- **No dedicated admin UI screen**: the API exists; a `/admin/data-lifecycle`
  screen is a reasonable follow-up, not required by this port.
- **Partitioning is guidance only**: no automation.
- **Deferred consumers**: `form_drafts`/`newsletter`/`comments` (unported in this
  base) are not registered as adopters here; re-add their descriptors + guard
  wiring when those modules land.
