import { fail, ok } from "../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../modules/_shared/tenant-route";
import {
  createRule,
  listRules,
  parseRuleCursor
} from "../../../../../modules/hr-commission/application/hr-commission-rule-directory";
import {
  readIdempotencyKey,
  readValidatedBody,
  runIdempotent
} from "../../../../../modules/hr-commission/application/hr-commission-route-support";
import { HR_COMMISSION_GUARDS } from "../../../../../modules/hr-commission/domain/hr-commission-permissions";
import {
  isCommissionRuleStatus,
  type CommissionRuleStatus
} from "../../../../../modules/hr-commission/domain/hr-commission-types";
import {
  validateCreateRule,
  type CreateRuleInput
} from "../../../../../modules/hr-commission/domain/hr-commission-validation";

const IDEMPOTENCY_SCOPE = "hr_commission_rule_create";

type ListPrepared = {
  ruleKey?: string;
  status?: CommissionRuleStatus;
  cursor: ReturnType<typeof parseRuleCursor>;
};

/**
 * `GET /api/v1/hr-commission/rules` — this tenant's commission rule versions,
 * newest first, keyset paginated (`?cursor=`), optionally filtered by `ruleKey`
 * and `status`. Rates and amounts are decimal STRINGS.
 */
export const GET = defineTenantRoute<ListPrepared>({
  workClass: "interactive",
  prepare: ({ url }) => {
    const ruleKey = url.searchParams.get("ruleKey");
    const status = url.searchParams.get("status");
    const cursorText = url.searchParams.get("cursor");

    if (ruleKey && !/^[a-z][a-z0-9_.-]{0,62}$/.test(ruleKey)) {
      return fail(400, "VALIDATION_ERROR", "ruleKey is not valid.");
    }

    if (status && !isCommissionRuleStatus(status)) {
      return fail(
        400,
        "VALIDATION_ERROR",
        "status must be draft, published or retired."
      );
    }

    const cursor = cursorText ? parseRuleCursor(cursorText) : null;

    if (cursorText && !cursor) {
      return fail(400, "VALIDATION_ERROR", "cursor is not valid.");
    }

    return {
      ruleKey: ruleKey || undefined,
      status: (status as CommissionRuleStatus | null) || undefined,
      cursor
    };
  },
  authorize: HR_COMMISSION_GUARDS.rules.read,
  handler: async ({ tx, tenantId, prepared }) =>
    ok(
      await listRules(
        tx,
        tenantId,
        { ruleKey: prepared.ruleKey, status: prepared.status },
        prepared.cursor ?? undefined
      )
    )
});

type CreatePrepared = { idempotencyKey: string; input: CreateRuleInput };

/**
 * `POST /api/v1/hr-commission/rules` — create a DRAFT version of a rule. The
 * version number is assigned (the next one for that `ruleKey`, or 1); the
 * status is always `draft`. Creating a draft does not make it apply.
 */
export const POST = defineTenantRoute<CreatePrepared>({
  workClass: "interactive",
  prepare: async ({ request }) => {
    const idempotencyKey = readIdempotencyKey(request);

    if (idempotencyKey instanceof Response) {
      return idempotencyKey;
    }

    const input = await readValidatedBody(request, validateCreateRule);

    return input instanceof Response ? input : { idempotencyKey, input };
  },
  authorize: HR_COMMISSION_GUARDS.rules.create,
  handler: async ({ tx, tenantId, auth, prepared, locals }) =>
    runIdempotent(
      tx,
      tenantId,
      IDEMPOTENCY_SCOPE,
      prepared.idempotencyKey,
      auth.context.tenantUserId,
      prepared.input,
      async () => {
        const result = await createRule(
          tx,
          tenantId,
          {
            actorTenantUserId: auth.context.tenantUserId,
            correlationId: locals.correlationId
          },
          prepared.input
        );

        return { status: 201, body: result.rule };
      }
    )
});
