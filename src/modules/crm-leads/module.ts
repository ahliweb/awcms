import { defineModule } from "../_shared/module-contract";
import type { SubjectDataDescriptor } from "../_shared/module-contract";
import {
  CONVERSIONS_ACTIVITY_CODE,
  CRM_LEADS_EVENT_TYPES,
  CRM_LEADS_MODULE_KEY,
  LEADS_ACTIVITY_CODE,
  MANUAL_CONVERSIONS_ACTIVITY_CODE,
  MERGES_ACTIVITY_CODE,
  PIPELINES_ACTIVITY_CODE,
  STAGES_ACTIVITY_CODE
} from "./domain/crm-leads-constants";

function stamps(input: {
  key: string;
  tableName: string;
  columns: string[];
  rationale: string;
  redactedColumns?: string[];
}): SubjectDataDescriptor {
  return {
    key: `${CRM_LEADS_MODULE_KEY}.${input.key}`,
    tableName: input.tableName,
    ownerModuleKey: CRM_LEADS_MODULE_KEY,
    subjectColumns: input.columns.map((column) => ({
      column,
      references: "tenant_user" as const
    })),
    exportable: false,
    erasure: "severed_with_subject_row",
    rationale: input.rationale,
    ...(input.redactedColumns ? { redactedColumns: input.redactedColumns } : {})
  };
}

/** The lead's own person has no tenant membership; the controller erases it through the anonymize endpoint. */
const LEAD_PERSON_NOTE =
  "The lead's own person (a prospect) is not a tenant member, so ADR-0094's per-member registry cannot reach them; a controller answers their request through POST /api/v1/crm-leads/leads/{id}/anonymize (found by an exact keyed-hash lookup), which erases the name, every contact point and every free-text reason and note while keeping the non-personal funnel facts (ADR-0153 section 7).";

/**
 * `crm_leads` — the reusable lead/prospect pipeline (Issue #1166, ADR-0153).
 *
 * A PRE-CUSTOMER context. It owns the lead and nothing else: no customer (N1),
 * no identity (N2), no consent (N3), no conversation or inbox (N4), no workflow
 * engine or messaging (N5), no coupling to a downstream product (N6).
 *
 * ## Status
 *
 * `experimental` and OFF at three levels (ADR-0153 section 1): the deployment
 * switch `CRM_LEADS_ENABLED`, Module Management's per-tenant enable, and the
 * module's own tenant switch (default off). It declares no `navigation` entry:
 * the admin screen is a recorded follow-up (a nav entry without a page is a
 * permanent 404), and every route is default-deny.
 */
export const crmLeadsModule = defineModule({
  key: CRM_LEADS_MODULE_KEY,
  name: "CRM Leads",
  version: "0.1.0",
  status: "experimental",
  description:
    "The reusable lead/prospect pipeline (Issue #1166, ADR-0153): a PRE-CUSTOMER context that never owns the customer, the identity or the consent. A tenant defines pipelines whose stage catalog is VERSIONED (a published revision, its stages and its allowed edges are immutable by database trigger; changing a pipeline publishes a new revision and moves leads out of removed stages only through an explicit, audited stage migration), with a CLOSED platform category per stage (new, working, qualified, converted, lost, disqualified) so reports never depend on tenant stage names, and declarative edge guards from a closed set (owner assigned, contact point present, reason required; no expression language). Lead intake (manual, import, api) is idempotent on the source key (kind, channel account, external event id) as well as on the Idempotency-Key; the first source touch is immutable and later touches are appended. Contact points are ciphertext plus a per-tenant, per-kind keyed hash plus a masked form; identity CANDIDATES are exact hash matches inside one tenant and never a merge; a merge is human-verified, concurrency-checked, idempotent, audited and undoable within the tenant's window. Every stage change is an append-only transition row naming the revision it happened under, decided under a row lock with optimistic concurrency. A conversion is RECORDED from the customer authority's confirmation (an opaque external customer reference, never a customer) or a flagged manual path, and reversed by event, never by editing history. Outbox events carry opaque ids and attribution references only. Soft delete, restore and anonymising erasure that keeps funnel counts. A CrmLeadPort lets a downstream authority read lead state and confirm or reverse a conversion.",
  dependencies: [
    "tenant_admin",
    "identity_access",
    "logging",
    "module_management",
    // The outbox: every lead write and its event commit in one transaction.
    "domain_event_runtime",
    // `normalizeIdentifierValue` / `maskIdentifierValue` only: the SAME
    // normalizer the identity module uses. No profile is ever written (N2).
    "profile_identity"
  ],
  type: "domain",
  api: {
    openApiPath: "openapi/modules/crm-leads.openapi.yaml",
    basePath: "/api/v1/crm-leads"
  },
  events: {
    asyncApiPath: "asyncapi/awcms-domain-events.asyncapi.yaml",
    publishes: [...CRM_LEADS_EVENT_TYPES]
  },
  capabilities: {
    provides: ["crm_lead"]
  },
  permissions: [
    {
      activityCode: LEADS_ACTIVITY_CODE,
      action: "read",
      description:
        "Read leads with MASKED contact points, their stage, source touches, transition history, assignments, merges and conversions, the pipelines and the tenant switch"
    },
    {
      activityCode: LEADS_ACTIVITY_CODE,
      action: "create",
      description:
        "Create a lead through the manual, import or API intake path (idempotent on the source key)"
    },
    {
      activityCode: LEADS_ACTIVITY_CODE,
      action: "update",
      description:
        "Change a lead's display name, add a contact point or a later source touch (optimistic concurrency)"
    },
    {
      activityCode: LEADS_ACTIVITY_CODE,
      action: "assign",
      description:
        "Assign or unassign the owner of a lead (high-risk, audited at warning)"
    },
    {
      activityCode: LEADS_ACTIVITY_CODE,
      action: "delete",
      description:
        "Soft-delete a lead, or anonymise it on a data subject's erasure request; funnel counts are kept (high-risk, audited at warning)"
    },
    {
      activityCode: LEADS_ACTIVITY_CODE,
      action: "restore",
      description: "Restore a soft-deleted lead (high-risk, audited at warning)"
    },
    {
      activityCode: STAGES_ACTIVITY_CODE,
      action: "update",
      description:
        "Move a lead along an allowed edge of its pipeline; the edge guard is re-checked in the transaction (audited)"
    },
    {
      activityCode: MERGES_ACTIVITY_CODE,
      action: "manage",
      description:
        "Merge two leads of the same pipeline after human review, and roll a merge back within the undo window (high-risk, audited at warning)"
    },
    {
      activityCode: PIPELINES_ACTIVITY_CODE,
      action: "configure",
      description:
        "Create a pipeline, publish a new immutable revision of its stage catalog (moving leads out of removed stages explicitly), and switch the module on or off for the tenant (high-risk, audited at warning)"
    },
    {
      activityCode: CONVERSIONS_ACTIVITY_CODE,
      action: "approve",
      description:
        "Record a conversion confirmed by the customer authority with its opaque customer reference, and record its reversal (high-risk, audited at warning)"
    },
    {
      activityCode: MANUAL_CONVERSIONS_ACTIVITY_CODE,
      action: "create",
      description:
        "Record a MANUAL conversion with no confirming authority; stored as authority_unconfirmed and reported separately (audited at warning)"
    }
  ],
  subjectData: [
    stamps({
      key: "settings",
      tableName: "awcms_crm_leads_settings",
      columns: ["updated_by"],
      rationale:
        "The tenant switch and merge-undo window. The only person-shaped column is the stamp of the administrator who last changed them."
    }),
    stamps({
      key: "pipelines",
      tableName: "awcms_crm_pipelines",
      columns: ["created_by", "updated_by"],
      rationale:
        "A tenant's funnel definition. It describes a process, not a person; its only person-shaped columns are administrator stamps."
    }),
    stamps({
      key: "pipeline_revisions",
      tableName: "awcms_crm_pipeline_revisions",
      columns: ["published_by"],
      rationale:
        "An immutable published version of a stage catalog. The only person-shaped column is the stamp of the administrator who published it."
    }),
    stamps({
      key: "leads",
      tableName: "awcms_crm_leads",
      columns: [
        "owner_tenant_user_id",
        "created_by",
        "updated_by",
        "deleted_by"
      ],
      rationale: `A pre-customer lead. Its tenant-user columns are the owner and the staff stamps. ${LEAD_PERSON_NOTE}`,
      redactedColumns: ["display_name"]
    }),
    stamps({
      key: "lead_contact_points",
      tableName: "awcms_crm_lead_contact_points",
      columns: ["created_by"],
      rationale: `A lead's email, phone or platform id as ciphertext, keyed hash and masked form. The only tenant-user column is the stamp of who added it. ${LEAD_PERSON_NOTE}`,
      redactedColumns: ["value_encrypted", "value_hash", "value_masked"]
    }),
    stamps({
      key: "lead_source_touches",
      tableName: "awcms_crm_lead_source_touches",
      columns: ["recorded_by"],
      rationale:
        "Source attribution of a lead (kind, opaque account and campaign references, bounded UTM codes, the stated legal basis). No identifier of the prospect; the only tenant-user column is the recorder's stamp. Kept on erasure: it is a non-personal funnel fact."
    }),
    stamps({
      key: "lead_transitions",
      tableName: "awcms_crm_lead_transitions",
      columns: ["actor_tenant_user_id"],
      rationale: `The append-only stage history. The only tenant-user column is the actor's stamp; the free-text reason is erased on the prospect's erasure. ${LEAD_PERSON_NOTE}`,
      redactedColumns: ["reason"]
    }),
    stamps({
      key: "lead_assignments",
      tableName: "awcms_crm_lead_assignments",
      columns: [
        "from_owner_tenant_user_id",
        "to_owner_tenant_user_id",
        "assigned_by"
      ],
      rationale:
        "Who owned a lead and who changed it: staff stamps only, append-only."
    }),
    stamps({
      key: "lead_conversions",
      tableName: "awcms_crm_lead_conversions",
      columns: ["recorded_by", "reversed_by"],
      rationale: `A conversion fact with an opaque customer reference and evidence reference. The tenant-user columns are staff stamps; the free-text note is erased on the prospect's erasure. ${LEAD_PERSON_NOTE}`,
      redactedColumns: ["note"]
    }),
    stamps({
      key: "lead_merges",
      tableName: "awcms_crm_lead_merges",
      columns: ["merged_by", "reverted_by"],
      rationale: `A merge record for undo, with a non-personal snapshot (ids, stage, version). The tenant-user columns are the reviewer stamps; the free-text note is erased on the prospect's erasure. ${LEAD_PERSON_NOTE}`,
      redactedColumns: ["note"]
    })
  ]
});
