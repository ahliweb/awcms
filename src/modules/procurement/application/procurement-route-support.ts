/**
 * Shared plumbing for the `/api/v1/procurement/*` route files (Issue #888,
 * ADR-0128): body parsing, `Idempotency-Key` handling, query parsing and the
 * refusal -> HTTP mapping. Keeping these here means the route files stay thin
 * and cannot drift into different spellings of the same 409.
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
import {
  DOCUMENT_MODES,
  DOCUMENT_STATUSES,
  SUPPLIER_STATUSES
} from "../domain/procurement-types";
import type { Validated } from "../domain/procurement-validation";
import type { DocumentWriteFailure } from "./procurement-document-directory";
import type { PostingFailure } from "./procurement-posting";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const LABEL_PATTERN = /^[a-z0-9][a-z0-9_.-]{0,63}$/;

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

/** Parses + validates a JSON body (absent body = `null`), answering the right 4xx without touching the database. */
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

export function badId(field = "id"): Response {
  return fail(400, "VALIDATION_ERROR", `${field} must be a UUID.`);
}

function badQuery(field: string, message: string): Response {
  return fail(400, "VALIDATION_ERROR", `${field}: ${message}`);
}

/** Query filters shared by the list endpoints, or the 400 naming the bad one. */
export function readDocumentFilters(url: URL):
  | {
      mode?: string;
      status?: string;
      supplierId?: string;
      locationId?: string;
      cursor: string | null;
    }
  | Response {
  const mode = url.searchParams.get("mode") ?? undefined;
  const status = url.searchParams.get("status") ?? undefined;
  const supplierId = url.searchParams.get("supplierId") ?? undefined;
  const locationId = url.searchParams.get("locationId") ?? undefined;

  if (mode && !(DOCUMENT_MODES as readonly string[]).includes(mode)) {
    return badQuery("mode", `must be one of ${DOCUMENT_MODES.join(", ")}.`);
  }

  if (status && !(DOCUMENT_STATUSES as readonly string[]).includes(status)) {
    return badQuery(
      "status",
      `must be one of ${DOCUMENT_STATUSES.join(", ")}.`
    );
  }

  if (supplierId && !asUuid(supplierId)) {
    return badQuery("supplierId", "must be a UUID.");
  }

  if (locationId && !asUuid(locationId)) {
    return badQuery("locationId", "must be a UUID.");
  }

  return {
    mode,
    status,
    supplierId: supplierId ? asUuid(supplierId)! : undefined,
    locationId: locationId ? asUuid(locationId)! : undefined,
    cursor: url.searchParams.get("cursor")
  };
}

export function readSupplierFilters(url: URL):
  | {
      status?: string;
      category?: string;
      tag?: string;
      includeDeleted: boolean;
      cursor: string | null;
    }
  | Response {
  const status = url.searchParams.get("status") ?? undefined;
  const category = url.searchParams.get("category") ?? undefined;
  const tag = url.searchParams.get("tag") ?? undefined;
  const includeDeleted = url.searchParams.get("includeDeleted");

  if (status && !(SUPPLIER_STATUSES as readonly string[]).includes(status)) {
    return badQuery(
      "status",
      `must be one of ${SUPPLIER_STATUSES.join(", ")}.`
    );
  }

  if (category && !LABEL_PATTERN.test(category)) {
    return badQuery("category", "is not a valid label.");
  }

  if (tag && !LABEL_PATTERN.test(tag)) {
    return badQuery("tag", "is not a valid label.");
  }

  if (
    includeDeleted &&
    includeDeleted !== "true" &&
    includeDeleted !== "false"
  ) {
    return badQuery("includeDeleted", "must be true or false.");
  }

  return {
    status,
    category,
    tag,
    includeDeleted: includeDeleted === "true",
    cursor: url.searchParams.get("cursor")
  };
}

export function readDateRange(
  url: URL
): { from: string | null; to: string | null } | Response {
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");

  for (const [field, value] of [
    ["from", from],
    ["to", to]
  ] as const) {
    if (
      value !== null &&
      (!DATE_PATTERN.test(value) ||
        new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value)
    ) {
      return badQuery(field, "must be a calendar date, YYYY-MM-DD.");
    }
  }

  return { from, to };
}

/**
 * Runs `produce` at most once per `(scope, Idempotency-Key, acting user)`:
 *
 *   * same key + same request hash  -> the STORED response, byte for byte;
 *   * same key + different hash     -> 409 IDEMPOTENCY_CONFLICT;
 *   * unseen key                    -> `produce()`, and a SUCCESS is stored.
 *
 * Refusals are NOT stored: the caller fixes something and retries. A concurrent
 * duplicate loses at `saveIdempotencyRecord` and `withTenant` replays the winner.
 */
export async function runIdempotent(
  tx: Bun.SQL,
  tenantId: string,
  scope: string,
  idempotencyKey: string,
  actorTenantUserId: string,
  requestPayload: unknown,
  produce: () => Promise<{ status: number; body: unknown } | Response>
): Promise<Response> {
  // The record is keyed `(tenant, scope, key)`, shared by every user of the
  // tenant, and a stored response can carry document detail. Binding the actor
  // into the request hash means a second user presenting the same key does not
  // get the first user's response replayed: they get 409 IDEMPOTENCY_CONFLICT.
  const requestHash = computeRequestHash({
    actor: actorTenantUserId,
    request: requestPayload
  });
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

/** Maps a document write refusal to its HTTP answer. Exhaustive. */
export function documentFailureResponse(
  failure: DocumentWriteFailure | PostingFailure
): Response {
  switch (failure.outcome) {
    case "not_found":
      return fail(404, "RESOURCE_NOT_FOUND", "Document not found.");
    case "invalid_state":
      return fail(
        409,
        "INVALID_STATE",
        `The document is ${failure.status}, which does not allow this operation.`,
        {},
        { status: failure.status }
      );
    case "mode_immutable":
      return fail(
        409,
        "MODE_IMMUTABLE",
        "A document's mode cannot change; create a new document instead."
      );
    case "location_not_found":
      return fail(
        422,
        "LOCATION_NOT_FOUND",
        "Stock location not found.",
        {},
        { field: failure.field }
      );
    case "supplier_not_found":
      return fail(422, "SUPPLIER_NOT_FOUND", "Supplier not found.");
    case "supplier_unavailable":
      return fail(
        409,
        "SUPPLIER_UNAVAILABLE",
        `The supplier is ${failure.reason} and cannot take part in this document.`,
        {},
        { reason: failure.reason }
      );
    case "duplicate_external_reference":
      return fail(
        409,
        "DUPLICATE_EXTERNAL_REFERENCE",
        "A live document already uses this external reference for this supplier; cancel it first or use a different reference."
      );
    case "approval_pending":
      return fail(
        409,
        "APPROVAL_PENDING",
        "The document is waiting for approval and cannot be finalised yet."
      );
    case "approval_rejected":
      return fail(
        409,
        "APPROVAL_REJECTED",
        "The approval workflow rejected this document; cancel it instead."
      );
    case "ledger_refused":
      return ledgerRefusalResponse(failure);
  }
}

function ledgerRefusalResponse(
  failure: Extract<PostingFailure, { outcome: "ledger_refused" }>
): Response {
  const { refusal, lineNo } = failure;

  switch (refusal.outcome) {
    case "insufficient_stock":
      // `onHand` is deliberately NOT returned (it would let a poster read a
      // balance without `inventory.balances.read`).
      return fail(
        409,
        "INSUFFICIENT_STOCK",
        "Not enough stock at the location, and the negative-stock policy forbids going below zero. Nothing was posted.",
        {},
        { lineNo, locationId: refusal.locationId }
      );
    case "unit_mismatch":
      return fail(
        409,
        "UNIT_MISMATCH",
        `This item is stocked in unit "${refusal.expectedUnitCode}" at this location; the ledger does not convert units. Nothing was posted.`,
        {},
        { lineNo, locationId: refusal.locationId }
      );
    case "location_not_found":
      return fail(
        422,
        "LOCATION_NOT_FOUND",
        "Stock location not found. Nothing was posted.",
        {},
        { lineNo, locationId: refusal.locationId }
      );
    case "location_inactive":
      return fail(
        409,
        "LOCATION_INACTIVE",
        "A stock location is inactive; reactivate it before posting. Nothing was posted.",
        {},
        { lineNo, locationId: refusal.locationId }
      );
    case "quantity_out_of_range":
      return fail(
        422,
        "QUANTITY_OUT_OF_RANGE",
        "The resulting balance would exceed the largest quantity the ledger can hold. Nothing was posted.",
        {},
        { lineNo, locationId: refusal.locationId }
      );
    case "source_conflict":
      return fail(
        409,
        "SOURCE_CONFLICT",
        "The ledger already holds a different posting under this document's identity. Nothing was posted; reconcile before retrying.",
        {},
        { lineNo }
      );
  }
}
