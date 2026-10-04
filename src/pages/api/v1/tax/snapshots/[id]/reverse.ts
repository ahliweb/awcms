import { fail } from "../../../../../../modules/_shared/api-response";
import { computeRequestHash } from "../../../../../../modules/_shared/idempotency";
import { defineTenantRoute } from "../../../../../../modules/_shared/tenant-route";
import {
  bodyTooLargeResponse,
  readJsonBody
} from "../../../../../../lib/security/request-body-limit";
import { recordAuditEvent } from "../../../../../../modules/logging/application/audit-log";
import { guardTaxDate } from "../../../../../../modules/tax/application/tax-date-guard";
import { publishSnapshotEvent } from "../../../../../../modules/tax/application/tax-event-publisher";
import { runIdempotent } from "../../../../../../modules/tax/application/tax-idempotency";
import {
  idempotencyKeyRequired,
  isUuid,
  validationFailure
} from "../../../../../../modules/tax/application/tax-route-support";
import { reverseSnapshot } from "../../../../../../modules/tax/application/tax-snapshot-directory";
import {
  TAX_MODULE_KEY,
  TAX_SNAPSHOTS_ACTIVITY_CODE
} from "../../../../../../modules/tax/domain/tax-permissions";
import {
  validateReversalInput,
  type ReversalInput
} from "../../../../../../modules/tax/domain/tax-validation";

/**
 * `POST /api/v1/tax/snapshots/{id}/reverse` (ADR-0127) — refund or return all or
 * part of a finalised document, computed from the ORIGINAL snapshot.
 *
 * ## Never from today's rule
 *
 * The reversal reads the original row's recorded quantities and amounts and
 * nothing else: it takes no rate and consults no rule table, so a refund of last
 * year's sale reverses the tax that was CHARGED, whatever the rate is now. The
 * body names lines and quantities returned (omit `lines` to reverse everything not
 * yet returned) — never an amount.
 *
 * ## Bounded and serialised
 *
 * Partial reversals cap at what has not yet been reversed, the one that completes
 * a line takes the exact remainder, and concurrent reversals of one sale queue on
 * a row lock (with a database trigger as the backstop), so the total refunded can
 * never exceed the total charged.
 *
 * `tax.snapshots.reverse` is HIGH-RISK. Requires an `Idempotency-Key`; the reversal
 * `documentId` is itself unique per original, so a retry under a fresh key replays.
 * Audited at `critical`; emits `awcms.tax.snapshot.reversed`.
 */
const IDEMPOTENCY_SCOPE = "tax_snapshot_reverse";

type Prepared = { idempotencyKey: string; input: ReversalInput };

export const POST = defineTenantRoute<Prepared>({
  workClass: "interactive",
  prepare: async ({ request }) => {
    const idempotencyKey = idempotencyKeyRequired(request);

    if (idempotencyKey instanceof Response) return idempotencyKey;

    const bodyRead = await readJsonBody(request);

    if (bodyRead.tooLarge) return bodyTooLargeResponse(bodyRead.limitBytes);

    const validation = validateReversalInput(bodyRead.value);

    if (!validation.valid) return validationFailure(validation);

    return { idempotencyKey, input: validation.value };
  },
  authorize: {
    moduleKey: TAX_MODULE_KEY,
    activityCode: TAX_SNAPSHOTS_ACTIVITY_CODE,
    action: "reverse"
  },
  handler: async ({
    tx,
    auth,
    prepared,
    tenantId,
    params,
    locals,
    tokenHash,
    now,
    request,
    clientAddress
  }) => {
    const originalId = params.id;

    if (!originalId || !isUuid(originalId)) {
      return fail(
        404,
        "RESOURCE_NOT_FOUND",
        "Original tax snapshot not found."
      );
    }

    const { input } = prepared;
    const inputHash = computeRequestHash({ originalId, ...input });

    return runIdempotent(
      tx,
      tenantId,
      IDEMPOTENCY_SCOPE,
      prepared.idempotencyKey,
      inputHash,
      async () => {
        // A stated tax date outside the server-date window needs its own
        // permission. An omitted one is the SERVER's date, never the original's:
        // a reversal reports in the period it happened in (ADR-0127 §6).
        let backdated = false;

        if (input.taxDate !== null) {
          const dateCheck = await guardTaxDate(
            { tx, tenantId, tokenHash, now, request, clientAddress },
            input.taxDate
          );

          if (!dateCheck.ok) return dateCheck.response;

          backdated = dateCheck.backdated;
        }

        const outcome = await reverseSnapshot(
          tx,
          tenantId,
          auth.context.tenantUserId,
          {
            originalId,
            documentId: input.documentId,
            requested: input.lines,
            taxDate: input.taxDate,
            reason: input.reason,
            inputHash
          }
        );

        if (outcome.kind === "original_not_found") {
          return fail(
            404,
            "RESOURCE_NOT_FOUND",
            "Original tax snapshot not found."
          );
        }

        if (outcome.kind === "conflict") {
          return fail(
            409,
            "TAX_DOCUMENT_ALREADY_FINALISED",
            "This reversal document id was already used with a different request."
          );
        }

        if (outcome.kind === "invalid") {
          return fail(422, "TAX_REVERSAL_INVALID", outcome.message);
        }

        if (outcome.kind === "created") {
          await recordAuditEvent(tx, {
            tenantId,
            actorTenantUserId: auth.context.tenantUserId,
            moduleKey: TAX_MODULE_KEY,
            action: "tax.snapshot.reverse",
            resourceType: "tax_snapshot",
            resourceId: outcome.snapshot.id,
            severity: "critical",
            message: "Document tax reversed.",
            attributes: {
              originalSnapshotId: originalId,
              documentType: outcome.snapshot.documentType,
              documentId: outcome.snapshot.documentId,
              taxTotal: outcome.snapshot.taxTotal,
              grossTotal: outcome.snapshot.grossTotal,
              reason: outcome.snapshot.reason,
              backdated
            },
            correlationId: locals.correlationId
          });

          await publishSnapshotEvent(tx, tenantId, outcome.snapshot, {
            actorTenantUserId: auth.context.tenantUserId,
            correlationId: locals.correlationId
          });
        }

        return {
          status: outcome.kind === "created" ? 201 : 200,
          body: { success: true, data: outcome.snapshot }
        };
      }
    );
  }
});
