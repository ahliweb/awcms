import { defineModule } from "../_shared/module-contract";
import { DATA_LIFECYCLE_PERMISSIONS } from "./domain/data-lifecycle-permissions";

/**
 * `data_lifecycle` (ported from awcms-micro Issue #745, ADR-0037). `type:
 * "system"` — a System Foundation module the same layer as
 * `logging`/`sync_storage`/`visitor_analytics`: platform/governance
 * infrastructure every tenant shares the mechanism of, not a tenant-facing
 * business feature.
 *
 * This module owns exactly its OWN policy/execution-state tables (legal holds,
 * cursors, archive manifests, run history) — it never owns another module's
 * high-volume table directly (ADR-0013 §6 "no shared-table write"). The
 * high-volume table DESCRIPTORS this engine operates on are declared by each
 * OWNING module's own `module.ts` (`dataLifecycle` field,
 * `_shared/module-contract.ts`) — see `logging`/`visitor_analytics` for the two
 * "delegated" adopters this port re-wires, and this module's own `dataLifecycle`
 * entry below for the one "generic"-execution descriptor the engine dogfoods
 * end-to-end (its own run-history table).
 */
export const dataLifecycleModule = defineModule({
  key: "data_lifecycle",
  name: "Data Lifecycle",
  version: "0.1.0",
  status: "active",
  description:
    "Module-contributed high-volume table registry and safe lifecycle engine: retention/partition/archive/legal-hold/purge descriptors declared by owning modules, dry-run planning, bounded archive/purge on the shared worker runner, a provider-neutral archive port, and legal holds that override ordinary retention/purge (ported from awcms-micro Issue #745, ADR-0037). Provides the LegalHoldGuardPort (_shared/ports/legal-hold-guard-port.ts) that logging and visitor_analytics consume at their purge composition roots so an active legal hold blocks their purge; real archive/purge is never exposed over HTTP (job only).",
  dependencies: ["tenant_admin", "identity_access", "logging"],
  type: "system",
  api: {
    openApiPath: "openapi/modules/data-lifecycle.openapi.yaml",
    basePath: "/api/v1/data-lifecycle"
  },
  // `/admin/data-lifecycle` — the registry, the legal-hold ledger (place and
  // release), the on-demand dry-run planner, and run history. Gated on
  // `registry.read`, the permission the page's primary panel needs; a viewer
  // holding only `legal_hold.read` or `runs.read` reaches the page directly and
  // gets the panels they are entitled to. Hiding a link is not a security
  // control — the page and every endpoint it calls guard themselves.
  //
  // Note that the page deliberately gates `legal_hold.create` and
  // `.release` SEPARATELY: `sodRules` below makes holding both a `critical`
  // maker/checker conflict, so no ordinary operator has the pair.
  navigation: [
    {
      labelKey: "admin.layout.nav_data_lifecycle",
      path: "/admin/data-lifecycle",
      order: 72,
      requiredPermission: "data_lifecycle.registry.read"
    }
  ],
  permissions: [
    {
      activityCode: "registry",
      action: "read",
      description:
        "Read the high-volume table lifecycle registry (code-declared metadata only, never row contents)"
    },
    {
      activityCode: "legal_hold",
      action: "read",
      description: "Read legal hold records"
    },
    {
      activityCode: "legal_hold",
      action: "create",
      description: "Create a legal hold"
    },
    {
      activityCode: "legal_hold",
      action: "release",
      description: "Release (end) an active legal hold"
    },
    {
      activityCode: "plan",
      action: "analyze",
      description: "Trigger an on-demand, read-only dry-run lifecycle plan"
    },
    {
      activityCode: "runs",
      action: "read",
      description: "Read lifecycle run history (aggregated counts only)"
    }
  ],
  jobs: [
    {
      command: "bun run data-lifecycle:archive-purge",
      purpose:
        "Archive (where applicable) and purge rows past retention for every registered generic-execution descriptor; record a dry-run backlog snapshot for every delegated (existing-adopter) descriptor.",
      recommendedSchedule: "Daily via cron/systemd timer.",
      environmentNotes:
        "Database plus local filesystem operation by default (local/offline archive adapter) — no external network dependency unless a future external object-storage adapter is configured.",
      safeInOfflineLan: true
    }
  ],
  /**
   * ADR-0094 wave 2 (Issue #557) — this module's OWN tables, held to the rule
   * it enforces for everybody else.
   *
   * A legal hold is the one place where erasure and retention argue directly,
   * and the answer is written down here rather than left to the executor: the
   * hold outlives the person who requested it, because a hold that vanished
   * when its requester left would silently release the evidence it exists to
   * keep.
   */
  subjectData: [
    {
      key: "data_lifecycle.legal_holds",
      tableName: "awcms_data_lifecycle_legal_holds",
      ownerModuleKey: "data_lifecycle",
      subjectColumns: [
        { column: "requested_by", references: "tenant_user" },
        { column: "approved_by", references: "tenant_user" },
        { column: "released_by", references: "tenant_user" }
      ],
      exportable: true,
      // NOT `severed_with_subject_row`, and the difference is deliberate: this
      // is the maker/checker record for a control that overrides retention, so
      // all three stamps are evidence in their own right. Severance leaves them
      // unresolvable, which is correct — but the reason they are kept is the
      // obligation, not the mechanism.
      erasure: "retain_under_obligation",
      rationale:
        "ADR-0037 — who requested, approved and released each legal hold. Retained under the obligation the hold itself represents: these three stamps are the maker/checker evidence that a retention override was authorised, and a hold whose provenance could be erased would be no hold at all.",
      redactedColumns: ["authority_metadata"]
    },
    {
      key: "data_lifecycle.archive_manifests",
      tableName: "awcms_data_lifecycle_archive_manifests",
      ownerModuleKey: "data_lifecycle",
      subjectColumns: [{ column: "created_by", references: "tenant_user" }],
      exportable: false,
      erasure: "severed_with_subject_row",
      rationale:
        "Checksums and locations of archived batches. The artifact is another table's rows under their own descriptor; the person here is whoever ran the archive."
    },
    {
      key: "data_lifecycle.runs",
      tableName: "awcms_data_lifecycle_runs",
      ownerModuleKey: "data_lifecycle",
      subjectColumns: [{ column: "triggered_by", references: "tenant_user" }],
      exportable: false,
      erasure: "severed_with_subject_row",
      rationale:
        "Aggregated counts per lifecycle run — eligible, archived, purged — and who triggered it. The counts are about tables, not people."
    },
    {
      key: "data_lifecycle.cursors",
      tableName: "awcms_data_lifecycle_cursors",
      ownerModuleKey: "data_lifecycle",
      unreachableBySubject: true,
      subjectColumns: [],
      exportable: false,
      erasure: "retain_under_obligation",
      rationale:
        "How far the purge engine has walked each descriptor. A resume point with no author column; resetting one would re-scan or skip a retention window."
    }
  ],
  dataLifecycle: [
    {
      key: "data_lifecycle.data_lifecycle_runs",
      tableName: "awcms_data_lifecycle_runs",
      ownerModuleKey: "data_lifecycle",
      scope: "tenant",
      cursorColumn: "created_at",
      retentionClass: "operational_queue",
      retentionMinDays: 30,
      retentionMaxDays: 1825,
      defaultRetentionDays: 180,
      partition: {
        eligible: false,
        rationale:
          "Expected row volume is one row per (tenant, descriptor, invocation) — orders of magnitude smaller than the tables this module purges on behalf of others; native PostgreSQL partitioning is not justified until real volume evidence says otherwise (automate only where PostgreSQL safety can be proven)."
      },
      archive: {
        archivable: true,
        format: "jsonl",
        port: "local_offline",
        rationale:
          "Run history is retention/purge EVIDENCE itself (ISO/IEC 27001/22301 audit trail of what was purged and when) — archiving before physical delete preserves that evidence beyond the live retention window, at negligible cost given the table's low expected volume."
      },
      deletion: {
        mode: "hard_delete",
        rationale:
          "No PII beyond opaque UUIDs already scoped by RLS plus aggregate counts — anonymization has nothing further to remove; hard delete after archive is sufficient."
      },
      legalHold: {
        applicable: true,
        precedence: "overrides_retention"
      },
      requiredIndexes: [
        {
          columns: ["tenant_id", "descriptor_key", "created_at"],
          purpose: "Per-descriptor run history lookup, newest first."
        },
        {
          columns: ["tenant_id", "run_type", "created_at"],
          purpose: "Filter run history by type (dry_run/archive/purge)."
        }
      ],
      batchLimit: 5000,
      backupRestoreNotes:
        "Included in ordinary full-database backup/restore; archived rows additionally have a standalone JSONL artifact restorable independently of a full database restore.",
      executionMode: "generic"
    }
  ],
  // Ported from awcms-micro Issue #746 (SoD): `legal_hold.create`/`.release`
  // (this module's OWN pre-existing permission pair, deliberately separate — see
  // `data-lifecycle-permissions.ts`'s header) is a genuine maker/checker
  // conflict, not contrived. `identity_access.business_scope_exceptions.approve`
  // exists in this base (sql/030), so the exception policy is portable as-is.
  sodRules: [
    {
      ruleKey: "data_lifecycle.legal_hold_maker_checker",
      ownerModuleKey: "data_lifecycle",
      description:
        "A subject who can CREATE a legal hold must not also be able to RELEASE one — maker/checker over data-protection holds. Global-within-tenant: holding both permissions anywhere in the tenant is itself the conflict (a legal hold has no per-scope narrowing today).",
      conflictingPermissionKeys: [
        "data_lifecycle.legal_hold.create",
        "data_lifecycle.legal_hold.release"
      ],
      scopeApplicability: "global_within_tenant",
      severity: "critical",
      exceptionPolicy: {
        allowed: true,
        requiresApprovalPermission:
          "identity_access.business_scope_exceptions.approve",
        maxDurationDays: 14
      }
    }
  ]
});

export { DATA_LIFECYCLE_PERMISSIONS };
