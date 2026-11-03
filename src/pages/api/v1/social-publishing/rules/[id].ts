import { defineTenantRoute } from "../../../../../modules/_shared/tenant-route";
import {
  auditPublishing,
  asUuid,
  badId,
  canUseAllAccounts,
  mutationRefusal,
  notFound,
  readIdempotencyKey,
  readJson,
  runIdempotent,
  validationFailure
} from "../../../../../modules/social-publishing/application/route-support";
import { setRuleEnabled } from "../../../../../modules/social-publishing/application/settings-directory";
import { SOCIAL_PUBLISHING_GUARDS } from "../../../../../modules/social-publishing/domain/social-publishing-constants";
import { validateRulePatch } from "../../../../../modules/social-publishing/domain/social-publishing-validation";

type Prepared = { id: string; idempotencyKey: string; enabled: boolean };

/**
 * `PATCH /api/v1/social-publishing/rules/{id}` (Issue #1145) — enable or disable
 * a rule. A rule is never deleted (disabled, so history stays readable); a
 * disabled rule stops FUTURE article events from queueing for that account and
 * does not touch a publication already queued (cancel that). The caller must be
 * able to use the rule's account (otherwise `404`). High-risk: `Idempotency-Key`,
 * audited at `warning`.
 */
export const PATCH = defineTenantRoute<Prepared>({
  workClass: "interactive",
  prepare: async ({ request, params }) => {
    const id = asUuid(params.id);

    if (!id) return badId();

    const idempotencyKey = readIdempotencyKey(request);

    if (idempotencyKey instanceof Response) return idempotencyKey;

    const body = await readJson(request);

    if (body instanceof Response) return body;

    const input = validateRulePatch(body);

    return input.valid
      ? { id, idempotencyKey, enabled: input.value.enabled }
      : validationFailure(input.errors);
  },
  authorize: SOCIAL_PUBLISHING_GUARDS.rulesConfigure,
  handler: async (context) => {
    const refused = mutationRefusal(context.auth);

    if (refused) return refused;

    const { tx, tenantId, auth, prepared } = context;
    const actor = auth.context.tenantUserId;
    const rows = (await tx`
      SELECT channel_account_id FROM awcms_social_publish_rules
      WHERE tenant_id = ${tenantId} AND id = ${prepared.id}
    `) as { channel_account_id: string }[];

    if (
      !rows[0] ||
      !(await canUseAllAccounts(
        context,
        SOCIAL_PUBLISHING_GUARDS.rulesConfigure,
        [rows[0].channel_account_id]
      ))
    ) {
      return notFound("Rule");
    }

    return runIdempotent(
      tx,
      tenantId,
      "social_publishing_rule_patch",
      prepared.idempotencyKey,
      actor,
      { id: prepared.id, enabled: prepared.enabled },
      async () => {
        const rule = await setRuleEnabled(
          tx,
          tenantId,
          actor,
          prepared.id,
          prepared.enabled
        );

        if (!rule) return notFound("Rule");

        await auditPublishing(context, {
          action: "social_publishing.rule.configure",
          resourceType: "social_publish_rule",
          resourceId: rule.id,
          severity: "warning",
          message: prepared.enabled
            ? "Social publish rule enabled."
            : "Social publish rule disabled.",
          attributes: {
            trigger: rule.trigger,
            accountId: rule.accountId,
            enabled: rule.enabled
          }
        });

        return { status: 200, body: rule };
      }
    );
  }
});
