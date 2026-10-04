import { fail, ok } from "../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../modules/_shared/tenant-route";
import {
  bodyTooLargeResponse,
  readJsonBody
} from "../../../../lib/security/request-body-limit";
import { resolveRuleVersion } from "../../../../modules/tax/application/tax-rule-version-directory";
import {
  NO_RULE_VERSION_RESPONSE,
  calculationFailure,
  validationFailure
} from "../../../../modules/tax/application/tax-route-support";
import { calculateTax } from "../../../../modules/tax/domain/tax-calculator";
import {
  TAX_CALCULATIONS_ACTIVITY_CODE,
  TAX_MODULE_KEY
} from "../../../../modules/tax/domain/tax-permissions";
import {
  validateQuoteInput,
  type QuoteInput
} from "../../../../modules/tax/domain/tax-validation";

/**
 * `POST /api/v1/tax/quote` (ADR-0127) — the stateless tax calculation every
 * quote, POS and storefront caller uses.
 *
 * ## Server-authoritative
 *
 * The body carries quantities, unit prices, discounts and a category per line —
 * never a tax amount. A payload that names one (`taxAmount`, `vat`, `total`, ...)
 * is refused outright with `400 TAX_AMOUNT_NOT_ACCEPTED`, not silently ignored,
 * so a client cannot believe its figure was honoured. The response is what the
 * server computes under the rule version in force on `taxDate`.
 *
 * ## Records nothing
 *
 * No snapshot, no event, no audit row: a quote is a question, and a storefront
 * asks it on every cart edit. Gated by `tax.calculations.analyze` (read-only,
 * not high-risk). The binding act is `POST /api/v1/tax/snapshots`. No
 * `Idempotency-Key`: there is no effect to repeat.
 */
type Prepared = { input: QuoteInput };

export const POST = defineTenantRoute<Prepared>({
  workClass: "interactive",
  prepare: async ({ request }) => {
    const bodyRead = await readJsonBody(request);

    if (bodyRead.tooLarge) return bodyTooLargeResponse(bodyRead.limitBytes);

    const validation = validateQuoteInput(bodyRead.value);

    if (!validation.valid) return validationFailure(validation);

    return { input: validation.value };
  },
  authorize: {
    moduleKey: TAX_MODULE_KEY,
    activityCode: TAX_CALCULATIONS_ACTIVITY_CODE,
    action: "analyze"
  },
  handler: async ({ tx, tenantId, prepared }) => {
    const { input } = prepared;
    const version = await resolveRuleVersion(
      tx,
      tenantId,
      input.profileCode,
      input.taxDate
    );

    if (!version) {
      return NO_RULE_VERSION_RESPONSE(input.profileCode, input.taxDate);
    }

    try {
      const calculation = calculateTax(version, input.lines);

      return ok({
        ruleVersion: {
          id: version.ruleVersionId,
          profileCode: version.profileCode,
          versionNo: version.versionNo,
          jurisdictionCode: version.jurisdictionCode
        },
        taxDate: input.taxDate,
        ...calculation
      });
    } catch (error) {
      return (
        calculationFailure(error) ??
        fail(500, "INTERNAL_ERROR", "Tax calculation failed.")
      );
    }
  }
});
