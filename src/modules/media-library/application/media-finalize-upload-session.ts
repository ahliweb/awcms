/**
 * Finalize orchestration for the direct-to-R2 presigned upload flow (Issue
 * #634). Extracted out of the route handler
 * (`pages/api/v1/media/news-images/upload-sessions/[id]/finalize.ts`) so
 * the route stays thin (`awcms-new-endpoint` skill: "route hanya
 * orkestrasi") and so integration tests can exercise this exact logic
 * against a real database with an INJECTED R2 client (a real
 * `Bun.S3Client` pointed at a local fake HTTP server, same convention
 * `tests/integration/object-dispatch.integration.test.ts` already
 * established for `sync-storage`) — the route itself does not expose a
 * seam for that, but a plain async function does, via `deps.createR2Client`.
 *
 * THIS is the function that closes the security-auditor Critical finding
 * on Issue #631: it never promotes a row past `HEAD` alone.
 * `verifyNewsMediaR2Object` (called below, between two separate
 * `withTenant` transactions) performs a full, size-capped `GET` + magic-byte
 * MIME sniffing + server-side SHA-256 checksum before any acceptance
 * decision is made (ADR-0006: the R2 calls happen strictly outside any DB
 * transaction).
 *
 * ## Atomic claim BEFORE the R2 call (security-auditor High finding, PR #653 review)
 *
 * `Idempotency-Key` only dedupes an EXACT key match — it does nothing to
 * stop N concurrent `finalize` calls against the SAME `objectId`, each
 * using its OWN distinct key (a normal-looking client retry storm, or a
 * deliberate cost-amplification attack: every such call used to reach
 * `verifyNewsMediaR2Object` in parallel, each paying for its own `HEAD`+
 * full `GET` of the same object). The precheck transaction below now calls
 * `markNewsMediaObjectUploaded(tx, tenantId, objectId)` (no `sizeBytes`/
 * `checksumSha256` — those are not known yet) as an ATOMIC CLAIM
 * (`pending_upload -> uploaded`) BEFORE any R2 call happens. Postgres
 * serializes concurrent `UPDATE`s against the same row, so exactly one
 * concurrent caller's claim succeeds; every other caller's `UPDATE`
 * matches zero rows (the row is no longer `pending_upload`) and gets `null`
 * back immediately — a cheap `409`, no R2 call ever attempted. If the R2
 * call itself then fails for a transient/infra reason (not a content
 * rejection), the claim is reverted (`revertNewsMediaObjectUploadClaim`)
 * so the session stays retryable rather than being stuck in `uploaded`
 * forever.
 */
import { fail, jsonResponse, ok } from "../../_shared/api-response";
import { withTenant } from "../../../lib/database/tenant-context";
import { authorizeInTransaction } from "../../identity-access/application/access-guard";
import { log } from "../../../lib/logging/logger";
import { recordAuditEvent } from "../../logging/application/audit-log";
import {
  computeRequestHash,
  findIdempotencyRecord,
  saveIdempotencyRecord
} from "../../_shared/idempotency";
import type { NewsMediaR2Config } from "../domain/media-r2-config";
import {
  fetchNewsMediaObjectById,
  markNewsMediaObjectFailed,
  markNewsMediaObjectUploaded,
  markNewsMediaObjectVerified,
  revertNewsMediaObjectUploadClaim
} from "./media-object-directory";
import {
  createNewsMediaR2Client,
  type NewsMediaR2Client
} from "../infrastructure/media-r2-client";
import { verifyNewsMediaR2Object } from "./media-r2-verification";

const VERIFY_GUARD = {
  moduleKey: "media_library",
  activityCode: "media",
  action: "verify" as const
};

const IDEMPOTENCY_SCOPE = "news_media_upload_session_finalize";

type PrecheckResult =
  | { kind: "response"; response: Response }
  | {
      kind: "proceed";
      objectId: string;
      objectKey: string;
      claimedMimeType: string;
      actorTenantUserId: string;
    };

export type FinalizeNewsMediaUploadSessionInput = {
  tenantId: string;
  objectId: string;
  tokenHash: string;
  idempotencyKey: string;
  claimedChecksumSha256: string | null;
  now: Date;
  correlationId?: string;
};

export type FinalizeNewsMediaUploadSessionDeps = {
  sql: Bun.SQL;
  config: NewsMediaR2Config;
  /** Test-only injection point — defaults to a real `Bun.S3Client`-backed client built from `deps.config`. */
  createR2Client?: (config: NewsMediaR2Config) => NewsMediaR2Client;
};

function defaultR2ClientFactory(config: NewsMediaR2Config): NewsMediaR2Client {
  return createNewsMediaR2Client({
    accountId: config.accountId,
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    bucket: config.bucket
  });
}

export async function finalizeNewsMediaUploadSession(
  input: FinalizeNewsMediaUploadSessionInput,
  deps: FinalizeNewsMediaUploadSessionDeps
): Promise<Response> {
  const { tenantId, objectId, tokenHash, idempotencyKey, now, correlationId } =
    input;
  const claimedChecksumSha256 = input.claimedChecksumSha256;
  const requestHash = computeRequestHash({ objectId, claimedChecksumSha256 });
  const { sql, config } = deps;
  const createR2Client = deps.createR2Client ?? defaultR2ClientFactory;

  const precheck = await withTenant<PrecheckResult>(
    sql,
    tenantId,
    async (tx) => {
      const auth = await authorizeInTransaction(
        tx,
        tenantId,
        tokenHash,
        now,
        VERIFY_GUARD
      );

      if (!auth.allowed) {
        return { kind: "response", response: auth.denied };
      }

      const existingIdempotency = await findIdempotencyRecord(
        tx,
        tenantId,
        IDEMPOTENCY_SCOPE,
        idempotencyKey
      );

      if (existingIdempotency) {
        if (existingIdempotency.requestHash !== requestHash) {
          return {
            kind: "response",
            response: fail(
              409,
              "IDEMPOTENCY_CONFLICT",
              "Idempotency-Key was already used with a different request."
            )
          };
        }

        return {
          kind: "response",
          response: jsonResponse(existingIdempotency.responseBody, {
            status: existingIdempotency.responseStatus
          })
        };
      }

      const row = await fetchNewsMediaObjectById(tx, tenantId, objectId);

      if (!row) {
        return {
          kind: "response",
          response: fail(404, "RESOURCE_NOT_FOUND", "Upload session not found.")
        };
      }

      if (row.status !== "pending_upload") {
        return {
          kind: "response",
          response: fail(
            409,
            "INVALID_STATUS_TRANSITION",
            `Cannot finalize an upload session in status "${row.status}".`
          )
        };
      }

      const expiresAtMs =
        row.createdAt.getTime() + config.presignedUploadTtlSeconds * 1000;

      if (now.getTime() > expiresAtMs) {
        await markNewsMediaObjectFailed(tx, tenantId, objectId);
        await recordAuditEvent(tx, {
          tenantId,
          actorTenantUserId: auth.context.tenantUserId,
          moduleKey: "media_library",
          action: "news_media.object.finalize_rejected",
          resourceType: "news_media_object",
          resourceId: objectId,
          severity: "warning",
          message: `News media finalize rejected: upload session expired (${row.objectKey}).`,
          attributes: { objectKey: row.objectKey, reason: "session_expired" },
          correlationId
        });

        return {
          kind: "response",
          response: fail(
            409,
            "UPLOAD_SESSION_EXPIRED",
            "Upload session has expired; start a new upload session."
          )
        };
      }

      // Atomic claim — see this module's header. Must happen BEFORE any R2
      // call, and BEFORE this transaction commits, so Postgres's own
      // row-update serialization is what does the mutual exclusion.
      const claimed = await markNewsMediaObjectUploaded(tx, tenantId, objectId);

      if (!claimed) {
        return {
          kind: "response",
          response: fail(
            409,
            "INVALID_STATUS_TRANSITION",
            "Upload session is already being finalized (or was already finalized) by another request."
          )
        };
      }

      return {
        kind: "proceed",
        objectId: row.id,
        objectKey: row.objectKey,
        claimedMimeType: row.mimeType,
        actorTenantUserId: auth.context.tenantUserId
      };
    }
  );

  if (precheck.kind === "response") {
    return precheck.response;
  }

  // Strictly outside any DB transaction (ADR-0006) — real R2 network calls.
  // At this point THIS call, and only this call, holds the `uploaded` claim
  // for this object — no other concurrent `finalize` call can reach here
  // for the same objectId until this one reverts or resolves it.
  const r2Client = createR2Client(config);

  // Reverts the claim (`uploaded -> pending_upload`) — called both for the
  // handled `provider_error` outcome AND for any UNEXPECTED exception
  // between the claim commit and this call's own resolution (reviewer +
  // security-auditor feedback, PR #653 re-review): a bug, an OOM, or an
  // unforeseen throw from `verifyNewsMediaR2Object`/the resolving
  // transaction below would otherwise leave the row permanently stuck at
  // `uploaded` (no client-triggerable recovery — both `finalize` and
  // `cancel` require `pending_upload`). Best-effort: if the revert itself
  // fails, that failure is only logged — it never masks/replaces the
  // caller's own error path.
  const revertClaim = async () => {
    await withTenant(sql, tenantId, (tx) =>
      revertNewsMediaObjectUploadClaim(tx, tenantId, precheck.objectId)
    ).catch((revertError) => {
      log("error", "news-portal.upload-session.finalize.revert_claim_failed", {
        correlationId,
        tenantId,
        objectId: precheck.objectId,
        error:
          revertError instanceof Error
            ? revertError.message
            : String(revertError)
      });
    });
  };

  let verification: Awaited<ReturnType<typeof verifyNewsMediaR2Object>>;

  try {
    verification = await verifyNewsMediaR2Object(r2Client, {
      objectKey: precheck.objectKey,
      claimedMimeType: precheck.claimedMimeType,
      allowedMimeTypes: config.allowedMimeTypes,
      maxUploadBytes: config.maxUploadBytes,
      claimedChecksumSha256
    });
  } catch (error) {
    log("error", "news-portal.upload-session.finalize.unexpected_error", {
      correlationId,
      tenantId,
      objectId: precheck.objectId,
      error: error instanceof Error ? error.message : String(error)
    });
    await revertClaim();
    throw error;
  }

  if (verification.outcome === "provider_error") {
    log("error", "news-portal.upload-session.finalize.provider_error", {
      correlationId,
      tenantId,
      objectId: precheck.objectId,
      error: verification.error
    });

    // Transient/infra failure, not a content rejection — revert the claim
    // so the session stays retryable instead of being stuck in `uploaded`.
    await revertClaim();

    return fail(
      502,
      "PROVIDER_ERROR",
      "Unable to verify the uploaded object right now. Try again shortly."
    );
  }

  try {
    return await withTenant(sql, tenantId, async (tx) => {
      if (verification.outcome === "rejected") {
        await markNewsMediaObjectFailed(tx, tenantId, precheck.objectId);
        await recordAuditEvent(tx, {
          tenantId,
          actorTenantUserId: precheck.actorTenantUserId,
          moduleKey: "media_library",
          action: "news_media.object.finalize_rejected",
          resourceType: "news_media_object",
          resourceId: precheck.objectId,
          severity: "warning",
          message: `News media finalize rejected: ${verification.reason} (${precheck.objectKey}).`,
          attributes: {
            objectKey: precheck.objectKey,
            reason: verification.reason
          },
          correlationId
        });

        const rejectedResponse = fail(
          422,
          "UPLOAD_VERIFICATION_FAILED",
          "Uploaded object failed content verification.",
          {},
          { reason: verification.reason }
        );
        const rejectedBody = await rejectedResponse.clone().json();

        // Store the rejection under this Idempotency-Key too (not just the
        // success path) — the row is now `failed`, so a same-key/same-payload
        // retry without this would hit the status guard above instead and
        // get a DIFFERENT ("Cannot finalize... status failed") response,
        // breaking the "same key + same request -> replay" idempotency
        // contract (reviewer feedback, PR #653).
        await saveIdempotencyRecord(
          tx,
          tenantId,
          IDEMPOTENCY_SCOPE,
          idempotencyKey,
          requestHash,
          422,
          rejectedBody
        );

        return rejectedResponse;
      }

      const verified = await markNewsMediaObjectVerified(
        tx,
        tenantId,
        precheck.actorTenantUserId,
        precheck.objectId,
        {
          sizeBytes: verification.sizeBytes,
          checksumSha256: verification.checksumSha256
        },
        correlationId
      );

      if (!verified) {
        return fail(
          409,
          "INVALID_STATUS_TRANSITION",
          "Upload session state changed concurrently; retry."
        );
      }

      const successResponse = ok(verified);
      const successBody = await successResponse.clone().json();

      await saveIdempotencyRecord(
        tx,
        tenantId,
        IDEMPOTENCY_SCOPE,
        idempotencyKey,
        requestHash,
        200,
        successBody
      );

      return successResponse;
    });
  } catch (error) {
    log("error", "news-portal.upload-session.finalize.unexpected_error", {
      correlationId,
      tenantId,
      objectId: precheck.objectId,
      error: error instanceof Error ? error.message : String(error)
    });
    await revertClaim();
    throw error;
  }
}
