import type { APIRoute } from "astro";

import { fail } from "../../../../../../../modules/_shared/api-response";
import { getDatabaseClient } from "../../../../../../../lib/database/client";
import { resolveAuthInputs } from "../../../../../../../modules/identity-access/application/access-guard";
import { hashSessionToken } from "../../../../../../../lib/auth/session-token";
import {
  bodyTooLargeResponse,
  readJsonBody
} from "../../../../../../../lib/security/request-body-limit";
import { resolveNewsMediaR2Config } from "../../../../../../../modules/news-portal/domain/news-media-r2-config";
import { validateFinalizeNewsMediaUploadSessionInput } from "../../../../../../../modules/news-portal/domain/news-media-upload-session-validation";
import { finalizeNewsMediaUploadSession } from "../../../../../../../modules/news-portal/application/news-media-finalize-upload-session";

/**
 * `POST /api/v1/media/news-images/upload-sessions/{id}/finalize` (Issue
 * #634) — step 5 of `r2-upload-sop.md` §2. Route only parses/validates the
 * HTTP request and delegates to `finalizeNewsMediaUploadSession`
 * (`application/news-media-finalize-upload-session.ts`), which performs
 * the real R2 `GET` + magic-byte MIME sniffing + server-side SHA-256
 * checksum this issue exists to add — see that module's own header for why
 * `HEAD` alone (the Issue #631 security-auditor Critical finding) is never
 * sufficient here.
 *
 * High-risk mutation — requires `Idempotency-Key` (skill
 * `awcms-idempotency`) since it promotes metadata to `verified`, the
 * status editorial content is allowed to reference.
 */
export const POST: APIRoute = async ({ request, params, cookies, locals }) => {
  const { tenantId, token } = resolveAuthInputs(request, cookies);
  const objectId = params.id;

  if (!tenantId) {
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  }

  if (!objectId) {
    return fail(400, "VALIDATION_ERROR", "Upload session id is required.");
  }

  if (!token) {
    return fail(401, "AUTH_REQUIRED", "Authentication required.");
  }

  const idempotencyKey = request.headers.get("idempotency-key");

  if (!idempotencyKey) {
    return fail(
      400,
      "IDEMPOTENCY_REQUIRED",
      "Idempotency-Key header is required."
    );
  }

  const bodyRead = await readJsonBody(request);

  if (bodyRead.tooLarge) {
    return bodyTooLargeResponse(bodyRead.limitBytes);
  }

  const validation = validateFinalizeNewsMediaUploadSessionInput(
    bodyRead.value
  );

  if (!validation.valid) {
    return fail(
      400,
      "VALIDATION_ERROR",
      "Finalize request is invalid.",
      {},
      validation.errors
    );
  }

  return finalizeNewsMediaUploadSession(
    {
      tenantId,
      objectId,
      tokenHash: hashSessionToken(token),
      idempotencyKey,
      claimedChecksumSha256: validation.value.checksumSha256,
      now: new Date(),
      correlationId: locals.correlationId
    },
    {
      sql: getDatabaseClient(),
      config: resolveNewsMediaR2Config()
    }
  );
};
