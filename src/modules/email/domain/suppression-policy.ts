/**
 * Which suppression blocks which mail, and the provider-reported projection of
 * one message (Issue #1161, ADR-0151 sections 4 and 5). Pure.
 *
 * ## Precedence (ADR-0151 section 4), as this repository implements it
 *
 * | Entry                                     | transactional | security |
 * | ----------------------------------------- | ------------- | -------- |
 * | `operator` `manual`/`bounced`/`complained`| blocked       | blocked  |
 * | `operator` `unsubscribed`                 | blocked       | allowed  |
 * | `provider_report` (any reason)            | blocked       | allowed  |
 *
 * - **A marketing opt-out never suppresses security mail** (section 4 rule 2: a
 *   password reset, invitation or security notice still goes out).
 * - **A provider report never suppresses security mail.** It rests on an
 *   UNAUTHENTICATED callback (Mailketing documents no signature), even after an
 *   operator confirmed it, so a forged bounce cannot lock a person out of
 *   account recovery.
 * - `unsubscribed` still stops TRANSACTIONAL mail. ADR-0151 rule 2 lets an
 *   unsubscribe stop `marketing` only, but this repository has no `marketing`
 *   purpose yet (`sql/346` admits only `transactional` and `security`), so an
 *   `unsubscribed` entry is today the only way a person stops tenant
 *   announcements. Narrowing it to marketing-only would silently resume mail to
 *   people who asked to stop: the restrictive reading is kept until the
 *   campaign issue adds `marketing` and its consent gate (recorded as an open
 *   decision in the module README).
 *
 * Checked at enqueue (`announcement-directory`, `direct-address-notification`)
 * and again by the dispatcher right before the provider call, with the row's
 * immutable `purpose`.
 */
import type { BounceClass, ProviderEventType } from "./mailketing-webhook";

export type EmailPurposeForSuppression = "transactional" | "security";

export type SuppressionSource = "operator" | "provider_report";

export type SuppressionFacts = {
  reason: "bounced" | "complained" | "manual" | "unsubscribed";
  source: SuppressionSource;
};

export function suppressionBlocksPurpose(
  entry: SuppressionFacts | undefined,
  purpose: EmailPurposeForSuppression
): boolean {
  if (!entry) return false;
  if (purpose !== "security") return true;

  return entry.source === "operator" && entry.reason !== "unsubscribed";
}

// ---------------------------------------------------------------------------
// Soft bounces
// ---------------------------------------------------------------------------

export const DEFAULT_SOFT_BOUNCE_THRESHOLD = 3;
export const SOFT_BOUNCE_WINDOW_DAYS = 30;

/** `EMAIL_WEBHOOK_SOFT_BOUNCE_THRESHOLD`: 2..20, default 3. Malformed = default. */
export function resolveSoftBounceThreshold(
  env: NodeJS.ProcessEnv = process.env
): number {
  const raw = env.EMAIL_WEBHOOK_SOFT_BOUNCE_THRESHOLD;

  if (raw === undefined || raw.trim() === "") {
    return DEFAULT_SOFT_BOUNCE_THRESHOLD;
  }

  const parsed = Number(raw);

  return Number.isInteger(parsed) && parsed >= 2 && parsed <= 20
    ? parsed
    : DEFAULT_SOFT_BOUNCE_THRESHOLD;
}

/**
 * May an operator confirm this bounce into the suppression list? A hard bounce
 * may; a soft or unclassified one only once the same recipient has bounced
 * `threshold` times in the window (counting this one).
 */
export function bounceMeetsSuppressionThreshold(
  bounceClass: BounceClass,
  recentSoftOrUnknownBounces: number,
  threshold: number
): boolean {
  if (bounceClass === "hard") return true;

  return recentSoftOrUnknownBounces >= threshold;
}

// ---------------------------------------------------------------------------
// The provider-reported projection of one message
// ---------------------------------------------------------------------------

/**
 * `accepted` (the provider queued it: our own `sent`) < `delivered` <
 * `bounced`. Forward-only by construction: the projection is the MAXIMUM rank
 * over every recorded event, so an older `delivered` arriving after a `bounce`
 * cannot move it back, and a replay changes nothing. `complained` is not a
 * state here: Mailketing documents no complaint event, and ADR-0151 M12 forbids
 * presenting one it does not report. Opens, clicks and unsubscribes are not
 * delivery states.
 *
 * It is never written onto the message: the message's own `status` stays what
 * the dispatcher decided (`strict` mode), and this is labelled
 * `provider-reported, unauthenticated` wherever it is shown.
 */
export type ProviderReportedStatus = "accepted" | "delivered" | "bounced";

const RANK: Record<ProviderReportedStatus, number> = {
  accepted: 0,
  delivered: 1,
  bounced: 2
};

export function projectProviderReportedStatus(
  messageStatus: string,
  eventTypes: readonly ProviderEventType[]
): ProviderReportedStatus | null {
  let best: ProviderReportedStatus | null =
    messageStatus === "sent" ? "accepted" : null;

  for (const type of eventTypes) {
    const candidate: ProviderReportedStatus | null =
      type === "bounce" ? "bounced" : type === "delivered" ? "delivered" : null;

    if (candidate && (best === null || RANK[candidate] > RANK[best])) {
      best = candidate;
    }
  }

  return best;
}
