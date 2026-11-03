import { fail, ok } from "../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../modules/_shared/tenant-route";
import {
  auditChannelAccounts,
  commonRefusal,
  readIdempotencyKey,
  readValidatedBody,
  requireConditionalStepUp,
  runIdempotent
} from "../../../../../modules/channel-accounts/application/channel-accounts-route-support";
import {
  acknowledgeRisk,
  listRiskAcknowledgements
} from "../../../../../modules/channel-accounts/application/risk-acknowledgement-directory";
import { CHANNEL_ACCOUNTS_GUARDS } from "../../../../../modules/channel-accounts/domain/channel-accounts-constants";
import {
  validateAcknowledgeRisk,
  type AcknowledgeRiskInput
} from "../../../../../modules/channel-accounts/domain/channel-accounts-validation";
import {
  describeRiskAcknowledgement,
  isRiskAcknowledgementProvider
} from "../../../../../modules/channel-accounts/domain/risk-acknowledgements";

/**
 * `GET /api/v1/channel-accounts/risk-acknowledgements?provider=starsender`
 * (Issue #1142, ADR-0148 section 7) — the CURRENT risk text of an UNOFFICIAL
 * provider (English and Indonesian, its version, and whether the business owner
 * has approved it) and who has acknowledged it. `acknowledgements` carries ids,
 * the person's tenant-user id, the text version and timestamps: no credential
 * and no message content. Read-only; `risk_acknowledgements.read`.
 */
export const GET = defineTenantRoute({
  workClass: "interactive",
  authorize: CHANNEL_ACCOUNTS_GUARDS.readRiskAcknowledgements,
  handler: async ({ tx, tenantId, auth, request }) => {
    const refused = commonRefusal(auth);

    if (refused) return refused;

    const provider = new URL(request.url).searchParams.get("provider");

    if (!isRiskAcknowledgementProvider(provider)) {
      return fail(
        400,
        "VALIDATION_ERROR",
        "provider must name a provider that needs a risk acknowledgement."
      );
    }

    return ok({
      ...describeRiskAcknowledgement(provider),
      acknowledgements: await listRiskAcknowledgements(tx, tenantId, provider)
    });
  }
});

type Prepared = { idempotencyKey: string; input: AcknowledgeRiskInput };

/**
 * `POST /api/v1/channel-accounts/risk-acknowledgements` (Issue #1142) — the
 * CALLER records their OWN acknowledgement of the current risk text. The body
 * names the provider and the text version shown; there is no field to name
 * another person, and a stale version is `409 RISK_TEXT_VERSION_STALE`.
 * While the business owner has not approved the text, nothing can be recorded
 * (`409 RISK_TEXT_NOT_APPROVED`), so no StarSender device can be connected: the
 * wording is a human decision, not a default. A signed-in person only (a machine
 * credential is refused); a person who has an MFA factor needs a fresh step-up
 * (conditional, like `PUT .../credential`); `Idempotency-Key` required; audited
 * at `warning`.
 */
export const POST = defineTenantRoute<Prepared>({
  workClass: "interactive",
  prepare: async ({ request }) => {
    const idempotencyKey = readIdempotencyKey(request);

    if (idempotencyKey instanceof Response) return idempotencyKey;

    const input = await readValidatedBody(request, validateAcknowledgeRisk);

    return input instanceof Response ? input : { idempotencyKey, input };
  },
  authorize: CHANNEL_ACCOUNTS_GUARDS.acknowledgeRisk,
  handler: async (context) => {
    const refused = commonRefusal(context.auth);

    if (refused) return refused;

    const { tx, tenantId, auth, prepared } = context;
    const actor = auth.context.tenantUserId;

    // A person with an MFA factor must present a fresh step-up (audit M4).
    const stepUp = await requireConditionalStepUp(context);

    if (stepUp) return stepUp;

    return runIdempotent(
      tx,
      tenantId,
      "channel_accounts_risk_acknowledgement_create",
      prepared.idempotencyKey,
      actor,
      prepared.input,
      async () => {
        const result = await acknowledgeRisk(
          tx,
          tenantId,
          actor,
          prepared.input
        );

        if (result.outcome === "refused") {
          return result.code === "TEXT_NOT_APPROVED"
            ? fail(
                409,
                "RISK_TEXT_NOT_APPROVED",
                "The risk text for this provider has not been approved by the business owner yet."
              )
            : fail(
                409,
                "RISK_TEXT_VERSION_STALE",
                "The risk text has changed; read the current version and acknowledge it."
              );
        }

        if (result.created) {
          await auditChannelAccounts(context, {
            action: "channel_accounts.risk_acknowledgement.create",
            resourceType: "channel_risk_acknowledgement",
            resourceId: result.acknowledgement.id,
            severity: "warning",
            message: "Provider risk acknowledgement recorded.",
            attributes: {
              provider: prepared.input.provider,
              textVersion: result.acknowledgement.textVersion
            }
          });
        }

        return {
          status: result.created ? 201 : 200,
          body: result.acknowledgement
        };
      }
    );
  }
});
