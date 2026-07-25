/**
 * Comment status state machine (ADR-0041, ported from awcms-micro Issue #271).
 * Pure domain — no I/O. This is the ONE place the legal moderation transitions
 * live, so no route or service can push a comment into an impossible state
 * (approving a deleted comment, "un-deleting" outside the sanctioned restore
 * path, archiving something that was never approved).
 *
 * ## Stored states
 *
 * These five are exactly the DB CHECK on `awcms_comments_comments.status`
 * (`sql/066`):
 *
 * - `pending`  — awaiting moderation. The default under any `moderated-*` mode.
 * - `approved` — visible publicly. The ONLY publicly visible status.
 * - `rejected` — denied publication by a moderator.
 * - `spam`     — denied publication, classified as spam (a rejection subtype).
 * - `deleted`  — soft-deleted. The row is retained; it is never rendered
 *   publicly and it is terminal (see `LEGAL_TRANSITIONS`).
 *
 * ## Why `archived` is an ACTION but not a STATUS
 *
 * Archiving means "take this approved comment out of the public view but keep
 * it for history". That is behaviourally identical to `rejected` — not publicly
 * visible, row retained — so giving it a sixth stored status would widen the
 * enum and the DB CHECK without buying any different behaviour. It would also
 * be wrong to model it as `approved -> pending`, which would re-queue the
 * comment for moderation it has already passed.
 *
 * So `archive` is a distinct moderator ACTION whose result status is `rejected`,
 * stamped with the reserved reason code `ARCHIVE_REASON_CODE`. The moderation
 * queue reads that reason code to tell an archive apart from a plain reject —
 * the two are distinguishable in the audit trail and in the UI, just not in the
 * status column.
 */
export type CommentStatus =
  "pending" | "approved" | "rejected" | "spam" | "deleted";

export type ModerationAction =
  "approve" | "reject" | "spam" | "archive" | "restore" | "delete";

/**
 * Reserved reason code stamped when an approved comment is archived, so the
 * queue can distinguish an archive from a plain reject. Reserved: a moderator's
 * own free-text reason must never collide with it.
 */
export const ARCHIVE_REASON_CODE = "archived";

const LEGAL_TRANSITIONS: Readonly<
  Record<CommentStatus, readonly CommentStatus[]>
> = {
  pending: ["approved", "rejected", "spam", "deleted"],
  approved: ["rejected", "spam", "deleted"],
  rejected: ["pending", "deleted"],
  spam: ["pending", "deleted"],
  // Terminal. Soft-delete is one-way: recovering a deleted comment is an
  // operator/database action, deliberately not an in-band moderator move.
  deleted: []
};

export function isLegalTransition(
  from: CommentStatus,
  to: CommentStatus
): boolean {
  if (from === to) return false;
  return LEGAL_TRANSITIONS[from]?.includes(to) ?? false;
}

export type ModerationOutcome = {
  status: CommentStatus;
  /** Whether the resulting status makes the comment publicly visible. */
  publiclyVisible: boolean;
  /** A reserved reason code the action implies (archive), or null. */
  impliedReasonCode: string | null;
};

/**
 * Maps a moderator action against a current status to the resulting status,
 * throwing `IllegalCommentTransitionError` when the action is not legal from
 * that status.
 */
export function applyModerationAction(
  current: CommentStatus,
  action: ModerationAction
): ModerationOutcome {
  const transitionTo = (
    target: CommentStatus,
    reason: string | null
  ): ModerationOutcome => {
    if (!isLegalTransition(current, target)) {
      throw new IllegalCommentTransitionError(current, target, action);
    }
    return {
      status: target,
      publiclyVisible: target === "approved",
      impliedReasonCode: reason
    };
  };

  switch (action) {
    case "approve":
      return transitionTo("approved", null);
    case "reject":
      return transitionTo("rejected", null);
    case "spam":
      return transitionTo("spam", null);
    case "archive":
      // Only an APPROVED comment can be archived — archiving is "withdraw from
      // public view", and nothing else was ever in public view. Rejecting a
      // pending comment is `reject`, not `archive`.
      if (current !== "approved") {
        throw new IllegalCommentTransitionError(current, "rejected", action);
      }
      return transitionTo("rejected", ARCHIVE_REASON_CODE);
    case "restore":
      return transitionTo("pending", null);
    case "delete":
      return transitionTo("deleted", null);
    default: {
      const exhaustive: never = action;
      throw new Error(`Unknown moderation action: ${String(exhaustive)}`);
    }
  }
}

export class IllegalCommentTransitionError extends Error {
  constructor(
    public readonly from: CommentStatus,
    public readonly to: CommentStatus,
    public readonly action: string
  ) {
    super(
      `Illegal comment transition: cannot ${action} a comment in status "${from}" (would move it to "${to}").`
    );
    this.name = "IllegalCommentTransitionError";
  }
}
