import { fail, ok } from "../../../../../modules/_shared/api-response";
import type { CommissionAccrualRequest } from "../../../../../modules/_shared/ports/commission-accrual-port";
import { recordSensitiveRead } from "../../../../../modules/logging/application/sensitive-read-audit";
import { defineTenantRoute } from "../../../../../modules/_shared/tenant-route";
import { accrueRefusal } from "../../../../../modules/hr-commission/application/hr-commission-accrual-route-support";
import {
  accrueCommission,
  auditAccrued,
  getAccrual,
  listAccruals,
  parseAccrualCursor
} from "../../../../../modules/hr-commission/application/hr-commission-accrual-ledger";
import {
  asUuid,
  readIdempotencyKey,
  readValidatedBody,
  runIdempotent
} from "../../../../../modules/hr-commission/application/hr-commission-route-support";
import {
  isAccrualStatus,
  type AccrualStatus
} from "../../../../../modules/hr-commission/domain/hr-commission-accrual-state";
import { validateAccrueBody } from "../../../../../modules/hr-commission/domain/hr-commission-accrual-validation";
import { HR_COMMISSION_GUARDS } from "../../../../../modules/hr-commission/domain/hr-commission-permissions";

const IDEMPOTENCY_SCOPE = "hr_commission_accrual_create";

type ListPrepared = {
  employmentId?: string;
  status?: AccrualStatus;
  sourceType?: string;
  cursor: ReturnType<typeof parseAccrualCursor>;
};

/**
 * `GET /api/v1/hr-commission/accruals` — this tenant's commission accruals,
 * newest first, keyset paginated (`?cursor=`), optionally filtered by
 * `employmentId`, `status` and `sourceType`. Amounts are decimal STRINGS and are
 * a person's earnings: the permission is its own.
 */
export const GET = defineTenantRoute<ListPrepared>({
  workClass: "interactive",
  prepare: ({ url }) => {
    const employmentId = url.searchParams.get("employmentId");
    const status = url.searchParams.get("status");
    const sourceType = url.searchParams.get("sourceType");
    const cursorText = url.searchParams.get("cursor");

    if (employmentId && !asUuid(employmentId)) {
      return fail(400, "VALIDATION_ERROR", "employmentId must be a UUID.");
    }

    if (status && !isAccrualStatus(status)) {
      return fail(
        400,
        "VALIDATION_ERROR",
        "status must be pending, approved, payable, paid or voided."
      );
    }

    if (sourceType && !/^[a-z][a-z0-9_.-]{0,62}$/.test(sourceType)) {
      return fail(400, "VALIDATION_ERROR", "sourceType is not valid.");
    }

    const cursor = cursorText ? parseAccrualCursor(cursorText) : null;

    if (cursorText && !cursor) {
      return fail(400, "VALIDATION_ERROR", "cursor is not valid.");
    }

    return {
      employmentId: employmentId
        ? (asUuid(employmentId) ?? undefined)
        : undefined,
      status: (status as AccrualStatus | null) || undefined,
      sourceType: sourceType || undefined,
      cursor
    };
  },
  authorize: HR_COMMISSION_GUARDS.accruals.read,
  handler: async ({ tx, tenantId, auth, prepared, locals }) => {
    const page = await listAccruals(
      tx,
      tenantId,
      {
        employmentId: prepared.employmentId,
        status: prepared.status,
        sourceType: prepared.sourceType
      },
      prepared.cursor ?? undefined
    );

    // PS-18: a read of people's earnings is an audited event (ids and counts
    // only, coalesced per actor and window), on this transaction.
    await recordSensitiveRead(tx, {
      tenantId,
      actorTenantUserId: auth.context.tenantUserId,
      permission: "hr_commission.accruals.read",
      itemCount: page.accruals.length,
      resourceIds: page.accruals.map((accrual) => accrual.id),
      correlationId: locals.correlationId
    });

    return ok(page);
  }
});

type CreatePrepared = {
  idempotencyKey: string;
  input: CommissionAccrualRequest;
};

/**
 * `POST /api/v1/hr-commission/accruals` — report a sale fact and accrue the
 * commission it earns, exactly once per `(source, employment)`. The AMOUNT is
 * computed by the ledger from the published rule in force on `occurredOn`; the
 * body can never assert it, a rule version, a status or a stamp. A redelivery of
 * the same canonical request returns the original with `replayed: true` (200);
 * the same source with a different amount, date, rule or currency is 409
 * `SOURCE_CONFLICT`. Requires an `Idempotency-Key`. Audited on a NEW accrual only,
 * and never with an amount.
 */
export const POST = defineTenantRoute<CreatePrepared>({
  workClass: "interactive",
  prepare: async ({ request }) => {
    const idempotencyKey = readIdempotencyKey(request);

    if (idempotencyKey instanceof Response) {
      return idempotencyKey;
    }

    const input = await readValidatedBody(request, (raw) =>
      validateAccrueBody(raw, new Date())
    );

    return input instanceof Response ? input : { idempotencyKey, input };
  },
  authorize: HR_COMMISSION_GUARDS.accruals.accrue,
  handler: async ({ tx, tenantId, auth, prepared, locals }) =>
    runIdempotent(
      tx,
      tenantId,
      IDEMPOTENCY_SCOPE,
      prepared.idempotencyKey,
      auth.context.tenantUserId,
      prepared.input,
      async () => {
        const result = await accrueCommission(
          tx,
          tenantId,
          auth.context.tenantUserId,
          { ...prepared.input, correlationId: locals.correlationId }
        );
        const refusal = accrueRefusal(result);

        if (refusal) {
          return refusal;
        }

        if (result.outcome !== "accrued" && result.outcome !== "replayed") {
          throw new Error("unreachable: accrue refusal handled above");
        }

        if (result.outcome === "accrued") {
          await auditAccrued(
            tx,
            tenantId,
            {
              actorTenantUserId: auth.context.tenantUserId,
              correlationId: locals.correlationId
            },
            result.accrual,
            prepared.input.source.type
          );
        }

        const stored = await getAccrual(tx, tenantId, result.accrual.id);

        // PS-18: a REPLAY hands back an existing accrual (amount, status),
        // which is a read of someone's earnings. A first-time accrual is
        // audited by auditAccrued above.
        if (result.outcome === "replayed") {
          await auditAccrualReplayRead(
            tx,
            tenantId,
            auth.context.tenantUserId,
            result.accrual.id,
            locals.correlationId
          );
        }

        return {
          status: result.outcome === "accrued" ? 201 : 200,
          body: {
            replayed: result.outcome === "replayed",
            accrual: stored!.accrual
          }
        };
      },
      async (storedBody) => {
        const id = (
          storedBody as { data?: { accrual?: { id?: unknown } } } | null
        )?.data?.accrual?.id;

        if (typeof id === "string") {
          await auditAccrualReplayRead(
            tx,
            tenantId,
            auth.context.tenantUserId,
            id,
            locals.correlationId
          );
        }
      }
    )
});

/** The read audit for a replayed POST, which returns a stored accrual. */
function auditAccrualReplayRead(
  tx: Bun.SQL,
  tenantId: string,
  actorTenantUserId: string,
  accrualId: string,
  correlationId: string | undefined
) {
  return recordSensitiveRead(tx, {
    tenantId,
    actorTenantUserId,
    permission: "hr_commission.accruals.read",
    itemCount: 1,
    resourceIds: [accrualId],
    correlationId
  });
}
