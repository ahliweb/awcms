import type { APIRoute } from "astro";

import { fail, ok } from "../../../../modules/_shared/api-response";
import { getDatabaseClient } from "../../../../lib/database/client";
import { withTenant } from "../../../../lib/database/tenant-context";
import {
  authorizeInTransaction,
  resolveAuthInputs
} from "../../../../modules/identity-access/application/access-guard";
import { hashSessionToken } from "../../../../lib/auth/session-token";
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
 * No `Idempotency-Key` is required: enabling is a naturally idempotent upsert of
 * one boolean-shaped marker with no external side effect and no resource
 * created, so a replayed request converges on the same state rather than
 * duplicating anything. This matches `POST .../upload-sessions`, which likewise
 * requires none.
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

  const sql = getDatabaseClient();
  const tokenHash = hashSessionToken(token);
  const now = new Date();
  const correlationId = locals.correlationId;

  const result = await withTenant<
    TxResult<{ enforced: true; enforcedAt: string; alreadyEnforced: boolean }>
  >(sql, tenantId, async (tx) => {
    const auth = await authorizeInTransaction(
      tx,
      tenantId,
      tokenHash,
      now,
      ENABLE_GUARD
    );

    if (!auth.allowed) {
      return { kind: "response", response: auth.denied };
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
      // through their request body instead of their R2 config.
      return {
        kind: "response",
        response: fail(
          409,
          outcome.code,
          "Managed-media enforcement cannot be enabled: this deployment's media storage is not ready.",
          {},
          { reasons: outcome.reasons, detail: outcome.detail }
        )
      };
    }

    return {
      kind: "ok",
      value: {
        enforced: true,
        enforcedAt: outcome.enforcedAt.toISOString(),
        alreadyEnforced: outcome.alreadyEnforced
      }
    };
  });

  if (result.kind === "response") {
    return result.response;
  }

  return ok(result.value);
};
