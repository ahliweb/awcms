import type { APIRoute } from "astro";

import {
  fail,
  jsonResponse,
  ok
} from "../../../../modules/_shared/api-response";
import { getDatabaseClient } from "../../../../lib/database/client";
import { withTenant } from "../../../../lib/database/tenant-context";
import {
  authorizeInTransaction,
  resolveAuthInputs
} from "../../../../modules/identity-access/application/access-guard";
import { hashSessionToken } from "../../../../lib/auth/session-token";
import {
  computeRequestHash,
  findIdempotencyRecord,
  saveIdempotencyRecord
} from "../../../../modules/_shared/idempotency";
import { evaluateManagedMediaReadiness } from "../../../../modules/media-library/domain/managed-media-readiness";
import { isManagedMediaEnforcedForTenant } from "../../../../modules/media-library/application/media-library-tenant-state";
import { enableManagedMediaEnforcement } from "../../../../modules/media-library/application/enable-managed-media-enforcement";

/**
 * `GET`/`POST /api/v1/media/enforcement` (ADR-0036 step 5a) — the managed-media
 * enforcement switch a brochure-site operator previously did not have.
 *
 * The ownership inversion made media independent of `news_portal`, but left the
 * flag (`sql/053`) writable only by `news_portal`'s R2-only preset — which is
 * not ported to this base. A tenant running `blog_content` + `tenant_domain`
 * therefore had the capability and no way to turn it on. This route is that way,
 * and in this base it is the ONLY writer of the flag.
 *
 * ## POST is enable-only, and there is deliberately no DELETE/disable
 *
 * See `enable-managed-media-enforcement.ts`'s header for the full reasoning.
 * Short version: a tenant able to switch its own media validation OFF is the
 * exact exploit `sql/043` documents as confirmed-exploitable in review, so the
 * "off" transition does not exist anywhere in this codebase. Do not add it here.
 *
 * ## Why GET exposes readiness `reasons`
 *
 * So an operator who cannot enable can see WHY (R2 disabled, config incomplete,
 * credentials shared with sync-storage) instead of being told "no". The reasons
 * are deployment-config facts the tenant's own admin already has to act on with
 * their operator; they name variables, never values, so nothing secret leaks.
 * `GET` is still permission-gated (`enforcement.read`) rather than public.
 *
 * ## `POST` requires an `Idempotency-Key`
 *
 * `enforcement.enable` is classified HIGH_RISK (`access-control.ts`
 * `HIGH_RISK_ACTIONS`), and the go-live convention requires idempotency on
 * every high-risk mutation — so this route follows it even though
 * `markManagedMediaEnforced` is itself a monotonic, naturally idempotent upsert
 * (a replay converges on the same state). Only a SUCCESSFUL enable is recorded
 * under the key; a `rejected` (deployment-not-ready) 409 is deliberately NOT
 * persisted, so the same key is free to retry once the R2 config is corrected.
 */

const READ_GUARD = {
  moduleKey: "media_library",
  activityCode: "enforcement",
  action: "read" as const
};

const ENABLE_GUARD = {
  moduleKey: "media_library",
  activityCode: "enforcement",
  action: "enable" as const
};

const IDEMPOTENCY_SCOPE = "media_library_enforcement_enable";

type TxResult<T> =
  { kind: "response"; response: Response } | { kind: "ok"; value: T };

export const GET: APIRoute = async ({ request, cookies }) => {
  const { tenantId, token } = resolveAuthInputs(request, cookies);

  if (!tenantId) {
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  }

  if (!token) {
    return fail(401, "AUTH_REQUIRED", "Authentication required.");
  }

  const sql = getDatabaseClient();
  const tokenHash = hashSessionToken(token);
  const now = new Date();

  const result = await withTenant<
    TxResult<{
      enforced: boolean;
      ready: boolean;
      reasons: string[];
      detail: string[];
    }>
  >(sql, tenantId, async (tx) => {
    const auth = await authorizeInTransaction(
      tx,
      tenantId,
      tokenHash,
      now,
      READ_GUARD
    );

    if (!auth.allowed) {
      return { kind: "response", response: auth.denied };
    }

    const readiness = evaluateManagedMediaReadiness();
    const enforced = await isManagedMediaEnforcedForTenant(tx, tenantId);

    return {
      kind: "ok",
      value: {
        enforced,
        ready: readiness.ready,
        reasons: readiness.reasons,
        detail: readiness.detail
      }
    };
  });

  if (result.kind === "response") {
    return result.response;
  }

  return ok(result.value);
};

export const POST: APIRoute = async ({ request, cookies, locals }) => {
  const { tenantId, token } = resolveAuthInputs(request, cookies);

  if (!tenantId) {
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
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

  const requestHash = computeRequestHash({
    action: "enable_managed_media_enforcement"
  });
  const sql = getDatabaseClient();
  const tokenHash = hashSessionToken(token);
  const now = new Date();
  const correlationId = locals.correlationId;

  return withTenant(sql, tenantId, async (tx) => {
    const auth = await authorizeInTransaction(
      tx,
      tenantId,
      tokenHash,
      now,
      ENABLE_GUARD
    );

    if (!auth.allowed) {
      return auth.denied;
    }

    const existingIdempotency = await findIdempotencyRecord(
      tx,
      tenantId,
      IDEMPOTENCY_SCOPE,
      idempotencyKey
    );

    if (existingIdempotency) {
      if (existingIdempotency.requestHash !== requestHash) {
        return fail(
          409,
          "IDEMPOTENCY_CONFLICT",
          "Idempotency-Key was already used with a different request."
        );
      }

      return jsonResponse(existingIdempotency.responseBody, {
        status: existingIdempotency.responseStatus
      });
    }

    const outcome = await enableManagedMediaEnforcement(
      tx,
      tenantId,
      auth.context.tenantUserId,
      process.env,
      correlationId,
      now
    );

    if (outcome.outcome === "rejected") {
      // 409, not 400: the request is well-formed and the caller is authorized —
      // the DEPLOYMENT is not in a state where this can be turned on. That is
      // not the caller's input to fix, and a 400 would send an operator hunting
      // through their request body instead of their R2 config. Deliberately NOT
      // persisted under the Idempotency-Key: this is a transient
      // deployment-state failure, so the same key must stay free to retry once
      // the R2 config is corrected.
      return fail(
        409,
        outcome.code,
        "Managed-media enforcement cannot be enabled: this deployment's media storage is not ready.",
        {},
        { reasons: outcome.reasons, detail: outcome.detail }
      );
    }

    const successResponse = ok({
      enforced: true,
      enforcedAt: outcome.enforcedAt.toISOString(),
      alreadyEnforced: outcome.alreadyEnforced
    });
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
};
