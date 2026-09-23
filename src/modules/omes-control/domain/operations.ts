/**
 * Safe operation allowlist (Issue ahliweb/omes#198, ADR-0122).
 *
 * The operation names below are copied verbatim from the OMES-owned contract
 * `contracts/control-center/v1/operation-request.schema.json` (ahliweb/omes
 * repository) — "the Control Center-facing shape of a safe operation
 * request ... a closed enum limited to the read/lifecycle operations issue
 * #91 exposes to tenant-scoped screens". That schema's `operation` enum is
 * `status`, `preflight`, `start`, `stop`, `restart`, `update`, `backup`,
 * `rollback` — deliberately a SUBSET of the broader `deployment.request`
 * enum (which also allows `install`/`configure`/`restore` for direct
 * job-runner use only).
 *
 * This module never invents an operation name, never accepts a free-form
 * command, and never widens the enum without also updating the OMES
 * contract fixture this file's own test compares against byte-for-byte.
 *
 * DESTRUCTIVE CLASSIFICATION — from `docs/jobs.md` §4 "Approval policy"
 * (ahliweb/omes): "Destructive operations — `restore`, `rollback`, `stop`,
 * `configure` — ... a job requires approval". Intersected with the
 * Control-Center-facing enum above (which has no `restore`/`configure`),
 * the destructive subset reachable through THIS API is exactly
 * `stop` and `rollback`.
 */

export const OMES_OPERATION_CODES = [
  "status",
  "preflight",
  "start",
  "stop",
  "restart",
  "update",
  "backup",
  "rollback"
] as const;

export type OmesOperationCode = (typeof OMES_OPERATION_CODES)[number];

const OPERATION_CODE_SET: ReadonlySet<string> = new Set(OMES_OPERATION_CODES);

export function isSupportedOmesOperation(
  value: string
): value is OmesOperationCode {
  return OPERATION_CODE_SET.has(value);
}

/**
 * `docs/jobs.md` §4 (ahliweb/omes), intersected with
 * {@link OMES_OPERATION_CODES} — see module header.
 */
export const DESTRUCTIVE_OMES_OPERATIONS: ReadonlySet<OmesOperationCode> =
  new Set(["stop", "rollback"]);

export function isDestructiveOmesOperation(
  operation: OmesOperationCode
): boolean {
  return DESTRUCTIVE_OMES_OPERATIONS.has(operation);
}

/**
 * Permission guard required to SUBMIT each operation — every entry reuses a
 * permission already seeded by `sql/155_awcms_omes_control_permissions.sql`
 * (no new permission migration for this issue).
 *
 * `status`/`preflight` are read/diagnostic in effect (they do not change
 * host state) and are gated by `deployments.read`. Every state-changing
 * lifecycle operation (`start`/`restart`/`update`/`backup`/`stop`) is gated
 * by `deployments.operate` ("Apply, update, reconcile, or roll back server
 * deployments"). `rollback` is gated by the MORE specific
 * `backups.rollback` ("Trigger emergency rollback to prior known-good
 * state"), matching that permission's own description exactly.
 */
export const OMES_OPERATION_GUARD: Record<
  OmesOperationCode,
  { moduleKey: "omes_control"; activityCode: string; action: string }
> = {
  status: { moduleKey: "omes_control", activityCode: "deployments", action: "read" },
  preflight: { moduleKey: "omes_control", activityCode: "deployments", action: "read" },
  start: { moduleKey: "omes_control", activityCode: "deployments", action: "operate" },
  stop: { moduleKey: "omes_control", activityCode: "deployments", action: "operate" },
  restart: { moduleKey: "omes_control", activityCode: "deployments", action: "operate" },
  update: { moduleKey: "omes_control", activityCode: "deployments", action: "operate" },
  backup: { moduleKey: "omes_control", activityCode: "deployments", action: "operate" },
  rollback: { moduleKey: "omes_control", activityCode: "backups", action: "rollback" }
};

/**
 * Workflow key an active, published `workflow` (workflow-approval module)
 * definition must be published under for a DESTRUCTIVE operation to be
 * submittable at all. Per ahliweb/omes#198's validated reuse requirement:
 * "Destructive OMES operations MUST use the existing `workflow-approval`
 * engine ... Its approved workflow outcome is the single human-approval
 * authority; do not add an independent OMES approver/state machine."
 *
 * A tenant that has never authored/published a definition under this key
 * (via the existing `/admin/approvals` + `POST /workflows/definitions`
 * surface) cannot submit a destructive OMES operation at all — the request
 * is refused with `APPROVAL_WORKFLOW_NOT_CONFIGURED` rather than silently
 * falling back to auto-approval or direct execution.
 */
export const OMES_DESTRUCTIVE_WORKFLOW_KEY = "omes_control.destructive_operation";

export type OperationSubmissionInput = {
  serverId: string;
  deploymentId?: string;
  operation: OmesOperationCode;
  parameters: Record<string, unknown>;
  backupId?: string;
  rollbackRef?: string;
};

export type OperationSubmissionValidation =
  | { valid: true; value: OperationSubmissionInput }
  | { valid: false; errors: { field: string; message: string }[] };

const ID_PATTERN = /^[A-Za-z0-9_.:-]{1,128}$/;

function isValidExternalId(value: unknown): value is string {
  return typeof value === "string" && ID_PATTERN.test(value);
}

/**
 * Validates the AWCMS-facing (session-authenticated) request body for
 * `POST /api/v1/omes/operations`. This is deliberately NOT the OMES wire
 * schema (`operation-request.schema.json`) — that schema's `tenant_id`,
 * `correlation_id`, `idempotency_key`, `actor`, and `permission` fields are
 * derived server-side from the caller's session/permission decision (the
 * schema's own description: "the RBAC/ABAC decision AWCMS made ... BEFORE
 * submitting the request"), never accepted from the client. Building that
 * OMES-facing envelope is the pull worker's job (ahliweb/omes#199, out of
 * scope here).
 */
export function validateOperationSubmission(
  body: unknown
): OperationSubmissionValidation {
  const errors: { field: string; message: string }[] = [];

  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return {
      valid: false,
      errors: [{ field: "body", message: "Request body must be a JSON object." }]
    };
  }

  const record = body as Record<string, unknown>;

  if (!isValidExternalId(record.serverId)) {
    errors.push({
      field: "serverId",
      message: "serverId is required and must match ^[A-Za-z0-9_.:-]{1,128}$."
    });
  }

  if (
    record.deploymentId !== undefined &&
    !isValidExternalId(record.deploymentId)
  ) {
    errors.push({
      field: "deploymentId",
      message: "deploymentId must match ^[A-Za-z0-9_.:-]{1,128}$."
    });
  }

  if (
    typeof record.operation !== "string" ||
    !isSupportedOmesOperation(record.operation)
  ) {
    errors.push({
      field: "operation",
      message: `operation must be one of: ${OMES_OPERATION_CODES.join(", ")}.`
    });
  }

  if (
    record.parameters !== undefined &&
    (typeof record.parameters !== "object" ||
      record.parameters === null ||
      Array.isArray(record.parameters))
  ) {
    errors.push({
      field: "parameters",
      message: "parameters must be a JSON object when present."
    });
  }

  if (record.backupId !== undefined && !isValidExternalId(record.backupId)) {
    errors.push({
      field: "backupId",
      message: "backupId must match ^[A-Za-z0-9_.:-]{1,128}$."
    });
  }

  if (
    record.rollbackRef !== undefined &&
    !isValidExternalId(record.rollbackRef)
  ) {
    errors.push({
      field: "rollbackRef",
      message: "rollbackRef must match ^[A-Za-z0-9_.:-]{1,128}$."
    });
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    value: {
      serverId: record.serverId as string,
      deploymentId: record.deploymentId as string | undefined,
      operation: record.operation as OmesOperationCode,
      parameters:
        (record.parameters as Record<string, unknown> | undefined) ?? {},
      backupId: record.backupId as string | undefined,
      rollbackRef: record.rollbackRef as string | undefined
    }
  };
}
