import type { APIRoute } from "astro";

import { fail, ok } from "../../../../../../modules/_shared/api-response";
import { getDatabaseClient } from "../../../../../../lib/database/client";
import { withTenant } from "../../../../../../lib/database/tenant-context";
import {
  authorizeInTransaction,
  resolveAuthInputs
} from "../../../../../../modules/identity-access/application/access-guard";
import { hashSessionToken } from "../../../../../../lib/auth/session-token";
import {
  bodyTooLargeResponse,
  readJsonBody
} from "../../../../../../lib/security/request-body-limit";
import {
  resolveNewsMediaR2Config,
  findMissingNewsMediaR2Vars
} from "../../../../../../modules/media-library/domain/media-r2-config";
import {
  validateCreateNewsMediaUploadSessionInput,
  type CreateNewsMediaUploadSessionInput
} from "../../../../../../modules/media-library/domain/media-upload-session-validation";
import { createPendingNewsMediaObject } from "../../../../../../modules/media-library/application/media-object-directory";
import { createNewsMediaR2Client } from "../../../../../../modules/media-library/infrastructure/media-r2-client";

const CREATE_GUARD = {
  moduleKey: "media_library",
  activityCode: "media",
  action: "create" as const
};

/**
 * The body's outcome, carried past the authorization gate.
 *
 * A discriminated union rather than a `Response | null` beside a
 * `Input | null`: those two nullables are correlated, and only the union lets
 * the compiler know it — otherwise the code below reads `input!`, which is an
 * assertion where a proof is available.
 */
type HeldBody =
  | { kind: "refusal"; response: Response }
  | { kind: "input"; value: CreateNewsMediaUploadSessionInput };

type CreateTxResult =
  | { kind: "response"; response: Response }
  | {
      kind: "created";
      objectId: string;
      objectKey: string;
      mimeType: string;
      createdAt: Date;
    };

/**
 * `POST /api/v1/media/news-images/upload-sessions` (Issue #634) — step 1 of
 * the direct-to-R2 presigned upload flow (`r2-upload-sop.md` §2). Validates
 * shape only (no bytes exist yet), creates a `pending_upload` metadata row
 * with a server-generated object key, then generates a short-lived
 * presigned `PUT` URL scoped to exactly that object key. The R2 call
 * (`presignUploadUrl` — a local signature computation, not a network round
 * trip) happens strictly AFTER the DB transaction commits, never inside it
 * (ADR-0006).
 */
export const POST: APIRoute = async ({ request, cookies, locals }) => {
  const { tenantId, token } = resolveAuthInputs(request, cookies);

  if (!tenantId) {
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  }

  if (!token) {
    return fail(401, "AUTH_REQUIRED", "Authentication required.");
  }

  const config = resolveNewsMediaR2Config();

  const bodyRead = await readJsonBody(request);

  // The body-size ceiling is a PROTOCOL limit, not a product answer, so it
  // stays ahead of everything — refusing it costs nothing and tells nobody
  // anything they did not already send.
  if (bodyRead.tooLarge) {
    return bodyTooLargeResponse(bodyRead.limitBytes);
  }

  /**
   * Both refusals below are HELD until authorization has answered.
   *
   * They used to return immediately, so a tenant user with no
   * `media_library.media.create` grant learned whether this deployment has R2
   * configured (`502`) and, if it does, the exact accepted MIME types and size
   * ceiling (`400` + field errors) — and, because `authorizeInTransaction`
   * never ran, the refusal left no row in the decision log. Probing was free
   * and invisible.
   *
   * The body is still read and validated OUT HERE, before the transaction
   * opens, for the reason `defineTenantRoute` documents: `await request.json()`
   * waits on the CLIENT, and doing that inside `withTenant` would hold a
   * reserved connection and its work-class slot for as long as a caller chooses
   * to take. Holding the refusal keeps both properties — no connection is held
   * on a slow body, and no answer precedes the permission answer.
   *
   * This is the shape the hand-written routes in
   * `tests/e2e/support/authorization-first-ledger.ts` need; it is written out
   * here rather than abstracted because each of those routes reaches this point
   * differently.
   */
  const held: HeldBody = ((): HeldBody => {
    if (!config.enabled || findMissingNewsMediaR2Vars().length > 0) {
      return {
        kind: "refusal",
        response: fail(
          502,
          "PROVIDER_ERROR",
          "News media R2 storage is not configured for this deployment."
        )
      };
    }

    const validation = validateCreateNewsMediaUploadSessionInput(
      bodyRead.value,
      config.allowedMimeTypes,
      config.maxUploadBytes
    );

    return validation.valid
      ? { kind: "input", value: validation.value }
      : {
          kind: "refusal",
          response: fail(
            400,
            "VALIDATION_ERROR",
            "Upload session request is invalid.",
            {},
            validation.errors
          )
        };
  })();

  const sql = getDatabaseClient();
  const tokenHash = hashSessionToken(token);
  const now = new Date();
  const correlationId = locals.correlationId;

  const txResult = await withTenant<CreateTxResult>(
    sql,
    tenantId,
    async (tx) => {
      const auth = await authorizeInTransaction(
        tx,
        tenantId,
        tokenHash,
        now,
        CREATE_GUARD
      );

      if (!auth.allowed) {
        return { kind: "response", response: auth.denied };
      }

      // Allowed — so the caller is entitled to hear what is actually wrong,
      // and the decision log now carries the row saying they were here.
      if (held.kind === "refusal") {
        return { kind: "response", response: held.response };
      }

      const input = held.value;

      const created = await createPendingNewsMediaObject(
        tx,
        tenantId,
        auth.context.tenantUserId,
        config,
        {
          mimeType: input.mimeType,
          originalFilename: input.originalFilename ?? undefined,
          altText: input.altText ?? undefined,
          caption: input.caption ?? undefined
        },
        correlationId
      );

      return {
        kind: "created",
        objectId: created.id,
        objectKey: created.objectKey,
        mimeType: created.mimeType,
        createdAt: created.createdAt
      };
    }
  );

  // Pool-gate refusal — forwarded as-is (see the note on `withTenant`).
  if (txResult instanceof Response) {
    return txResult;
  }

  if (txResult.kind === "response") {
    return txResult.response;
  }

  // Outside the DB transaction (ADR-0006) — presign is local/synchronous,
  // never a network call, but this discipline is kept uniform regardless
  // (see news-media-r2-client.ts's own header comment).
  const r2Client = createNewsMediaR2Client({
    accountId: config.accountId,
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    bucket: config.bucket
  });

  const presignedUrl = r2Client.presignUploadUrl({
    objectKey: txResult.objectKey,
    mimeType: txResult.mimeType,
    ttlSeconds: config.presignedUploadTtlSeconds
  });

  const expiresAt = new Date(
    txResult.createdAt.getTime() + config.presignedUploadTtlSeconds * 1000
  );

  // Never include raw R2 credentials — only the already-signed URL.
  return ok({
    objectId: txResult.objectId,
    objectKey: txResult.objectKey,
    presignedUrl,
    expiresAt: expiresAt.toISOString()
  });
};
