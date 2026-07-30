import { defineTenantRoute } from "../../../../../../modules/_shared/tenant-route";
import {
  fail,
  jsonResponse,
  ok
} from "../../../../../../modules/_shared/api-response";
import {
  computeRequestHash,
  findIdempotencyRecord,
  saveIdempotencyRecord
} from "../../../../../../modules/_shared/idempotency";
import {
  IDN_ADMIN_REGIONS_MODULE_KEY,
  IDN_DATASET_ACTIVITY_CODE
} from "../../../../../../modules/idn-admin-regions/domain/idn-admin-regions-permissions";
import {
  activateDataset,
  DatasetLifecycleError
} from "../../../../../../modules/idn-admin-regions/application/dataset-lifecycle";
import { recordAuditEvent } from "../../../../../../modules/logging/application/audit-log";

/**
 * `POST /api/v1/idn-regions/datasets/{id}/activate` (ADR-0046 §5) — make one
 * imported dataset version the one the platform SERVES.
 *
 * High-risk by consequence rather than by blast radius in rows: it changes what
 * every address form, coverage map, and regional report in the product returns,
 * for every tenant at once, and it is the kind of change nobody notices until a
 * village is missing. So: ABAC-gated, `Idempotency-Key` required, audited with
 * the dataset codes on both sides of the switch.
 *
 * The single-active rule itself is a partial unique index in the database, not a
 * check here — two concurrent activations end with one committed and one
 * rejected, never with two active datasets.
 */
const IDEMPOTENCY_SCOPE = "idn_regions_dataset_activate";

type Prepared = { datasetId: string; idempotencyKey: string };

export const POST = defineTenantRoute<Prepared>({
  workClass: "interactive",
  prepare: ({ params, request }) => {
    const datasetId = params.id ?? "";

    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        datasetId
      )
    ) {
      return fail(400, "VALIDATION_ERROR", "id must be a dataset UUID.");
    }

    const idempotencyKey = request.headers.get("idempotency-key");

    if (!idempotencyKey) {
      return fail(
        400,
        "IDEMPOTENCY_REQUIRED",
        "Idempotency-Key header is required."
      );
    }

    return { datasetId, idempotencyKey };
  },
  authorize: {
    moduleKey: IDN_ADMIN_REGIONS_MODULE_KEY,
    activityCode: IDN_DATASET_ACTIVITY_CODE,
    action: "configure"
  },
  handler: async ({ tx, auth, prepared, tenantId, locals }) => {
    const requestHash = computeRequestHash({ datasetId: prepared.datasetId });
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

    let result: Awaited<ReturnType<typeof activateDataset>>;

    try {
      result = await activateDataset(tx, prepared.datasetId, {
        activatedBy: auth.context.tenantUserId
      });
    } catch (error) {
      if (error instanceof DatasetLifecycleError) {
        return error.code === "DATASET_NOT_FOUND"
          ? fail(404, "NOT_FOUND", "Dataset not found.")
          : fail(409, error.code, error.message);
      }
      throw error;
    }

    await recordAuditEvent(tx, {
      tenantId,
      actorTenantUserId: auth.context.tenantUserId,
      moduleKey: IDN_ADMIN_REGIONS_MODULE_KEY,
      action: "idn_admin_regions.dataset.activate",
      resourceType: "idn_region_dataset",
      resourceId: prepared.datasetId,
      severity: "warning",
      message: result.changed
        ? "Indonesia region dataset activated."
        : "Indonesia region dataset activation was a no-op (already active).",
      attributes: {
        datasetCode: result.dataset.datasetCode,
        rowCount: result.dataset.rowCount,
        supersededDatasetId: result.supersededId,
        changed: result.changed
      },
      correlationId: locals.correlationId
    });

    const response = ok({ dataset: result.dataset, changed: result.changed });
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
