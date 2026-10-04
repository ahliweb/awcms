import { fail } from "../../../../../../modules/_shared/api-response";
import { computeRequestHash } from "../../../../../../modules/_shared/idempotency";
import { defineTenantRoute } from "../../../../../../modules/_shared/tenant-route";
import { recordAuditEvent } from "../../../../../../modules/logging/application/audit-log";
import { runIdempotent } from "../../../../../../modules/tax/application/tax-idempotency";
import { publishRuleVersionPublishedEvent } from "../../../../../../modules/tax/application/tax-event-publisher";
import { publishRuleVersion } from "../../../../../../modules/tax/application/tax-rule-version-directory";
import {
  idempotencyKeyRequired,
  isUuid
} from "../../../../../../modules/tax/application/tax-route-support";
import {
  TAX_MODULE_KEY,
  TAX_RULES_ACTIVITY_CODE
} from "../../../../../../modules/tax/domain/tax-permissions";

/**
 * `POST /api/v1/tax/rule-versions/{id}/publish` (ADR-0127) — make a draft the rule
 * every sale on or after its `effectiveFrom` is taxed under.
 *
 * ## Why this is the high-risk step
 *
 * It is the only act that changes what future documents are taxed at. It is
 * separately grantable (`tax.rules.publish`, the natural second key of a
 * maker/checker split), idempotency-keyed, audited at `critical`, and emits
 * `awcms.tax.rule_version.published` through the outbox.
 *
 * ## What it does NOT do
 *
 * It never alters a document already finalised: a snapshot carries its own copy of
 * the version it was computed under, and a published version is immutable. It
 * refuses to publish into the past: `409 TAX_VERSION_OUT_OF_ORDER` unless it takes
 * effect strictly after the latest published version (which it then ends), and
 * `409 TAX_VERSION_BACKDATED` if it takes effect before the server's date or on or
 * before a tax date already finalised under the profile.
 */
const IDEMPOTENCY_SCOPE = "tax_rule_version_publish";

type Prepared = { idempotencyKey: string };

export const POST = defineTenantRoute<Prepared>({
  workClass: "interactive",
  prepare: ({ request }) => {
    const idempotencyKey = idempotencyKeyRequired(request);

    return idempotencyKey instanceof Response
      ? idempotencyKey
      : { idempotencyKey };
  },
  authorize: {
    moduleKey: TAX_MODULE_KEY,
    activityCode: TAX_RULES_ACTIVITY_CODE,
    action: "publish"
  },
  handler: async ({ tx, auth, prepared, tenantId, params, locals }) => {
    const id = params.id;

    if (!id || !isUuid(id)) {
      return fail(404, "RESOURCE_NOT_FOUND", "Tax rule version not found.");
    }

    return runIdempotent(
      tx,
      tenantId,
      IDEMPOTENCY_SCOPE,
      prepared.idempotencyKey,
      computeRequestHash({ id, action: "publish" }),
      async () => {
        const outcome = await publishRuleVersion(
          tx,
          tenantId,
          auth.context.tenantUserId,
          id
        );

        if (outcome.kind === "not_found") {
          return fail(404, "RESOURCE_NOT_FOUND", "Tax rule version not found.");
        }

        if (outcome.kind === "already_published") {
          return fail(
            409,
            "TAX_VERSION_ALREADY_PUBLISHED",
            "This rule version is already published."
          );
        }

        if (outcome.kind === "out_of_order") {
          return fail(
            409,
            "TAX_VERSION_OUT_OF_ORDER",
            `A new version must take effect after ${outcome.latestEffectiveFrom}, the latest published version of this profile.`
          );
        }

        if (outcome.kind === "backdated") {
          return fail(
            409,
            "TAX_VERSION_BACKDATED",
            outcome.reason === "before_today"
              ? `A version cannot take effect before the server date (${outcome.boundary}).`
              : `A version cannot take effect on or before ${outcome.boundary}, the latest tax date already finalised under this profile.`
          );
        }

        const context = {
          actorTenantUserId: auth.context.tenantUserId,
          correlationId: locals.correlationId
        };

        await recordAuditEvent(tx, {
          tenantId,
          actorTenantUserId: auth.context.tenantUserId,
          moduleKey: TAX_MODULE_KEY,
          action: "tax.rule_version.publish",
          resourceType: "tax_rule_version",
          resourceId: outcome.version.id,
          severity: "critical",
          message: "Tax rule version published.",
          attributes: {
            profileCode: outcome.version.profileCode,
            versionNo: outcome.version.versionNo,
            effectiveFrom: outcome.version.effectiveFrom,
            closedVersionId: outcome.closedVersionId
          },
          correlationId: locals.correlationId
        });

        await publishRuleVersionPublishedEvent(
          tx,
          tenantId,
          outcome.version,
          outcome.closedVersionId,
          context
        );

        return { status: 200, body: { success: true, data: outcome.version } };
      }
    );
  }
});
