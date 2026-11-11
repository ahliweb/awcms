/**
 * Shared plumbing for the `/api/v1/crm-follow-up/*` route files (Issue #1165,
 * ADR-0159): the off switches, body parsing, `Idempotency-Key` handling, the
 * audit row and the refusals, so the route files stay thin.
 *
 * ## Off by default at three levels (ADR-0159 section 1)
 *
 *   deployment  `CRM_FOLLOW_UP_ENABLED=true`, else `503 CRM_FOLLOW_UP_DISABLED`
 *               on every route, answered AFTER authorization;
 *   module      Module Management's per-tenant enable, enforced by the
 *               authorization chokepoint itself;
 *   tenant      the module's own switch (default off): staff task writes and
 *               stop signals answer `409 CRM_FOLLOW_UP_TENANT_DISABLED` until a
 *               holder of `rules.configure` turns it on. Rules may be prepared,
 *               simulated and read while it is off.
 */
import {
  bodyTooLargeResponse,
  readCappedText
} from "../../../lib/security/request-body-limit";
import { fail, jsonResponse } from "../../_shared/api-response";
import {
  computeRequestHash,
  findIdempotencyRecord,
  saveIdempotencyRecord,
  userIdempotencyActor
} from "../../_shared/idempotency";
import { recordAuditEvent } from "../../logging/application/audit-log";
import {
  CRM_FOLLOW_UP_BODY_LIMIT_BYTES,
  CRM_FOLLOW_UP_MODULE_KEY,
  isCrmFollowUpEnabled
} from "../domain/crm-follow-up-constants";
import { isUuid, type Validated } from "../domain/crm-follow-up-validation";
import { fetchSettings } from "./settings-directory";

type AuthLike = {
  context: { viaMachineCredential?: boolean; tenantUserId: string };
};

/** The deployment switch. Checked AFTER authorization. */
export function disabledResponse(
  env: NodeJS.ProcessEnv = process.env
): Response | null {
  return isCrmFollowUpEnabled(env)
    ? null
    : fail(
        503,
        "CRM_FOLLOW_UP_DISABLED",
        "Follow-up tasks are not enabled for this deployment."
      );
}

/** For a MUTATION: the deployment switch and a refusal of a machine credential. */
export function mutationRefusal(auth: AuthLike): Response | null {
  const disabled = disabledResponse();

  if (disabled) return disabled;

  if (auth.context.viaMachineCredential === true) {
    return fail(
      403,
      "INTERACTIVE_SESSION_REQUIRED",
      "This action needs a signed-in person; a machine credential cannot do it."
    );
  }

  return null;
}

/** The tenant switch, for every task write and stop signal. */
export async function tenantDisabledResponse(
  tx: Bun.SQL,
  tenantId: string
): Promise<Response | null> {
  const settings = await fetchSettings(tx, tenantId);

  return settings.enabled
    ? null
    : fail(
        409,
        "CRM_FOLLOW_UP_TENANT_DISABLED",
        "Follow-up tasks are switched off for this tenant."
      );
}

export function readIdempotencyKey(request: Request): string | Response {
  const key = request.headers.get("idempotency-key");

  if (!key || key.length > 255) {
    return fail(
      400,
      "IDEMPOTENCY_REQUIRED",
      "Idempotency-Key header is required (at most 255 characters)."
    );
  }

  return key;
}

/** Parses and validates a JSON body under the module's 16 KiB ceiling. */
export async function readValidatedBody<T>(
  request: Request,
  validate: (raw: unknown) => Validated<T>
): Promise<T | Response> {
  const read = await readCappedText(request, CRM_FOLLOW_UP_BODY_LIMIT_BYTES);

  if (read.tooLarge)
    return bodyTooLargeResponse(CRM_FOLLOW_UP_BODY_LIMIT_BYTES);

  let raw: unknown = null;

  if (read.text.length > 0) {
    try {
      raw = JSON.parse(read.text);
    } catch {
      return fail(400, "VALIDATION_ERROR", "Request body must be valid JSON.");
    }
  }

  const validation = validate(raw);

  if (!validation.valid) {
    return fail(
      400,
      "VALIDATION_ERROR",
      "Request is invalid.",
      {},
      validation.errors
    );
  }

  return validation.value;
}

/** `prepare` for a mutation: the key, then the validated body. */
export async function prepareMutation<T>(
  request: Request,
  validate: (raw: unknown) => Validated<T>
): Promise<{ idempotencyKey: string; input: T } | Response> {
  const idempotencyKey = readIdempotencyKey(request);

  if (idempotencyKey instanceof Response) return idempotencyKey;

  const input = await readValidatedBody(request, validate);

  return input instanceof Response ? input : { idempotencyKey, input };
}

export function asUuid(value: string | undefined | null): string | null {
  return isUuid(value) ? value.toLowerCase() : null;
}

export function badId(field = "id"): Response {
  return fail(400, "VALIDATION_ERROR", `${field} must be a UUID.`);
}

/** One uniform answer for "no such id in this tenant". */
export function notFound(what: string): Response {
  return fail(404, "RESOURCE_NOT_FOUND", `${what} not found.`);
}

export function versionConflict(currentVersion: number): Response {
  return fail(
    409,
    "VERSION_CONFLICT",
    "The resource changed since it was read; re-read it and retry.",
    {},
    { currentVersion }
  );
}

/** The standard answer for a refused task close; `null` when the outcome is a success. */
export function taskCloseRefusal(
  result:
    | { outcome: "not_found" }
    | { outcome: "version_conflict"; currentVersion: number }
    | { outcome: "closed"; status: string }
    | { outcome: "completed" | "cancelled" }
): Response | null {
  switch (result.outcome) {
    case "not_found":
      return notFound("Task");
    case "version_conflict":
      return versionConflict(result.currentVersion);
    case "closed":
      return fail(
        409,
        "TASK_CLOSED",
        "This task is already closed.",
        {},
        { status: result.status }
      );
    default:
      return null;
  }
}

export function unknownUsers(): Response {
  return fail(
    422,
    "USER_NOT_FOUND",
    "A user the rule names is not an active user of this tenant."
  );
}

export async function auditCrmFollowUp(
  context: {
    tx: Bun.SQL;
    tenantId: string;
    auth: AuthLike;
    locals: { correlationId?: string };
  },
  input: {
    action: string;
    resourceType: string;
    resourceId: string | null;
    severity: "info" | "warning";
    message: string;
    attributes?: Record<string, unknown>;
  }
): Promise<void> {
  await recordAuditEvent(context.tx, {
    tenantId: context.tenantId,
    actorTenantUserId: context.auth.context.tenantUserId,
    moduleKey: CRM_FOLLOW_UP_MODULE_KEY,
    action: input.action,
    resourceType: input.resourceType,
    ...(input.resourceId ? { resourceId: input.resourceId } : {}),
    severity: input.severity,
    message: input.message,
    // Ids, fixed codes and counts ONLY: never anything about the prospect.
    ...(input.attributes ? { attributes: input.attributes } : {}),
    ...(context.locals.correlationId
      ? { correlationId: context.locals.correlationId }
      : {})
  });
}

/**
 * Runs `produce` at most once per `(scope, Idempotency-Key, acting person)`:
 * same key + same request -> the STORED response; same key + different request
 * -> `409 IDEMPOTENCY_CONFLICT`; unseen key -> `produce()`. Refusals are not
 * stored, so a corrected retry with the same key is possible.
 */
export async function runIdempotent(
  tx: Bun.SQL,
  tenantId: string,
  scope: string,
  idempotencyKey: string,
  actorTenantUserId: string,
  requestPayload: unknown,
  produce: () => Promise<
    { status: number; body: Record<string, unknown> } | Response
  >
): Promise<Response> {
  const requestHash = computeRequestHash({
    actor: actorTenantUserId,
    request: requestPayload
  });
  const actor = userIdempotencyActor(actorTenantUserId);
  const existing = await findIdempotencyRecord(
    tx,
    tenantId,
    scope,
    idempotencyKey,
    actor
  );

  if (existing) {
    if (existing.requestHash !== requestHash) {
      return fail(
        409,
        "IDEMPOTENCY_CONFLICT",
        "Idempotency-Key was already used with a different request."
      );
    }

    return jsonResponse(existing.responseBody, {
      status: existing.responseStatus
    });
  }

  const produced = await produce();

  if (produced instanceof Response) return produced;

  const stored = { success: true as const, data: produced.body, meta: {} };

  await saveIdempotencyRecord(
    tx,
    tenantId,
    scope,
    idempotencyKey,
    actor,
    requestHash,
    produced.status,
    stored
  );

  return jsonResponse(stored, { status: produced.status });
}
