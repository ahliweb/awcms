import { fail, ok } from "../../../../../modules/_shared/api-response";
import { computeRequestHash } from "../../../../../modules/_shared/idempotency";
import { decodeKeysetCursor } from "../../../../../modules/_shared/keyset-pagination";
import { defineTenantRoute } from "../../../../../modules/_shared/tenant-route";
import {
  bodyTooLargeResponse,
  readJsonBody
} from "../../../../../lib/security/request-body-limit";
import { recordAuditEvent } from "../../../../../modules/logging/application/audit-log";
import { publishSnapshotEvent } from "../../../../../modules/tax/application/tax-event-publisher";
import { runIdempotent } from "../../../../../modules/tax/application/tax-idempotency";
import { guardTaxDate } from "../../../../../modules/tax/application/tax-date-guard";
import {
  lockProfileShared,
  resolveRuleVersion
} from "../../../../../modules/tax/application/tax-rule-version-directory";
import {
  NO_RULE_VERSION_RESPONSE,
  calculationFailure,
  idempotencyKeyRequired,
  validationFailure
} from "../../../../../modules/tax/application/tax-route-support";
import {
  finaliseSnapshot,
  listSnapshots,
  type SnapshotListFilters
} from "../../../../../modules/tax/application/tax-snapshot-directory";
import { calculateTax } from "../../../../../modules/tax/domain/tax-calculator";
import {
  TAX_MODULE_KEY,
  TAX_SNAPSHOTS_ACTIVITY_CODE
} from "../../../../../modules/tax/domain/tax-permissions";
import {
  validateSnapshotInput,
  type SnapshotInput
} from "../../../../../modules/tax/domain/tax-validation";

/**
 * `GET`/`POST /api/v1/tax/snapshots` (ADR-0127) — finalise a document's tax into
 * an immutable snapshot, and list them.
 *
 * ## `POST` is the binding act
 *
 * The server computes the tax (same calculator as `/quote`, same rule version for
 * the same `taxDate`) and writes it, together with a copy of the rule version it
 * used, into an append-only row. From then on nothing about the rules can change
 * that document, and a refund is computed from this row alone.
 *
 * Idempotent two ways: the required `Idempotency-Key` (replays the stored
 * response), and the natural key `(documentType, documentId)` — finalising the
 * SAME document with the SAME request returns the existing snapshot even under a
 * fresh key, and a DIFFERENT request for an already-finalised document is a
 * `409 TAX_DOCUMENT_ALREADY_FINALISED`. Audited, and emits
 * `awcms.tax.snapshot.finalised` through the outbox.
 */
const IDEMPOTENCY_SCOPE = "tax_snapshot_finalise";

type ListPrepared = {
  filters: SnapshotListFilters;
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

    const filters: SnapshotListFilters = {};
    const documentType = url.searchParams.get("documentType");
    const documentId = url.searchParams.get("documentId");
    const kind = url.searchParams.get("kind");

    if (documentType) filters.documentType = documentType;
    if (documentId) filters.documentId = documentId;

    if (kind !== null) {
      if (kind !== "sale" && kind !== "reversal") {
        return fail(400, "VALIDATION_ERROR", "kind must be sale or reversal.");
      }
      filters.kind = kind;
    }

    return { filters, cursor };
  },
  authorize: {
    moduleKey: TAX_MODULE_KEY,
    activityCode: TAX_SNAPSHOTS_ACTIVITY_CODE,
    action: "read"
  },
  handler: async ({ tx, tenantId, prepared }) => {
    const { snapshots, nextCursor } = await listSnapshots(
      tx,
      tenantId,
      prepared.filters,
      prepared.cursor ?? undefined
    );

    return ok({ snapshots, nextCursor });
  }
});

type CreatePrepared = { idempotencyKey: string; input: SnapshotInput };

export const POST = defineTenantRoute<CreatePrepared>({
  workClass: "interactive",
  prepare: async ({ request }) => {
    const idempotencyKey = idempotencyKeyRequired(request);

    if (idempotencyKey instanceof Response) return idempotencyKey;

    const bodyRead = await readJsonBody(request);

    if (bodyRead.tooLarge) return bodyTooLargeResponse(bodyRead.limitBytes);

    const validation = validateSnapshotInput(bodyRead.value);

    if (!validation.valid) return validationFailure(validation);

    return { idempotencyKey, input: validation.value };
  },
  authorize: {
    moduleKey: TAX_MODULE_KEY,
    activityCode: TAX_SNAPSHOTS_ACTIVITY_CODE,
    action: "create"
  },
  handler: async ({
    tx,
    auth,
    prepared,
    tenantId,
    locals,
    tokenHash,
    now,
    request,
    clientAddress
  }) => {
    const { input } = prepared;
    const inputHash = computeRequestHash(input);

    return runIdempotent(
      tx,
      tenantId,
      IDEMPOTENCY_SCOPE,
      prepared.idempotencyKey,
      inputHash,
      async () => {
        // A tax date outside the server-date window needs its own permission,
        // and is refused by name without it (ADR-0127 §6).
        const dateCheck = await guardTaxDate(
          { tx, tenantId, tokenHash, now, request, clientAddress },
          input.taxDate
        );

        if (!dateCheck.ok) return dateCheck.response;

        // Shared profile lock BEFORE resolving the version: a concurrent publish
        // waits for this finalise to commit, so its back-dating check sees this
        // document's tax date.
        await lockProfileShared(tx, tenantId, input.profileCode);

        const version = await resolveRuleVersion(
          tx,
          tenantId,
          input.profileCode,
          input.taxDate
        );

        if (!version) {
          return NO_RULE_VERSION_RESPONSE(input.profileCode, input.taxDate);
        }

        let calculation;

        try {
          calculation = calculateTax(version, input.lines);
        } catch (error) {
          return (
            calculationFailure(error) ??
            fail(500, "INTERNAL_ERROR", "Tax calculation failed.")
          );
        }

        const outcome = await finaliseSnapshot(
          tx,
          tenantId,
          auth.context.tenantUserId,
          {
            documentType: input.documentType,
            documentId: input.documentId,
            taxDate: input.taxDate,
            version,
            calculation,
            inputHash
          }
        );

        if (outcome.kind === "conflict") {
          return fail(
            409,
            "TAX_DOCUMENT_ALREADY_FINALISED",
            "This document was already finalised with a different request."
          );
        }

        if (outcome.kind === "created") {
          await recordAuditEvent(tx, {
            tenantId,
            actorTenantUserId: auth.context.tenantUserId,
            moduleKey: TAX_MODULE_KEY,
            action: "tax.snapshot.finalise",
            resourceType: "tax_snapshot",
            resourceId: outcome.snapshot.id,
            severity: "info",
            message: "Document tax finalised.",
            attributes: {
              documentType: outcome.snapshot.documentType,
              documentId: outcome.snapshot.documentId,
              profileCode: outcome.snapshot.profileCode,
              versionNo: outcome.snapshot.versionNo,
              taxDate: outcome.snapshot.taxDate,
              backdated: dateCheck.backdated,
              netTotal: outcome.snapshot.netTotal,
              taxTotal: outcome.snapshot.taxTotal,
              grossTotal: outcome.snapshot.grossTotal
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
