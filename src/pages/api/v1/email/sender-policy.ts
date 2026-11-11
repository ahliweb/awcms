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
import { setEmailSenderPolicy } from "../../../../modules/email/application/email-sender-directory";
import { validateEmailSenderPolicyInput } from "../../../../modules/email/domain/announcement-validation";
import {
  loadEmailSenderAccess,
  tryLoadEmailSenderPort
} from "../../../../modules/email/infrastructure/channel-account-loaders";

const IDEMPOTENCY_SCOPE = "email_sender_policy_set";
const GUARD = {
  moduleKey: "email",
  activityCode: "sender_policy",
  action: "configure"
} as const;

const SENDER_UNAVAILABLE_MESSAGE =
  "That sender cannot be the default: it must be a verified email sender of this tenant that may send now, within the policy's business scope.";

type Prepared = { payload: unknown; idempotencyKey: string };

/**
 * `PUT /api/v1/email/sender-policy` (Issue #1160, ADR-0151 section 2) — set the
 * default email sender of a business scope, or tenant-wide (`businessScope:
 * null`). `defaultSenderAccountId: null` is an explicit decision to use the
 * deployment sender for that scope. The twin of
 * `PUT /api/v1/whatsapp/sender-policy`.
 *
 * PROSPECTIVE: the change applies to messages enqueued after it; a queued
 * message keeps the sender and policy version it was given (`sql/346`).
 * HIGH-RISK (it decides which address and Mailketing account speak for the
 * tenant): `email.sender_policy.configure`, an `Idempotency-Key`, and an audit
 * row at `warning`. The sender must be a verified Mailketing sender identity of
 * THIS tenant that may send now; anything else, including another tenant's
 * account, is the same `422 SENDER_UNAVAILABLE` (no existence oracle). With
 * `EMAIL_SENDER_ROUTING_ENABLED` off the policy cannot be set
 * (`409 SENDER_ROUTING_DISABLED`).
 *
 * `prepare` (idempotency key presence, body size, JSON) runs before the
 * permission check, as in the WhatsApp twin; the field-level schema validation
 * runs only after authorization.
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
  authorize: GUARD,
  handler: async (context) => {
    const { tx, tenantId, auth, prepared, locals } = context;
    const validation = validateEmailSenderPolicyInput(prepared.payload);

    if (!validation.valid) {
      return fail(
        400,
        "VALIDATION_ERROR",
        "Sender policy request is invalid.",
        {},
        validation.errors
      );
    }

    const access = await loadEmailSenderAccess();

    if (!access) return fail(403, "ACCESS_DENIED", "Access denied.");

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
      return fail(422, "SENDER_UNAVAILABLE", SENDER_UNAVAILABLE_MESSAGE);
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

    const result = await setEmailSenderPolicy(
      tx,
      tenantId,
      actor,
      validation.value,
      await tryLoadEmailSenderPort()
    );

    if (result.outcome === "refused") {
      return result.code === "SENDER_ROUTING_DISABLED"
        ? fail(
            409,
            "SENDER_ROUTING_DISABLED",
            "Tenant email senders are not enabled on this deployment."
          )
        : fail(422, "SENDER_UNAVAILABLE", SENDER_UNAVAILABLE_MESSAGE);
    }

    if (result.changed) {
      await recordAuditEvent(tx, {
        tenantId,
        actorTenantUserId: actor,
        moduleKey: "email",
        action: "email_sender_policy.set",
        resourceType: "email_sender_policy",
        resourceId: result.policy.id,
        severity: "warning",
        message: "Default email sender changed for later messages.",
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
