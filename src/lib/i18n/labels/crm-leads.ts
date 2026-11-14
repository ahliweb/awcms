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
