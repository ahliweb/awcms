🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](data-lifecycle.id.md)

# Data Lifecycle — operational and compliance guide

> **Document status (AWCMS, foundation-rebuild stage).** The
> `data_lifecycle` module below is a generic mechanism that on the
> `awcms-mini` base is already fully implemented (descriptor registry, the
> dry-run/archive/purge engine, legal hold, scheduled job, complete
> integration tests). In AWCMS, **there is no code implementation for this
> module yet**, and not a single high-volume table descriptor is registered
> because there is no ERP module yet producing tables of that kind. This
> document describes the **target architecture and contracts** that will be
> ported and extended with ERP descriptors once the finance/inventory/HR-
> payroll modules are built. Read any "already registered"/"already
> running" claim as a target specification, not as today's implementation
> status.
>
> **ERP-specific retention note.** Financial and payroll data on an ERP
> platform is generally subject to legal/tax retention periods that are far
> stricter and far longer than CMS content retention (e.g. the obligation
> to store transaction/tax/bookkeeping evidence under the KUP law and the
> related tax regulations, generally for years, often exceeding the typical
> 1-5 years for security audit logs). Every descriptor for a finance/payroll
> table (ledger entries, payroll records, tax invoice) MUST review its own
> actual legal/contractual retention requirement before setting
> `retentionMinDays`/`retentionMaxDays` — do not simply inherit the generic
> CMS/telemetry retention numbers from the base.

The `data_lifecycle` module (`type: "system"`) — a registry of
module-contributed high-volume tables and a safe lifecycle engine
(retention, partitioning, archive, legal hold, purge). This document
focuses on the operational guide and the compliance mapping; the full
technical detail will live in
`src/modules/data-lifecycle/README.md` once this module is implemented.

## Module summary

The AWCMS technical base (`awcms-mini`) already has a pattern of several
resource-specific retention/purge jobs (audit log purge, analytics purge,
form-draft purge), each implementing its own retention/batching/audit.
`data_lifecycle` adds a **module-contributed registry** (a static code
contract declared by each owning module about its own high-volume tables)
plus a **safe lifecycle engine** (dry-run planning, bounded archive/purge,
legal hold) that operates through that contract — never directly against
another module's schema ("no shared-table write").

## Descriptor registry (target, ERP example)

Every owning module declares a `HighVolumeTableDescriptor` in its own
`module.ts` (the `dataLifecycle` array,
`src/modules/_shared/module-contract.ts`) — table name, tenant/cursor
columns, retention class + safety bounds, partitioning eligibility, archive
policy, deletion behaviour, legal hold applicability, mandatory indexes,
batch limits, and execution mode (`"delegated"` — an adopter of an existing
mechanism; or `"generic"` — executed directly by this engine). Validated by
`bun run data-lifecycle:registry:check` (part of `bun run check`) and by
`security:readiness`'s `checkDataLifecycleRegistryValid`.

### Tables with no owning module ([ADR-0076](../adr/0076-infrastructure-tables-may-hold-lifecycle-descriptors.md))

A small number of tables are owned by **infrastructure** (`src/lib/`), not by
a module — deliberately, the same way the database and rate limit subsystems
are. Such tables have no `module.ts` to hold their descriptor, and
`ownerModuleKey` is not relaxed for them: relaxing it would make a module
descriptor that **forgot** to name an owner stop being an error and start
meaning "infrastructure".

Their descriptors live in
`src/modules/data-lifecycle/domain/infrastructure-lifecycle-registry.ts`, use
`ownerPath` (a `src/lib/…/` directory) instead of `ownerModuleKey`, and MUST
be `executionMode: "delegated"` — the generic engine deletes on behalf of the
owning module, and these tables have none.

What keeps that registry from becoming a parking lot is not a written rule:
`data-lifecycle:registry:check` scans `src/` with `ownerOfFile()` — the same
function `modules:table-writes:check` uses — and rejects an infrastructure
descriptor for a table whose writer is a module, as well as for a table that
nobody writes to.

| Descriptor key      | Table                     | Owner                 | Mode        | Retention class     | Window                           |
| ------------------- | ------------------------- | --------------------- | ----------- | ------------------- | -------------------------------- |
| `edge_cache.purges` | `awcms_edge_cache_purges` | `src/lib/edge-cache/` | `delegated` | `operational_queue` | `done` 7 days, `failed` 180 days |

Its purge is run by `bun run edge-cache:purge` and honours legal holds over
`edge_cache.purges` like every other delegated adopter.

The descriptors below are **target ERP examples** (not registered in code
yet — there is no finance/inventory/HR-payroll module yet):

| Descriptor key                        | Table                           | Owner            | Mode        | Retention class         |
| ------------------------------------- | ------------------------------- | ---------------- | ----------- | ----------------------- |
| `logging.audit_events`                | `awcms_audit_events`            | `logging`        | `delegated` | `audit_security`        |
| `finance.ledger_entries`              | `awcms_ledger_entries`          | `finance`        | `delegated` | `financial_record`      |
| `hr_payroll.payroll_records`          | `awcms_payroll_records`         | `hr_payroll`     | `delegated` | `payroll_record`        |
| `integration.webhook_delivery_events` | `awcms_webhook_delivery_events` | `integration`    | `delegated` | `operational_telemetry` |
| `data_lifecycle.data_lifecycle_runs`  | `awcms_data_lifecycle_runs`     | `data_lifecycle` | `generic`   | `operational_queue`     |

## Data retention (per descriptor)

Principle: **there is no single universal legal retention period** — each
descriptor declares its own retention class and safety bounds, mapped to that
table's specific business/compliance needs, not a generic number forced onto
all data. For AWCMS this means the `financial_record`/`payroll_record`
classes MUST be reviewed against the actual tax/bookkeeping retention
obligations (see the note above), not simply copied from the base's inherited
`audit_security`/`analytics_telemetry` classes.

| Descriptor                            | Default (illustrative) | Safety bounds (min–max, illustrative) | Rationale                                                                                                                                                      |
| ------------------------------------- | ---------------------- | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `logging.audit_events`                | 730 days               | 365–1825 days                         | Security/audit log: 1–5 years as needed — the midpoint of the range                                                                                            |
| `finance.ledger_entries`              | **not yet set**        | **legal/tax review required**         | The obligation to store bookkeeping/financial transaction evidence usually far exceeds technical audit log retention — do not default to a generic base number |
| `hr_payroll.payroll_records`          | **not yet set**        | **legal/labour review required**      | Payroll/employment data retention obligations vary by jurisdiction/contract — an explicit decision is required, not an inherited default                       |
| `integration.webhook_delivery_events` | 90 days                | 7–730 days                            | External integration telemetry (payment gateway/marketplace/logistics) — retention far shorter than the financial data itself                                  |
| `data_lifecycle.data_lifecycle_runs`  | 180 days               | 30–1825 days                          | The lifecycle execution history ITSELF is compliance evidence (ISO 27001/22301) — medium retention, archived before physical purge                             |

`retentionDaysOverride` (on-demand dry-run, `POST
/api/v1/data-lifecycle/dry-run`) is always clamped to the descriptor's
`[retentionMinDays, retentionMaxDays]` — an operator cannot force retention
outside the safety bounds declared by the table's owner, and **legal hold
still wins** over any override (see §Legal hold).

## Legal hold

`awcms_data_lifecycle_legal_holds` (RLS FORCE, tenant-scoped).
Fields: `descriptorKey` (nullable = tenant-wide), `scopeDescription`,
`reason` (required, minimum 10 characters), `authorityReference` (required —
the court/regulator/tax authority letter number), `authorityMetadata`
(jsonb, non-secret), `status` (`active`/`released`), `startsAt`/`endsAt`
(informational — `endsAt` does NOT automatically release the hold, see
below), `requestedBy`/`approvedBy`, `releasedBy`/`releasedAt`/`releaseReason`.

**Precedence cannot be bypassed**: an active hold (tenant-wide or targeting
a specific descriptor) makes ALL eligible rows on that descriptor be
reported as `held`, not `purgeable` — checked in `planLifecycleDryRun`
BEFORE any archive/purge branch, and even an aggressive
`retentionDaysOverride` cannot open a purge path. The `legalHold.applicable`
field on the descriptor is pure documentation metadata (whether this data
class plausibly makes sense to hold) — **not** a technical gate; a real hold
record always applies regardless of that field's value (which prevents an
owning module from declaring its own table "hold not applicable" to escape).
For financial/payroll data this legal hold is the relevant mechanism when a
tax audit or an employment dispute requires preserving data beyond routine
retention.

**Default-deny release**: `data_lifecycle.legal_hold.create` and
`data_lifecycle.legal_hold.release` are SEPARATE permissions — a role that
can create a hold cannot automatically release it. Release requires a
`releaseReason` (≥10 characters), an explicit permission, an
`Idempotency-Key`, and a `critical` audit. A hold whose `endsAt` has already
passed STAYS `active` until an explicit release action — preventing a hold
from "silently expiring" while the protected data is still legally relevant.

## Dry-run lifecycle planning

`GET /api/v1/data-lifecycle/registry` (descriptor list) →
`POST /api/v1/data-lifecycle/dry-run` (`{ descriptorKey,
retentionDaysOverride? }`) — pure `SELECT count(*)`, with no mutation at
all, without an `Idempotency-Key` (there is no side effect to make safe),
without persisting a row (unlike the scheduled job dry-run below, which DOES
record a run history snapshot for backlog visibility over time). Reports
`eligibleCount`/`heldCount`/`archivedCount`/`purgeableCount`/`blockedCount`.

## Scheduled job (`bun run data-lifecycle:archive-purge`)

`scripts/data-lifecycle-archive-purge.ts` — built on the shared worker
runner: advisory lock, timeout, SIGTERM/SIGINT-aware cancellation, JSON
telemetry. Iterates tenant-first; legal holds are re-fetched for each tenant
on each invocation (a new hold takes effect starting on the next pass, not
waiting for the next invocation).

- `"generic"` descriptors (`data_lifecycle.data_lifecycle_runs`): archive
  batch (if `archive.archivable`) then purge batch, both bounded
  (`batchLimit` per pass, `maxPasses` safety bound). Only
  `deletion.mode === "hard_delete"` is executed.
- `"delegated"` descriptors (audit/finance/payroll/integration): a dry-run
  snapshot only, NEVER a mutation — the real purge still goes through each
  existing job (or one that will be built alongside its owning module).
- `--dry-run`: no mutation for either mode, the snapshot is still recorded.

`bun run data-lifecycle:archive-purge --dry-run --json-output=<path>` is safe
to run in production as a preview before scheduling it for real.

### Cursor boundary precision (microsecond vs millisecond)

PostgreSQL `timestamptz` has microsecond precision; JavaScript `Date` only
milliseconds. Every cursor boundary comparison (`archivedThrough` for purge,
`resumeAfter` for resuming an archive) needs padding with
`CURSOR_BOUNDARY_SAFETY_MARGIN_MS` (1ms) — without it, the boundary row
itself fails the `<=`/`>` comparison against its own precision-truncated
value (proven empirically on the `awcms-mini` base through a large-volume
test — see the module's technical documentation for the full detail once it
is ported). The impact if not handled: purge loses exactly one row per cycle
(the boundary row is never deleted), and archive resume re-archives the last
row endlessly up to the `DEFAULT_MAX_PASSES` bound.

## Archive port and restore procedure (local/offline archive)

Provider-neutral (`domain/archive-port.ts`); the default AND first target
adapter: `local_offline` (`infrastructure/local-archive-adapter.ts`) —
writes JSONL/CSV artifacts to `DATA_LIFECYCLE_ARCHIVE_ROOT_PATH`, SHA-256
checksum, manifest recorded in
`awcms_data_lifecycle_archive_manifests` (location, row count, cursor range,
checksum, schema version, restore procedure reference).
`external_object_storage` is a valid value for `archive.port`
(forward-compatible typing) but there is no real adapter yet.

**Restore procedure (local/offline archive):**

1. Find the manifest via `GET /api/v1/data-lifecycle/runs` (correlate on
   `jobRunId`/`correlationId`) or query
   `awcms_data_lifecycle_archive_manifests` directly (admin/operator access).
2. Verify integrity BEFORE using any artifact:
   `ArchivePort.verify(artifactLocation, checksumHex)` — recompute SHA-256
   and compare; it must be `true` before continuing.
3. Read the artifact contents: `ArchivePort.read(artifactLocation)` — returns
   rows as `Record<string, unknown>[]`. **The returned values are JSON/CSV-
   native** (string/number/boolean/null/object), NOT automatically cast back
   to their original Postgres column types (e.g. a `timestamptz` column comes
   back as an ISO string, not a `Date` object) — the restoring operator MUST
   re-cast per column according to the target schema, never assume it is
   already correct. For financial data (e.g. `numeric` columns for monetary
   values), a wrong cast is a more serious data integrity risk than on CMS
   data — validate type and precision explicitly.
4. Restore-INTO-the-source-table is a **separate manual operator procedure**
   that is documented — this port deliberately does NOT write back into the
   source table automatically (the same "no shared-table write" constraint
   applies: only the code of the module that OWNS the table may write to its
   table). Restore means an operator (with direct DB admin access, outside
   the API) runs a manual `INSERT` of the already-read rows into the target
   table, validating `tenant_id`/constraints before inserting.
5. Reconciliation: compare the manifest's `rowCount` against the number of
   rows returned by `read()` — they must match exactly; a mismatch means the
   artifact is corrupt or the location is wrong, STOP the restore and
   investigate before continuing.

The end-to-end testing target (checksum + read + row count reconciliation)
follows the `awcms-mini` base integration test pattern once this module is
implemented in AWCMS.

## Partitioning policy and runbook guidance

`partition.eligible`/`partition.granularity` on a descriptor are
**guidance**, not automation — partitioning operations are only automated
once PostgreSQL safety can be proven, and a destructive migration of an
entire existing table in one PR remains out of scope. High-volume
descriptors (e.g. `logging.audit_events` monthly; high-volume
finance/inventory transaction tables once their modules exist) are future
candidates; low-volume descriptors (form drafts, run history) mark
`eligible: false` (the volume does not yet justify the complexity of
partitioning).

**Runbook (if it is ever implemented — an evaluation checklist, not proven
execution steps):**

1. Prove that real volume justifies partitioning (row count/growth rate
   metrics, not assumptions) — see §Metrics below.
2. A PostgreSQL partitioning migration MUST be non-destructive: create a new
   partitioned table, copy the data in batches (not a direct `ALTER TABLE` on
   a large live table), swap names in a short transaction, verify the row
   counts match exactly before dropping the old table.
3. RLS policies and indexes must be recreated EXACTLY the same on every child
   partition — doing it on the parent table alone is not enough (PostgreSQL
   declarative partitioning inherits RLS from the parent only for some
   operations; test explicitly before claiming it is safe).
4. Application role grants (`awcms_worker`/`awcms_app`) must be re-verified
   as applying to the new partitions (a grant on a partitioned parent table
   does not always automatically inherit to every child created later,
   depending on the `ALTER DEFAULT PRIVILEGES` strategy).
5. Run a real load test (`EXPLAIN ANALYZE` query plans on representative
   queries) BEFORE and AFTER partitioning — a partitioning scheme with the
   wrong granularity can slow things down, not speed them up.
6. An explicit rollback plan before the production cutover.

## Config and readiness checks

One new var (target): `DATA_LIFECYCLE_ARCHIVE_ROOT_PATH` (default
`./var/data-lifecycle-archive`). `security:readiness` adds two checks
(`checkDataLifecycleRegistryValid` — critical, revalidates the entire
registry; `checkDataLifecycleLegalHoldReleaseSeparate` — critical, verifies
that `legal_hold.create`/`.release` remain separate permissions and that
`release` remains classified high-risk).

## Metrics

Follows the `src/lib/observability/metrics-port.ts` pattern — low-cardinality
labels, never a tenant id or row content:
`job_run_total`/`job_run_duration_ms`/`job_run_item_count` (generic, from the
shared worker runner, automatically applying to
`data-lifecycle:archive-purge` with no extra instrumentation).
Volume/backlog/held-data per descriptor is available through `GET /api/v1/
data-lifecycle/runs` (run history, aggregated counts) and
`GET /api/v1/data-lifecycle/registry` (registered descriptors) — not an extra
dedicated Prometheus metric (the run history aggregate already answers "how
big is the backlog" without duplicating the metrics-port mechanism for the
same data).

## Compliance mapping

The principle that applies to EVERY row of the tables below: **retention is a
per-data-class decision declared by the table's owner** (see §Data
retention), not one universal legal number claimed to be correct for every
jurisdiction/data type. This module provides the MECHANISM (registry,
dry-run, legal hold, archive, safe purge) — the organisation using AWCMS is
still obliged to set the actual retention periods according to its own tax
regulations, employment law, and internal policy for finance/payroll data —
this is an additional responsibility compared with a generic CMS base, not
something that becomes automatically correct once the code is ported.

### UU PDP (Personal Data Protection Law, Law No. 27/2022)

| UU PDP principle                                        | Implementation (target)                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Storage limitation (data kept no longer than necessary) | Every descriptor declares explicit `retentionMinDays`/`retentionMaxDays`/`defaultRetentionDays`; the dry-run exposes the "eligible" backlog before a real purge is run                                                                                                                                       |
| Right to erasure / data subject requests                | Bounded purge + audit exist as a MECHANISM; the decision of WHEN to delete on a subject's request remains an operational decision by the operator, not automatic from this module — for payroll/HR data that decision must also weigh employment retention obligations that may override the erasure request |
| Processing accountability                               | Every purge (`"generic"` mode) is audited as `critical` with `descriptorKey`/`purgedCount`/`cutoffIso`; the run history holds aggregated execution evidence                                                                                                                                                  |
| Legal hold vs the right to erasure                      | Legal hold OVERRIDES the routine right to erasure — compliance with another, legally valid obligation (e.g. a tax audit, an employment dispute) beats a routine erasure request, consistent with the usual UU PDP exemption for legal obligations                                                            |

### PP PSTE (Electronic Systems and Transactions Operation, Government Regulation No. 71/2019)

| Aspect                                                            | Implementation (target)                                                                                                                                                                              |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Obligation to retain electronic data for law enforcement purposes | The explicit legal hold mechanism lets an operator preserve data beyond routine retention when a competent authority requests it, with `authorityReference` as evidence of the request's legal basis |
| Electronic system reliability                                     | Bounded batches (never an unbounded DELETE), advisory lock (never a concurrent double purge), archive checksums (verified integrity)                                                                 |

### ISO/IEC 27001:2022 Annex A (code-relevant controls)

| Control                              | Implementation (target)                                                                                                                            |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| A.5.33 Protection of records         | Archive manifest + checksum + restore procedure before the physical purge (for archivable descriptors)                                             |
| A.5.34 Privacy and protection of PII | Dry-run/run history aggregate counts, never row content/individual PII                                                                             |
| A.8.10 Information deletion          | Bounded, audited, permission-gated purge; explicit `deletion.mode` per table                                                                       |
| A.5.15 Access control                | ABAC default-deny + RLS on every endpoint; separate create/release legal hold permissions                                                          |
| A.8.15 Logging                       | Every purge (`"generic"`) and every legal hold action is audited `critical`/`warning` via the existing `recordAuditEvent` (no new audit mechanism) |

### ISO/IEC 27002:2022 (implementation guidance for the controls above)

Class-based retention guidance (not one global number) aligns with 27002
§5.33 ("retention periods should take into account... legal, statutory,
regulatory and contractual requirements" — plural, per data type). Secure
deletion guidance (27002 §8.10) is reflected in the explicit per-descriptor
`deletion.mode` (`hard_delete`/`anonymize`/`status_transition_then_purge`)
instead of one uniform strategy.

### ISO/IEC 27005:2023 (risk management)

| Risk                                                            | Mitigation (target)                                                                                                                                                                                                |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| An unbounded purge locking an old table                         | A mandatory `batchLimit` per descriptor (validated by the registry gate, absolute maximum 50,000), bounded statements, never a `DELETE` without a `LIMIT`                                                          |
| Legal hold silently bypassed                                    | Precedence is checked unconditionally before any purge branch; `legalHold.applicable` is not a technical gate (see §Legal hold)                                                                                    |
| Accidental cross-tenant purge                                   | RLS FORCE + an explicit `tenant_id` filter in every query; the job iterates tenants ONE BY ONE via separate tenant-scoped transactions, never one cross-tenant query                                               |
| A corrupt/unrecoverable archive artifact                        | A mandatory SHA-256 checksum per manifest, `verify()` before use, tested end-to-end                                                                                                                                |
| Credentials leaking through logs/archives                       | `artifactLocation` is always a path/URI, never a credential; no new mechanism writes a raw secret to a log                                                                                                         |
| An early purge of finance/payroll data breaking legal retention | `finance.*`/`hr_payroll.*` descriptors require a legal review before `retentionMinDays`/`retentionMaxDays` are set (see the note at the start of this document) — a risk with no counterpart in a generic CMS base |

### ISO/IEC 27701:2025 (privacy extension to ISO 27001, PIMS)

The dry-run and the run history aggregate (a count per descriptor per
tenant), never exposing individual row identifiers/values — aligned with the
PIMS data minimisation principle. The legal hold's `authorityMetadata`
(jsonb) is documented as non-secret but is still tenant-scoped under RLS —
never cross-tenant even when it holds external authority metadata.

### ISO/IEC 22301 (business continuity)

Archive-before-purge (for archivable descriptors) is evidence of retention
that can be recovered after an incident — a manifest + checksum + a restore
procedure that is documented and tested (not merely claimed) is part of
historical data recovery readiness. See also
[`resilience-dr-verification.md`](resilience-dr-verification.md) for full
database backup/restore coverage (independent of this module's archive
mechanism — the archive manifest complements, and does not replace, routine
database backups).

## Limitations recorded, not ignored

- **This module does not exist at all in AWCMS yet** — the main gap at the
  current foundation stage, separate from the technical limitations below
  that apply once the port from the base is complete.
- **The ERP descriptors above are merely illustrative examples** — there is
  no real finance/inventory/HR-payroll/integration module to register yet;
  the actual list will be determined when those modules are built.
- **`scope: "global"` descriptors** need to be accepted by the registry
  validator (forward-compatible) but skipped (not wrongly executed) by the
  dry-run planner and the archive/purge engine once implemented.
- **No dedicated admin UI screen** is planned as part of the initial
  acceptance criteria — API first, an `/admin/data-lifecycle` screen is a
  sensible follow-up.
- **External object-storage adapter** — `local_offline` only in the initial
  target implementation.
- **Cursor tie edge case** — see §Cursor boundary precision above; the
1ms bound that may remain after the fix (based on the base's experience) is
not theoretically eliminated entirely.
</content>
