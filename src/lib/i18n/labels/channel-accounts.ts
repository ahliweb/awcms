/**
 * Translated labels for the closed vocabularies of the channel-account screens
 * (Issue #1154, ADR-0148 UP-08): account status, connection grant state, auth
 * mode, health state, capability evidence state and provider names.
 *
 * Rendered on TWO screens (`/admin/channel-accounts` and
 * `/admin/channel-accounts/[id]`), so one shared helper rather than a copy per
 * screen (`docs/awcms/14_ui_ux_design_system.md` "No raw enums"). Each value is
 * a database or matrix token (`pending_approval`) that is not English prose, so
 * `t()` cannot translate it in place; the raw token stays in a `data-*`
 * attribute for tests and CSS. An unrecognised value falls back to the raw
 * string, never a crash or a blank cell.
 *
 * Provider names are brand names; they are routed through `t()` anyway so a
 * locale may adapt them, and so the catalogue gate sees every string.
 */
import type { Translator } from "../catalog";

type T = Translator["t"];

export type StatusTone = "success" | "warning" | "danger" | "info" | "neutral";

const ACCOUNT_STATUS_TONE: Record<string, StatusTone> = {
  pending: "info",
  connected: "success",
  degraded: "warning",
  revoked: "danger",
  disabled: "neutral",
  deleted: "neutral"
};

export function channelAccountStatusLabel(t: T, status: string): string {
  switch (status) {
    case "pending":
      return t("Pending verification");
    case "connected":
      return t("Connected");
    case "degraded":
      return t("Degraded");
    case "revoked":
      return t("Disconnected");
    case "disabled":
      return t("Disabled");
    case "deleted":
      return t("Deleted");
    default:
      return status;
  }
}

export function channelAccountStatusTone(status: string): StatusTone {
  return ACCOUNT_STATUS_TONE[status] ?? "neutral";
}

const GRANT_STATE_TONE: Record<string, StatusTone> = {
  pending: "info",
  active: "success",
  expired: "warning",
  revoked: "danger",
  failed: "danger"
};

export function channelGrantStateLabel(t: T, state: string): string {
  switch (state) {
    case "pending":
      return t("Awaiting authorisation");
    case "active":
      return t("Active");
    case "expired":
      return t("Expired");
    case "revoked":
      return t("Revoked");
    case "failed":
      return t("Failed");
    default:
      return state;
  }
}

export function channelGrantStateTone(state: string): StatusTone {
  return GRANT_STATE_TONE[state] ?? "neutral";
}

export function channelAuthModeLabel(t: T, mode: string): string {
  switch (mode) {
    case "oauth2":
      return t("OAuth authorisation");
    case "api_token":
      return t("API token");
    case "bot_token":
      return t("Bot token");
    case "device_key":
      return t("Device key");
    default:
      return mode;
  }
}

const HEALTH_TONE: Record<string, StatusTone> = {
  ok: "success",
  degraded: "warning",
  failing: "danger",
  unknown: "neutral"
};

export function channelHealthStateLabel(t: T, state: string): string {
  switch (state) {
    case "ok":
      return t("Healthy");
    case "degraded":
      return t("Degraded");
    case "failing":
      return t("Failing");
    case "unknown":
      return t("Unknown");
    default:
      return state;
  }
}

export function channelHealthTone(state: string): StatusTone {
  return HEALTH_TONE[state] ?? "neutral";
}

export function channelCapabilityLabel(t: T, capability: string): string {
  switch (capability) {
    case "publish":
      return t("Publish posts");
    case "reply":
      return t("Reply to messages");
    case "dm":
      return t("Send direct messages");
    case "inbound":
      return t("Receive inbound events");
    case "comments":
      return t("Manage comments");
    case "analytics":
      return t("Read analytics");
    case "leads":
      return t("Capture leads");
    case "ads":
      return t("Advertising");
    case "broadcast":
      return t("Broadcast to a list");
    default:
      return capability;
  }
}

/** What a capability row shows as its evidence state. */
export type CapabilityDisplayState =
  | "granted"
  | "pending_approval"
  | "denied"
  | "not_offered"
  | "unverified"
  | "not_requested";

export function capabilityDisplayStateLabel(
  t: T,
  state: CapabilityDisplayState
): string {
  switch (state) {
    case "granted":
      return t("Granted");
    case "pending_approval":
      return t("Pending approval");
    case "denied":
      return t("Denied");
    case "not_offered":
      return t("Not offered");
    case "unverified":
      return t("Not available (unverified)");
    case "not_requested":
      return t("No grant recorded");
  }
}

export function capabilityDisplayStateTone(
  state: CapabilityDisplayState
): StatusTone {
  switch (state) {
    case "granted":
      return "success";
    case "pending_approval":
      return "info";
    case "denied":
      return "danger";
    case "not_offered":
    case "unverified":
    case "not_requested":
      return "neutral";
  }
}

export function capabilityEvidenceKindLabel(t: T, kind: string): string {
  switch (kind) {
    case "scope_list_hash":
      return t("Granted scope list");
    case "app_review_reference":
      return t("App review reference");
    case "contract_reference":
      return t("Contract reference");
    case "written_authorization":
      return t("Written authorisation");
    default:
      return kind;
  }
}

/** Why a capability cannot be used right now. Unknown codes fall back to the code itself. */
export function capabilityDenialLabel(t: T, code: string): string {
  switch (code) {
    case "PROVIDER_UNKNOWN":
      return t("The provider is not recognised.");
    case "ACCOUNT_KIND_CONTAINER":
      return t(
        "This account only groups other accounts and does not act itself."
      );
    case "PROVIDER_NOT_OFFERED":
      return t("The provider does not offer this.");
    case "PROVIDER_BARRED":
      return t("This is not permitted by policy.");
    case "PROVIDER_UNVERIFIED":
      return t("The provider's support for this is not verified.");
    case "PROVIDER_RESTRICTED":
      return t("This needs a contract or written authorisation as evidence.");
    case "CAPABILITY_NOT_RECORDED":
      return t("No grant has been recorded.");
    case "CAPABILITY_NOT_GRANTED":
      return t("The grant is not in the granted state.");
    case "EVIDENCE_MISSING":
      return t("The grant has no evidence.");
    case "MATRIX_VERSION_STALE":
      return t("The grant predates the current provider matrix.");
    case "ACCOUNT_NOT_USABLE":
      return t("The account is not connected.");
    case "CONNECTION_NOT_ACTIVE":
      return t("The provider authorisation is not active.");
    default:
      return code;
  }
}

export function channelProviderLabel(t: T, provider: string): string {
  switch (provider) {
    case "whatsapp_cloud":
      return t("WhatsApp Cloud API");
    case "starsender":
      return t("StarSender (unofficial)");
    case "facebook":
      return t("Facebook Page");
    case "instagram":
      return t("Instagram");
    case "threads":
      return t("Threads");
    case "tiktok":
      return t("TikTok");
    case "youtube":
      return t("YouTube");
    case "linkedin":
      return t("LinkedIn Page");
    case "linkedin_member":
      return t("LinkedIn member data");
    case "telegram":
      return t("Telegram");
    case "website":
      return t("Website forms");
    case "mailketing":
      return t("Mailketing email");
    case "x":
      return t("X account");
    case "line":
      return t("LINE Official Account");
    case "pinterest":
      return t("Pinterest");
    case "google_business_profile":
      return t("Google Business Profile");
    case "discord":
      return t("Discord");
    case "bluesky":
      return t("Bluesky");
    case "mastodon":
      return t("Mastodon");
    case "snapchat":
      return t("Snapchat");
    case "reddit":
      return t("Reddit");
    default:
      return provider;
  }
}

export function channelAccountKindLabel(t: T, kind: string): string {
  switch (kind) {
    case "waba":
      return t("WhatsApp Business account");
    case "waba_phone_number":
      return t("WhatsApp phone number");
    case "device":
      return t("Device");
    case "page":
      return t("Page");
    case "professional_account":
      return t("Professional account");
    case "profile":
      return t("Profile");
    case "creator_account":
      return t("Creator account");
    case "channel":
      return t("Channel");
    case "organization_page":
      return t("Organisation page");
    case "bot":
      return t("Bot");
    case "esp_account":
      return t("Email service account");
    case "sender_identity":
      return t("Sender identity");
    default:
      return kind;
  }
}

/** Reasons a provider is shown without a Connect action. */
export type ProviderAvailability =
  "policy_boundary" | "phase_gated" | "connector_available" | "no_connector";

export function providerAvailabilityLabel(
  t: T,
  availability: ProviderAvailability
): string {
  switch (availability) {
    case "policy_boundary":
      return t("Not connectable: a policy boundary, not an account");
    case "phase_gated":
      return t(
        "Not connectable: phase-gated, documented only; needs a business case and the provider's approval"
      );
    case "connector_available":
      return t("Connector installed");
    case "no_connector":
      return t(
        "Unsupported on this deployment: no connector installed, requires approval"
      );
  }
}
