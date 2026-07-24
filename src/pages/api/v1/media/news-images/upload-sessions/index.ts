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
import { validateCreateNewsMediaUploadSessionInput } from "../../../../../../modules/media-library/domain/media-upload-session-validation";
import { createPendingNewsMediaObject } from "../../../../../../modules/media-library/application/media-object-directory";
import { createNewsMediaR2Client } from "../../../../../../modules/media-library/infrastructure/media-r2-client";

const CREATE_GUARD = {
  moduleKey: "media_library",
  activityCode: "media",
  action: "create" as const
};

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

  if (!config.enabled || findMissingNewsMediaR2Vars().length > 0) {
    return fail(
      502,
      "PROVIDER_ERROR",
      "News media R2 storage is not configured for this deployment."
    );
  }

  const bodyRead = await readJsonBody(request);

  if (bodyRead.tooLarge) {
    return bodyTooLargeResponse(bodyRead.limitBytes);
  }

  const validation = validateCreateNewsMediaUploadSessionInput(
    bodyRead.value,
    config.allowedMimeTypes,
    config.maxUploadBytes
  );

  if (!validation.valid) {
    return fail(
      400,
      "VALIDATION_ERROR",
      "Upload session request is invalid.",
      {},
      validation.errors
    );
  }

  const input = validation.value;
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
