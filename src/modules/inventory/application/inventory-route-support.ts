/**
 * Shared plumbing for the `/api/v1/inventory/*` route files (Issue #887,
 * ADR-0126): body parsing, `Idempotency-Key` handling, the refusal -> HTTP
 * mapping, and the audit rows the posting endpoints write. Keeping these here
 * means thirteen thin route files cannot drift into thirteen spellings of the
 * same 409.
 *
 * Routes stay thin on purpose (skill `awcms-new-endpoint`): validate in
 * `prepare` (before a connection is taken), authorize through
 * `defineTenantRoute`, then call one application function.
 */
import { fail, jsonResponse } from "../../_shared/api-response";
import {
  computeRequestHash,
  findIdempotencyRecord,
  saveIdempotencyRecord
} from "../../_shared/idempotency";
import {
  bodyTooLargeResponse,
  readJsonBody
} from "../../../lib/security/request-body-limit";
import { recordAuditEvent } from "../../logging/application/audit-log";
import { authorizeInTransaction } from "../../identity-access/application/access-guard";
import {
  exceedsBackdateWindow,
  resolveBackdateWindowDays
} from "../domain/inventory-backdate";
import {
  INVENTORY_GUARDS,
  INVENTORY_MODULE_KEY
} from "../domain/inventory-permissions";
import type { Validated } from "../domain/inventory-validation";
import type { Movement } from "./inventory-rows";
import {
  isPostSuccess,
  type PostFailure,
  type PostResult,
  type PostSuccess
} from "./inventory-ledger";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The `Idempotency-Key` header, or the 400 that names it. Checked in `prepare`. */
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

/** Parses + validates a JSON body, answering the right 4xx without touching the database. */
export async function readValidatedBody<T>(
  request: Request,
  validate: (raw: unknown) => Validated<T>
): Promise<T | Response> {
  const bodyRead = await readJsonBody(request);

  if (bodyRead.tooLarge) {
    return bodyTooLargeResponse(bodyRead.limitBytes);
  }

  if (bodyRead.malformed) {
    return fail(400, "VALIDATION_ERROR", "Request body must be valid JSON.");
  }

  const validation = validate(bodyRead.value);

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

/** A uuid path/query parameter, or `null` when it is not one. */
export function asUuid(value: string | undefined | null): string | null {
  return value && UUID_PATTERN.test(value) ? value.toLowerCase() : null;
}

/**
 * Runs `produce` at most once per `(scope, Idempotency-Key)`:
 *
 *   * same key + same request hash  -> the STORED response, byte for byte;
 *   * same key + different hash     -> 409 IDEMPOTENCY_CONFLICT;
 *   * unseen key                    -> `produce()`, and a SUCCESS is stored.
 *
 * Refusals (an insufficient-stock 409, a validation 4xx) are NOT stored: the
 * caller is expected to fix something and retry, and a stored refusal would
 * keep answering "insufficient stock" after the stock arrived.
 *
 * A concurrent duplicate loses at `saveIdempotencyRecord`, which throws
 * `IdempotencyRaceLostError`; `withTenant` rolls the loser back and replays the
 * winner — so the "double submit in parallel does not post twice" rule holds
 * even before the ledger's own source-identity replay is consulted.
 */
export async function runIdempotent(
  tx: Bun.SQL,
  tenantId: string,
  scope: string,
  idempotencyKey: string,
  requestPayload: unknown,
  produce: () => Promise<{ status: number; body: unknown } | Response>
): Promise<Response> {
  const requestHash = computeRequestHash(requestPayload);
  const existing = await findIdempotencyRecord(
    tx,
    tenantId,
    scope,
    idempotencyKey
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

  if (produced instanceof Response) {
    return produced;
  }

  const body = { success: true as const, data: produced.body, meta: {} };

  await saveIdempotencyRecord(
    tx,
    tenantId,
    scope,
    idempotencyKey,
    requestHash,
    produced.status,
    body
  );

  return jsonResponse(body, { status: produced.status });
}

/**
 * The movement as the HTTP API shows it: WITHOUT `balanceAfter`. That field is a
 * snapshot of the balance, and the permission that reads movements
 * (`movements.read`) or posts them (`movements.create`) is not the permission
 * that reads balances (`balances.read`) — returning it would hand every poster a
 * running stock count. The ledger row keeps it (it is the second witness for
 * reconciliation) and the in-process port and the event payload carry it, because
 * those callers are composition roots that have already authorized.
 */
export function toApiMovement(
  movement: Movement
): Omit<Movement, "balanceAfter"> {
  const { balanceAfter: _balanceAfter, ...rest } = movement;

  return rest;
}

/**
 * Refuses a `occurredAt` older than the backdate window unless the caller also
 * holds `movements.adjust`. The extra permission check goes through the same
 * chokepoint and writes its own decision-log row, so an attempt to backdate
 * without it is visible, not just refused.
 */
export async function enforceBackdateWindow(
  tx: Bun.SQL,
  tenantId: string,
  tokenHash: string,
  now: Date,
  occurredAt: Date | null
): Promise<Response | null> {
  const windowDays = resolveBackdateWindowDays();

  if (!exceedsBackdateWindow(occurredAt, now, windowDays)) {
    return null;
  }

  const auth = await authorizeInTransaction(
    tx,
    tenantId,
    tokenHash,
    now,
    INVENTORY_GUARDS.movements.adjust
  );

  if (auth.allowed) {
    return null;
  }

  return fail(
    403,
    "BACKDATE_REQUIRES_ADJUST",
    `occurredAt is older than the ${windowDays}-day backdating window; dating a movement further back needs inventory.movements.adjust.`
  );
}

/** Maps a ledger refusal to its HTTP answer. Exhaustive: a new refusal fails to compile here. */
export function postFailureResponse(failure: PostFailure): Response {
  switch (failure.outcome) {
    case "location_not_found":
      return fail(
        404,
        "LOCATION_NOT_FOUND",
        "Stock location not found.",
        {},
        {
          locationId: failure.locationId
        }
      );
    case "location_inactive":
      return fail(
        409,
        "LOCATION_INACTIVE",
        "Stock location is inactive; reactivate it before posting.",
        {},
        { locationId: failure.locationId }
      );
    case "unit_mismatch":
      return fail(
        409,
        "UNIT_MISMATCH",
        `This item is stocked in unit "${failure.expectedUnitCode}" at this location; the ledger does not convert units.`,
        {},
        {
          locationId: failure.locationId,
          expectedUnitCode: failure.expectedUnitCode
        }
      );
    case "insufficient_stock":
      return fail(
        409,
        "INSUFFICIENT_STOCK",
        "Not enough stock, and the negative-stock policy forbids going below zero.",
        {},
        // `onHand` is deliberately NOT returned: it is the caller's way to read a
        // balance, and `movements.create` is not `balances.read`. A caller that
        // may see balances has the balances endpoint; one that may not should not
        // be able to binary-search a quantity out of refusals.
        {
          locationId: failure.locationId,
          requested: failure.requested
        }
      );
    case "quantity_out_of_range":
      return fail(
        422,
        "QUANTITY_OUT_OF_RANGE",
        "The resulting balance would exceed the largest quantity the ledger can hold (numeric(20,6)).",
        {},
        { locationId: failure.locationId }
      );
    case "source_conflict":
      return fail(
        409,
        "SOURCE_CONFLICT",
        "This source identity was already posted with a different request.",
        {}
      );
    case "opening_not_first":
      return fail(
        409,
        "OPENING_NOT_FIRST",
        "An opening movement must be the first movement for its (location, item); correct a balance with an adjustment instead.",
        {},
        { locationId: failure.locationId }
      );
    case "target_not_found":
      return fail(404, "RESOURCE_NOT_FOUND", "Movement not found.");
    case "not_reversible":
      return fail(409, "NOT_REVERSIBLE", failure.reason);
  }
}

export type PostedAuditShape = {
  action: string;
  severity: "info" | "warning";
  message: string;
  reasonCode?: string | null;
};

/**
 * Writes the audit row for a POSTED movement set. Never called for a replay —
 * a retry is not a second event. The note is deliberately absent: it is free
 * text, the audit log is read by more people than the ledger is, and the ledger
 * row already carries it.
 */
export async function auditPostedMovements(
  tx: Bun.SQL,
  tenantId: string,
  actorTenantUserId: string | null,
  correlationId: string | undefined,
  success: PostSuccess,
  shape: PostedAuditShape
): Promise<void> {
  const first = success.movements[0]!;

  await recordAuditEvent(tx, {
    tenantId,
    actorTenantUserId: actorTenantUserId ?? undefined,
    moduleKey: INVENTORY_MODULE_KEY,
    action: shape.action,
    resourceType: "inventory_movement",
    resourceId: first.id,
    severity: shape.severity,
    message: shape.message,
    attributes: {
      movementIds: success.movements.map((movement) => movement.id),
      itemType: first.itemType,
      itemRef: first.itemRef,
      unitCode: first.unitCode,
      movements: success.movements.map((movement) => ({
        locationId: movement.locationId,
        movementType: movement.movementType,
        quantityDelta: movement.quantityDelta
      })),
      sourceType: first.source.type,
      sourceId: first.source.id,
      sourceLine: first.source.line,
      transferId: first.transferId,
      reversesMovementId: first.reversesMovementId,
      reasonCode: shape.reasonCode ?? first.reasonCode
    },
    correlationId
  });
}

/**
 * The success half of every posting endpoint: audit once (never on a replay),
 * then answer 201 for a new posting and 200 for a replay of the original.
 */
export async function postedResult(
  tx: Bun.SQL,
  tenantId: string,
  actorTenantUserId: string | null,
  correlationId: string | undefined,
  result: PostResult,
  audit: (success: PostSuccess) => PostedAuditShape
): Promise<{ status: number; body: unknown } | Response> {
  if (!isPostSuccess(result)) {
    return postFailureResponse(result);
  }

  if (result.outcome === "posted") {
    await auditPostedMovements(
      tx,
      tenantId,
      actorTenantUserId,
      correlationId,
      result,
      audit(result)
    );
  }

  return {
    status: result.outcome === "posted" ? 201 : 200,
    body: {
      replayed: result.outcome === "replayed",
      movements: result.movements.map(toApiMovement)
    }
  };
}
