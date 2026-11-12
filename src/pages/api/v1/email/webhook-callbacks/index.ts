import { randomUUID } from "node:crypto";

import { fail, ok } from "../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../modules/_shared/tenant-route";
import {
  bodyTooLargeResponse,
  readJsonBody
} from "../../../../../lib/security/request-body-limit";
import { recordAuditEvent } from "../../../../../modules/logging/application/audit-log";
import {
  asUuid,
  EMAIL_WEBHOOK_GUARDS,
  personOnlyRefusal,
  readIdempotencyKey,
  runIdempotent
} from "../../../../../modules/email/application/webhook-route-support";
import {
  formatCallbackToken,
  generateCallbackSecret,
  hashCallbackSecret
} from "../../../../../modules/email/domain/mailketing-webhook";
import {
  EMAIL_WEBHOOK_MODE,
  isEmailWebhookEnabled
} from "../../../../../modules/email/domain/email-webhook-config";
import {
  loadEmailSenderAccess,
  tryLoadWebhookSubscriptionDirectory
} from "../../../../../modules/email/infrastructure/channel-account-loaders";

const SCOPE = "email_webhook_callback_issue";

const unavailable = (): Response =>
  fail(
    503,
    "SERVICE_UNAVAILABLE",
    "Channel accounts are not available on this deployment."
  );

/**
 * `GET /api/v1/email/webhook-callbacks` (Issue #1161) — the Mailketing
 * callback credentials of this tenant: id, account, status, last event. Never
 * the token (only its hash is stored, and it is not returned either). Only the
 * accounts the caller may see under the `channel_accounts` rules. Also says
 * whether the deployment accepts callbacks at all and in which mode (`strict`:
 * provider events are quarantined, never applied).
 */
export const GET = defineTenantRoute({
  workClass: "interactive",
  authorize: EMAIL_WEBHOOK_GUARDS.read,
  handler: async (context) => {
    const directory = await tryLoadWebhookSubscriptionDirectory();
    const access = await loadEmailSenderAccess();

    if (!directory || !access) return unavailable();

    const all = await directory.listWebhookSubscriptions(
      context.tx,
      context.tenantId,
      "mailketing"
    );
    const callbacks = [];
    const seen = new Map<string, boolean>();

    for (const entry of all) {
      let visible = seen.get(entry.accountId);

      if (visible === undefined) {
        visible = await access.canUseAccount(
          context,
          EMAIL_WEBHOOK_GUARDS.read,
          entry.accountId,
          "viewer"
        );
        seen.set(entry.accountId, visible);
      }

      if (visible) callbacks.push(entry);
    }

    return ok({
      enabled: isEmailWebhookEnabled(),
      mode: EMAIL_WEBHOOK_MODE,
      authenticity: "unauthenticated",
      callbacks
    });
  }
});

type Prepared = { idempotencyKey: string; payload: unknown };

/**
 * `POST /api/v1/email/webhook-callbacks` (Issue #1161, ADR-0151 section 5) —
 * issue, or ROTATE, the callback URL of one Mailketing account
 * (`{"espAccountId": "<uuid>"}`).
 *
 * Any live callback of that account is revoked in the same transaction, so a
 * leaked URL is cut off by issuing a new one. The token is in THIS response
 * once (`revealed: true`); only a hash bound to the tenant and subscription is
 * stored, and a replay of the same `Idempotency-Key` answers without it.
 * HIGH-RISK: `email.webhook.configure`, operator access to the account under
 * the `channel_accounts` rules, an `Idempotency-Key`, a signed-in person, and
 * an audit row at `warning` (never the token, never the hash).
 *
 * The URL locates the account; it does not authenticate Mailketing (the vendor
 * documents no signature), so whatever arrives on it is quarantined as
 * unauthenticated and changes no state.
 */
export const POST = defineTenantRoute<Prepared>({
  workClass: "interactive",
  prepare: async ({ request }) => {
    const idempotencyKey = readIdempotencyKey(request);

    if (idempotencyKey instanceof Response) return idempotencyKey;

    const read = await readJsonBody(request);

    if (read.tooLarge) return bodyTooLargeResponse(read.limitBytes);

    if (read.malformed) {
      return fail(400, "VALIDATION_ERROR", "Request body must be valid JSON.");
    }

    return { idempotencyKey, payload: read.value };
  },
  authorize: EMAIL_WEBHOOK_GUARDS.configure,
  handler: async (context) => {
    const refused = personOnlyRefusal(context.auth);

    if (refused) return refused;

    const { tx, tenantId, auth, prepared } = context;
    const record = (prepared.payload ?? {}) as Record<string, unknown>;
    const espAccountId = asUuid(record.espAccountId);

    if (!espAccountId) {
      return fail(400, "VALIDATION_ERROR", "Callback request is invalid.", {}, [
        { field: "espAccountId", message: "espAccountId must be a UUID." }
      ]);
    }

    const directory = await tryLoadWebhookSubscriptionDirectory();
    const access = await loadEmailSenderAccess();

    if (!directory || !access) return unavailable();

    const accountRefusal = fail(
      422,
      "ACCOUNT_UNAVAILABLE",
      "That account cannot receive a callback URL: it must be a live Mailketing account of this tenant that you operate."
    );

    if (
      !(await access.canUseAccount(
        context,
        EMAIL_WEBHOOK_GUARDS.configure,
        espAccountId,
        "operator"
      ))
    ) {
      return accountRefusal;
    }

    const actor = auth.context.tenantUserId;

    return runIdempotent(
      tx,
      tenantId,
      SCOPE,
      prepared.idempotencyKey,
      actor,
      { espAccountId },
      async () => {
        const subscriptionId = randomUUID();
        const secret = generateCallbackSecret();
        const issued = await directory.issueWebhookSubscription(tx, tenantId, {
          id: subscriptionId,
          accountId: espAccountId,
          provider: "mailketing",
          accountKind: "esp_account",
          verificationMode: "unauthenticated",
          callbackTokenHash: hashCallbackSecret(
            tenantId,
            subscriptionId,
            secret
          ),
          createdBy: actor
        });

        if (issued.outcome === "account_unavailable") return accountRefusal;

        await recordAuditEvent(tx, {
          tenantId,
          actorTenantUserId: actor,
          moduleKey: "email",
          action: "email_webhook.callback_issued",
          resourceType: "email_webhook_callback",
          resourceId: subscriptionId,
          severity: "warning",
          message:
            issued.revokedIds.length > 0
              ? "Mailketing callback URL rotated; the previous URL stopped working."
              : "Mailketing callback URL issued.",
          attributes: {
            espAccountId,
            revokedCallbackIds: issued.revokedIds
          },
          correlationId: context.locals.correlationId
        });

        const token = formatCallbackToken(tenantId, subscriptionId, secret);

        return {
          status: 201,
          body: {
            callback: issued.subscription,
            rotatedCallbackIds: issued.revokedIds,
            mode: EMAIL_WEBHOOK_MODE
          },
          reveal: {
            callbackPath: `/api/v1/email/webhooks/mailketing/${token}`
          }
        };
      }
    );
  }
});
