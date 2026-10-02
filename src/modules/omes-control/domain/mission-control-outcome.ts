/**
 * Mission Control mutation outcome mapping (Issue ahliweb/omes#267, ADR-0031).
 *
 * Pure and import-free ON PURPOSE: it is shared by the server-side action
 * domain (`mission-control-actions.ts` re-exports it) and by the browser action
 * client (`src/lib/ui/mission-control/actions.ts`), and the browser must not
 * bundle the vendored source map, the permission catalogue or the scene
 * composer just to classify an HTTP status.
 */

export type MissionControlMutationOutcome =
  "accepted" | "approval_required" | "rejected" | "unknown";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorCode(body: unknown): string | null {
  if (!isRecord(body) || !isRecord(body.error)) return null;
  return typeof body.error.code === "string" ? body.error.code : null;
}

/**
 * A 201 from `POST /operations` or `/backups/{id}/restore` carries
 * `data.operationRequest.workflowInstanceId` only when the destructive
 * workflow was started (`application/operation-submission.ts`,
 * `application/backup-restore.ts`). Returns that id, or `null`.
 */
export function workflowInstanceIdOf(body: unknown): string | null {
  if (!isRecord(body) || !isRecord(body.data)) return null;
  const request = body.data.operationRequest;
  if (!isRecord(request)) return null;
  const id = request.workflowInstanceId;
  return typeof id === "string" && id.length > 0 ? id : null;
}

/**
 * Maps an existing-endpoint response to a Mission Control result state.
 * 2xx is `accepted` — NEVER "succeeded": accepted means the request was
 * recorded; verification is the job/scene's job, and a timeout or 5xx is
 * `unknown`, never success or failure.
 */
export function mapMutationOutcome(
  status: number | "network_error" | "timeout",
  body?: unknown
): MissionControlMutationOutcome {
  if (typeof status !== "number") return "unknown";
  if (status >= 200 && status < 300) {
    if (status === 200 || status === 201 || status === 202) {
      return workflowInstanceIdOf(body) !== null
        ? "approval_required"
        : "accepted";
    }
    return "unknown";
  }
  if (
    status === 409 &&
    errorCode(body) === "APPROVAL_WORKFLOW_NOT_CONFIGURED"
  ) {
    return "approval_required";
  }
  if (status >= 400 && status < 500) return "rejected";
  return "unknown";
}
