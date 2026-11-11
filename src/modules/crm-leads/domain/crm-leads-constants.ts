/**
 * Closed vocabularies and fixed names for `crm_leads` (Issue #1166, ADR-0153).
 * Every list here is closed ON PURPOSE and is also a CHECK constraint in
 * `sql/342`, so the database refuses what the validator should already have.
 *
 * There is deliberately NO product vocabulary here (ADR-0153 L2, test T-L1):
 * stage names and keys, pipeline codes and milestones are tenant data.
 *
 * Pure module: no database, no I/O.
 */

export const CRM_LEADS_MODULE_KEY = "crm_leads";

export const LEADS_ACTIVITY_CODE = "leads";
export const STAGES_ACTIVITY_CODE = "stages";
export const MERGES_ACTIVITY_CODE = "merges";
export const PIPELINES_ACTIVITY_CODE = "pipelines";
export const CONVERSIONS_ACTIVITY_CODE = "conversions";
export const MANUAL_CONVERSIONS_ACTIVITY_CODE = "manual_conversions";

/**
 * The route guards. ADR-0153's working permission names map onto the shared,
 * closed `AccessAction` vocabulary through the activity code (`sql/343`).
 * Written out literally: the enforcement gate reads these object literals.
 */
export const CRM_LEADS_GUARDS = {
  readLeads: {
    moduleKey: CRM_LEADS_MODULE_KEY,
    activityCode: LEADS_ACTIVITY_CODE,
    action: "read" as const
  },
  createLeads: {
    moduleKey: CRM_LEADS_MODULE_KEY,
    activityCode: LEADS_ACTIVITY_CODE,
    action: "create" as const
  },
  updateLeads: {
    moduleKey: CRM_LEADS_MODULE_KEY,
    activityCode: LEADS_ACTIVITY_CODE,
    action: "update" as const
  },
  assignLeads: {
    moduleKey: CRM_LEADS_MODULE_KEY,
    activityCode: LEADS_ACTIVITY_CODE,
    action: "assign" as const
  },
  deleteLeads: {
    moduleKey: CRM_LEADS_MODULE_KEY,
    activityCode: LEADS_ACTIVITY_CODE,
    action: "delete" as const
  },
  restoreLeads: {
    moduleKey: CRM_LEADS_MODULE_KEY,
    activityCode: LEADS_ACTIVITY_CODE,
    action: "restore" as const
  },
  moveLeads: {
    moduleKey: CRM_LEADS_MODULE_KEY,
    activityCode: STAGES_ACTIVITY_CODE,
    action: "update" as const
  },
  manageMerges: {
    moduleKey: CRM_LEADS_MODULE_KEY,
    activityCode: MERGES_ACTIVITY_CODE,
    action: "manage" as const
  },
  configurePipelines: {
    moduleKey: CRM_LEADS_MODULE_KEY,
    activityCode: PIPELINES_ACTIVITY_CODE,
    action: "configure" as const
  },
  confirmConversions: {
    moduleKey: CRM_LEADS_MODULE_KEY,
    activityCode: CONVERSIONS_ACTIVITY_CODE,
    action: "approve" as const
  },
  manualConversions: {
    moduleKey: CRM_LEADS_MODULE_KEY,
    activityCode: MANUAL_CONVERSIONS_ACTIVITY_CODE,
    action: "create" as const
  }
} as const;

/** The closed platform list (ADR-0153 section 3). Reports use these, never stage names. */
export const STAGE_CATEGORIES = [
  "new",
  "working",
  "qualified",
  "converted",
  "lost",
  "disqualified"
] as const;
export type StageCategory = (typeof STAGE_CATEGORIES)[number];

/** Terminal-looking categories that announce `lead.lost` when entered. */
export const LOST_CATEGORIES: readonly StageCategory[] = [
  "lost",
  "disqualified"
];

/**
 * The closed set of declarative guard predicates an edge may carry (ADR-0153
 * L3). No expression language, no script, no callback.
 *
 *   owner_assigned         the lead has an owner
 *   contact_point_present  the lead has at least one live contact point
 *   reason_required        the move carries a reason
 */
export const TRANSITION_GUARDS = [
  "owner_assigned",
  "contact_point_present",
  "reason_required"
] as const;
export type TransitionGuard = (typeof TRANSITION_GUARDS)[number];

/** Intake paths (ADR-0153 section 4). */
export const SOURCE_KINDS = [
  "website_form",
  "inbound_message",
  "import",
  "manual",
  "api"
] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

/**
 * The source kinds THIS slice accepts through the HTTP intake. `website_form`
 * arrives only through the `website_engagement` event subscription and
 * `inbound_message` only through an explicit tenant rule (ADR-0153 section 4,
 * O8); neither consumer exists yet, so both are refused rather than accepted
 * from a caller who merely claims them.
 */
export const HTTP_INTAKE_SOURCE_KINDS = ["manual", "import", "api"] as const;
export type HttpIntakeSourceKind = (typeof HTTP_INTAKE_SOURCE_KINDS)[number];

/** Recorded, never decided (ADR-0153 section 7, O5). Never a consent grant. */
export const LEGAL_BASES = [
  "consent",
  "contract_steps",
  "legitimate_interest",
  "not_stated"
] as const;
export type LegalBasis = (typeof LEGAL_BASES)[number];

export const CONTACT_POINT_KINDS = ["email", "phone", "platform_id"] as const;
export type ContactPointKind = (typeof CONTACT_POINT_KINDS)[number];

export const LEAD_STATUSES = ["open", "merged", "anonymized"] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

export const TRANSITION_KINDS = [
  "created",
  "moved",
  "stage_migrated",
  "converted",
  "conversion_reversed",
  "merged_away",
  "merge_reverted"
] as const;
export type TransitionKind = (typeof TRANSITION_KINDS)[number];

export const CONVERSION_MODES = [
  "authority_confirmed",
  "authority_unconfirmed"
] as const;
export type ConversionMode = (typeof CONVERSION_MODES)[number];

/** Field-encryption purposes (AAD and hash domains). */
export const CONTACT_POINT_AAD_PURPOSE = "crm_leads.contact_point:v1";
/** Per tenant AND per kind (ADR-0153 section 5): an email hash never equals a phone hash. */
export function contactPointHashPurpose(
  kind: ContactPointKind,
  platform: string | null
): string {
  return kind === "platform_id"
    ? `crm_leads.contact_point.platform_id.${platform ?? ""}`
    : `crm_leads.contact_point.${kind}`;
}

/** Bounds (ADR-0153 section 7: closed, bounded standard fields). */
export const MAX_STAGES_PER_REVISION = 50;
export const MAX_TRANSITIONS_PER_REVISION = 400;
export const MAX_CONTACT_POINTS_PER_REQUEST = 10;
export const MAX_REASON_LENGTH = 500;
export const MAX_NOTE_LENGTH = 1000;
export const MAX_DISPLAY_NAME_LENGTH = 120;
export const CRM_LEADS_BODY_LIMIT_BYTES = 32 * 1024;
export const MAX_CANDIDATES = 50;

/** Event types (registered in `domain-event-runtime`, declared in AsyncAPI). */
export const CRM_LEADS_EVENT_VERSION = "1.0";
export const CRM_LEAD_AGGREGATE_TYPE = "crm_leads.lead";
export const CRM_LEAD_CREATED_EVENT_TYPE = "awcms.crm_leads.lead.created";
export const CRM_LEAD_STAGE_CHANGED_EVENT_TYPE =
  "awcms.crm_leads.lead.stage_changed";
export const CRM_LEAD_ASSIGNED_EVENT_TYPE = "awcms.crm_leads.lead.assigned";
export const CRM_LEAD_MERGED_EVENT_TYPE = "awcms.crm_leads.lead.merged";
export const CRM_LEAD_MERGE_REVERTED_EVENT_TYPE =
  "awcms.crm_leads.lead.merge_reverted";
export const CRM_LEAD_CONVERTED_EVENT_TYPE = "awcms.crm_leads.lead.converted";
export const CRM_LEAD_CONVERSION_REVERSED_EVENT_TYPE =
  "awcms.crm_leads.lead.conversion_reversed";
export const CRM_LEAD_LOST_EVENT_TYPE = "awcms.crm_leads.lead.lost";

export const CRM_LEADS_EVENT_TYPES = [
  CRM_LEAD_CREATED_EVENT_TYPE,
  CRM_LEAD_STAGE_CHANGED_EVENT_TYPE,
  CRM_LEAD_ASSIGNED_EVENT_TYPE,
  CRM_LEAD_MERGED_EVENT_TYPE,
  CRM_LEAD_MERGE_REVERTED_EVENT_TYPE,
  CRM_LEAD_CONVERTED_EVENT_TYPE,
  CRM_LEAD_CONVERSION_REVERSED_EVENT_TYPE,
  CRM_LEAD_LOST_EVENT_TYPE
] as const;

/**
 * Every event carries a privacy class (ADR-0153 L6). The payload itself holds
 * opaque ids and attribution references only, so it is `pseudonymous`: it
 * identifies a lead to a holder of this module's tables, and nobody else.
 */
export const CRM_LEADS_EVENT_PRIVACY_CLASS = "pseudonymous" as const;

/** The deployment switch (ADR-0153 section 1: off at deployment level by default). */
export function isCrmLeadsEnabled(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return env.CRM_LEADS_ENABLED === "true";
}
