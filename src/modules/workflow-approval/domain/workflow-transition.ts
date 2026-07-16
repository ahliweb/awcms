/**
 * Decision-request validation (Issue 11.1, kept unchanged in shape by
 * Issue #747). The linear `evaluateDecisionOutcome`/`validateWorkflowSteps`
 * this file used to also export were replaced by the graph-based engine —
 * see `domain/workflow-graph.ts` (structure), `domain/workflow-quorum.ts`
 * (approval-outcome evaluation), and `domain/workflow-condition.ts`
 * (conditional routing). No I/O in this file — callers (the decision API
 * route) own persistence.
 */

export type WorkflowDecision = "approve" | "reject";

export type ValidationError = {
  field: string;
  message: string;
};

export type WorkflowDecisionRequestBody = {
  decision: WorkflowDecision;
  reason?: string;
};

export type WorkflowDecisionRequestValidationResult =
  | { valid: true; value: WorkflowDecisionRequestBody }
  | { valid: false; errors: ValidationError[] };

/**
 * Validates `POST /workflows/tasks/{id}/decisions` request bodies.
 * `decision` must be `"approve"` or `"reject"`; `reason` is an optional
 * string.
 */
export function validateWorkflowDecisionRequestBody(
  body: unknown
): WorkflowDecisionRequestValidationResult {
  const errors: ValidationError[] = [];
  const record = (body ?? {}) as Record<string, unknown>;
  const decision = record.decision;

  if (decision !== "approve" && decision !== "reject") {
    errors.push({
      field: "decision",
      message: 'decision must be "approve" or "reject".'
    });
  }

  if (record.reason !== undefined && typeof record.reason !== "string") {
    errors.push({ field: "reason", message: "reason must be a string." });
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    value: {
      decision: decision as WorkflowDecision,
      reason: typeof record.reason === "string" ? record.reason : undefined
    }
  };
}
