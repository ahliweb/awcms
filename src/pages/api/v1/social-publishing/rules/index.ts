import { fail, ok } from "../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../modules/_shared/tenant-route";
import {
  auditPublishing,
  canUseAllAccounts,
  disabledResponse,
  loadPublishersOrNull,
  mutationRefusal,
  readIdempotencyKey,
  readJson,
  runIdempotent,
  validationFailure
} from "../../../../../modules/social-publishing/application/route-support";
import {
  MAX_RULES_PER_TENANT,
  countRules,
  listRules,
  upsertRule
} from "../../../../../modules/social-publishing/application/settings-directory";
import { SOCIAL_PUBLISHING_GUARDS } from "../../../../../modules/social-publishing/domain/social-publishing-constants";
import {
  validateCreateRule,
  type CreateRuleInput
} from "../../../../../modules/social-publishing/domain/social-publishing-validation";

/**
 * `GET /api/v1/social-publishing/rules` (Issue #1145) — which connected accounts
 * each article event publishes to. A rule is a pointer, never a grant: the
 * account's own `publish` capability decides, at enqueue and again at dispatch.
 */
export const GET = defineTenantRoute({
  workClass: "interactive",
  authorize: SOCIAL_PUBLISHING_GUARDS.rulesRead,
  handler: async (context) => {
    const disabled = disabledResponse();

    if (disabled) return disabled;

    return ok({ items: await listRules(context.tx, context.tenantId) });
  }
});

type Prepared = { idempotencyKey: string; input: CreateRuleInput };

/**
 * `POST /api/v1/social-publishing/rules` (Issue #1145) — publish an article
 * event (`post_published`, `scheduled_published`, `manual_editor_action`) to one
 * more account, or re-enable a disabled rule. The caller must be able to use the
 * account (assignment rule and business scope of `channel_accounts`; another
 * tenant's account and an unknown id are one `422 ACCOUNT_NOT_USABLE`), and the
 * account must be of a provider that can publish at all. Whether it MAY publish
 * now is not asked here (a rule can be set up before an approval lands): that is
 * decided at enqueue and at dispatch. High-risk: `Idempotency-Key`, audited at
 * `warning`.
 */
export const POST = defineTenantRoute<Prepared>({
  workClass: "interactive",
  prepare: async ({ request }) => {
    const idempotencyKey = readIdempotencyKey(request);

    if (idempotencyKey instanceof Response) return idempotencyKey;

    const body = await readJson(request);

    if (body instanceof Response) return body;

    const input = validateCreateRule(body);

    return input.valid
      ? { idempotencyKey, input: input.value }
      : validationFailure(input.errors);
  },
  authorize: SOCIAL_PUBLISHING_GUARDS.rulesConfigure,
  handler: async (context) => {
    const refused = mutationRefusal(context.auth);

    if (refused) return refused;

    const { tx, tenantId, auth, prepared } = context;
    const actor = auth.context.tenantUserId;
    const { trigger, accountId } = prepared.input;

    if (
      !(await canUseAllAccounts(
        context,
        SOCIAL_PUBLISHING_GUARDS.rulesConfigure,
        [accountId]
      ))
    ) {
      return fail(
        422,
        "ACCOUNT_NOT_USABLE",
        "The account cannot be used by you for publishing."
      );
    }

    const publishers = await loadPublishersOrNull();
    const resolved = publishers
      ? await publishers.resolvePublisher(tx, { tenantId, accountId })
      : null;

    if (
      !resolved ||
      (!resolved.usable &&
        (resolved.reason === "NOT_A_PUBLISHER" ||
          resolved.reason === "ACCOUNT_NOT_FOUND" ||
          resolved.reason === "CHANNEL_ACCOUNTS_DISABLED"))
    ) {
      return fail(
        422,
        "ACCOUNT_NOT_USABLE",
        "The account cannot be used for publishing."
      );
    }

    return runIdempotent(
      tx,
      tenantId,
      "social_publishing_rule_create",
      prepared.idempotencyKey,
      actor,
      prepared.input,
      async () => {
        if ((await countRules(tx, tenantId)) >= MAX_RULES_PER_TENANT) {
          return fail(
            422,
            "RULE_LIMIT_REACHED",
            "This tenant already has the maximum number of publish rules."
          );
        }

        const result = await upsertRule(
          tx,
          tenantId,
          actor,
          trigger,
          accountId
        );

        await auditPublishing(context, {
          action: "social_publishing.rule.configure",
          resourceType: "social_publish_rule",
          resourceId: result.rule.id,
          severity: "warning",
          message: result.created
            ? "Social publish rule added."
            : "Social publish rule enabled.",
          attributes: { trigger, accountId, created: result.created }
        });

        return { status: result.created ? 201 : 200, body: result.rule };
      }
    );
  }
});
