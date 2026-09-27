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
import {
  bodyTooLargeResponse,
  readJsonBody
} from "../../../../../lib/security/request-body-limit";
import { OMES_GUARDS } from "../../../../../modules/omes-control/domain/permissions";
import {
  clearRepositoryProgressConfig,
  getRepositoryProgressConfig,
  setRepositoryProgressConfig
} from "../../../../../modules/omes-control/application/repository-progress-config";
import { recordAuditEvent } from "../../../../../modules/logging/application/audit-log";

const IDEMPOTENCY_SCOPE_SET = "omes_repository_progress_configure_set";
const IDEMPOTENCY_SCOPE_CLEAR = "omes_repository_progress_configure_clear";

/**
 * `GET /api/v1/omes/repository-progress/config` (Issue ahliweb/omes#249) —
 * the tenant's current repository-progress configuration (or `null` if
 * unconfigured), for the `/admin/omes/progres-hermes` settings form. Reuses
 * `omes_control.hermes_orchestration.read` (the same read gate as the
 * projection itself) — reading the current setting is not the sensitive
 * action here, changing it is (see `PUT`/`DELETE` below).
 */
export const GET = defineTenantRoute({
  workClass: "interactive",
  authorize: OMES_GUARDS.hermesOrchestration.read,
  handler: async ({ tx, tenantId }) => {
    const config = await getRepositoryProgressConfig(tx, tenantId);
    return ok({ config });
  }
});

type SetBody = { owner?: unknown; name?: unknown; useToken?: unknown };
type Prepared = {
  idempotencyKey: string;
  owner: string;
  name: string;
  useToken: boolean;
};

/**
 * `PUT /api/v1/omes/repository-progress/config` — sets (or replaces) the
 * tenant's observed repository. Guarded by
 * `omes_control.repository_progress.configure` — a NEW, distinct write
 * permission from the read permission above (sql/167's header). Requires an
 * `Idempotency-Key` header (same convention as
 * `POST /api/v1/omes/jobs/{id}/approve`).
 *
 * `owner`/`name` are re-validated against the GitHub identifier charset in
 * `application/repository-progress-config.ts` (never trust the client) —
 * this is also, structurally, the "github.com only" requirement: the stored
 * `html_url` is always built server-side from the validated owner/name via
 * `buildRepositoryHtmlUrl`, never accepted as client input, so there is no
 * field here through which a non-github.com URL could ever be stored.
 */
export const PUT = defineTenantRoute<Prepared>({
  workClass: "interactive",
  prepare: async ({ request }): Promise<Prepared | Response> => {
    const idempotencyKey = request.headers.get("idempotency-key");
    if (!idempotencyKey) {
      return fail(
        400,
        "IDEMPOTENCY_REQUIRED",
        "Idempotency-Key header is required."
      );
    }

    const bodyRead = await readJsonBody<SetBody>(request);

    if (bodyRead.tooLarge) {
      return bodyTooLargeResponse(bodyRead.limitBytes);
    }
    if (bodyRead.malformed) {
      return fail(400, "VALIDATION_ERROR", "Request body must be valid JSON.");
    }

    const body: SetBody = bodyRead.value ?? {};

    if (typeof body.owner !== "string" || typeof body.name !== "string") {
      return fail(
        400,
        "VALIDATION_ERROR",
        '"owner" and "name" are required strings.'
      );
    }

    return {
      idempotencyKey,
      owner: body.owner,
      name: body.name,
      useToken: body.useToken === true
    };
  },
  authorize: OMES_GUARDS.repositoryProgress.configure,
  handler: async ({ tx, tenantId, auth, prepared, locals }) => {
    const requestHash = computeRequestHash({
      action: "set",
      owner: prepared.owner,
      name: prepared.name,
      useToken: prepared.useToken
    });
    const existing = await findIdempotencyRecord(
      tx,
      tenantId,
      IDEMPOTENCY_SCOPE_SET,
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

    const outcome = await setRepositoryProgressConfig(tx, tenantId, {
      owner: prepared.owner,
      name: prepared.name,
      useToken: prepared.useToken
    });

    if (outcome.outcome === "invalid_owner_or_name") {
      return fail(
        400,
        "VALIDATION_ERROR",
        "\"owner\" and \"name\" must each be 1-100 GitHub-identifier characters (letters, digits, '.', '_', '-')."
      );
    }

    await recordAuditEvent(tx, {
      tenantId,
      actorTenantUserId: auth.context.tenantUserId,
      moduleKey: "omes_control",
      action: "omes_control.repository_progress.configure",
      resourceType: "omes_repository_progress_config",
      resourceId: tenantId,
      severity: "info",
      message: `Repository-progress configuration set to ${outcome.config.owner}/${outcome.config.name}.`,
      attributes: {
        owner: outcome.config.owner,
        name: outcome.config.name,
        usesToken: outcome.config.usesToken
      },
      correlationId: locals.correlationId
    });

    const response = ok({ config: outcome.config });
    const responseBody = await response.clone().json();
    await saveIdempotencyRecord(
      tx,
      tenantId,
      IDEMPOTENCY_SCOPE_SET,
      prepared.idempotencyKey,
      requestHash,
      200,
      responseBody
    );

    return response;
  }
});

type ClearPrepared = { idempotencyKey: string };

/**
 * `DELETE /api/v1/omes/repository-progress/config` — clears the tenant's
 * configuration (back to the "unconfigured" screen state) and any existing
 * projection row. Same guard/idempotency shape as `PUT` above.
 */
export const DELETE = defineTenantRoute<ClearPrepared>({
  workClass: "interactive",
  prepare: ({ request }): ClearPrepared | Response => {
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
  authorize: OMES_GUARDS.repositoryProgress.configure,
  handler: async ({ tx, tenantId, auth, prepared, locals }) => {
    const requestHash = computeRequestHash({ action: "clear" });
    const existing = await findIdempotencyRecord(
      tx,
      tenantId,
      IDEMPOTENCY_SCOPE_CLEAR,
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

    await clearRepositoryProgressConfig(tx, tenantId);

    await recordAuditEvent(tx, {
      tenantId,
      actorTenantUserId: auth.context.tenantUserId,
      moduleKey: "omes_control",
      action: "omes_control.repository_progress.configure",
      resourceType: "omes_repository_progress_config",
      resourceId: tenantId,
      severity: "info",
      message: "Repository-progress configuration cleared.",
      attributes: {},
      correlationId: locals.correlationId
    });

    const response = ok({ cleared: true });
    const responseBody = await response.clone().json();
    await saveIdempotencyRecord(
      tx,
      tenantId,
      IDEMPOTENCY_SCOPE_CLEAR,
      prepared.idempotencyKey,
      requestHash,
      200,
      responseBody
    );

    return response;
  }
});
