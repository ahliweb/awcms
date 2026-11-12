import { fail, ok } from "../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../modules/_shared/tenant-route";
import {
  createSlaPolicy,
  listSlaPolicies
} from "../../../../../modules/omnichannel-inbox/application/sla-policy-directory";
import {
  auditInbox,
  authorizePolicyScope,
  disabledResponse,
  personOnlyRefusal,
  readIdempotencyKey,
  readValidatedBody,
  runIdempotent,
  visibilityFor
} from "../../../../../modules/omnichannel-inbox/application/route-support";
import { OMNICHANNEL_INBOX_GUARDS } from "../../../../../modules/omnichannel-inbox/domain/inbox-constants";
import {
  validateSlaPolicyCreateBody,
  type SlaPolicyCreateInput
} from "../../../../../modules/omnichannel-inbox/domain/inbox-validation";

/** `GET /api/v1/omnichannel-inbox/sla-policies` — the SLA policies the caller may see (the tenant default plus the scopes they cover; all when acting tenant-wide), newest first (bounded). */
export const GET = defineTenantRoute({
  workClass: "interactive",
  prepare: () => disabledResponse() ?? undefined,
  authorize: OMNICHANNEL_INBOX_GUARDS.readSlaPolicies,
  handler: async (context) =>
    ok({
      items: await listSlaPolicies(
        context.tx,
        context.tenantId,
        await visibilityFor(context, OMNICHANNEL_INBOX_GUARDS.readSlaPolicies)
      )
    })
});

/**
 * `POST /api/v1/omnichannel-inbox/sla-policies` — create a policy for the
 * tenant (no `businessScope`) or for one business scope, retiring the active
 * policy of the same scope in the same transaction. The timezone must be a
 * known IANA zone and at least one weekday must be open. A scope-confined
 * caller may only name a scope they cover, never the tenant default.
 * `Idempotency-Key`; audited at warning.
 */
export const POST = defineTenantRoute<{
  key: string;
  body: SlaPolicyCreateInput;
}>({
  workClass: "interactive",
  prepare: async ({ request }) => {
    const disabled = disabledResponse();

    if (disabled) return disabled;

    const key = readIdempotencyKey(request);

    if (key instanceof Response) return key;

    const body = await readValidatedBody(request, validateSlaPolicyCreateBody);

    return body instanceof Response ? body : { key, body };
  },
  authorize: OMNICHANNEL_INBOX_GUARDS.configureSlaPolicies,
  handler: async (context) => {
    const refused = personOnlyRefusal(context.auth);

    if (refused) return refused;

    const scopeRefusal = await authorizePolicyScope(
      context,
      OMNICHANNEL_INBOX_GUARDS.configureSlaPolicies,
      context.prepared.body.businessScope
    );

    if (scopeRefusal) return scopeRefusal;

    const actor = context.auth.context.tenantUserId;

    return runIdempotent(
      context.tx,
      context.tenantId,
      "omnichannel_inbox_sla_policy_create",
      context.prepared.key,
      actor,
      context.prepared.body,
      async () => {
        const result = await createSlaPolicy(
          context.tx,
          context.tenantId,
          actor,
          context.prepared.body
        );

        if (result.outcome === "conflict") {
          return fail(
            409,
            "SLA_POLICY_CONFLICT",
            "Another policy for this scope was created at the same time; reload and try again."
          );
        }

        await auditInbox(context, {
          action: "omnichannel_inbox.sla_policy.create",
          resourceType: "omnichannel_inbox_sla_policy",
          resourceId: result.policy.id,
          severity: "warning",
          message: "Inbox SLA policy created.",
          attributes: {
            retiredPolicyId: result.retiredId,
            scoped: result.policy.businessScope !== null
          }
        });

        return {
          status: 201,
          body: { policy: result.policy, retiredPolicyId: result.retiredId }
        };
      }
    );
  }
});
