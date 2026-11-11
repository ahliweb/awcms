import { fail } from "../../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../../modules/_shared/tenant-route";
import { publishRevision } from "../../../../../../modules/crm-follow-up/application/rule-directory";
import {
  asUuid,
  auditCrmFollowUp,
  badId,
  mutationRefusal,
  notFound,
  prepareMutation,
  runIdempotent,
  unknownUsers,
  versionConflict
} from "../../../../../../modules/crm-follow-up/application/route-support";
import { CRM_FOLLOW_UP_GUARDS } from "../../../../../../modules/crm-follow-up/domain/crm-follow-up-constants";
import {
  validatePublishRevision,
  type PublishRevisionInput
} from "../../../../../../modules/crm-follow-up/domain/crm-follow-up-validation";

/**
 * `POST /api/v1/crm-follow-up/rules/{id}/revisions` (Issue #1165, ADR-0159
 * section 3) — publish the next IMMUTABLE revision of a rule. Tasks already
 * created keep the revision that created them; only new triggers use the new
 * one. An identical definition is refused (`409 REVISION_UNCHANGED`), an
 * archived rule cannot change (`409 RULE_ARCHIVED`). High-risk (`configure`):
 * `Idempotency-Key`, `expectedVersion`, audited at warning.
 */
export const POST = defineTenantRoute<{
  idempotencyKey: string;
  input: PublishRevisionInput;
}>({
  workClass: "interactive",
  prepare: ({ request }) => prepareMutation(request, validatePublishRevision),
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
      "crm_follow_up_rule_publish",
      prepared.idempotencyKey,
      actor,
      { id, ...prepared.input },
      async () => {
        const result = await publishRevision(
          tx,
          tenantId,
          actor,
          id,
          prepared.input
        );

        switch (result.outcome) {
          case "not_found":
            return notFound("Rule");
          case "version_conflict":
            return versionConflict(result.currentVersion);
          case "archived_rule":
            return fail(409, "RULE_ARCHIVED", "This rule is archived.");
          case "unchanged":
            return fail(
              409,
              "REVISION_UNCHANGED",
              "The definition is identical to the current revision."
            );
          case "unknown_users":
            return unknownUsers();
          case "archived":
          case "published":
            break;
        }

        await auditCrmFollowUp(context, {
          action: "crm_follow_up.rule.publish",
          resourceType: "crm_follow_up_rule",
          resourceId: id,
          severity: "warning",
          message: "Follow-up rule revision published.",
          attributes: {
            revisionNumber: result.rule.currentRevisionNumber,
            triggerKind: prepared.input.definition.trigger.kind,
            definitionHash: result.rule.currentRevision?.definitionHash ?? null
          }
        });

        return { status: 201, body: result.rule };
      }
    );
  }
});
