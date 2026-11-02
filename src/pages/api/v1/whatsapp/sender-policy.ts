import { fail, jsonResponse } from "../../../../modules/_shared/api-response";
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
import { setSenderPolicy } from "../../../../modules/whatsapp-delivery/application/whatsapp-sender-directory";
import { validateSenderPolicyInput } from "../../../../modules/whatsapp-delivery/domain/whatsapp-validation";
import { loadSenderAccess } from "../../../../modules/whatsapp-delivery/infrastructure/channel-account-access-loader";
import { loadChannelAccountPort } from "../../../../modules/whatsapp-delivery/infrastructure/channel-account-port-loader";

const IDEMPOTENCY_SCOPE = "whatsapp_sender_policy_set";
const GUARD = {
  moduleKey: "whatsapp_delivery",
  activityCode: "sender_policy",
  action: "configure"
} as const;

type Prepared = { payload: unknown; idempotencyKey: string };

/**
 * `PUT /api/v1/whatsapp/sender-policy` (Issue #1141, ADR-0148 section 4) — set
 * the default sender of a business scope, or tenant-wide (`businessScope:
 * null`). `defaultSenderAccountId: null` is an explicit decision to use the
 * deployment sender for that scope.
 *
 * PROSPECTIVE: the change applies to messages enqueued after it. A message
 * already queued keeps the sender (and the policy version) it was given, because
 * the queue row is immutable (`sql/322`); the response's `configVersion` is what
 * a later message will snapshot. High-risk (it decides which number and provider
 * speak for the tenant): `whatsapp_delivery.sender_policy.configure`, an
 * `Idempotency-Key`, and an audit row at `warning`. The sender must be an
 * account of THIS tenant that may send a business-initiated message right now;
 * anything else, including another tenant's account, is the same
 * `422 SENDER_UNAVAILABLE` (no existence oracle). The body is validated AFTER
 * authorization so an unauthorised token learns nothing about the schema.
 *
 * Per-account access applies (Issue #1233 M1), by the rules of
 * `channel_accounts`: the business scope named (or tenant-wide, `null`) must be
 * one the caller holds, a caller confined to business scopes cannot set the
 * tenant-wide default, and the sender must be an account the caller may use
 * (assignment rule, `assignments.assign` bypass, and the account's own scope).
 * Anything refused for access is the SAME `403 ACCESS_DENIED` (scope) or
 * `422 SENDER_UNAVAILABLE` (sender) as an unknown id; default-deny when the
 * channel module cannot be loaded.
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

    if (read.tooLarge) {
      return bodyTooLargeResponse(read.limitBytes);
    }

    if (read.malformed) {
      return fail(400, "VALIDATION_ERROR", "Request body must be valid JSON.");
    }

    return { payload: read.value, idempotencyKey };
  },
  authorize: {
    moduleKey: "whatsapp_delivery",
    activityCode: "sender_policy",
    action: "configure"
  },
  handler: async (context) => {
    const { tx, tenantId, auth, prepared, locals } = context;
    const validation = validateSenderPolicyInput(prepared.payload);

    if (!validation.valid) {
      return fail(
        400,
        "VALIDATION_ERROR",
        "Sender policy request is invalid.",
        {},
        validation.errors
      );
    }

    const access = await loadSenderAccess();

    if (!access) return fail(403, "ACCESS_DENIED", "Access denied.");

    // The scope the client names is a request, not a fact: authorised as the
    // required scope, resolved against this tenant, and refused for a confined
    // caller when it is tenant-wide. Before the idempotent section, so a refusal
    // is never stored for replay and a replay by a caller who has since lost the
    // scope is refused.
    const scopeRefusal = await access.authorizeScope(
      context,
      GUARD,
      validation.value.businessScope
    );

    if (scopeRefusal) return scopeRefusal;

    if (
      validation.value.defaultSenderAccountId !== null &&
      !(await access.canUseAccount(
        context,
        GUARD,
        validation.value.defaultSenderAccountId,
        "operator"
      ))
    ) {
      return fail(
        422,
        "SENDER_UNAVAILABLE",
        "That sender cannot be the default: it must be an account of this tenant that may send WhatsApp messages now."
      );
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

    let senders = null;

    try {
      senders = await loadChannelAccountPort();
    } catch {
      // A module import, not a query; refused as unavailable below.
      senders = null;
    }

    const result = await setSenderPolicy(
      tx,
      tenantId,
      actor,
      validation.value,
      senders
    );

    if (result.outcome === "refused") {
      return fail(
        422,
        result.code,
        "That sender cannot be the default: it must be an account of this tenant that may send WhatsApp messages now."
      );
    }

    if (result.changed) {
      await recordAuditEvent(tx, {
        tenantId,
        actorTenantUserId: actor,
        moduleKey: "whatsapp_delivery",
        action: "whatsapp_sender_policy.set",
        resourceType: "whatsapp_sender_policy",
        resourceId: result.policy.id,
        severity: "warning",
        message: "Default WhatsApp sender changed for later messages.",
        attributes: {
          configVersion: result.policy.configVersion,
          previousVersion: result.previous?.configVersion ?? null,
          defaultSenderAccountId: result.policy.defaultSenderAccountId,
          previousDefaultSenderAccountId:
            result.previous?.defaultSenderAccountId ?? null,
          businessScopeType: result.policy.businessScope?.type ?? null,
          businessScopeId: result.policy.businessScope?.id ?? null
        },
        correlationId: locals.correlationId
      });
    }

    const body = {
      success: true as const,
      data: { ...result.policy, changed: result.changed },
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
