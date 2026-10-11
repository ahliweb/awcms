import { fail } from "../../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../../modules/_shared/tenant-route";
import { publishRule } from "../../../../../../modules/hr-commission/application/hr-commission-rule-directory";
import {
  asUuid,
  badId,
  readIdempotencyKey,
  readValidatedBody,
  runIdempotent
} from "../../../../../../modules/hr-commission/application/hr-commission-route-support";
import { HR_COMMISSION_GUARDS } from "../../../../../../modules/hr-commission/domain/hr-commission-permissions";
import { validatePublishBody } from "../../../../../../modules/hr-commission/domain/hr-commission-validation";

type Prepared = {
  id: string;
  idempotencyKey: string;
  expectedContentDigest: string;
  backdatedReason: string | null;
};

const SCOPE = "hr_commission_rule_publish";

/**
 * `POST /api/v1/hr-commission/rules/{id}/publish` — make a draft IMMUTABLE and
 * eligible to apply. The body names the `expectedContentDigest` the publisher
 * reviewed: if the terms changed since, `409 RULE_CHANGED`. Whoever created or
 * last edited the draft may not publish it (`403 PUBLISH_BY_AUTHOR_FORBIDDEN`,
 * maker / checker). Refused (409) when its window overlaps another published
 * version of the same rule, naming that version. High-risk, audited (the audit
 * row carries the rule key, version, window and content digest — never a rate or
 * an amount), and idempotent: replaying the same key returns the stored response.
 */
export const POST = defineTenantRoute<Prepared>({
  workClass: "interactive",
  prepare: async ({ request, params }) => {
    const id = asUuid(params.id);

    if (!id) {
      return badId();
    }

    const idempotencyKey = readIdempotencyKey(request);

    if (idempotencyKey instanceof Response) {
      return idempotencyKey;
    }

    const body = await readValidatedBody(request, validatePublishBody);

    return body instanceof Response
      ? body
      : {
          id,
          idempotencyKey,
          expectedContentDigest: body.expectedContentDigest,
          backdatedReason: body.backdatedReason
        };
  },
  authorize: HR_COMMISSION_GUARDS.rules.publish,
  handler: async ({ tx, tenantId, auth, prepared, locals }) =>
    runIdempotent(
      tx,
      tenantId,
      SCOPE,
      prepared.idempotencyKey,
      auth.context.tenantUserId,
      {
        id: prepared.id,
        expectedContentDigest: prepared.expectedContentDigest,
        backdatedReason: prepared.backdatedReason
      },
      async () => {
        const result = await publishRule(
          tx,
          tenantId,
          prepared.id,
          {
            actorTenantUserId: auth.context.tenantUserId,
            correlationId: locals.correlationId
          },
          prepared.expectedContentDigest,
          prepared.backdatedReason
        );

        switch (result.outcome) {
          case "ok":
            return { status: 200, body: result.rule };
          case "not_found":
            return fail(
              404,
              "RESOURCE_NOT_FOUND",
              "Commission rule not found."
            );
          case "not_draft":
            return fail(
              409,
              "RULE_NOT_DRAFT",
              `Only a draft can be published; this version is ${result.status}.`
            );
          case "stale":
            return fail(
              409,
              "RULE_CHANGED",
              "The rule changed since you reviewed it; review the current terms and publish with their contentDigest."
            );
          case "self_publish":
            return fail(
              403,
              "PUBLISH_BY_AUTHOR_FORBIDDEN",
              "The person who created or last edited a draft cannot publish it; a second person must."
            );
          case "backdated_reason_required":
            return fail(
              409,
              "RULE_BACKDATED_REASON_REQUIRED",
              `The window starts before today (${result.todayUtc}, UTC): it changes which rule applies to events that already happened, so publishing it needs a backdatedReason.`
            );
          case "window_overlap":
            return fail(
              409,
              "RULE_WINDOW_OVERLAP",
              `The effective window overlaps published version ${result.conflictingVersionNo} of this rule; end that version's window at authoring or retire it.`
            );
        }
      }
    )
});
