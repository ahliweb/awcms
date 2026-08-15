🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](0037-data-lifecycle-module-admission.id.md)

# ADR-0037 — Admission of `data_lifecycle` (retention governance + legal hold) as a System Foundation module

- **Status:** Accepted
- **Date:** 2026-07-24
- **Decision maker:** @ahliweb
- **Adapts:** awcms-micro `src/modules/data-lifecycle/` (Issue #745, epic #738 platform-evolution Wave 1; awcms-micro admitted it under ADR-0013 without a dedicated admission ADR) into the `awcms` base, per the absorption programme of [ADR-0035](0035-awcms-online-first-erp-saas-superset-repositioning.md) and the map [`docs/awcms/absorb-awcms-micro-roadmap.md`](../awcms/absorb-awcms-micro-roadmap.md) (Wave 1, net-new additive port + re-wiring two consumers).
- **Related:** ADR-0011 (capability ports), ADR-0013 §1/§6 (extension layers & "no shared-table write"), ADR-0006 (external providers outside the transaction), ADR-0031 (SoD), ADR-0034 (templates are used directly; modules live directly in `src/modules/`).

## Context

The `awcms` base already has several hand-rolled retention/purge jobs per resource (`logs:audit:purge`, `analytics:purge`), each deriving its own retention semantics, batching, and audit trail. As more high-volume tables pile up, that pattern does not scale — each module re-derives the same governance questions (how long to keep, whether to archive before deleting, how legal hold interacts with purge, how to batch safely) slightly differently.

awcms-micro already solved this (Issue #745) with the `data_lifecycle` module: a **module-contributed registry** (a static, code-only contract where each owning module declares its own high-volume tables) plus a **safe lifecycle engine** (dry-run planning, bounded archive/purge, legal holds) operating on top of that contract — never touching another module's schema directly.

On top of that, when `visitor_analytics` (PR #220) and `logging` (Issue #146) were ported/built into this base, their legal-hold coupling was **deliberately dropped** because `data_lifecycle` did not yet exist. The header of `logging/application/audit-purge.ts` and the description in `visitor_analytics/module.ts` document that re-add contract explicitly. This ADR makes that coupling real again.

## Decision

### 1. Admit `data_lifecycle` as a System Foundation module (net-new additive)

- Name: **Data Lifecycle** · `key`: `data_lifecycle`
- Category: **System Foundation** (`type: system`) — platform governance infrastructure whose mechanism is shared by every tenant, alongside `logging`/`sync_storage`/`visitor_analytics`, not a tenant-facing business feature.
- `dependencies`: `["tenant_admin", "identity_access", "logging"]` — the DAG stays acyclic (all three are already earlier in the registry).
- The module owns **ONLY its own four policy/execution-state tables** (`awcms_data_lifecycle_legal_holds`/`_cursors`/`_archive_manifests`/`_runs`, migration `sql/055`), and never owns another module's high-volume tables (ADR-0013 §6). The high-volume table descriptors this engine operates on are declared by each owning module's own `module.ts` (the `dataLifecycle` field, `_shared/module-contract.ts`), not mirrored into a DB table.

### 2. Additive contract seam (`MODULE_CONTRACT_VERSION` 2.0.0 → 2.1.0)

Adds the optional field `ModuleDescriptor.dataLifecycle?: HighVolumeTableDescriptor[]` plus the `HighVolumeTableDescriptor`/`Lifecycle*Policy`/union-literal type family. A purely additive MINOR — every `module.ts` that does not set `dataLifecycle` stays valid. The family manifest pin (`awcms-family-compatibility.yaml` `contracts.moduleDescriptorContractVersion`) is raised alongside it (gate `family:conformance:check`).

### 3. Registry validation gate + readiness

`domain/lifecycle-registry.ts`'s `validateLifecycleRegistry` (pure, no DB) validates every descriptor: unique `key`/`tableName`, `ownerModuleKey` matching the declaring module, valid `scope`/`retentionClass`, the bound `retentionMin <= default <= retentionMax`, consistent partition/archive/deletion/legalHold policies (in particular `legalHold.applicable: true` MUST be paired with `precedence: "overrides_retention"` — it cannot be declared-missing), at least one index (a composite tenant+cursor one specifically for `"generic"` descriptors), a sane `batchLimit`, and `executionMode`/`existingAdopter` consistency. Gated by `bun run data-lifecycle:registry:check` (part of the `check` chain), and re-checked by `security:readiness` (`checkDataLifecycleRegistryValid` + `checkDataLifecycleLegalHoldReleaseSeparate`).

### 4. Legal hold cannot be bypassed silently

A descriptor's `legalHold.applicable` is documentation/guidance only — it is **deliberately NOT consulted** by the enforcement path (`evaluateLegalHoldForDescriptor`). A hold RECORD (a human action, permission-gated, audited) targeting a descriptor `key` (or tenant-wide `descriptorKey: null`) always applies, whatever the descriptor metadata claims. Letting `applicable: false` suppress enforcement would let the owning module silently break the legal-hold coverage of its own table.

For `"delegated"` descriptors (`logging.audit_events`, `visitor_analytics.visit_events`), the `data_lifecycle` engine **never** mutates the table — it only records a dry-run snapshot. Therefore **the owning module's own purge function** is the only real enforcement point. Enforcement crosses the module boundary via **`_shared/ports/legal-hold-guard-port.ts`** (`LegalHoldGuardPort.isDescriptorHeld`) — a source-level port seam (NOT a capability-registry entry): each purge function receives the port and skips its DELETE when the descriptor is under hold. The concrete adapter is injected at the composition root (`scripts/audit-log-purge.ts`, `scripts/visitor-analytics-purge.ts`, `POST /api/v1/analytics/retention/purge`) — never imported directly from inside the consumer module's `application`/`domain` tree (preventing cyclic cross-imports, ADR-0011: `data_lifecycle` already imports `logging`'s `recordAuditEvent`).

### 5. Default-deny release + maker/checker SoD

`legal_hold.create` and `legal_hold.release` are separate permissions (a role with `create` cannot implicitly `release`). `release` is a NEW `AccessAction` and is classified HIGH-RISK (releasing a hold removes a data-protection safeguard). The SoD rule `data_lifecycle.legal_hold_maker_checker` (severity critical) enforces that pair as a maker/checker conflict; `exceptionPolicy.requiresApprovalPermission` = `identity_access.business_scope_exceptions.approve` (present in this base, `sql/030`), maxDurationDays 14.

### 6. Archive/purge is not exposed over HTTP

Real archive/purge execution is an unattended maintenance operation (`bun run data-lifecycle:archive-purge`, shared worker runner: advisory lock, timeout, pass limits), not a user action — the same administrative posture as `bun run logs:audit:purge`. The HTTP surface is only: read the registry, create/release a legal hold (Idempotency-Key + critical audit), read-only dry-run (no idempotency, zero mutation), read run history.

## Re-wiring the two shipped consumers

- **`visitor_analytics`** (PR #220): the `dataLifecycle` descriptor (`visitor_analytics.visit_events`, delegated) + the const `VISITOR_ANALYTICS_VISIT_EVENTS_LIFECYCLE_KEY` are RESTORED; `purgeVisitorAnalyticsData` takes a 5th param `legalHoldGuard`. A hold covering `visitor_analytics.visit_events` (descriptor-scoped OR tenant-wide) skips the ENTIRE purge — events AND steps 2-4 (session raw-detail cleanup, session deletion, rollup deletion) — preserving all analytics data. This is DELIBERATELY broader than awcms-micro (which only gated the events DELETE): steps 2-4 also destroy litigation-relevant data (IP/login snapshots, aggregates), so over-preservation under hold is the safe default for a compliance control.
- **`logging`** (Issue #146): the `dataLifecycle` descriptor (`logging.audit_events`, delegated) + the const `LOGGING_AUDIT_EVENTS_LIFECYCLE_KEY` are ADDED; `purgeExpiredAuditEvents` takes a **MANDATORY** `legalHoldGuard` param (not optional — as that file's own header instructs) and gates the audit-events DELETE.

The `form_drafts`/`newsletter`/`comments` consumers (not yet ported into this base) are DEFERRED.

## Consequences

- Positive: one proven retention governance engine, a legal hold that cannot be bypassed, a preserved purge audit trail, a CI-validated registry; the `visitor_analytics`/`logging` legal-hold coupling is whole again end to end.
- Cost: one new env var `DATA_LIFECYCLE_ARCHIVE_ROOT_PATH` (doc 18); `MODULE_CONTRACT_VERSION` goes up a minor; `AccessAction` gains `release`.
- Limitations (see `src/modules/data-lifecycle/README.md`): only the `scope: "tenant"` path is implemented end to end; the `external_object_storage` archive adapter does not exist yet (only `local_offline`); no dedicated admin UI; partitioning is guidance only.

## Rejected alternatives

- **Building a second lifecycle engine alongside the existing purge jobs** — duplicates retention/legal-hold semantics, two sources of truth. Rejected; a module-contributed registry + a generic engine is awcms-micro's proven decision.
- **Making `LegalHoldGuardPort` a capability-registry entry** (`capability-contract-versions.ts`) — overkill for a one-method seam wired at the composition root; awcms-micro also uses it as a plain source-level port. Rejected.
- **Porting the `legalHoldGuard` param as optional in `logging`** — a gate that can be skipped silently is more dangerous than an honest absence; the file header demands MANDATORY. Rejected.
