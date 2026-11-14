/**
 * Pure rules of the email senders screen (Issue #1162, ADR-0151 sections 2, 6
 * and 7, ADR-0149). No database, no network, no secret: every function takes
 * facts and answers a label-free code, so the rules are unit-tested without
 * rendering and the page only chooses the words.
 */
import {
  isMailketingV2Verified,
  resolveMailketingApiVersion,
  type MailketingApiVersion
} from "./mailketing-v2-contract";
import {
  evaluateEmailSenderHealth,
  type EmailAccountHealthFacts,
  type EmailSenderHealthHold
} from "./email-sender";

/**
 * How current a recorded fact is. `unknown` means NO check was ever recorded
 * (there is no timestamp to show); `stale` means one was, but it is older than
 * the freshness window the dispatcher itself applies, so it no longer holds. The
 * two are different instructions to an operator ("run the verification" versus
 * "the verification stopped running") and are never merged into one word.
 */
export type CheckFreshness = "fresh" | "stale" | "unknown";

export function classifyCheckFreshness(
  checkedAt: Date | null,
  now: Date,
  maxAgeMs: number
): CheckFreshness {
  if (checkedAt === null) return "unknown";

  // A timestamp in the future (clock skew between the app host and the job
  // host) is not "fresh forever": it is as old as it can be proven to be, zero.
  return now.getTime() - checkedAt.getTime() > maxAgeMs ? "stale" : "fresh";
}

/** What the provider told us about a sender identity at the last check. */
export type SenderVerification =
  "verified" | "unverified" | "unknown" | "stale" | "failing";

/**
 * The verification a SENDER row shows, from the same facts and the same order
 * the dispatcher's freshness gate reads (`evaluateEmailSenderHealth`), so the
 * screen cannot say "verified" about a sender the dispatcher would hold.
 *
 * - no recorded check → `unknown`;
 * - state `ok` but older than the window → `stale` (not assumed still verified);
 * - state `ok` and fresh → `verified`;
 * - state `degraded` (the provider listed no verified sender of this address) →
 *   `unverified`;
 * - state `failing` → `failing`; state `unknown` → `unknown`.
 */
export function senderVerification(
  facts: EmailAccountHealthFacts | null,
  now: Date,
  maxAgeMs: number
): SenderVerification {
  if (facts === null) return "unknown";

  switch (facts.state) {
    case "ok":
      return classifyCheckFreshness(facts.checkedAt, now, maxAgeMs) === "fresh"
        ? "verified"
        : "stale";
    case "degraded":
      return "unverified";
    case "failing":
      return "failing";
    default:
      return "unknown";
  }
}

/** How the credit balance of a Mailketing account reads. */
export type CreditReading =
  | { kind: "unknown" }
  | { kind: "stale"; balance: number }
  | { kind: "ok"; balance: number }
  | { kind: "insufficient"; balance: number };

/**
 * `insufficient` is below the deployment's credit floor (ADR-0151 section 6),
 * which holds every sender of the account; a balance with no check time, or with
 * a check older than the window, is `stale` and never `ok`.
 */
export function creditReading(
  facts: EmailAccountHealthFacts | null,
  now: Date,
  maxAgeMs: number,
  creditFloor: number
): CreditReading {
  if (facts === null || facts.quotaRemaining === null) {
    return { kind: "unknown" };
  }

  const balance = facts.quotaRemaining;

  if (facts.state === "degraded" && facts.reasonCode === "CREDIT_DEPLETED") {
    return { kind: "insufficient", balance };
  }

  if (classifyCheckFreshness(facts.checkedAt, now, maxAgeMs) !== "fresh") {
    return { kind: "stale", balance };
  }

  return balance < creditFloor
    ? { kind: "insufficient", balance }
    : { kind: "ok", balance };
}

/** How a Mailketing ACCOUNT reads (its own login, apart from its senders). */
export type AccountConnection =
  | "connected"
  | "credential_rejected"
  | "credit_depleted"
  | "unverified_response"
  | "stale"
  | "unknown"
  | "disconnected"
  | "pending";

export function accountConnection(input: {
  status: string;
  facts: EmailAccountHealthFacts | null;
  now: Date;
  maxAgeMs: number;
}): AccountConnection {
  const { status, facts, now, maxAgeMs } = input;

  if (status === "revoked" || status === "disabled" || status === "deleted") {
    return "disconnected";
  }

  if (status === "pending") return "pending";

  if (facts === null) return "unknown";

  if (facts.state === "failing") return "credential_rejected";

  if (facts.state === "degraded" && facts.reasonCode === "CREDIT_DEPLETED") {
    return "credit_depleted";
  }

  if (facts.state === "unknown") {
    return facts.reasonCode === "CREDIT_RESPONSE_UNRECOGNISED"
      ? "unverified_response"
      : "unknown";
  }

  if (classifyCheckFreshness(facts.checkedAt, now, maxAgeMs) !== "fresh") {
    return "stale";
  }

  // `degraded` with any other reason is still a degraded account.
  return facts.state === "ok" ? "connected" : "unknown";
}

/**
 * Whether a sender may send RIGHT NOW as far as health is concerned: exactly the
 * dispatcher's freshness gate, so a screen that says "ready" is a sender the
 * queue would actually serve. `null` is "no hold".
 */
export function senderHealthHold(input: {
  sender: EmailAccountHealthFacts | null;
  account: EmailAccountHealthFacts | null;
  now: Date;
  maxAgeMs: number;
  creditFloor: number;
}): EmailSenderHealthHold | null {
  return evaluateEmailSenderHealth(input);
}

/**
 * A from-address as shown to an operator: the first character of the local part
 * and the whole domain (`n•••@brand.example`). A sender address is a mailbox of
 * the tenant, not a secret, but the repo's rule is that an identity is masked
 * unless a screen has a reason to show it whole, and the operator recognises the
 * sender by its domain and its name. Anything that is not an address is reduced
 * to its last four characters, like a provider external id.
 */
export function maskSenderAddress(address: string): string {
  const at = address.lastIndexOf("@");

  if (at > 0 && at < address.length - 1) {
    const local = [...address.slice(0, at)];

    return `${local[0]}•••@${address.slice(at + 1)}`;
  }

  const chars = [...address];

  return chars.length <= 6 ? "••••" : `••••${chars.slice(-4).join("")}`;
}

/**
 * The state of the DEPLOYMENT sender's Mailketing API migration (ADR-0151
 * section 1 and 7). Tenant-owned senders always use v2; this is about the one
 * deployment-level sender (`EMAIL_PROVIDER=mailketing`).
 */
export type MailketingMigrationNotice =
  /** The deployment sender is not Mailketing: there is nothing to migrate. */
  | { kind: "not_mailketing" }
  /** `EMAIL_MAILKETING_API_VERSION` is set to something that is neither v1 nor v2: nothing sends until it is fixed. */
  | { kind: "invalid_version" }
  /** Still on v1: the migration to v2 has not been made. */
  | { kind: "v1_active" }
  /** On v2 but the live stage-2 check was not acknowledged: v2 is not approved for production. */
  | { kind: "v2_unverified" }
  | { kind: "v2_verified" };

export function mailketingMigrationNotice(
  env: NodeJS.ProcessEnv = process.env
): MailketingMigrationNotice & {
  deploymentApiVersion: MailketingApiVersion | null;
} {
  if (env.EMAIL_PROVIDER?.trim() !== "mailketing") {
    return { kind: "not_mailketing", deploymentApiVersion: null };
  }

  const resolution = resolveMailketingApiVersion(env);

  if (!resolution.ok) {
    return { kind: "invalid_version", deploymentApiVersion: null };
  }

  if (resolution.version === "v1") {
    return { kind: "v1_active", deploymentApiVersion: "v1" };
  }

  return isMailketingV2Verified(env)
    ? { kind: "v2_verified", deploymentApiVersion: "v2" }
    : { kind: "v2_unverified", deploymentApiVersion: "v2" };
}
