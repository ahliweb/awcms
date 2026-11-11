import { fail } from "../../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../../modules/_shared/tenant-route";
import { archiveRule } from "../../../../../../modules/crm-follow-up/application/rule-directory";
import {
  asUuid,
  auditCrmFollowUp,
  badId,
  mutationRefusal,
  notFound,
  prepareMutation,
  runIdempotent,
  versionConflict
} from "../../../../../../modules/crm-follow-up/application/route-support";
import { CRM_FOLLOW_UP_GUARDS } from "../../../../../../modules/crm-follow-up/domain/crm-follow-up-constants";
import {
  validateVersioned,
  type VersionedInput
} from "../../../../../../modules/crm-follow-up/domain/crm-follow-up-validation";

/**
 * `POST /api/v1/crm-follow-up/rules/{id}/archive` (Issue #1165) — the rule
 * creates no new task from now on. Tasks it already created keep running; stop
 * them with a stop signal or cancel them. High-risk (`configure`):
 * `Idempotency-Key`, `expectedVersion`, audited at warning. A rule is never
 * deleted: its revisions are what its tasks point at.
 */
export const POST = defineTenantRoute<{
  idempotencyKey: string;
  input: VersionedInput;
}>({
  workClass: "interactive",
  prepare: ({ request }) => prepareMutation(request, validateVersioned),
  authorize: CRM_FOLLOW_UP_GUARDS.configureRules,
  handler: async (context) => {
    const refused = mutationRefusal(context.auth);

    if (refused) return refused;

    const id = asUuid(context.params.id);

    if (!id) return badId();

    const { tx, tenantId, auth, prepared } = context;
    const actor = auth.context.tenantUserId;

    return runIdempotent(
      tx,
      tenantId,
      "crm_follow_up_rule_archive",
      prepared.idempotencyKey,
      actor,
      { id, ...prepared.input },
      async () => {
        const result = await archiveRule(
          tx,
          tenantId,
          actor,
          id,
          prepared.input.expectedVersion
        );

        switch (result.outcome) {
          case "not_found":
            return notFound("Rule");
          case "version_conflict":
            return versionConflict(result.currentVersion);
          case "archived_rule":
            return fail(409, "RULE_ARCHIVED", "This rule is archived.");
          case "archived":
            break;
          default:
            return fail(409, "RULE_ARCHIVED", "This rule is archived.");
        }

        await auditCrmFollowUp(context, {
          action: "crm_follow_up.rule.archive",
          resourceType: "crm_follow_up_rule",
          resourceId: id,
          severity: "warning",
          message: "Follow-up rule archived."
        });

        return { status: 200, body: result.rule };
      }
    );
  }
});
