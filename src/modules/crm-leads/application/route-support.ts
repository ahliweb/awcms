/**
 * Shared plumbing for the `/api/v1/crm-leads/*` route files (Issue #1166): the
 * three off switches, body parsing, `Idempotency-Key` handling, the audit row
 * and the refusals, so the route files stay thin and cannot drift into
 * different spellings of the same answer.
 *
 * ## Off by default at three levels (ADR-0153 section 1)
 *
 *   deployment  `CRM_LEADS_ENABLED=true`, else `503 CRM_LEADS_DISABLED` on every
 *               route, answered AFTER authorization so an unauthorised caller
 *               learns nothing about it;
 *   module      Module Management's per-tenant enable, enforced by the
 *               authorization chokepoint itself;
 *   tenant      the module's own switch (`settings.enabled`, default false):
 *               every LEAD write (intake, edit, touch, move, assign, merge and
 *               its rollback, conversion and reversal, soft delete, restore)
 *               answers `409 CRM_LEADS_TENANT_DISABLED` until a holder of
 *               `pipelines.configure` turns it on. Pipelines may be prepared and
 *               existing data read while it is off. The ONE exception is
 *               anonymising erasure: a data subject's erasure request must be
 *               answerable even after the controller switched the module off.
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
  resolveCrmLeadsRings,
  type CrmLeadsRings
} from "../domain/crm-leads-config";
import {
  CRM_LEADS_BODY_LIMIT_BYTES,
  CRM_LEADS_MODULE_KEY,
  isCrmLeadsEnabled
} from "../domain/crm-leads-constants";
import { isUuid, type Validated } from "../domain/crm-leads-validation";
import { fetchSettings } from "./settings-directory";
import type { EmitContext } from "./lead-events";

type AuthLike = {
  context: { viaMachineCredential?: boolean; tenantUserId: string };
};

/** The deployment switch. Checked AFTER authorization. */
export function disabledResponse(
  env: NodeJS.ProcessEnv = process.env
): Response | null {
  return isCrmLeadsEnabled(env)
    ? null
    : fail(
        503,
        "CRM_LEADS_DISABLED",
        "The lead pipeline is not enabled for this deployment."
      );
}

/**
 * For a MUTATION: the deployment switch and a refusal of a machine credential.
 * Moves, merges and conversions are accountable acts filed per person (the
 * idempotency record, the audit row and the transition's actor).
 */
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

/** The tenant switch, for every LEAD write. */
export async function tenantDisabledResponse(
  tx: Bun.SQL,
  tenantId: string
): Promise<Response | null> {
  const settings = await fetchSettings(tx, tenantId);

  return settings.enabled
    ? null
    : fail(
        409,
        "CRM_LEADS_TENANT_DISABLED",
        "The lead pipeline is switched off for this tenant."
      );
}

/**
 * The two key rings (encryption and HMAC, distinct; ADR-0137 section 3), or a
 * `503` BEFORE any work that would hash or encrypt a contact value.
 */
export function requireRings(): CrmLeadsRings | Response {
  const resolved = resolveCrmLeadsRings();

  return resolved.ok
    ? resolved.rings
    : fail(
        503,
        "KEY_RING_UNAVAILABLE",
        "Lead contact keys are not configured on this deployment."
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

/**
 * Parses and validates a JSON body without touching the database, under the
 * module's OWN ceiling (`CRM_LEADS_BODY_LIMIT_BYTES`, 32 KiB: the largest body
 * here is a 50-stage, 400-edge pipeline definition), far below the platform's
 * default tier. Error text never echoes a value.
 */
export async function readValidatedBody<T>(
  request: Request,
  validate: (raw: unknown) => Validated<T>
): Promise<T | Response> {
  const read = await readCappedText(request, CRM_LEADS_BODY_LIMIT_BYTES);

  if (read.tooLarge) return bodyTooLargeResponse(CRM_LEADS_BODY_LIMIT_BYTES);

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

/** One uniform answer for "no such id in this tenant": an id must not be enumerable. */
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

export function leadNotOpen(status: string): Response {
  return fail(
    409,
    "LEAD_NOT_OPEN",
    "This lead is not open for changes.",
    {},
    { status }
  );
}

/** The standard answer for the shared write refusals; `null` when the outcome is not one. */
export function leadWriteRefusalResponse(
  result:
    | { outcome: "not_found" }
    | { outcome: "version_conflict"; currentVersion: number }
    | { outcome: "not_open"; status: string }
    | { outcome: string }
): Response | null {
  switch (result.outcome) {
    case "not_found":
      return notFound("Lead");
    case "version_conflict":
      return versionConflict(
        (result as { currentVersion: number }).currentVersion
      );
    case "not_open":
      return leadNotOpen((result as { status: string }).status);
    default:
      return null;
  }
}

export function emitContext(
  context: {
    auth: AuthLike;
    locals: { correlationId?: string };
  },
  idempotencyKey: string | null
): EmitContext {
  return {
    correlationId: context.locals.correlationId ?? null,
    actorTenantUserId: context.auth.context.tenantUserId,
    idempotencyKey
  };
}

export async function auditCrmLeads(
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
    moduleKey: CRM_LEADS_MODULE_KEY,
    action: input.action,
    resourceType: input.resourceType,
    ...(input.resourceId ? { resourceId: input.resourceId } : {}),
    severity: input.severity,
    message: input.message,
    // Ids, fixed codes, stage keys and counts ONLY (ADR-0153 L6): never a name,
    // a contact value, a reason or a note.
    ...(input.attributes ? { attributes: input.attributes } : {}),
    ...(context.locals.correlationId
      ? { correlationId: context.locals.correlationId }
      : {})
  });
}

/**
 * What a mutation answers, and what is STORED for its replay, carries nothing
 * derived from the prospect's identity: no display name and no masked contact
 * form (only each contact point's id, kind and state). The replay body lives in
 * `awcms_idempotency_keys` for 30 days, outside the reach of the anonymising
 * erasure, so anything personal stored there would survive the person's erasure
 * request (ADR-0153 section 7; the precedent is
 * `data-lifecycle/domain/subject-export-payroll.ts`, which keeps payroll rows
 * out of the same table). Read the lead with GET for the masked view.
 */
export function redactForReplay(
  body: Record<string, unknown>
): Record<string, unknown> {
  const data: Record<string, unknown> = { ...body };

  delete data.displayName;

  if (Array.isArray(data.contactPoints)) {
    data.contactPoints = data.contactPoints.map((point) => {
      if (typeof point !== "object" || point === null) return point;

      const copy: Record<string, unknown> = {
        ...(point as Record<string, unknown>)
      };
      delete copy.masked;
      return copy;
    });
  }

  return data;
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

  const stored = {
    success: true as const,
    data: redactForReplay(produced.body),
    meta: {}
  };

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
