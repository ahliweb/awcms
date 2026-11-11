import {
  fail,
  jsonResponse
} from "../../../../../../modules/_shared/api-response";
import {
  computeRequestHash,
  findIdempotencyRecord,
  saveIdempotencyRecord,
  userIdempotencyActor
} from "../../../../../../modules/_shared/idempotency";
import { defineTenantRoute } from "../../../../../../modules/_shared/tenant-route";
import { recordAuditEvent } from "../../../../../../modules/logging/application/audit-log";
import {
  clearMetaRestriction,
  resolveWabaExternalId
} from "../../../../../../modules/whatsapp-delivery/application/whatsapp-meta-directory";
import { isWhatsappRecordUuid } from "../../../../../../modules/whatsapp-delivery/domain/whatsapp-sender";
import { loadSenderAccess } from "../../../../../../modules/whatsapp-delivery/infrastructure/channel-account-access-loader";

const GUARD = {
  moduleKey: "whatsapp_delivery",
  activityCode: "meta_signals",
  action: "configure"
} as const;
const IDEMPOTENCY_SCOPE = "whatsapp_meta_restriction_clear";

type Prepared = { id: string; idempotencyKey: string };

/**
 * `POST /api/v1/whatsapp/meta-signals/{id}/clear-restriction` (Issue #1143) —
 * clear the restriction Meta reported for a WABA (`{id}` is the WABA account),
 * after the operator verified at Meta that it was lifted. Meta's documented
 * reversals (a ban `REINSTATE`, `ACCOUNT_RECONNECTED`) clear their own
 * restriction automatically; a policy restriction, a deletion or an app
 * uninstall is cleared only here. HIGH-RISK (it re-opens every number of the
 * WABA): `meta_signals.configure`, the `operator` assignment, `Idempotency-Key`,
 * audited at `warning`. An unknown, foreign or non-WABA id and a WABA the caller
 * cannot operate are one `404`; a WABA that is not restricted is `409`.
 */
export const POST = defineTenantRoute<Prepared>({
  workClass: "interactive",
  prepare: async ({ request, params }) => {
    if (!isWhatsappRecordUuid(params.id)) {
      return fail(400, "VALIDATION_ERROR", "id must be a UUID.");
    }

    const idempotencyKey = request.headers.get("idempotency-key");

    if (!idempotencyKey || idempotencyKey.length > 255) {
      return fail(
        400,
        "IDEMPOTENCY_REQUIRED",
        "Idempotency-Key header is required (at most 255 characters)."
      );
    }

    return { id: params.id.toLowerCase(), idempotencyKey };
  },
  authorize: GUARD,
  handler: async (context) => {
    const { tx, tenantId, auth, prepared, locals } = context;
    const notFound = () =>
      fail(404, "RESOURCE_NOT_FOUND", "WABA account not found.");
    const access = await loadSenderAccess();

    if (!access) return fail(403, "ACCESS_DENIED", "Access denied.");

    const wabaId = await resolveWabaExternalId(tx, tenantId, prepared.id);

    if (
      !wabaId ||
      !(await access.canUseAccount(context, GUARD, prepared.id, "operator"))
    ) {
      return notFound();
    }

    const actor = auth.context.tenantUserId;
    const requestHash = computeRequestHash({
      actor,
      request: { id: prepared.id }
    });
    const existing = await findIdempotencyRecord(
      tx,
      tenantId,
      IDEMPOTENCY_SCOPE,
      prepared.idempotencyKey,
      userIdempotencyActor(actor)
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

    const result = await clearMetaRestriction(tx, tenantId, actor, wabaId);

    if (result.outcome === "not_restricted") {
      return fail(
        409,
        "NOT_RESTRICTED",
        "This WABA has no recorded restriction."
      );
    }

    await recordAuditEvent(tx, {
      tenantId,
      actorTenantUserId: actor,
      moduleKey: "whatsapp_delivery",
      action: "whatsapp_meta_restriction.clear",
      resourceType: "channel_account",
      resourceId: prepared.id,
      severity: "warning",
      message: "Meta WABA restriction cleared by an operator.",
      attributes: { previousReason: result.previousReason },
      correlationId: locals.correlationId
    });

    const body = {
      success: true as const,
      data: { containerAccountId: prepared.id, cleared: true },
      meta: {}
    };

    await saveIdempotencyRecord(
      tx,
      tenantId,
      IDEMPOTENCY_SCOPE,
      prepared.idempotencyKey,
      userIdempotencyActor(actor),
      requestHash,
      200,
      body
    );

    return jsonResponse(body, { status: 200 });
  }
});
