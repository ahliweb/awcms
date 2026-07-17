import type { APIRoute } from "astro";
import { fail, ok } from "../../../../../modules/_shared/api-response";
import { getDatabaseClient } from "../../../../../lib/database/client";
import { withTenant } from "../../../../../lib/database/tenant-context";
import {
  bodyTooLargeResponse,
  readTextBody
} from "../../../../../lib/security/request-body-limit";
import {
  resolveOrRegisterSyncNode,
  verifySyncHeaders
} from "../../../../../modules/sync-storage/application/sync-auth";
import { validateObjectSyncEnqueueRequestBody } from "../../../../../modules/sync-storage/domain/object-queue";

export const POST: APIRoute = async ({ request }) => {
  const tenantId = request.headers.get("x-awcms-tenant-id");
  const nodeCode = request.headers.get("x-awcms-node-id");

  if (!tenantId) {
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  }

  if (!nodeCode) {
    return fail(400, "VALIDATION_ERROR", "X-AWCMS-Node-ID header is required.");
  }

  const bodyRead = await readTextBody(request, "large");

  if (bodyRead.tooLarge) {
    return bodyTooLargeResponse(bodyRead.limitBytes);
  }

  const rawBody = bodyRead.value;
  const authResult = verifySyncHeaders(
    tenantId,
    nodeCode,
    request.headers.get("x-awcms-timestamp"),
    request.headers.get("x-awcms-signature"),
    request.headers.get("x-awcms-signature-version"),
    rawBody
  );

  if (!authResult.ok) {
    return fail(authResult.status, authResult.code, authResult.message);
  }

  let parsedBody: unknown = null;

  if (rawBody.length > 0) {
    try {
      parsedBody = JSON.parse(rawBody);
    } catch {
      return fail(
        400,
        "VALIDATION_ERROR",
        "Object sync enqueue body must be valid JSON."
      );
    }
  }

  const validation = validateObjectSyncEnqueueRequestBody(parsedBody);

  if (!validation.valid) {
    return fail(
      400,
      "VALIDATION_ERROR",
      "Object sync enqueue body is invalid.",
      {},
      validation.errors
    );
  }

  // Dedupe by objectKey (last one wins) before the batched INSERT below —
  // `ON CONFLICT DO UPDATE` errors ("cannot affect row a second time") if the
  // same conflict target appears twice in one statement. The previous
  // per-object loop tolerated a client resending the same objectKey twice in
  // one request (each INSERT was its own statement); this preserves that
  // same last-write-wins behavior while still batching into one round trip.
  const objects = [
    ...new Map(
      validation.value.objects.map((object) => [object.objectKey, object])
    ).values()
  ];
  const requiresUpload = process.env.R2_ENABLED === "true";
  const sql = getDatabaseClient();

  return withTenant(
    sql,
    tenantId,
    async (tx) => {
      const node = await resolveOrRegisterSyncNode(tx, tenantId, nodeCode);

      if (!node || node.status !== "active") {
        return fail(403, "ACCESS_DENIED", "Sync node is not active.");
      }

      // Batched (single round trip via unnest) instead of one INSERT per
      // object — Issue #435 N+1 audit (skill `awcms-performance`
      // §Hindari N+1). ON CONFLICT still resolves per-row independently, so
      // behavior for a mixed new/re-enqueued batch is unchanged.
      await tx`
        INSERT INTO awcms_object_sync_queue
          (tenant_id, node_id, object_key, local_path, checksum_sha256, byte_size, requires_upload, status)
        SELECT ${tenantId}, ${node.id}, t.object_key, t.local_path, t.checksum_sha256, t.byte_size,
               ${requiresUpload}, 'pending'
        FROM unnest(
          ${tx.array(
            objects.map((object) => object.objectKey),
            "text"
          )},
          ${tx.array(
            objects.map((object) => object.localPath),
            "text"
          )},
          ${tx.array(
            objects.map((object) => object.checksumSha256),
            "text"
          )},
          ${tx.array(
            objects.map((object) => object.byteSize),
            "bigint"
          )}
        ) AS t(object_key, local_path, checksum_sha256, byte_size)
        ON CONFLICT (tenant_id, node_id, object_key) DO UPDATE SET
          local_path = EXCLUDED.local_path,
          checksum_sha256 = EXCLUDED.checksum_sha256,
          byte_size = EXCLUDED.byte_size,
          requires_upload = EXCLUDED.requires_upload,
          status = 'pending',
          retry_count = 0,
          next_retry_at = null,
          last_error = null,
          uploaded_at = null
      `;

      return ok({ queued: objects.length });
    },
    { workClass: "background_sync" }
  );
};
