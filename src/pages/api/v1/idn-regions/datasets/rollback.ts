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
  IDN_ADMIN_REGIONS_MODULE_KEY,
  IDN_DATASET_ACTIVITY_CODE
} from "../../../../../modules/idn-admin-regions/domain/idn-admin-regions-permissions";
import {
  DatasetLifecycleError,
  rollbackActiveDataset
} from "../../../../../modules/idn-admin-regions/application/dataset-lifecycle";
import { recordAuditEvent } from "../../../../../modules/logging/application/audit-log";

/**
 * `POST /api/v1/idn-regions/datasets/rollback` (ADR-0046 §4) — go back to the
 * dataset version that was active before the current one.
 *
 * The target is resolved from `activated_at` history, NOT from a client-supplied
 * id: "roll back" means one specific thing, and letting the caller name the
 * destination would make it an activation wearing a safer-sounding name. The
 * previous version's rows were never deleted (an import writes a new set beside
 * the old one), so this is a status flip, not a re-import.
 *
 * Same guarantees as activation: ABAC-gated, `Idempotency-Key` required, audited
 * with both dataset codes.
 */
const IDEMPOTENCY_SCOPE = "idn_regions_dataset_rollback";

type Prepared = { idempotencyKey: string };

export const POST = defineTenantRoute<Prepared>({
  workClass: "interactive",
  prepare: ({ request }) => {
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
  authorize: {
    moduleKey: IDN_ADMIN_REGIONS_MODULE_KEY,
    activityCode: IDN_DATASET_ACTIVITY_CODE,
    action: "restore"
  },
  handler: async ({ tx, auth, prepared, tenantId, locals }) => {
    const requestHash = computeRequestHash({ action: "rollback" });
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

    let result: Awaited<ReturnType<typeof rollbackActiveDataset>>;

    try {
      result = await rollbackActiveDataset(tx, {
        activatedBy: auth.context.tenantUserId
      });
    } catch (error) {
      if (error instanceof DatasetLifecycleError) {
        return fail(409, error.code, error.message);
      }
      throw error;
    }

    await recordAuditEvent(tx, {
      tenantId,
      actorTenantUserId: auth.context.tenantUserId,
      moduleKey: IDN_ADMIN_REGIONS_MODULE_KEY,
      action: "idn_admin_regions.dataset.rollback",
      resourceType: "idn_region_dataset",
      resourceId: result.dataset.id,
      severity: "warning",
      message: "Indonesia region dataset rolled back to the previous version.",
      attributes: {
        datasetCode: result.dataset.datasetCode,
        rowCount: result.dataset.rowCount,
        rolledBackFromId: result.rolledBackFromId
      },
      correlationId: locals.correlationId
    });

    const response = ok({ dataset: result.dataset });
    const body = await response.clone().json();

    await saveIdempotencyRecord(
      tx,
      tenantId,
      IDEMPOTENCY_SCOPE,
      prepared.idempotencyKey,
      requestHash,
      200,
      body
    );

    return response;
  }
});
