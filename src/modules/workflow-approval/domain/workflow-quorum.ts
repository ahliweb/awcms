/**
 * Pure quorum/any/all approval-outcome evaluation (Issue #747). No I/O —
 * `application/workflow-instance.ts` reads the task's assignments/decisions
 * and calls this after recording each new decision.
 *
 * Rule, deliberately conservative and documented: a single `reject` (or
 * `force_reject`) decision completes the task as rejected REGARDLESS of
 * `quorumRule` — one stakeholder's reject is a hard stop, not a vote that
 * can be outvoted by others still approving. `force_approve`/
 * `force_reject` (administrative override, `application/
 * workflow-recovery.ts`) always completes the task immediately with that
 * outcome, bypassing quorum counting entirely — that is the entire point
 * of an administrative override.
 */

export type QuorumRule = "all" | "any" | "quorum";

export type TaskDecisionKind =
  "approve" | "reject" | "force_approve" | "force_reject";

export type QuorumEvaluationInput = {
  quorumRule: QuorumRule;
  quorumThreshold?: number;
  /** Count of assignments in a decidable state (`pending` or `decided`) — excludes `reassigned`/`skipped` rows, which are no longer eligible to vote. */
  eligibleAssigneeCount: number;
  decisions: TaskDecisionKind[];
};

export type QuorumOutcome =
  { complete: false } | { complete: true; outcome: "approved" | "rejected" };

export function evaluateQuorumOutcome(
  input: QuorumEvaluationInput
): QuorumOutcome {
  if (input.decisions.some((d) => d === "reject" || d === "force_reject")) {
    return { complete: true, outcome: "rejected" };
  }

  if (input.decisions.some((d) => d === "force_approve")) {
    return { complete: true, outcome: "approved" };
  }

  const approveCount = input.decisions.filter((d) => d === "approve").length;

  if (approveCount === 0) {
    return { complete: false };
  }

  if (input.quorumRule === "any") {
    return { complete: true, outcome: "approved" };
  }

  if (input.quorumRule === "all") {
    return approveCount >= input.eligibleAssigneeCount
      ? { complete: true, outcome: "approved" }
      : { complete: false };
  }

  // "quorum"
  const threshold = input.quorumThreshold ?? input.eligibleAssigneeCount;

  return approveCount >= threshold
    ? { complete: true, outcome: "approved" }
    : { complete: false };
}
