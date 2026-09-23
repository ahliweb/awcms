import { defineTenantRoute } from "../../../../../modules/_shared/tenant-route";
import {
  fail,
  jsonResponse,
  ok
} from "../../../../../modules/_shared/api-response";
import {
  computeRequestHash,
  findIdempotencyRecord,
  saveIdempotencyRecord
} from "../../../../../modules/_shared/idempotency";
import { OMES_GUARDS } from "../../../../../modules/omes-control/domain/permissions";
import {
  decommissionServer,
  fetchServerDetail
} from "../../../../../modules/omes-control/application/server-directory";
import { recordAuditEvent } from "../../../../../modules/logging/application/audit-log";

/**
 * `GET /api/v1/omes/servers/{id}` (Issue ahliweb/omes#198) — a single
 * server's fleet/enrollment/trust evidence. `{id}` is the AWCMS row uuid
 * (`awcms_omes_servers.id`), not OMES's own `server_id` text identifier —
 * the same convention every other detail route in this repo uses
 * (`sync/nodes/{id}`, `idn-regions/datasets/{id}`, ...). A row belonging to
 * another tenant is indistinguishable from a missing one (RLS + the same
 * 404 either way — no cross-tenant oracle).
 */
export const GET = defineTenantRoute<undefined>({
  workClass: "interactive",
  authorize: OMES_GUARDS.servers.read,
  handler: async ({ tx, tenantId, now, params }) => {
    const id = params.id;

    if (!id) {
      return fail(400, "VALIDATION_ERROR", "Server id is required.");
    }

    const server = await fetchServerDetail(tx, tenantId, id, now);

    if (!server) {
      return fail(404, "RESOURCE_NOT_FOUND", "Server not found.");
    }

    return ok({ server });
  }
});

const IDEMPOTENCY_SCOPE = "omes_server_decommission";

type DecommissionPrepared = { idempotencyKey: string };

/**
 * `DELETE /api/v1/omes/servers/{id}` (Issue ahliweb/omes#198) — decommission
 * (soft delete, doc 10). Guarded by `omes_control.servers.delete`.
 */
export const DELETE = defineTenantRoute<DecommissionPrepared>({
  workClass: "interactive",
  prepare: ({ request }): DecommissionPrepared | Response => {
    const idempotencyKey = request.headers.get("idempotency-key");

    if (!idempotencyKey) {
      return fail(
        400,
        "IDEMPOTENCY_REQUIRED",
        "Idempotency-Key header is required."
      );
    }

    return { idempotencyKey };
  },
  authorize: OMES_GUARDS.servers.delete,
  handler: async ({ tx, tenantId, now, auth, prepared, params, locals }) => {
    const id = params.id;

    if (!id) {
      return fail(400, "VALIDATION_ERROR", "Server id is required.");
    }

    const requestHash = computeRequestHash({
      action: "decommission",
      serverId: id
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

    const outcome = await decommissionServer(tx, tenantId, id, now);

    if (outcome.outcome === "not_found") {
      return fail(404, "RESOURCE_NOT_FOUND", "Server not found.");
    }

    await recordAuditEvent(tx, {
      tenantId,
      actorTenantUserId: auth.context.tenantUserId,
      moduleKey: "omes_control",
      action: "omes_control.servers.delete",
      resourceType: "omes_server",
      resourceId: outcome.server.id,
      severity: "warning",
      message: `Server "${outcome.server.hostname}" decommissioned.`,
      correlationId: locals.correlationId
    });

    const response = ok({ server: outcome.server });
    const responseBody = await response.clone().json();

    await saveIdempotencyRecord(
      tx,
      tenantId,
      IDEMPOTENCY_SCOPE,
      prepared.idempotencyKey,
      requestHash,
      200,
      responseBody
    );

    return response;
  }
});
