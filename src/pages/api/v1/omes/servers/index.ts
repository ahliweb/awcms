import { defineTenantRoute } from "../../../../../modules/_shared/tenant-route";
import {
  created,
  fail,
  jsonResponse,
  ok
} from "../../../../../modules/_shared/api-response";
import { decodeKeysetCursor } from "../../../../../modules/_shared/keyset-pagination";
import type { KeysetCursor } from "../../../../../modules/_shared/keyset-pagination";
import {
  computeRequestHash,
  findIdempotencyRecord,
  saveIdempotencyRecord
} from "../../../../../modules/_shared/idempotency";
import { checkSharedRateLimit } from "../../../../../lib/security/rate-limit";
import { OMES_GUARDS } from "../../../../../modules/omes-control/domain/permissions";
import {
  fetchServers,
  registerServer
} from "../../../../../modules/omes-control/application/server-directory";
import { validateServerRegistrationInput } from "../../../../../modules/omes-control/domain/server-registration";
import { recordAuditEvent } from "../../../../../modules/logging/application/audit-log";

/**
 * `GET /api/v1/omes/servers` (Issue ahliweb/omes#198) — tenant-scoped fleet
 * inventory list, keyset-paginated, with a computed `stale` flag (no
 * heartbeat, or older than the threshold in
 * `src/modules/omes-control/domain/staleness.ts`). Sanitized: no enrollment
 * key material here (see the `/servers/{id}` detail route for the
 * fingerprint-only enrollment evidence).
 */
const VALID_STATUS_FILTERS = new Set([
  "offline",
  "online",
  "degraded",
  "maintenance",
  "decommissioned"
]);

type Prepared = { status: string | null; cursor: KeysetCursor | undefined };

export const GET = defineTenantRoute<Prepared>({
  workClass: "interactive",
  prepare: ({ url }): Prepared | Response => {
    const status = url.searchParams.get("status");
    if (status !== null && !VALID_STATUS_FILTERS.has(status)) {
      return fail(400, "VALIDATION_ERROR", "status is not a known value.");
    }

    const rawCursor = url.searchParams.get("cursor");
    if (rawCursor === null) {
      return { status, cursor: undefined };
    }

    const cursor = decodeKeysetCursor(rawCursor);
    if (!cursor) {
      return fail(400, "VALIDATION_ERROR", "cursor is not a valid cursor.");
    }

    return { status, cursor };
  },
  authorize: OMES_GUARDS.servers.read,
  handler: async ({ tx, tenantId, now, prepared }) =>
    ok(
      await fetchServers(tx, tenantId, now, {
        status: prepared.status ?? undefined,
        cursor: prepared.cursor
      })
    )
});

const IDEMPOTENCY_SCOPE = "omes_server_register";

/** Registration is source-scoped, not tenant-scoped (Issue #447 precedent). */
const REGISTER_RATE_LIMIT = { maxAttempts: 20, windowMs: 60_000 };

type RegisterPrepared =
  | { valid: true; idempotencyKey: string; body: unknown }
  | { valid: false; response: Response };

/**
 * `POST /api/v1/omes/servers` (Issue ahliweb/omes#198) — registers a new
 * server's fleet-inventory row (`status = 'offline'`). Guarded by
 * `omes_control.servers.register`. This never reaches a host: the server
 * becomes reachable only once its pull worker later completes the
 * enrollment-challenge exchange (`POST .../{id}/enrollment-challenges`,
 * `ahliweb/omes#199`).
 */
export const POST = defineTenantRoute<RegisterPrepared>({
  workClass: "interactive",
  prepare: async ({ request }): Promise<RegisterPrepared> => {
    const idempotencyKey = request.headers.get("idempotency-key");

    if (!idempotencyKey) {
      return {
        valid: false,
        response: fail(
          400,
          "IDEMPOTENCY_REQUIRED",
          "Idempotency-Key header is required."
        )
      };
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return {
        valid: false,
        response: fail(
          400,
          "VALIDATION_ERROR",
          "Request body must be valid JSON."
        )
      };
    }

    return { valid: true, idempotencyKey, body };
  },
  authorize: OMES_GUARDS.servers.register,
  handler: async ({ tx, tenantId, now, auth, prepared, locals }) => {
    if (!prepared.valid) {
      return prepared.response;
    }

    const validation = validateServerRegistrationInput(prepared.body);

    if (!validation.valid) {
      return fail(
        400,
        "VALIDATION_ERROR",
        "Server registration input is invalid.",
        {},
        validation.errors
      );
    }

    const requestHash = computeRequestHash({
      action: "register_server",
      input: validation.value
    });
    const existing = await findIdempotencyRecord(
      tx,
      tenantId,
      IDEMPOTENCY_SCOPE,
      prepared.idempotencyKey
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

    const rateLimit = await checkSharedRateLimit(
      `omes-server-register:${auth.context.tenantUserId}`,
      REGISTER_RATE_LIMIT,
      now.getTime()
    );

    if (!rateLimit.allowed) {
      return fail(
        429,
        "RATE_LIMITED",
        "Too many server registration attempts. Try again shortly.",
        {},
        undefined,
        { "retry-after": String(rateLimit.retryAfterSec) }
      );
    }

    const outcome = await registerServer(tx, tenantId, now, validation.value);

    await recordAuditEvent(tx, {
      tenantId,
      actorTenantUserId: auth.context.tenantUserId,
      moduleKey: "omes_control",
      action: "omes_control.servers.register",
      resourceType: "omes_server",
      resourceId: outcome.server.id,
      severity: "info",
      message:
        outcome.outcome === "registered"
          ? `Server "${outcome.server.hostname}" registered.`
          : `Server "${outcome.server.hostname}" was already registered — returned the existing row.`,
      attributes: {
        hostname: outcome.server.hostname,
        alreadyRegistered: outcome.outcome === "already_registered"
      },
      correlationId: locals.correlationId
    });

    const response = created({ server: outcome.server });
    const responseBody = await response.clone().json();

    await saveIdempotencyRecord(
      tx,
      tenantId,
      IDEMPOTENCY_SCOPE,
      prepared.idempotencyKey,
      requestHash,
      201,
      responseBody
    );

    return response;
  }
});
