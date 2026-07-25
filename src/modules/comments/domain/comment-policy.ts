/**
 * Comment submission policy (ADR-0041, ported from awcms-micro Issue #271).
 * Pure domain — no I/O. Given the thread's policy mode, the tenant settings and
 * the author kind, decide whether a submission is ACCEPTED (and whether it
 * needs moderation) or REJECTED.
 *
 * ## Policy modes
 *
 * The same four values as `awcms_comments_settings.default_policy_mode`,
 * `awcms_comments_threads.policy_mode` (`sql/066`) and
 * `CommentableResourceDescriptor.defaultPolicy`:
 *
 * - `disabled`             — no submissions accepted at all.
 * - `authenticated-only`   — registered (logged-in) authors only.
 * - `moderated-anonymous`  — anyone may submit; every submission starts `pending`.
 * - `moderated-registered` — registered authors only; every submission `pending`.
 *
 * ## Moderation-first
 *
 * `requireModeration` defaults to true, so out of the box every accepted
 * submission starts `pending`. A tenant that turns it off on an
 * `authenticated-only` thread lets a registered author's comment auto-approve.
 * An ANONYMOUS submission always requires moderation regardless of that
 * setting — an unauthenticated writer must never be able to put text on a
 * public page without a moderator seeing it first.
 */
export type CommentPolicyMode =
  | "disabled"
  | "authenticated-only"
  | "moderated-anonymous"
  | "moderated-registered";

export type CommentAuthorKind = "anonymous" | "registered";

export type CommentPolicySettings = {
  requireModeration: boolean;
  allowAnonymous: boolean;
};

export type CommentPolicyDecision =
  | { accepted: true; initialStatus: "pending" | "approved" }
  | { accepted: false; reason: CommentPolicyRejectionReason };

export type CommentPolicyRejectionReason =
  | "comments_disabled"
  | "authentication_required"
  | "anonymous_not_allowed"
  | "thread_closed";

export function decideCommentPolicy(input: {
  policyMode: CommentPolicyMode;
  authorKind: CommentAuthorKind;
  threadClosed: boolean;
  settings: CommentPolicySettings;
}): CommentPolicyDecision {
  const { policyMode, authorKind, threadClosed, settings } = input;

  if (threadClosed) {
    return { accepted: false, reason: "thread_closed" };
  }

  if (policyMode === "disabled") {
    return { accepted: false, reason: "comments_disabled" };
  }

  const anonymous = authorKind === "anonymous";

  if (
    anonymous &&
    (policyMode === "authenticated-only" ||
      policyMode === "moderated-registered")
  ) {
    return { accepted: false, reason: "authentication_required" };
  }

  if (anonymous && !settings.allowAnonymous) {
    return { accepted: false, reason: "anonymous_not_allowed" };
  }

  // Moderation gate. An anonymous author ALWAYS requires moderation, and so does
  // any `moderated-*` thread. A registered author may auto-approve only on an
  // `authenticated-only` thread whose tenant has explicitly turned
  // `requireModeration` off.
  const alwaysModerate =
    policyMode === "moderated-anonymous" ||
    policyMode === "moderated-registered" ||
    anonymous ||
    settings.requireModeration;

  return {
    accepted: true,
    initialStatus: alwaysModerate ? "pending" : "approved"
  };
}
