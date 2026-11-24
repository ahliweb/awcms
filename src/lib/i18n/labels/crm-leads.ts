/**
 * Translated labels for the closed vocabularies of the lead pipeline screens
 * (Issue #1166, ADR-0153): stage category, source kind, transition kind,
 * edge guard, conversion mode and lead status.
 *
 * Rendered on three screens, so one shared helper (`docs/awcms/14_ui_ux_design_
 * system.md` "No raw enums"). Each value is a database token, not English
 * prose, so `t()` cannot translate it in place; the raw token stays in a
 * `data-*` attribute for tests and CSS. An unrecognised value falls back to the
 * raw string, never a crash or a blank cell.
 */
import type { Translator } from "../catalog";

type T = Translator["t"];

export type LeadTone = "success" | "warning" | "danger" | "info" | "neutral";

const CATEGORY_TONE: Record<string, LeadTone> = {
  new: "info",
  working: "info",
  qualified: "success",
  converted: "success",
  lost: "danger",
  disqualified: "neutral"
};

export function stageCategoryLabel(t: T, category: string): string {
  switch (category) {
    case "new":
      return t("New");
    case "working":
      return t("Working");
    case "qualified":
      return t("Qualified");
    case "converted":
      return t("Converted");
    case "lost":
      return t("Lost");
    case "disqualified":
      return t("Disqualified");
    default:
      return category;
  }
}

export function stageCategoryTone(category: string): LeadTone {
  return CATEGORY_TONE[category] ?? "neutral";
}

export function leadSourceKindLabel(t: T, kind: string | null): string {
  switch (kind) {
    case "website_form":
      return t("Website form");
    case "inbound_message":
      return t("Inbound message");
    case "import":
      return t("Import");
    case "manual":
      return t("Entered by hand");
    case "api":
      return t("API");
    case null:
      return t("Not recorded");
    default:
      return kind;
  }
}

export function leadTransitionKindLabel(t: T, kind: string): string {
  switch (kind) {
    case "created":
      return t("Created");
    case "moved":
      return t("Moved");
    case "stage_migrated":
      return t("Moved by a catalogue change");
    case "converted":
      return t("Converted");
    case "conversion_reversed":
      return t("Conversion reversed");
    case "merged_away":
      return t("Merged into another lead");
    case "merge_reverted":
      return t("Merge undone");
    default:
      return kind;
  }
}

export function transitionGuardLabel(t: T, guard: string): string {
  switch (guard) {
    case "owner_assigned":
      return t("needs an owner");
    case "contact_point_present":
      return t("needs a contact point");
    case "reason_required":
      return t("needs a reason");
    default:
      return guard;
  }
}

export function conversionModeLabel(t: T, mode: string): string {
  switch (mode) {
    case "authority_confirmed":
      return t("Confirmed by the customer authority");
    case "authority_unconfirmed":
      return t("Recorded by hand, not confirmed");
    default:
      return mode;
  }
}

export function leadStatusLabel(t: T, status: string): string {
  switch (status) {
    case "open":
      return t("Open");
    case "merged":
      return t("Merged into another lead");
    case "anonymized":
      return t("Anonymised");
    default:
      return status;
  }
}

export function legalBasisLabel(t: T, basis: string): string {
  switch (basis) {
    case "consent":
      return t("Consent");
    case "contract_steps":
      return t("Steps towards a contract");
    case "legitimate_interest":
      return t("Legitimate interest");
    case "not_stated":
      return t("Not stated");
    default:
      return basis;
  }
}

export function contactPointKindLabel(t: T, kind: string): string {
  switch (kind) {
    case "email":
      return t("Email");
    case "phone":
      return t("Phone");
    case "platform_id":
      return t("Messaging account");
    default:
      return kind;
  }
}

/**
 * The sentence each refusal of the lead WRITE endpoints gets on the write
 * screens (Issue #1166), keyed by the API's error code. Translated on the
 * server and carried to the page script in a `data-messages` attribute: a
 * client script cannot translate. A code not listed shows `fallback`, never
 * the server's own text (no internal detail reaches the screen).
 */
export function crmLeadWriteMessages(t: T): Record<string, string> {
  return {
    VALIDATION_ERROR: t(
      "Some of the details are not valid. Check the form and try again."
    ),
    VERSION_CONFLICT: t(
      "Someone else changed this lead. Reload the page and try again."
    ),
    PIPELINE_NOT_FOUND: t("That pipeline no longer exists."),
    PIPELINE_ARCHIVED: t("That pipeline is archived and takes no new leads."),
    OWNER_NOT_FOUND: t("You cannot be made the owner of this lead."),
    CONTACT_POINT_NOT_FOUND: t(
      "A contact point to revoke is no longer part of this lead. Reload the page and try again."
    ),
    LEAD_NOT_OPEN: t("This lead can no longer be changed."),
    LEAD_ALREADY_DELETED: t("This lead is already deleted."),
    LEAD_NOT_DELETED: t("This lead is not deleted."),
    PIPELINE_MISMATCH: t("Only leads of the same pipeline can be merged."),
    ABSORBED_LEAD_CONVERTED: t("A converted lead cannot be merged away."),
    ABSORBED_LEAD_HAS_MERGES: t(
      "The lead to merge away already has another lead merged into it."
    ),
    ALREADY_REVERTED: t("This merge was already undone."),
    UNDO_WINDOW_CLOSED: t("The time to undo this merge has passed."),
    ABSORBED_LEAD_CHANGED: t(
      "The merged lead is no longer merged into the survivor."
    ),
    EVIDENCE_REUSED: t(
      "This evidence reference is already recorded for something else."
    ),
    ALREADY_CONVERTED: t("This lead is already converted."),
    ALREADY_REVERSED: t("This conversion was already reversed."),
    NO_CONVERTED_STAGE: t("The pipeline has no converted stage."),
    STAGE_NOT_FOUND: t(
      "That stage is no longer part of the pipeline. Reload the page and try again."
    ),
    TRANSITION_NOT_ALLOWED: t(
      "The pipeline does not allow converting from this stage."
    ),
    GUARD_NOT_MET: t(
      "This step needs something the lead does not have yet (an owner, a contact point or a reason)."
    ),
    CONVERSION_MODE_MISMATCH: t(
      "That kind of conversion is not allowed for your access."
    ),
    CRM_LEADS_TENANT_DISABLED: t(
      "The lead pipeline is switched off for this tenant."
    ),
    RESOURCE_NOT_FOUND: t("That lead is no longer available."),
    ACCESS_DENIED: t("You do not have permission to do that."),
    IDEMPOTENCY_CONFLICT: t(
      "This request was already used for something else. Reload the page and try again."
    ),
    RATE_LIMITED: t("Too many requests. Wait a moment and try again."),
    INTERACTIVE_SESSION_REQUIRED: t(
      "This needs a signed-in person; a machine credential cannot do it."
    ),
    fallback: t("Could not save the change. Please try again.")
  };
}
