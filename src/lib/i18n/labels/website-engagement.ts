/**
 * Translated labels for the closed vocabularies of the website engagement
 * screens (Issue #1153, ADR-0155): submission kind, interaction type,
 * submission and source status, challenge mode and outcome, consent purpose and
 * withdrawal reason.
 *
 * Rendered on three screens, so one shared helper ("No raw enums",
 * `docs/awcms/14_ui_ux_design_system.md`). Each value is a database token
 * (`whatsapp_click`), not English prose, so `t()` cannot translate it in place;
 * the raw token stays in a `data-*` attribute for tests and CSS. An
 * unrecognised value falls back to the raw string, never a crash or a blank
 * cell.
 */
import type { Translator } from "../catalog";

type T = Translator["t"];

export type EngagementTone =
  "success" | "warning" | "danger" | "info" | "neutral";

export function submissionKindLabel(t: T, kind: string): string {
  switch (kind) {
    case "contact":
      return t("Contact request");
    case "lead":
      return t("Lead");
    case "interaction":
      return t("Interaction");
    default:
      return kind;
  }
}

export function interactionTypeLabel(t: T, type: string): string {
  switch (type) {
    case "form_view":
      return t("Form viewed");
    case "form_start":
      return t("Form started");
    case "cta_click":
      return t("Call-to-action clicked");
    case "call_click":
      return t("Phone link clicked");
    case "whatsapp_click":
      return t("WhatsApp link clicked");
    case "map_click":
      return t("Map link clicked");
    case "download_click":
      return t("Download clicked");
    default:
      return type;
  }
}

export function submissionStatusLabel(t: T, status: string): string {
  switch (status) {
    case "received":
      return t("Received");
    case "withdrawn":
      return t("Withdrawn");
    default:
      return status;
  }
}

export function submissionStatusTone(status: string): EngagementTone {
  return status === "received" ? "success" : "neutral";
}

export function sourceStatusLabel(t: T, status: string): string {
  switch (status) {
    case "active":
      return t("Active");
    case "paused":
      return t("Paused");
    case "revoked":
      return t("Revoked");
    default:
      return status;
  }
}

export function sourceStatusTone(status: string): EngagementTone {
  return status === "active"
    ? "success"
    : status === "paused"
      ? "warning"
      : "danger";
}

export function challengeModeLabel(t: T, mode: string): string {
  switch (mode) {
    case "turnstile":
      return t("Turnstile challenge");
    case "none":
      return t("No challenge");
    default:
      return mode;
  }
}

export function challengeOutcomeLabel(t: T, outcome: string): string {
  switch (outcome) {
    case "turnstile_verified":
      return t("Challenge passed");
    case "not_required":
      return t("Challenge not run on this deployment");
    case "source_none":
      return t("Source has no challenge");
    default:
      return outcome;
  }
}

export function consentPurposeLabel(t: T, purpose: string): string {
  switch (purpose) {
    case "respond_to_inquiry":
      return t("Respond to the inquiry");
    case "marketing_follow_up":
      return t("Marketing follow-up");
    default:
      return purpose;
  }
}

export function withdrawalReasonLabel(t: T, reason: string): string {
  switch (reason) {
    case "data_subject_request":
      return t("Data subject request");
    case "consent_withdrawn":
      return t("Consent withdrawn");
    case "controller_decision":
      return t("Controller decision");
    default:
      return reason;
  }
}

export function originViaLabel(t: T, via: string): string {
  switch (via) {
    case "origin":
      return t("Origin header");
    case "referer":
      return t("Referer header");
    default:
      return via;
  }
}
