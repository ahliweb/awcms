import {
  fail,
  jsonResponse,
  ok
} from "../../../../modules/_shared/api-response";
import {
  computeRequestHash,
  findIdempotencyRecord,
  saveIdempotencyRecord,
  userIdempotencyActor
} from "../../../../modules/_shared/idempotency";
import { defineTenantRoute } from "../../../../modules/_shared/tenant-route";
import {
  bodyTooLargeResponse,
  readJsonBody
} from "../../../../lib/security/request-body-limit";
import { recordAuditEvent } from "../../../../modules/logging/application/audit-log";
import {
  listMetaSignals,
  listMetaTemplates,
  recordMetaTemplate
} from "../../../../modules/whatsapp-delivery/application/whatsapp-meta-directory";
import { validateMetaTemplateRecord } from "../../../../modules/whatsapp-delivery/domain/whatsapp-validation";
import { loadSenderAccess } from "../../../../modules/whatsapp-delivery/infrastructure/channel-account-access-loader";

const READ_GUARD = {
  moduleKey: "whatsapp_delivery",
  activityCode: "meta_templates",
  action: "read"
} as const;
const CONFIGURE_GUARD = {
  moduleKey: "whatsapp_delivery",
  activityCode: "meta_templates",
  action: "configure"
} as const;
const IDEMPOTENCY_SCOPE = "whatsapp_meta_template_record";

/**
 * `GET /api/v1/whatsapp/meta-templates` (Issue #1143) — which Meta templates are
 * approved on which WABA (`items`), and each WABA's restriction and
 * messaging-limit tier (`signals`). Only WABA accounts the caller may see
 * (`channel_accounts` assignments and business-scope confinement); default-deny
 * when the channel module cannot be loaded. Never an evidence reference's text
 * (only whether one exists), never a token or a number.
 */
export const GET = defineTenantRoute({
  workClass: "interactive",
  authorize: READ_GUARD,
  handler: async (context) => {
    const { tx, tenantId } = context;
    const access = await loadSenderAccess();

    if (!access) return fail(403, "ACCESS_DENIED", "Access denied.");

    const seen = new Map<string, boolean>();
    const canSee = async (accountId: string): Promise<boolean> => {
      let known = seen.get(accountId);

      if (known === undefined) {
        known = await access.canUseAccount(
          context,
          READ_GUARD,
          accountId,
          "viewer"
        );
        seen.set(accountId, known);
      }

      return known;
    };
    const templates = await listMetaTemplates(tx, tenantId);
    const signalRows = await listMetaSignals(tx, tenantId);
    const items = [];

    for (const item of templates.items) {
      if (await canSee(item.containerAccountId)) items.push(item);
    }

    const signals = [];

    for (const signal of signalRows.items) {
      if (await canSee(signal.containerAccountId)) signals.push(signal);
    }

    // `truncated`: the tenant has more rows than one answer returns; never a
    // silent cut (security review L-6).
    return ok({
      items,
      signals,
      itemsTruncated: templates.truncated,
      signalsTruncated: signalRows.truncated
    });
  }
});

type Prepared = { payload: unknown; idempotencyKey: string };

/**
 * `PUT /api/v1/whatsapp/meta-templates` (Issue #1143) — record what Meta shows
 * for ONE template (name, language, category, status) on ONE WABA. Marking it
 * `APPROVED`/`REINSTATED` needs an `evidenceRef`. HIGH-RISK (an approved row
 * lets messages be sent with that template through that WABA's numbers):
 * `meta_templates.configure`, the `operator` assignment on the WABA account,
 * `Idempotency-Key`, audited at `warning`. A later signed Meta webhook with a
 * newer event time overrides an operator record; an unknown, foreign or
 * non-WABA container is one `422 CONTAINER_NOT_FOUND`.
 */
export const PUT = defineTenantRoute<Prepared>({
  workClass: "interactive",
  prepare: async ({ request }) => {
    const idempotencyKey = request.headers.get("idempotency-key");

    if (!idempotencyKey || idempotencyKey.length > 255) {
      return fail(
        400,
        "IDEMPOTENCY_REQUIRED",
        "Idempotency-Key header is required (at most 255 characters)."
      );
    }

    const read = await readJsonBody(request);

    if (read.tooLarge) return bodyTooLargeResponse(read.limitBytes);

    if (read.malformed) {
      return fail(400, "VALIDATION_ERROR", "Request body must be valid JSON.");
    }

    return { payload: read.value, idempotencyKey };
  },
  authorize: CONFIGURE_GUARD,
  handler: async (context) => {
    const { tx, tenantId, auth, prepared, locals } = context;
    const validation = validateMetaTemplateRecord(prepared.payload);

    if (!validation.valid) {
      return fail(
        400,
        "VALIDATION_ERROR",
        "Meta template record is invalid.",
        {},
        validation.errors
      );
    }

    const access = await loadSenderAccess();

    if (!access) return fail(403, "ACCESS_DENIED", "Access denied.");

    const containerRefused = () =>
      fail(
        422,
        "CONTAINER_NOT_FOUND",
        "containerAccountId must be a live WABA account of this tenant that you operate."
      );

    if (
      !(await access.canUseAccount(
        context,
        CONFIGURE_GUARD,
        validation.value.containerAccountId,
        "operator"
      ))
    ) {
      return containerRefused();
    }

    const actor = auth.context.tenantUserId;
    const requestHash = computeRequestHash({
      actor,
      request: validation.value
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

    const result = await recordMetaTemplate(
      tx,
      tenantId,
      actor,
      validation.value
    );

    if (result.outcome === "container_not_found") return containerRefused();

    await recordAuditEvent(tx, {
      tenantId,
      actorTenantUserId: actor,
      moduleKey: "whatsapp_delivery",
      action: "whatsapp_meta_template.record",
      resourceType: "whatsapp_meta_template",
      resourceId: result.template.id,
      severity: "warning",
      message: "Meta template approval status recorded by an operator.",
      attributes: {
        containerAccountId: result.template.containerAccountId,
        templateName: result.template.name,
        language: result.template.language,
        category: result.template.category,
        providerStatus: result.template.providerStatus,
        previousStatus: result.previousStatus,
        hasEvidence: result.template.hasEvidence
      },
      correlationId: locals.correlationId
    });

    const body = { success: true as const, data: result.template, meta: {} };

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
