import { fail } from "../../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../../modules/_shared/tenant-route";
import { recordAuditEvent } from "../../../../../../modules/logging/application/audit-log";
import {
  asUuid,
  EMAIL_WEBHOOK_GUARDS,
  personOnlyRefusal,
  readIdempotencyKey,
  runIdempotent
} from "../../../../../../modules/email/application/webhook-route-support";
import {
  loadEmailSenderAccess,
  tryLoadWebhookSubscriptionDirectory
} from "../../../../../../modules/email/infrastructure/channel-account-loaders";

const SCOPE = "email_webhook_callback_revoke";

/**
 * `POST /api/v1/email/webhook-callbacks/{id}/revoke` (Issue #1161) — the
 * callback URL stops verifying at once and is never re-activated (issue a new
 * one instead). Idempotent by state; HIGH-RISK like issuing:
 * `email.webhook.configure`, operator access to the account, an
 * `Idempotency-Key`, and an audit row at `warning`. An unknown id, another
 * tenant's id and an account the caller cannot operate are the same `404`.
 */
export const POST = defineTenantRoute<string>({
  workClass: "interactive",
  prepare: ({ request }) => readIdempotencyKey(request),
  authorize: EMAIL_WEBHOOK_GUARDS.configure,
  handler: async (context) => {
    const refused = personOnlyRefusal(context.auth);

    if (refused) return refused;

    const id = asUuid(context.params.id);
    const notFound = fail(404, "NOT_FOUND", "Callback not found.");

    if (!id) return notFound;

    const directory = await tryLoadWebhookSubscriptionDirectory();
    const access = await loadEmailSenderAccess();

    if (!directory || !access) {
      return fail(
        503,
        "SERVICE_UNAVAILABLE",
        "Channel accounts are not available on this deployment."
      );
    }

    const { tx, tenantId, auth } = context;
    const listed = await directory.listWebhookSubscriptions(
      tx,
      tenantId,
      "mailketing"
    );
    const target = listed.find((entry) => entry.id === id);

    if (
      !target ||
      !(await access.canUseAccount(
        context,
        EMAIL_WEBHOOK_GUARDS.configure,
        target.accountId,
        "operator"
      ))
    ) {
      return notFound;
    }

    const actor = auth.context.tenantUserId;

    return runIdempotent(
      tx,
      tenantId,
      SCOPE,
      context.prepared,
      actor,
      { id },
      async () => {
        const result = await directory.revokeWebhookSubscription(
          tx,
          tenantId,
          "mailketing",
          id
        );

        if (!result) return notFound;

        if (result.changed) {
          await recordAuditEvent(tx, {
            tenantId,
            actorTenantUserId: actor,
            moduleKey: "email",
            action: "email_webhook.callback_revoked",
            resourceType: "email_webhook_callback",
            resourceId: id,
            severity: "warning",
            message: "Mailketing callback URL revoked.",
            attributes: { espAccountId: result.subscription.accountId },
            correlationId: context.locals.correlationId
          });
        }

        return {
          status: 200,
          body: { callback: result.subscription, changed: result.changed }
        };
      }
    );
  }
});
