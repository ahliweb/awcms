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
