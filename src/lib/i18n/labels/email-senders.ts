/**
 * Translated labels for the closed vocabularies of `/admin/email-senders`
 * (Issue #1162): sender verification, account connection, credit reading,
 * freshness, the dispatcher's hold reasons, and why "make default" is withheld.
 *
 * Every value here is a code from the application function, never prose, so
 * `t()` cannot translate it in place (`docs/awcms/14_ui_ux_design_system.md`
 * "No raw enums"). An unrecognised value falls back to the raw token, never a
 * crash or a blank cell. Shared with the page-contract test by exporting the
 * tone functions, which are the part a test can pin without rendering.
 */
import type { Translator } from "../catalog";
import type { StatusTone } from "./channel-accounts";

type T = Translator["t"];

export function senderVerificationLabel(t: T, value: string): string {
  switch (value) {
    case "verified":
      return t("Verified by the provider");
    case "unverified":
      return t("Not verified by the provider");
    case "stale":
      return t("Check out of date");
    case "failing":
      return t("Verification failing");
    case "unknown":
      return t("Never checked");
    default:
      return value;
  }
}

export function senderVerificationTone(value: string): StatusTone {
  switch (value) {
    case "verified":
      return "success";
    case "unverified":
    case "stale":
      return "warning";
    case "failing":
      return "danger";
    default:
      return "neutral";
  }
}

export function accountConnectionLabel(t: T, value: string): string {
  switch (value) {
    case "connected":
      return t("Connected");
    case "credential_rejected":
      return t("Credential rejected by the provider");
    case "credit_depleted":
      return t("Out of credit");
    case "unverified_response":
      return t("Provider answer not recognised");
    case "stale":
      return t("Check out of date");
    case "unknown":
      return t("Never checked");
    case "disconnected":
      return t("Disconnected");
    case "pending":
      return t("Pending verification");
    default:
      return value;
  }
}

export function accountConnectionTone(value: string): StatusTone {
  switch (value) {
    case "connected":
      return "success";
    case "credit_depleted":
    case "stale":
    case "unverified_response":
      return "warning";
    case "credential_rejected":
    case "disconnected":
      return "danger";
    case "pending":
      return "info";
    default:
      return "neutral";
  }
}

export function freshnessLabel(
  t: T,
  freshness: string,
  windowMinutes: number
): string {
  switch (freshness) {
    case "fresh":
      return t("Within the {minutes}-minute window", {
        minutes: windowMinutes
      });
    case "stale":
      return t("Older than the {minutes}-minute window", {
        minutes: windowMinutes
      });
    case "unknown":
      return t("Never checked");
    default:
      return freshness;
  }
}

export function creditToneFor(kind: string): StatusTone {
  switch (kind) {
    case "ok":
      return "success";
    case "stale":
      return "warning";
    case "insufficient":
      return "danger";
    default:
      return "neutral";
  }
}

export function creditLabel(
  t: T,
  reading: { kind: string; balance?: number },
  creditFloor: number
): string {
  const balance = reading.balance;

  switch (reading.kind) {
    case "ok":
      return t("{balance} credits", { balance: String(balance) });
    case "stale":
      return t("{balance} credits (out of date)", { balance: String(balance) });
    case "insufficient":
      return t("{balance} credits, below the {floor} needed to send", {
        balance: String(balance),
        floor: creditFloor
      });
    default:
      return t("Not known");
  }
}

export function senderHoldLabel(t: T, hold: string): string {
  switch (hold) {
    case "SENDER_VERIFICATION_UNKNOWN":
      return t("Held: sender verification is unknown");
    case "SENDER_VERIFICATION_STALE":
      return t("Held: sender verification is out of date");
    case "SENDER_UNVERIFIED":
      return t("Held: the provider does not list this sender as verified");
    case "CREDIT_UNKNOWN":
      return t("Held: the account credit is unknown");
    case "CREDIT_STALE":
      return t("Held: the account credit is out of date");
    case "CREDIT_BELOW_THRESHOLD":
      return t("Held: the account credit is too low");
    default:
      return hold;
  }
}

export function senderUnusableLabel(t: T, reason: string): string {
  switch (reason) {
    case "STATUS_PENDING":
      return t("Not connected yet");
    case "STATUS_DEGRADED":
    case "ACCOUNT_DEGRADED":
      return t("Degraded");
    case "STATUS_REVOKED":
    case "ACCOUNT_REVOKED":
      return t("Disconnected");
    case "STATUS_DISABLED":
    case "ACCOUNT_DISABLED":
      return t("Disabled");
    case "ACCOUNT_PENDING":
      return t("The Mailketing account is not connected yet");
    case "CREDENTIAL_UNAVAILABLE":
    case "SECRET_STORE_UNAVAILABLE":
      return t("The account credential cannot be used right now");
    case "CHANNEL_ACCOUNTS_DISABLED":
    case "CHANNEL_ACCOUNTS_UNAVAILABLE":
      return t("Channel accounts are not available");
    case "CAPABILITY_DENIED":
      return t("Sending email is not granted to this sender");
    default:
      return t("Cannot send right now");
  }
}

export function defaultWithheldLabel(t: T, reason: string): string {
  switch (reason) {
    case "not_permitted":
      return t("You may view senders but not change the default.");
    case "routing_disabled":
      return t("Tenant senders are switched off on this deployment.");
    case "not_connected":
      return t("Only a connected sender can be the default.");
    case "not_ready":
      return t(
        "Only a sender that may send right now can be the default. Run the sender verification first."
      );
    case "not_yours":
      return t("You are not assigned to operate this sender.");
    case "scope_not_held":
      return t("You do not hold this sender's business scope.");
    default:
      return t("This sender cannot be made the default.");
  }
}
