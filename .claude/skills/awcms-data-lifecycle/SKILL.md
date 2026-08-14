---
name: awcms-data-lifecycle
description: The data_lifecycle module HAS ALREADY been ported into this repo (ADR-0037, from awcms-micro Issue #745; migrations sql/055 schema + sql/056 permission). A System Foundation (`type: system`, deps `[tenant_admin, identity_access, logging]`) that OWNS four `awcms_data_lifecycle_*` tables (legal_holds/cursors/archive_manifests/runs, all FORCE RLS), a `HighVolumeTableDescriptor` registry contributed by each owning module (`ModuleDescriptor.dataLifecycle`), a zero-mutation dry-run planner, a bounded archive/purge engine, and a provider-neutral archive port (local/offline). It provides `LegalHoldGuardPort` (`_shared/ports/legal-hold-guard-port.ts`, a source-level seam NOT a capability registry entry) consumed by `logging` (mandatory) & `visitor_analytics` (optional-step) in their purge composition roots. SINCE ADR-0094 this module also owns a SECOND, separate surface — data subject rights (`subjectData` descriptor, export, maker/checker erasure, `sql/125`–`126`) — see §Data subject rights. Use when registering a new high-volume table, registering ANY NEW table into the subject ledger, creating/releasing a legal hold, or changing the engine.
---

🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](SKILL.id.md)

# AWCMS — Data Lifecycle (Registry, Legal Hold, Dry-Run, Archive/Purge)

> **STATUS — this module HAS ALREADY been ported into this repo (ADR-0037).**
> `data_lifecycle` lives in `src/modules/data-lifecycle/` (16 files),
> migrations `sql/055` (schema, four `awcms_data_lifecycle_*` tables FORCE
> RLS) + `sql/056` (permission), and `HighVolumeTableDescriptor` +
> `ModuleDescriptor.dataLifecycle` EXIST in `_shared/module-contract.ts`
> (`MODULE_CONTRACT_VERSION` ≥ 2.1.0). The table/code references below are REAL in
> this repo. `LegalHoldGuardPort` is a **source-level seam port**, NOT a
> `capability-contract-versions.ts` entry — it is wired at the composition root
> (script/route), and is never imported from inside the `application`/
> `domain` tree of a consuming module. Active consumers: `logging.audit_events`
> (delegated, guard MANDATORY) & `visitor_analytics.visit_events` (delegated,
> the guard gates the step-1 DELETE only).
>
> **Real adopters as of 2026-07-26 — 7 modules, 10 descriptors** (not 2; the
> source of truth is `listModules()`, not this list):
>
> | module              | table                                | retentionClass        |
> | ------------------- | ------------------------------------ | --------------------- |
> | `logging`           | `awcms_audit_events`                 | `audit_security`      |
> | `visitor_analytics` | `awcms_visit_events`                 | `analytics_telemetry` |
> | `data_lifecycle`    | `awcms_data_lifecycle_runs`          | `operational_queue`   |
> | `seo_distribution`  | `awcms_seo_not_found_observations`   | `analytics_telemetry` |
> | `form_drafts`       | `awcms_form_drafts`                  | `operational_queue`   |
> | `site_search`       | `awcms_site_search_query_log`        | `analytics_telemetry` |
> | `site_search`       | `awcms_site_search_index_failures`   | `system_event`        |
> | `comments`          | `awcms_comments_abuse_events`        | `system_event`        |
> | `comments`          | `awcms_comments_reply_subscriptions` | `communication_log`   |
> | `comments`          | `awcms_comments_comments`            | `communication_log`   |
>
> An earlier version stated `form_drafts`/`comments` were "DEFERRED (module not
> yet ported)". **Both are already ported** (`sql/062`–`063`, `sql/066`–`067`) and
> both are `executionMode: "delegated"`. `newsletter` genuinely still does not exist.

Source of truth: `src/modules/_shared/module-contract.ts`
(`HighVolumeTableDescriptor`), `src/modules/data-lifecycle/` (domain/
application/infrastructure/api), `src/modules/data-lifecycle/README.md`
(full technical detail + compliance mapping + restore procedure),
`docs/adr/0037-data-lifecycle-module-admission.md`, ADR-0013 §6 (data
ownership matrix — "no shared-table write").

## When to use this skill

1. **Adding ANY `awcms_*` table** — not only high-volume ones. Since
   ADR-0094 every table must answer the data subject question, and
   `bun run check` refuses to stay silent. See §Data subject rights.
2. **Registering a new high-volume table** into the retention registry —
   see §Playbook below. This is a DIFFERENT registry from number 1;
   a table can belong to either one, both, or (if it is not
   high-volume) only the first.
3. **Creating/releasing a legal hold** from code (service layer, not only
   via the API).
4. **Running/changing a subject export or erasure** — see
   §Data subject rights, in particular §The five `erasure` modes.
5. **Changing the engine** (`dry-run-planner.ts`, `archive-purge-job.ts`,
   `local-archive-adapter.ts`) — read §Do not repeat the cursor precision bug
   below BEFORE touching any cursor boundary comparison.

## Playbook: registering a new high-volume table

1. In the `module.ts` of the module that OWNS the table (not
   `data-lifecycle/module.ts` — the descriptor is registered by the module that
   owns its own table), add an entry to `dataLifecycle: [...]`:

   ```ts
   dataLifecycle: [
     {
       key: "your_module.your_table", // unique, "<ownerModuleKey>.<tableShortName>"
       tableName: "awcms_your_table",
       ownerModuleKey: "your_module", // MUST equal module.ts's own key
       scope: "tenant", // scope: "global" is not yet executed end-to-end, see Limitations
       cursorColumn: "created_at", // timestamptz column for batching/ordering
       retentionClass: "operational_queue", // | audit_security | analytics_telemetry | financial_tax | communication_log | system_event
       retentionMinDays: 7,
       retentionMaxDays: 365,
       defaultRetentionDays: 90,
       partition: { eligible: false, rationale: "..." }, // rationale is mandatory even when eligible:false
       archive: { archivable: false, rationale: "..." }, // archivable:true requires format+port
       deletion: { mode: "hard_delete", rationale: "..." },
       legalHold: { applicable: true, precedence: "overrides_retention" }, // CANNOT be "not_applicable" when applicable:true
       requiredIndexes: [
         { columns: ["tenant_id", "created_at"], purpose: "..." }
       ],
       batchLimit: 5000, // <= 50,000 (MAX_LIFECYCLE_BATCH_LIMIT)
       backupRestoreNotes: "...",
       executionMode: "delegated", // OR "generic" — see the choice below
       existingAdopter: {
         // MANDATORY when executionMode is "delegated", FORBIDDEN when "generic"
         jobCommand: "bun run <modul>:purge", // replace with the REAL target in package.json
         purgeFunctionRef:
           "src/modules/your_module/application/your-purge.ts#purgeYourTable",
         description: "..."
       }
     }
   ];
   ```

2. **Choose `executionMode`**:
   - Already have your own purge job (the most common case)? →
     `"delegated"` — KEEP using the existing job/function, do not
     duplicate its logic. `data_lifecycle`'s engine only reads this table
     for dry-run (read-only, safe); the real purge is never
     touched by this engine.
   - Have no purge mechanism at all and want
     `data_lifecycle`'s engine to execute bounded archive/purge
     for you? → `"generic"` — an `id uuid PRIMARY KEY` column is MANDATORY
     (global assumption of doc 04) and a composite tenant+cursor index (checked by the
     registry gate). Only `deletion.mode: "hard_delete"` is executed by this
     engine today — other modes are rejected (with a clear error), not
     silently executed wrongly.

3. `bun run data-lifecycle:registry:check` — fix the errors it
   reports (they name the exact field and reason).

4. Document the retention rationale for your new table in the `README.md` of the
   OWNING module (and/or `src/modules/data-lifecycle/README.md` §compliance)
   — **do not** claim one universal legal retention period; explain the
   specific reason for this class of data.

5. `bun run changeset`.

## Data subject rights (ADR-0094) — a SECOND registry, and it covers EVERY table

> Two registries, two different questions. Do not mix them up:
>
> | descriptor      | question                                  | coverage                  | gate                                                          |
> | --------------- | ----------------------------------------- | ------------------------- | ------------------------------------------------------------- |
> | `dataLifecycle` | when does this row EXPIRE?                | high-volume tables only   | `data-lifecycle:registry:check`                               |
> | `subjectData`   | what does this table store ABOUT SOMEONE? | **every `awcms_*` table** | `subject-data:coverage:check` + `subject-data:registry:check` |

As of 2026-08-13 the `subjectData` ledger is **ZERO**: 147 tables = 140
with descriptors + 7 rejected with reasons + **0 owing**. `subject-data:coverage:check`
keeps the debt ledger so that it can only SHRINK — adding a table without a
descriptor turns `bun run check` red, and the exclusion list
`TABLES_PREDATING_THE_SUBJECT_RULE` in `scripts/subject-data-coverage-check.ts`
is deliberately left as an EMPTY array so that a regression has to be written by hand.

### Playbook: a new table answers the subject question

In the `module.ts` of the module that **owns the table** (same as
`dataLifecycle` — not in `data-lifecycle/module.ts`), add an entry to `subjectData: [...]`:

```ts
subjectData: [
  {
    key: "your_module.your_table", // "<ownerModuleKey>.<tableShortName>", unique
    tableName: "awcms_your_table",
    ownerModuleKey: "your_module", // MUST equal module.ts's own key
    subjectColumns: [
      { column: "tenant_user_id", references: "tenant_user" }
      // references: "tenant_user" | "identity" | "profile" | "principal"
      // match: "equals" (default) | "jsonb_array_contains"
    ],
    // tenantColumn: undefined → "tenant_id"; "id" → the column has another name;
    //   null → GLOBAL table (three DIFFERENT meanings, the gate enforces all three)
    exportable: true,
    erasure: "anonymize",
    rationale: "...", // MANDATORY, and read by humans — not a formality
    redactedColumns: ["token_hash"] // columns that NEVER enter an export
  }
];
```

Then `bun run subject-data:coverage:check && bun run subject-data:registry:check`.

**Two gates, two questions.** Coverage asks _whether every table
answers_; registry asks _whether the answer is RIGHT_ — it resolves each
descriptor against `sql/`: the subject columns really exist, `references` matches
the real FK target, the redacted columns exist, the `tenantColumn` contract is
consistent, the severance chain is intact, and **the `erasure` mode is within
`awcms_app`'s privileges** (it replays every `GRANT`/`REVOKE` in `sql/`
in migration order). A green coverage gate whose every answer is
wrong is a REAL failure that has already happened in this repo — that is why
the second gate exists.

### The five `erasure` modes — and the one most often right is NOT `anonymize`

| mode                           | meaning                                                  |
| ------------------------------ | -------------------------------------------------------- |
| `anonymize`                    | overwrite the personal columns in place; the row remains |
| `hard_delete`                  | delete the row                                           |
| `status_transition_then_purge` | mark it (`revoked_at`) then let retention delete it      |
| `severed_with_subject_row`     | **there is nothing to do HERE**                          |
| `retain_under_obligation`      | deliberately RETAINED — a decision, not an oversight     |

`severed_with_subject_row` is the MAJORITY answer in this schema (~90
tables) and the easiest to misunderstand. It is used when a table only
carries the subject id as a **stamp** (`created_by`, `deleted_by`,
`actor_tenant_user_id`): anonymizing `awcms_identities` already makes
every one of those stamps point at nobody. An executor
told to `anonymize` here will **overwrite the stamp** — destroying the
tenant's record of who deleted a page, in order to
sever a link that is already severed. `erasureTargets()` in
`domain/subject-data-plan.ts` filters this mode and
`retain_under_obligation` out; do not bypass that function.

### Three ids, not one

The subject is a **tenant user** (ADR-0094 Decision 1 — answered PER TENANT,
never through the global `awcms_principals`). A row reaches
that person through one of three ids, and the descriptor states which:
`tenant_user_id`, `identity_id`, or **`profile_id`**. The third is not
optional: not a single column in `awcms_profiles` carries either of the first two
ids — the link runs the other way, from
`awcms_identities.profile_id`. `references: "principal"` is only valid on
descriptors with `tenantColumn: null` and deliberately has no entry in
`SUBJECT_ID_OF`; the planner filters it out.

### Surface: export ≠ erasure, and maker/checker erasure

Four separate permissions (`domain/subject-request-permissions.ts`):

| permission                               | for                                                  |
| ---------------------------------------- | ---------------------------------------------------- |
| `data_lifecycle.subject_request.read`    | seeing the queue; does NOT disclose subject data     |
| `data_lifecycle.subject_request.export`  | performing an export — a **DISCLOSURE**, audited     |
| `data_lifecycle.subject_erasure.create`  | REQUESTING erasure (maker) — never executes          |
| `data_lifecycle.subject_erasure.approve` | approving/rejecting (checker) — execution lives here |

Holding `create` **and** `approve` at once is a `critical` SoD
conflict (`SUBJECT_ERASURE_MAKER_CHECKER_RULE`). That separation is enforced
at **four** independent layers: two permissions, the SoD rule, the CHECK constraint
`awcms_subject_requests_checker_is_not_maker` in `sql/125`, and a conditional
UPDATE (`claimPendingErasure`) that carries `requested_by <> checker`
in its `WHERE`. The claim and the execution live in ONE transaction —
splitting it (read status → delete → update) is the shape that makes a
lockout counter count K parallel attempts as one, and here
it runs an irreversible erasure twice.

Routes: `src/pages/api/v1/data-lifecycle/subject-requests/{index,export,erase}.ts`

- `[id]/decide.ts` (all on top of `defineTenantRoute`), the screen
  `src/pages/admin/subject-requests.astro`, table `sql/125`, permissions
  `sql/126`.

### The export STATES its own coverage

`SubjectPlan.unansweredEntries` carries the tables that were deliberately NOT answered
(global, or without a subject column) all the way into the report. A per-tenant
report that silently omits `awcms_principals` is indistinguishable from a
report written before that table existed; a report that NAMES it can be
acted on. Do not "tidy this up" by dropping the list.

### Proven traps — do not repeat them

- **`hard_delete` on a table whose privileges have already been revoked.** Two
  MFA descriptors promised `hard_delete` while ADR-0087/`sql/114`
  deliberately made it read-only → `42501` in the middle of an erasure, AFTER
  the request had been claimed. The fix is `severed_with_subject_row`, **not**
  restoring GRANT DELETE (that would cancel the ADR's control).
- **A migration comment that lies about its own control.** `sql/125` at one point
  wrote "no DELETE" while only doing `GRANT SELECT, INSERT, UPDATE` —
  even though the blanket grant in `sql/019` had already given DELETE. The intended
  control needs an EXPLICIT `REVOKE DELETE`. A table narrowed this way
  must be registered in `RETIRED_TENANT_TABLE_PRIVILEGES`
  (`scripts/security-readiness.ts`) or `checkRuntimeRoleGrants` goes red.
- **Pure tests do not execute SQL.** Both defects above passed a full
  `bun run check` and only became visible when the engine was run against a
  REAL Postgres. For changes in `application/subject-data-executor.ts`,
  run the DB-gated integration tests — do not rely on pure tests alone.
- **jsonb binding.** `${JSON.stringify(arr)}::jsonb` stores a jsonb
  _string_ (`jsonb_typeof` = `string`) so containment is always false;
  `${arr}::jsonb` stores an array. This makes a CORRECT executor look
  broken.

## Legal hold — precedence and default-deny (critical, do not loosen)

- An active hold (tenant-wide `descriptorKey: null`, or targeting a specific
  descriptor) ALWAYS overrides ordinary retention/purge — checked in
  `planLifecycleDryRun` BEFORE any branch that could report purgeable
  rows. No `retentionDaysOverride`, however aggressive, can
  open a purge path while a hold is active.
- `legalHold.applicable` on a descriptor is **pure documentation
  metadata** — NEVER make the engine check this field to
  decide whether a hold applies. A REAL hold record always applies
  regardless of this field's value (this prevents an owning module from declaring
  its own table "hold-immune").
- `data_lifecycle.legal_hold.create` and `.release` MUST remain
  SEPARATE CODE permissions — never merge them into a single
  `manage` permission. `security:readiness`'s
  `checkDataLifecycleLegalHoldReleaseSeparate` (critical) will fail if
  this is violated.
- Release MUST have a reason (≥10 characters, `validateReleaseLegalHoldInput`),
  an `Idempotency-Key`, and a `critical` audit — exactly like create.
- `endsAt` on a hold does **not** release the hold automatically — it is purely
  "estimated review date" metadata. Only an explicit release action changes the
  status.

## Do not repeat the cursor precision bug (microsecond vs millisecond)

PostgreSQL `timestamptz` has microsecond precision; JavaScript `Date` only
milliseconds. **Every** cursor boundary comparison that reads a value
from Postgres (via `SELECT`, automatically becoming a JS `Date`) and then uses it
as a `<=`/`>`/`>=` bound in the NEXT query loses precision —
the row that DEFINES that boundary can fail the comparison
against itself.

- **Already fixed** in `archive-purge-job.ts` via
  `CURSOR_BOUNDARY_SAFETY_MARGIN_MS` (1ms) — the pattern: pad the boundary in the
  CORRECT DIRECTION (upper bound `<=` → add 1ms; lower bound resume `>` →
  turn it into `>=` with a bound of `+1ms`) before using it as a parameter of
  the next query. Constant/helper: `domain/cursor-boundary.ts`.
- **When adding a NEW cursor comparison** (new feature, refactor):
  reuse the existing `CURSOR_BOUNDARY_SAFETY_MARGIN_MS`, do NOT
  directly compare a `Date` value that was read-then-written-back
  without padding. Test it with the regression test
  `tests/data-lifecycle-cursor-boundary.test.ts` + a DB-gated
  integration test (this bug ALWAYS shows up on the last row of every batch, not as a
  rare case — without the fix, a small backlog can get stuck in a loop until
  `DEFAULT_MAX_PASSES`).
- Full investigation detail (how the bug was found, the impact before the
  fix): `src/modules/data-lifecycle/README.md` §Timestamp precision.

## Dynamic identifiers (tableName/tenantColumn/cursorColumn) in SQL

Always go through `assertSafeIdentifier` (regex allowlist) BEFORE
interpolating into SQL text via `tx.unsafe(sql, params)` — the actual
values (`tenantId`, `cutoff`, etc.) still ALWAYS go through bound
`$1`/`$2`/... parameters, never string concatenation. Identifiers may ONLY
originate from a `HighVolumeTableDescriptor` already validated by the
registry gate — never from request/user input. Same pattern as
`visitor-analytics/application/analytics-queries.ts`'s
`topJsonFieldCounts`.

## Do not build a new mechanism for something that already exists

- **Locking/batching/retry** — reuse `src/lib/jobs/*` (shared worker
  runner, PR #713/Issue #697) via `runBoundedBatches`. DO NOT add your own
  advisory lock/batching.
- **Audit** — reuse the existing `recordAuditEvent`
  (`logging/application/audit-log.ts`). DO NOT build a separate audit
  table for data-lifecycle actions.
- **Redaction/masking** — no new mechanism; dry-run/run history
  only stores aggregated counts, never row content, so
  there is no sensitive value to redact there in the first place.
- **ABAC/RLS** — the standard `authorizeInTransaction` + `withTenant`
  pattern (skill `awcms-abac-guard`), no new authorization mechanism.

## Verification

- `bun run data-lifecycle:registry:check` — the retention registry is valid.
- `bun run subject-data:coverage:check` — 0 tables owing (the ledger may only
  shrink).
- `bun run subject-data:registry:check` — every subject descriptor resolves
  against `sql/`: the columns exist, `references` matches the FK, the `erasure` mode is
  within `awcms_app`'s privileges.
- Changes to the subject executor: DB-gated integration tests run
  against a real Postgres, not pure tests only (see §Traps).
- `bun run security:readiness` — the two new checks
  (`checkDataLifecycleRegistryValid`, `checkDataLifecycleLegalHoldReleaseSeparate`)
  pass.
- Dry-run against a real Postgres: for any descriptor, calling it twice
  in a row with the same input produces an identical result (no
  mutation).
- Active legal hold: dry-run reports ALL eligible rows as
  `held`, `purgeableCount: 0`, even with the most aggressive
  `retentionDaysOverride`.
- `executionMode: "generic"` descriptor: a large-volume test (>batchLimit)
  proves multi-pass is correct with no duplicated/skipped rows, and the
  resulting archive manifest passes `ArchivePort.verify()`.
