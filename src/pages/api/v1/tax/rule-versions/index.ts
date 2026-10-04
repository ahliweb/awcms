import { fail, ok } from "../../../../../modules/_shared/api-response";
import { computeRequestHash } from "../../../../../modules/_shared/idempotency";
import { decodeKeysetCursor } from "../../../../../modules/_shared/keyset-pagination";
import { defineTenantRoute } from "../../../../../modules/_shared/tenant-route";
import {
  bodyTooLargeResponse,
  readJsonBody
} from "../../../../../lib/security/request-body-limit";
import { recordAuditEvent } from "../../../../../modules/logging/application/audit-log";
import { runIdempotent } from "../../../../../modules/tax/application/tax-idempotency";
import {
  createDraftVersion,
  listRuleVersions,
  type RuleVersionListFilters
} from "../../../../../modules/tax/application/tax-rule-version-directory";
import {
  idempotencyKeyRequired,
  validationFailure
} from "../../../../../modules/tax/application/tax-route-support";
import {
  TAX_MODULE_KEY,
  TAX_RULES_ACTIVITY_CODE
} from "../../../../../modules/tax/domain/tax-permissions";
import {
  validateRuleVersionInput,
  type RuleVersionInput
} from "../../../../../modules/tax/domain/tax-validation";

/**
 * `GET`/`POST /api/v1/tax/rule-versions` (ADR-0127) — list this tenant's tax rule
 * versions, and author a new DRAFT.
 *
 * A draft changes nothing: it is not resolved by any quote or snapshot until it is
 * published (`POST .../{id}/publish`), which is a separately grantable permission.
 * `POST` still requires an `Idempotency-Key` — creating a draft is not naturally
 * idempotent (a retry would otherwise mint a second draft and bump the version
 * number) — and is audited.
 */
const IDEMPOTENCY_SCOPE = "tax_rule_version_create";

type ListPrepared = {
  filters: RuleVersionListFilters;
  cursor?: ReturnType<typeof decodeKeysetCursor>;
};

export const GET = defineTenantRoute<ListPrepared>({
  workClass: "interactive",
  prepare: ({ url }) => {
    const cursorParam = url.searchParams.get("cursor");
    const cursor = cursorParam ? decodeKeysetCursor(cursorParam) : undefined;

    if (cursorParam && !cursor) {
      return fail(400, "VALIDATION_ERROR", "cursor is malformed.");
    }

    const filters: RuleVersionListFilters = {};
    const profileCode = url.searchParams.get("profileCode");
    const status = url.searchParams.get("status");

    if (profileCode) filters.profileCode = profileCode;

    if (status !== null) {
      if (status !== "draft" && status !== "published") {
        return fail(
          400,
          "VALIDATION_ERROR",
          "status must be draft or published."
        );
      }
      filters.status = status;
    }

    return { filters, cursor };
  },
  authorize: {
    moduleKey: TAX_MODULE_KEY,
    activityCode: TAX_RULES_ACTIVITY_CODE,
    action: "read"
  },
  handler: async ({ tx, tenantId, prepared }) => {
    const { versions, nextCursor } = await listRuleVersions(
      tx,
      tenantId,
      prepared.filters,
      prepared.cursor ?? undefined
    );

    return ok({ versions, nextCursor });
  }
});

type CreatePrepared = { idempotencyKey: string; input: RuleVersionInput };

export const POST = defineTenantRoute<CreatePrepared>({
  workClass: "interactive",
  prepare: async ({ request }) => {
    const idempotencyKey = idempotencyKeyRequired(request);

    if (idempotencyKey instanceof Response) return idempotencyKey;

    const bodyRead = await readJsonBody(request);

    if (bodyRead.tooLarge) return bodyTooLargeResponse(bodyRead.limitBytes);

    const validation = validateRuleVersionInput(bodyRead.value);

    if (!validation.valid) return validationFailure(validation);

    return { idempotencyKey, input: validation.value };
  },
  authorize: {
    moduleKey: TAX_MODULE_KEY,
    activityCode: TAX_RULES_ACTIVITY_CODE,
    action: "configure"
  },
  handler: async ({ tx, auth, prepared, tenantId, locals }) =>
    runIdempotent(
      tx,
      tenantId,
      IDEMPOTENCY_SCOPE,
      prepared.idempotencyKey,
      computeRequestHash(prepared.input),
      async () => {
        const version = await createDraftVersion(
          tx,
          tenantId,
          auth.context.tenantUserId,
          prepared.input
        );

        await recordAuditEvent(tx, {
          tenantId,
          actorTenantUserId: auth.context.tenantUserId,
          moduleKey: TAX_MODULE_KEY,
          action: "tax.rule_version.create",
          resourceType: "tax_rule_version",
          resourceId: version.id,
          severity: "info",
          message: "Tax rule version drafted.",
          attributes: {
            profileCode: version.profileCode,
            versionNo: version.versionNo,
            effectiveFrom: version.effectiveFrom,
            pricingMode: version.pricingMode,
            roundingMode: version.roundingMode,
            roundingScale: version.roundingScale,
            roundingLevel: version.roundingLevel
          },
          correlationId: locals.correlationId
        });

        return { status: 201, body: { success: true, data: version } };
      }
    )
});
