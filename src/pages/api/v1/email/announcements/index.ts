import type { APIRoute } from "astro";

import {
  fail,
  jsonResponse,
  ok
} from "../../../../../modules/_shared/api-response";
import { getDatabaseClient } from "../../../../../lib/database/client";
import { withTenant } from "../../../../../lib/database/tenant-context";
import {
  authorizeInTransaction,
  resolveAuthInputs
} from "../../../../../modules/identity-access/application/access-guard";
import { hashSessionToken } from "../../../../../lib/auth/session-token";
import {
  bodyTooLargeResponse,
  readJsonBody
} from "../../../../../lib/security/request-body-limit";
import { recordAuditEvent } from "../../../../../modules/logging/application/audit-log";
import {
  computeRequestHash,
  findIdempotencyRecord,
  saveIdempotencyRecord,
  userIdempotencyActor
} from "../../../../../modules/_shared/idempotency";
import { enqueueAnnouncement } from "../../../../../modules/email/application/announcement-directory";
import {
  logEmailSenderRefusal,
  resolveEnqueueEmailSender
} from "../../../../../modules/email/application/email-sender-directory";
import { validateAnnouncementInput } from "../../../../../modules/email/domain/announcement-validation";
import {
  isRequestReservedEmailCategory,
  purposeForEmailCategory,
  TEMPLATE_CATEGORY_RESERVED_CODE
} from "../../../../../modules/email/domain/email-sender";
import {
  loadEmailSenderAccess,
  tryLoadEmailSenderPort
} from "../../../../../modules/email/infrastructure/channel-account-loaders";

const NOTIFICATION_GUARD = {
  moduleKey: "email",
  activityCode: "notification",
  action: "create" as const
};

const ANNOUNCEMENT_GUARD = {
  moduleKey: "email",
  activityCode: "announcement",
  action: "create" as const
};

const SENDER_USE_GUARD = {
  moduleKey: "email",
  activityCode: "senders",
  action: "use" as const
};

const IDEMPOTENCY_SCOPE = "email_announcement_create";

/** One answer for unknown, another tenant's, unverified, disabled and out-of-scope senders: no existence oracle. */
function senderUnavailable(): Response {
  return fail(
    422,
    "SENDER_UNAVAILABLE",
    "That sender cannot send this message now: it must be a verified sender of this tenant that you may use, within the message's business scope."
  );
}

/**
 * `POST /api/v1/email/announcements` — enqueue a notification/announcement
 * to an explicit user list, a role, or the whole tenant. High-risk
 * (bulk-capable) mutation: always requires `Idempotency-Key` (doc 10
 * §Idempotency wrapper rules), same replay/conflict shape as
 * `workflows/tasks/{id}/decisions.ts`.
 *
 * Two-tier ABAC (Issue #497 §Access control — "Bulk announcement should
 * require stronger permission than ordinary notification enqueue"):
 * `email.notification.create` is required for every request;
 * `email.announcement.create` is ADDITIONALLY required when
 * `target.type` is `"role"` or `"tenant"` (unbounded) — a role granted
 * only the base permission can message specific users it already knows
 * about, but cannot blast an entire role/tenant.
 */
export const POST: APIRoute = async ({
  request,
  cookies,
  locals,
  clientAddress
}) => {
  const { tenantId, token } = resolveAuthInputs(request, cookies);

  if (!tenantId) {
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  }

  if (!token) {
    return fail(401, "AUTH_REQUIRED", "Authentication required.");
  }

  const idempotencyKey = request.headers.get("idempotency-key");

  const bodyRead = await readJsonBody(request, "large");

  if (bodyRead.tooLarge) {
    return bodyTooLargeResponse(bodyRead.limitBytes);
  }

  const validation = validateAnnouncementInput(bodyRead.value);

  const sql = getDatabaseClient();
  const tokenHash = hashSessionToken(token);
  const now = new Date();
  const correlationId = locals.correlationId ?? crypto.randomUUID();

  return withTenant(sql, tenantId, async (tx) => {
    const auth = await authorizeInTransaction(
      tx,
      tenantId,
      tokenHash,
      now,
      NOTIFICATION_GUARD
    );

    if (!auth.allowed) {
      return auth.denied;
    }

    // Allowed — so the caller is entitled to hear what is actually wrong, and
    // the decision log now carries the row saying they were here.
    if (!idempotencyKey) {
      return fail(
        400,
        "IDEMPOTENCY_REQUIRED",
        "Idempotency-Key header is required."
      );
    }

    if (!validation.valid) {
      return fail(
        400,
        "VALIDATION_ERROR",
        "Announcement request is invalid.",
        {},
        validation.errors
      );
    }

    const input = validation.value;

    // Issue #1161: announcement routes no longer accept auth/security
    // templates; security mail is sent only by internal ports.
    if (isRequestReservedEmailCategory(input.templateKey)) {
      return fail(
        422,
        TEMPLATE_CATEGORY_RESERVED_CODE,
        "This template category is reserved for system security mail and cannot be sent as an announcement."
      );
    }

    const isBulk =
      input.target.type === "role" || input.target.type === "tenant";
    const requestHash = computeRequestHash(input);

    if (isBulk) {
      const bulkAuth = await authorizeInTransaction(
        tx,
        tenantId,
        tokenHash,
        now,
        ANNOUNCEMENT_GUARD
      );

      if (!bulkAuth.allowed) {
        return bulkAuth.denied;
      }
    }

    // Issue #1160 (ADR-0151 section 2). The sender is decided FIRST: explicit,
    // else the scope's prospective default, else the deployment sender. A
    // sender that cannot send is refused, never swapped. Decided, and the
    // caller's right to it checked, BEFORE the idempotent section, so a
    // refusal is never stored for replay and a replay by a caller who has
    // since lost the right is refused.
    const senderDecision = await resolveEnqueueEmailSender(tx, {
      tenantId,
      explicitSenderAccountId: input.senderAccountId ?? null,
      businessScope: input.businessScope ?? null,
      purpose: purposeForEmailCategory(input.templateKey),
      senders: tryLoadEmailSenderPort
    });

    if (!senderDecision.ok) {
      logEmailSenderRefusal(tenantId, senderDecision.detail, correlationId);

      return senderDecision.reason === "SENDER_ROUTING_DISABLED"
        ? fail(
            409,
            "SENDER_ROUTING_DISABLED",
            "Tenant email senders are not enabled on this deployment."
          )
        : senderUnavailable();
    }

    // Sending AS a brand needs `email.senders.use` on top of the announcement
    // permissions, and the per-account access rules of `channel_accounts`
    // (assignment, scope) on the sender ACTUALLY used. That includes a sender
    // chosen by the default-sender policy (audit L2, fail closed): a policy
    // names which brand speaks; it does not grant every mailer the right to
    // speak as it. Naming a business scope is asking to speak as that brand
    // even when its policy resolves to the deployment sender.
    const tenantSenderId = senderDecision.snapshot.senderAccountId;

    if (tenantSenderId !== null || input.businessScope !== undefined) {
      const useAuth = await authorizeInTransaction(
        tx,
        tenantId,
        tokenHash,
        now,
        SENDER_USE_GUARD
      );

      if (!useAuth.allowed) {
        return useAuth.denied;
      }

      const access = await loadEmailSenderAccess();

      if (!access) return fail(403, "ACCESS_DENIED", "Access denied.");

      const accessContext = {
        tx,
        tenantId,
        tokenHash,
        auth: useAuth,
        now,
        request,
        clientAddress
      };

      if (input.businessScope !== undefined) {
        const scopeRefusal = await access.authorizeScope(
          accessContext,
          SENDER_USE_GUARD,
          input.businessScope
        );

        if (scopeRefusal) return scopeRefusal;
      }

      if (
        tenantSenderId !== null &&
        !(await access.canUseAccount(
          accessContext,
          SENDER_USE_GUARD,
          tenantSenderId,
          "operator"
        ))
      ) {
        return senderUnavailable();
      }
    }

    const existingIdempotency = await findIdempotencyRecord(
      tx,
      tenantId,
      IDEMPOTENCY_SCOPE,
      idempotencyKey,
      userIdempotencyActor(auth.context.tenantUserId)
    );

    if (existingIdempotency) {
      if (existingIdempotency.requestHash !== requestHash) {
        return fail(
          409,
          "IDEMPOTENCY_CONFLICT",
          "Idempotency-Key was already used with a different request."
        );
      }

      return jsonResponse(existingIdempotency.responseBody, {
        status: existingIdempotency.responseStatus
      });
    }

    const result = await enqueueAnnouncement(
      tx,
      tenantId,
      input.templateKey,
      input.variables,
      input.target,
      correlationId,
      input.locale,
      senderDecision.snapshot
    );

    if (!result) {
      return fail(
        404,
        "TEMPLATE_NOT_FOUND",
        `No active template found for templateKey "${input.templateKey}".`
      );
    }

    await recordAuditEvent(tx, {
      tenantId,
      actorTenantUserId: auth.context.tenantUserId,
      moduleKey: "email",
      action: "announcement_sent",
      resourceType: "email_announcement",
      severity: isBulk ? "warning" : "info",
      message: `Announcement enqueued: ${input.templateKey} to ${result.recipientCount} recipient(s).`,
      attributes: {
        targetType: input.target.type,
        templateKey: input.templateKey,
        // Issue #1160: the sender key and how it was chosen; never its token.
        senderAccountId: senderDecision.snapshot.senderAccountId,
        senderSelection: senderDecision.snapshot.selection,
        senderPolicyVersion: senderDecision.snapshot.policyVersion,
        recipientCount: result.recipientCount,
        truncated: result.truncated,
        correlationId: result.correlationId,
        dispatchStatus: "queued"
      },
      correlationId
    });

    const responseBody = ok({
      recipientCount: result.recipientCount,
      // Surfaced, not just logged: without this the caller sees 200 + a
      // recipient count and cannot tell that matching users beyond
      // ANNOUNCEMENT_MAX_RECIPIENTS were never enqueued.
      truncated: result.truncated,
      correlationId: result.correlationId
    });
    const responseJson = await responseBody.clone().json();

    await saveIdempotencyRecord(
      tx,
      tenantId,
      IDEMPOTENCY_SCOPE,
      idempotencyKey,
      userIdempotencyActor(auth.context.tenantUserId),
      requestHash,
      200,
      responseJson
    );

    return responseBody;
  });
};
