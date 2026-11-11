import { fail } from "../../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../../modules/_shared/tenant-route";
import {
  accountNotFound,
  asUuid,
  auditChannelAccounts,
  badId,
  commonRefusal,
  loadAuthorizedAccount,
  readIdempotencyKey,
  readValidatedBody,
  requireConditionalStepUp,
  runIdempotent,
  secretStoreUnavailable
} from "../../../../../../modules/channel-accounts/application/channel-accounts-route-support";
import { defaultSecretStore } from "../../../../../../modules/channel-accounts/application/secret-store";
import { createMetaWebhookSubscription } from "../../../../../../modules/channel-accounts/application/webhook-subscription-directory";
import { CHANNEL_ACCOUNTS_GUARDS } from "../../../../../../modules/channel-accounts/domain/channel-accounts-constants";
import {
  validateCreateWebhookSubscription,
  type CreateWebhookSubscriptionInput
} from "../../../../../../modules/channel-accounts/domain/channel-accounts-validation";

type Prepared = {
  id: string;
  idempotencyKey: string;
  input: CreateWebhookSubscriptionInput;
};

/** Where Meta must deliver: the token is the last path segment (`whatsapp_delivery` owns the route). */
const CALLBACK_PATH_PREFIX = "/api/v1/whatsapp/webhooks/meta/";

/**
 * `POST /api/v1/channel-accounts/accounts/{id}/webhook-subscription` (Issue
 * #1143, ADR-0148 I9) — create or ROTATE the signed webhook subscription of a
 * Meta WhatsApp number.
 *
 * The Meta app secret is stored write-only (envelope-encrypted, purpose
 * `webhook_signing_secret`) and is never returned. The response carries the
 * opaque callback token ONCE (`callbackToken`, `callbackPath`, `revealed:
 * true`): it is both the last segment of the callback URL and the
 * `hub.verify_token` to enter in Meta's configuration. A replay of the same
 * `Idempotency-Key` answers the stored body WITHOUT it (`revealed: false`). An
 * earlier subscription of the number is revoked and its secret erased in the
 * same transaction.
 *
 * HIGH-RISK: `webhooks.configure`, `Idempotency-Key`, a conditional step-up
 * (a person with an MFA factor must present a fresh one), the `owner`
 * assignment on the account, and a `warning` audit row with no secret, token
 * or external identifier.
 */
export const POST = defineTenantRoute<Prepared>({
  workClass: "interactive",
  prepare: async ({ request, params }) => {
    const id = asUuid(params.id);

    if (!id) return badId();

    const idempotencyKey = readIdempotencyKey(request);

    if (idempotencyKey instanceof Response) return idempotencyKey;

    const input = await readValidatedBody(
      request,
      validateCreateWebhookSubscription
    );

    return input instanceof Response ? input : { id, idempotencyKey, input };
  },
  authorize: CHANNEL_ACCOUNTS_GUARDS.manageWebhooks,
  handler: async (context) => {
    const refused = commonRefusal(context.auth);

    if (refused) return refused;

    const unavailable = secretStoreUnavailable();

    if (unavailable) return unavailable;

    const { tx, tenantId, auth, prepared } = context;
    const actor = auth.context.tenantUserId;
    const loaded = await loadAuthorizedAccount(
      context,
      prepared.id,
      CHANNEL_ACCOUNTS_GUARDS.manageWebhooks,
      "owner"
    );

    if ("denied" in loaded) return loaded.denied;

    const stepUp = await requireConditionalStepUp(context);

    if (stepUp) return stepUp;

    return runIdempotent(
      tx,
      tenantId,
      "channel_accounts_webhook_subscription_create",
      prepared.idempotencyKey,
      actor,
      { id: prepared.id, input: prepared.input },
      async () => {
        const result = await createMetaWebhookSubscription(
          tx,
          defaultSecretStore,
          tenantId,
          actor,
          prepared.id,
          prepared.input.appSecret
        );

        if (result.outcome === "not_found") return accountNotFound();

        if (result.outcome === "refused") {
          return fail(
            409,
            result.code,
            result.code === "NOT_A_META_NUMBER"
              ? "A signed webhook can only be created for a live Meta WhatsApp number."
              : "The number has no live WABA container; register it under its WABA first."
          );
        }

        await auditChannelAccounts(context, {
          action: "channel_accounts.webhook_subscription.create",
          resourceType: "channel_account",
          resourceId: prepared.id,
          severity: "warning",
          message:
            "Signed webhook subscription created (app secret and callback token not recorded).",
          attributes: {
            subscriptionId: result.subscriptionId,
            rotatedSubscriptions: result.rotated
          }
        });

        return {
          status: 201,
          body: {
            subscriptionId: result.subscriptionId,
            accountId: prepared.id,
            verificationMode: "hmac_signature",
            rotatedSubscriptions: result.rotated
          },
          reveal: {
            callbackToken: result.callbackToken,
            callbackPath: `${CALLBACK_PATH_PREFIX}${result.callbackToken}`
          }
        };
      }
    );
  }
});
