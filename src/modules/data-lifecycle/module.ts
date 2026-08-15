import { defineModule } from "../_shared/module-contract";
import { DATA_LIFECYCLE_PERMISSIONS } from "./domain/data-lifecycle-permissions";
import { SUBJECT_ERASURE_MAKER_CHECKER_RULE } from "./domain/subject-request-permissions";

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
    },
    // Its own entry rather than a panel on `/admin/data-lifecycle`, and gated on
    // its own key: retention policy and answering a named person's legal request
    // are different jobs done by different people, and an operator who tunes
    // purge windows has no business holding the export authority.
    {
      labelKey: "admin.layout.nav_subject_requests",
      path: "/admin/subject-requests",
      order: 73,
      requiredPermission: "data_lifecycle.subject_request.read"
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
    },
    // ADR-0094 gelombang 2 (#557). Four keys, and every split is load-bearing —
    // see `domain/subject-request-permissions.ts` for why read, export, and the
    // two halves of erasure are not fewer.
    {
      activityCode: "subject_request",
      action: "read",
      description: "Read the subject-request log and the pending-erasure inbox"
    },
    {
      activityCode: "subject_request",
      action: "export",
      description:
        "Export everything this tenant holds about a data subject (a DISCLOSURE)"
    },
    {
      activityCode: "subject_erasure",
      action: "create",
      description:
        "Request erasure of a data subject (maker half — never executes it)"
    },
    {
      activityCode: "subject_erasure",
      action: "approve",
      description:
        "Approve and execute a pending erasure request (checker half)"
    }
  ],
  jobs: [
    {
      command: "bun run data-lifecycle:archive-purge",
      schedule: {
        mode: "cron",
        expression: "30 3 * * *",
        backlog: "review-before-first-run",
        backlogNote:
          "Archives and purges per the lifecycle registry. The first pass covers every row that has been eligible since the registry landed. Dry-run and read the per-descriptor counts."
      },
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
      key: "data_lifecycle.subject_requests",
      tableName: "awcms_subject_requests",
      ownerModuleKey: "data_lifecycle",
      // Three ways to appear, and the reason all three are named is the point
      // of the table: it records what was done ABOUT a person, BY a person,
      // and decided BY somebody else again.
      subjectColumns: [
        { column: "subject_tenant_user_id", references: "tenant_user" },
        { column: "requested_by", references: "tenant_user" },
        { column: "decided_by", references: "tenant_user" }
      ],
      exportable: true,
      // The one answer that would be self-defeating any other way: this table
      // is the evidence that a subject request was made, by whom, approved by
      // whom, and what it wrote. An erasure that took its own record with it
      // would destroy the proof that the erasure happened — ADR-0094 Decision
      // 2's argument, applied to the feature itself.
      erasure: "retain_under_obligation",
      rationale:
        "Every export and erasure this tenant performed, including the ones about this person and the ones they requested or decided. Exported because a subject is entitled to know that their data was disclosed and on what ground; retained under obligation because it is the accountability record for an irreversible act, and the row proving an erasure occurred must outlive the erasure."
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
      key: "data_lifecycle.subject_requests",
      tableName: "awcms_subject_requests",
      ownerModuleKey: "data_lifecycle",
      scope: "tenant",
      cursorColumn: "created_at",
      // Not `operational_queue` like this module's other tables. A subject
      // request is the accountability record for a disclosure or an
      // irreversible erasure, which is the same evidentiary role
      // `awcms_audit_events` plays — and its floor is set accordingly.
      retentionClass: "audit_security",
      // The floor is high ON PURPOSE. A supervisory authority asking "show me
      // every erasure you performed" two years later must not be told the
      // record aged out; and the shortest retention an operator can configure
      // is the one an operator under pressure will configure.
      retentionMinDays: 730,
      retentionMaxDays: 3650,
      defaultRetentionDays: 2555,
      partition: {
        eligible: false,
        rationale:
          "One row per subject request — a volume measured in tens per tenant per year, orders of magnitude below the audit/analytics tables partitioning exists for."
      },
      archive: {
        archivable: true,
        format: "jsonl",
        port: "local_offline",
        rationale:
          "Unlike this module's run history, these rows ARE a business record: they evidence that a data-protection obligation was discharged, by whom, and on what stated ground. Archiving them before purge is exactly the ISO 27001 evidence case the archive port exists for."
      },
      deletion: {
        mode: "hard_delete",
        rationale:
          "There is nothing to anonymize: the row's identifying columns are tenant-user FKs whose targets are themselves anonymised by any erasure that touches them, so the row is already pseudonymous long before its retention expires. Past that horizon the record has served its accountability purpose and keeping it is the privacy harm."
      },
      legalHold: {
        applicable: true,
        precedence: "overrides_retention"
      },
      requiredIndexes: [
        {
          columns: ["tenant_id", "created_at"],
          purpose:
            "awcms_subject_requests_tenant_created_idx (sql/125) — the engine's own cursor path (WHERE tenant_id = ? AND created_at < ?), added by this table's migration for it rather than reused from a lookup index that happens to fit."
        }
      ],
      batchLimit: 1000,
      backupRestoreNotes:
        "Restoring this table without the tables an erasure wrote to would produce a ledger claiming erasures that the restored data contradicts. Restore it together with the identity/profile tables, or accept that its rows describe a state the database is no longer in.",
      executionMode: "generic"
    },
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
    },
    {
      ruleKey: SUBJECT_ERASURE_MAKER_CHECKER_RULE,
      ownerModuleKey: "data_lifecycle",
      description:
        "ADR-0094 Decision 3 — a subject who can REQUEST an erasure must not also be able to APPROVE one. Erasure is irreversible and the request names a person by id, so one operator holding both halves can erase anybody in the tenant with no second pair of eyes. Global-within-tenant: holding both anywhere in the tenant is the conflict, because a request carries no scope to narrow.",
      conflictingPermissionKeys: [
        "data_lifecycle.subject_erasure.create",
        "data_lifecycle.subject_erasure.approve"
      ],
      scopeApplicability: "global_within_tenant",
      severity: "critical",
      exceptionPolicy: {
        // NOT `allowed: false`, even though that reads stricter. A rule that
        // forbids exceptions has no pending row for a checker to see, so the
        // only way past it in a real incident is an out-of-band grant change
        // nobody reviews. An exception is time-boxed, attributable, and lands
        // in the #545 inbox — seven days rather than the legal hold's fourteen,
        // because this one hands somebody the ability to erase unilaterally.
        allowed: true,
        requiresApprovalPermission:
          "identity_access.business_scope_exceptions.approve",
        maxDurationDays: 7
      }
    }
  ]
});

export { DATA_LIFECYCLE_PERMISSIONS };
