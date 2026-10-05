import { fail, ok } from "../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../modules/_shared/tenant-route";
import {
  createDocument,
  listDocuments,
  parseDocumentCursor
} from "../../../../../modules/procurement/application/procurement-document-directory";
import {
  documentFailureResponse,
  readDocumentFilters,
  readIdempotencyKey,
  readValidatedBody,
  runIdempotent
} from "../../../../../modules/procurement/application/procurement-route-support";
import { PROCUREMENT_GUARDS } from "../../../../../modules/procurement/domain/procurement-permissions";
import {
  validateCreateDocument,
  type CreateDocumentInput
} from "../../../../../modules/procurement/domain/procurement-validation";

type ListPrepared = Exclude<
  ReturnType<typeof readDocumentFilters>,
  Response
> & {
  cursorValue: ReturnType<typeof parseDocumentCursor>;
};

/**
 * `GET /api/v1/procurement/documents` — receiving, supplier-return, requisition
 * and transfer documents, newest first, keyset paginated. Lines are in the
 * single-document read.
 */
export const GET = defineTenantRoute<ListPrepared>({
  workClass: "interactive",
  prepare: ({ url }) => {
    const filters = readDocumentFilters(url);

    if (filters instanceof Response) {
      return filters;
    }

    const cursorValue = filters.cursor
      ? parseDocumentCursor(filters.cursor)
      : null;

    if (filters.cursor && !cursorValue) {
      return fail(400, "VALIDATION_ERROR", "cursor is not valid.");
    }

    return { ...filters, cursorValue };
  },
  authorize: PROCUREMENT_GUARDS.documents.read,
  handler: async ({ tx, tenantId, prepared }) => {
    const page = await listDocuments(
      tx,
      tenantId,
      prepared,
      prepared.cursorValue ?? undefined
    );

    return ok(page);
  }
});

const IDEMPOTENCY_SCOPE = "procurement_document_create";

type PostPrepared = { idempotencyKey: string; input: CreateDocumentInput };

/**
 * `POST /api/v1/procurement/documents` — create a DRAFT. Nothing a draft says
 * touches stock; the lifecycle state, snapshots and totals are server-derived
 * and a body naming one is a 400. Needs an `Idempotency-Key` so a double-submit
 * cannot create two drafts.
 */
export const POST = defineTenantRoute<PostPrepared>({
  workClass: "interactive",
  prepare: async ({ request }) => {
    const idempotencyKey = readIdempotencyKey(request);

    if (idempotencyKey instanceof Response) {
      return idempotencyKey;
    }

    const input = await readValidatedBody(request, validateCreateDocument);

    return input instanceof Response ? input : { idempotencyKey, input };
  },
  authorize: PROCUREMENT_GUARDS.documents.create,
  handler: async ({ tx, tenantId, auth, prepared, locals }) =>
    runIdempotent(
      tx,
      tenantId,
      IDEMPOTENCY_SCOPE,
      prepared.idempotencyKey,
      auth.context.tenantUserId,
      prepared.input,
      async () => {
        const result = await createDocument(
          tx,
          tenantId,
          {
            actorTenantUserId: auth.context.tenantUserId,
            correlationId: locals.correlationId
          },
          prepared.input
        );

        return result.outcome === "ok"
          ? { status: 201, body: result.document }
          : documentFailureResponse(result);
      }
    )
});
