import { defineModule } from "../_shared/module-contract";
import { FORM_DRAFT_PERMISSIONS } from "./domain/form-draft-permissions";

/**
 * Single source of truth for this module's `dataLifecycle` descriptor key,
 * shared with `application/form-draft-purge.ts` so the purge function and the
 * registry entry a legal hold is created against can never drift apart. If
 * they drift, a hold is placed on one key while the purge checks another — the
 * hold silently fails open and data is deleted anyway.
 */
export const FORM_DRAFTS_LIFECYCLE_KEY = "form_drafts.form_drafts";

/**
 * `form_drafts` — ported from awcms-micro (Issue #484), the first Gelombang-1
 * row of `docs/awcms/absorb-awcms-micro-roadmap.md`.
 *
 * Net-new and additive: no existing module changes behaviour, the module DAG
 * stays acyclic (this depends only on `identity_access`), and no other module's
 * wizard writes to it yet. It is infrastructure a later multi-step form reaches
 * for, not a tenant-facing feature on its own.
 *
 * It nonetheless declares `navigation` now. The screen it points at,
 * `/admin/form-drafts`, is an OPS/JANITOR view — filter, inspect the payload
 * read-only, delete — NOT an authoring UI, so it is useful before any wizard
 * exists: without it the drafts a tenant accumulates are invisible outside the
 * JSON API, and the only way to clear a stuck one is the daily purge job. The
 * entry is gated on `form_drafts.draft.read`, the same triple the routes
 * enforce and `sql/063` seeds; a non-core entry without a
 * `requiredPermission` would be visible to everyone (and fails
 * `tests/admin-navigation-registry.test.ts`). No `group` is set — `form_drafts`
 * already has a `DEFAULT_MODULE_TYPE` placement (`system`), which wins.
 *
 * `type: "system"` — like `logging`/`data_lifecycle`, this is shared platform
 * mechanism rather than a business capability. A derived or website module owns
 * what a draft's payload MEANS; this module only owns that it is stored,
 * bounded, resumable, and eventually purged.
 *
 * Deliberately NOT ported alongside it: awcms-micro's wizard COMPONENT library
 * (`WizardStepper`/`WizardPanel`/`WizardActions`, `wizard-client.ts`). That is
 * the `src/components/ui/` Gelombang-0 row, still open, and this store is
 * usable without it — the API is what a wizard talks to, not the other way
 * round.
 */
export const formDraftsModule = defineModule({
  key: "form_drafts",
  name: "Form Drafts",
  version: "0.1.0",
  status: "active",
  description:
    "Generic, domain-agnostic server-side draft store for multi-step forms: create/read/update/submit/delete a tenant-scoped JSONB payload, size-bounded and denylist-validated against secret-shaped field names, with a two-phase expire-then-purge retention job. No domain logic — the module that created a draft owns what its payload means.",
  dependencies: ["identity_access"],
  type: "system",
  api: {
    openApiPath: "openapi/modules/form-drafts.openapi.yaml",
    basePath: "/api/v1/form-drafts"
  },
  navigation: [
    {
      labelKey: "admin.layout.nav_form_drafts",
      path: "/admin/form-drafts",
      // Sits with the other `system` screens, after `/admin/sidebar-menu` (33).
      order: 34,
      requiredPermission: "form_drafts.draft.read"
    }
  ],
  permissions: FORM_DRAFT_PERMISSIONS.map((permission) => ({
    activityCode: permission.activityCode,
    action: permission.action,
    description: permission.description
  })),
  jobs: [
    {
      command: "bun run form-drafts:purge",
      purpose:
        "Expire overdue draft rows, then physically delete expired/abandoned drafts past the retention cutoff, for every active tenant.",
      recommendedSchedule: "Daily via cron/systemd timer.",
      environmentNotes:
        "Pure database operation — no external network dependency.",
      safeInOfflineLan: true
    }
  ],
  /**
   * Registered as a `delegated` adopter for `data_lifecycle` (ADR-0037): that
   * engine's dry-run planner may READ this table for backlog visibility, but
   * the real, irreversible DELETE stays owned by `purgeExpiredFormDrafts`
   * here. Which is exactly why the legal-hold check lives in that function and
   * not in the engine — the engine never mutates this table, so a hold
   * enforced only there would not stop anything.
   */
  dataLifecycle: [
    {
      key: FORM_DRAFTS_LIFECYCLE_KEY,
      tableName: "awcms_form_drafts",
      ownerModuleKey: "form_drafts",
      scope: "tenant",
      cursorColumn: "created_at",
      retentionClass: "operational_queue",
      retentionMinDays: 1,
      retentionMaxDays: 365,
      defaultRetentionDays: 30,
      partition: {
        eligible: false,
        rationale:
          "Scratch wizard-progress data with a short (30d default) retention window and expected low-to-moderate volume relative to audit/analytics tables — partitioning is not justified without real volume evidence to the contrary."
      },
      archive: {
        archivable: false,
        rationale:
          "Draft payloads are in-progress user input scratch state, not a business record of lasting value — archiving before purge would preserve exactly the kind of ephemeral data this table's short retention window exists to let go of."
      },
      deletion: {
        mode: "status_transition_then_purge",
        rationale:
          "Matches expireOverdueFormDrafts (status -> 'expired') followed by purgeExpiredFormDrafts' physical DELETE exactly — a two-phase status transition then purge, not a direct hard delete."
      },
      legalHold: {
        applicable: true,
        precedence: "overrides_retention"
      },
      requiredIndexes: [
        {
          columns: ["tenant_id"],
          purpose:
            "awcms_form_drafts_tenant_idx (sql/062) — sufficient for this descriptor's dry-run count query; the authoritative purge query path is owned by form_drafts' own awcms_form_drafts_tenant_updated_idx (tenant_id, status, updated_at)."
        }
      ],
      batchLimit: 5000,
      backupRestoreNotes:
        "Included in ordinary full-database backup/restore; no standalone archive artifact exists (archive.archivable is false above) — by design, draft scratch state is not archived.",
      executionMode: "delegated",
      existingAdopter: {
        jobCommand: "bun run form-drafts:purge",
        purgeFunctionRef:
          "src/modules/form-drafts/application/form-draft-purge.ts#purgeExpiredFormDrafts",
        description:
          "Two-phase: expireOverdueFormDrafts transitions overdue drafts to status='expired', then purgeExpiredFormDrafts physically deletes expired/abandoned drafts past FORM_DRAFT_DEFAULT_RETENTION_DAYS (default 30d), refusing the batch when a legal hold covers this descriptor."
      }
    }
  ]
});
