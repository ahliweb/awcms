import { defineTenantRoute } from "../../../../../../modules/_shared/tenant-route";
import {
  fetchSlaPolicy,
  retireSlaPolicy
} from "../../../../../../modules/omnichannel-inbox/application/sla-policy-directory";
import {
  asUuid,
  auditInbox,
  authorizePolicyScope,
  badId,
  disabledResponse,
  notFound,
  personOnlyRefusal,
  readIdempotencyKey,
  readValidatedBody,
  runIdempotent
} from "../../../../../../modules/omnichannel-inbox/application/route-support";
import { OMNICHANNEL_INBOX_GUARDS } from "../../../../../../modules/omnichannel-inbox/domain/inbox-constants";
import { validateEmptyBody } from "../../../../../../modules/omnichannel-inbox/domain/inbox-validation";

/**
 * `POST /api/v1/omnichannel-inbox/sla-policies/{id}/retire` — retire a policy.
 * Conversations already waiting keep the due time they were given; new waits in
 * that scope fall back to the tenant default (or to no SLA). The caller must be
 * allowed to name the policy's scope. `Idempotency-Key`; audited at warning.
 */
export const POST = defineTenantRoute<string>({
  workClass: "interactive",
  prepare: async ({ request }) => {
    const disabled = disabledResponse();

    if (disabled) return disabled;

    const key = readIdempotencyKey(request);

    if (key instanceof Response) return key;

    const body = await readValidatedBody(request, validateEmptyBody);

    return body instanceof Response ? body : key;
  },
  authorize: OMNICHANNEL_INBOX_GUARDS.configureSlaPolicies,
  handler: async (context) => {
    const refused = personOnlyRefusal(context.auth);

    if (refused) return refused;

    const id = asUuid(context.params.id);

    if (!id) return badId();

    const policy = await fetchSlaPolicy(context.tx, context.tenantId, id);

    if (!policy) return notFound("SLA policy");

    const scopeRefusal = await authorizePolicyScope(
      context,
      OMNICHANNEL_INBOX_GUARDS.configureSlaPolicies,
      policy.businessScope
    );

    if (scopeRefusal) return notFound("SLA policy");

    const actor = context.auth.context.tenantUserId;

    return runIdempotent(
      context.tx,
      context.tenantId,
      "omnichannel_inbox_sla_policy_retire",
      context.prepared,
      actor,
      { id },
      async () => {
        const outcome = await retireSlaPolicy(
          context.tx,
          context.tenantId,
          actor,
          id
        );

        if (outcome === "not_found") return notFound("SLA policy");

        if (outcome === "retired") {
          await auditInbox(context, {
            action: "omnichannel_inbox.sla_policy.retire",
            resourceType: "omnichannel_inbox_sla_policy",
            resourceId: id,
            severity: "warning",
            message: "Inbox SLA policy retired."
          });
        }

        return {
          status: 200,
          body: { id, status: "retired", alreadyRetired: outcome !== "retired" }
        };
      }
    );
  }
});
