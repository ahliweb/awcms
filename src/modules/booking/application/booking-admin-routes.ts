/**
 * The shared handler plumbing of the booking ADMIN configuration routes (Issue
 * #1030): query parsing for the lists, and the one idempotent-mutation wrapper
 * every write route calls. Each route file still calls `defineTenantRoute`
 * itself, so the route and permission-enforcement scans read the guard where it
 * sits.
 *
 * ## The order of a write, and why
 *
 *   1. the route has ALREADY authorised the verb (default deny) and validated the
 *      header and body before any database work;
 *   2. {@link runIdempotent}: a stored response for this key (same acting user,
 *      same request) is returned byte for byte, a reused key with a different
 *      request is `409 IDEMPOTENCY_CONFLICT`, concurrent requests with one key
 *      are serialised by the per-key advisory lock;
 *   3. the service call: a refusal is returned as a value and stored nowhere (it
 *      wrote nothing), a success is stored with its status.
 */
import { fail } from "../../_shared/api-response";
import { resolveClientIp } from "../../../lib/security/rate-limit";
import { authorizeInTransaction } from "../../identity-access/application/access-guard";
import {
  decodeKeysetCursor,
  type KeysetCursor
} from "../../_shared/keyset-pagination";
import type { AuthorizedAccess } from "../../_shared/tenant-route";
import { runIdempotent } from "./booking-route-support";
import {
  refusalResponse,
  type AdminActor,
  type AdminRefusal,
  type DeletedFilter
} from "./booking-admin-support";

type RouteLocals = { correlationId?: string };

export function actorOf(
  auth: AuthorizedAccess,
  locals: RouteLocals
): AdminActor {
  return {
    actorTenantUserId: auth.context.tenantUserId,
    ...(locals.correlationId ? { correlationId: locals.correlationId } : {})
  };
}

export type AdminListQuery<F> = { filters: F; cursor: KeysetCursor | null };

/**
 * `?includeDeleted=true` (live and soft-deleted) or `?onlyDeleted=true` (only the
 * soft-deleted), default neither, and `?cursor=`; or the 400 that names the
 * problem. A request for deleted rows also needs the `.restore` permission
 * ({@link authorizeDeletedView}, the ADR-0128 rule).
 */
export function parseListQuery<F extends object>(
  url: URL,
  extra: (params: URLSearchParams) => F | Response
): AdminListQuery<F & { deleted: DeletedFilter }> | Response {
  const includeDeleted = url.searchParams.get("includeDeleted");
  const onlyDeleted = url.searchParams.get("onlyDeleted");

  for (const [name, value] of [
    ["includeDeleted", includeDeleted],
    ["onlyDeleted", onlyDeleted]
  ] as const) {
    if (value && value !== "true" && value !== "false") {
      return fail(400, "VALIDATION_ERROR", `${name} must be true or false.`);
    }
  }

  const deleted: DeletedFilter =
    onlyDeleted === "true"
      ? "only"
      : includeDeleted === "true"
        ? "include"
        : "exclude";

  const cursorText = url.searchParams.get("cursor");
  const cursor = cursorText ? decodeKeysetCursor(cursorText) : null;

  if (cursorText && !cursor) {
    return fail(400, "VALIDATION_ERROR", "cursor is not valid.");
  }

  const filters = extra(url.searchParams);

  if (filters instanceof Response) {
    return filters;
  }

  return { filters: { ...filters, deleted }, cursor };
}

/** An enum query parameter, `undefined` when absent, or the 400. */
export function enumParam<T extends string>(
  params: URLSearchParams,
  name: string,
  values: readonly T[]
): T | undefined | Response {
  const value = params.get(name);

  if (value === null || value === "") {
    return undefined;
  }

  return (values as readonly string[]).includes(value)
    ? (value as T)
    : fail(400, "VALIDATION_ERROR", `${name} must be ${values.join(" or ")}.`);
}

type GuardLiteral = Parameters<typeof authorizeInTransaction>[4];

/**
 * Whether the caller may see SOFT-DELETED rows: they must also hold the
 * `.restore` permission of the same area (booking.md section 6, the ADR-0128
 * rule). Through the one access chokepoint, so ABAC and the decision log apply;
 * ADR-0092: a hand-written call passes the client IP explicitly. A refusal is
 * the denial the chokepoint produced.
 */
export async function authorizeDeletedView(
  tx: Bun.SQL,
  tenantId: string,
  tokenHash: string,
  now: Date,
  restoreGuard: GuardLiteral,
  request: Request,
  clientAddress: string | undefined
): Promise<{ allowed: true } | { allowed: false; denied: Response }> {
  const decision = await authorizeInTransaction(
    tx,
    tenantId,
    tokenHash,
    now,
    restoreGuard,
    { clientIp: resolveClientIp(request, clientAddress) }
  );

  return decision.allowed
    ? { allowed: true }
    : { allowed: false, denied: decision.denied };
}

/** {@link authorizeDeletedView} as the `canSeeDeleted` callback the write services take; called only when the row is already deleted. */
export function deletedViewer(
  tx: Bun.SQL,
  tenantId: string,
  tokenHash: string,
  now: Date,
  restoreGuard: GuardLiteral,
  request: Request,
  clientAddress: string | undefined
): () => Promise<boolean> {
  return async () =>
    (
      await authorizeDeletedView(
        tx,
        tenantId,
        tokenHash,
        now,
        restoreGuard,
        request,
        clientAddress
      )
    ).allowed;
}

type Outcome<T> = ({ outcome: "ok"; replayed: boolean } & T) | AdminRefusal;

/**
 * Runs one admin write under `Idempotency-Key`. `successStatus` is the status of
 * the FIRST success (201 for a create); a replayed state-check success is 200.
 * The stored response is the success body, so a retry of a create returns the
 * same 201 and body, never a `CODE_TAKEN` about its own row.
 */
export function runAdminMutation<T extends object>(
  tx: Bun.SQL,
  tenantId: string,
  auth: AuthorizedAccess,
  scope: string,
  idempotencyKey: string,
  payload: unknown,
  successStatus: 200 | 201,
  produce: () => Promise<Outcome<T>>,
  toBody: (result: { outcome: "ok"; replayed: boolean } & T) => unknown
): Promise<Response> {
  return runIdempotent(
    tx,
    tenantId,
    scope,
    idempotencyKey,
    auth.context.tenantUserId,
    payload,
    async () => {
      const result = await produce();

      if (result.outcome === "refused") {
        return refusalResponse(result);
      }

      return {
        status: result.replayed ? 200 : successStatus,
        body: toBody(result)
      };
    }
  );
}
