import type { APIRoute } from "astro";

import { fail, ok } from "../../../../modules/_shared/api-response";
import { getSetupDatabaseClient } from "../../../../lib/database/client";
import {
  checkRateLimit,
  resolveClientIp
} from "../../../../lib/security/rate-limit";
import {
  bodyTooLargeResponse,
  readJsonBody
} from "../../../../lib/security/request-body-limit";
import {
  enforceTurnstileIfRequired,
  SETUP_TURNSTILE_ACTION
} from "../../../../lib/security/turnstile";
import { validateSetupInitializeInput } from "../../../../modules/tenant-admin/domain/setup-validation";
import { bootstrapPlatformTenant } from "../../../../modules/tenant-admin/application/platform-bootstrap";

/**
 * Source-scoped volumetric rate limit for the public, unauthenticated setup
 * endpoint (Issue #186, F5 — symmetric with `auth/login.ts`). There is no
 * tenant yet (this endpoint CREATES the first one), so the bucket is keyed by
 * source alone. A loose ceiling: setup is a once-only bootstrap, so a
 * legitimate operator never approaches it, but it bounds how many outbound
 * Cloudflare siteverify round-trips (and multi-row bootstrap attempts) an
 * unauthenticated caller can drive on a full-online deployment.
 */
const SETUP_RATE_LIMIT_MAX = Number(process.env.SETUP_RATE_LIMIT_MAX ?? 10);
const SETUP_RATE_LIMIT_WINDOW_SEC = Number(
  process.env.SETUP_RATE_LIMIT_WINDOW_SEC ?? 60
);

/**
 * Uses `getSetupDatabaseClient()` — a dedicated setup role, not the
 * ordinary web-runtime connection every other route uses. The only route
 * that creates a tenant/office/owner from scratch.
 */
export const POST: APIRoute = async ({ request, clientAddress }) => {
  // Rate limit FIRST (cheapest rejection, before body read / Turnstile /
  // bootstrap) — mirrors login.ts. Keyed by source so a caller can't drive
  // unbounded siteverify round-trips or bootstrap attempts.
  const clientIp = resolveClientIp(request, clientAddress);
  const rateLimit = checkRateLimit(`setup:${clientIp}`, {
    maxAttempts:
      Number.isFinite(SETUP_RATE_LIMIT_MAX) && SETUP_RATE_LIMIT_MAX > 0
        ? SETUP_RATE_LIMIT_MAX
        : 10,
    windowMs:
      (Number.isFinite(SETUP_RATE_LIMIT_WINDOW_SEC) &&
      SETUP_RATE_LIMIT_WINDOW_SEC > 0
        ? SETUP_RATE_LIMIT_WINDOW_SEC
        : 60) * 1000
  });

  if (!rateLimit.allowed) {
    return fail(
      429,
      "RATE_LIMITED",
      "Too many setup attempts from this source. Try again later.",
      {},
      undefined,
      { "retry-after": String(rateLimit.retryAfterSec) }
    );
  }

  const bodyRead = await readJsonBody(request);
  if (bodyRead.tooLarge) return bodyTooLargeResponse(bodyRead.limitBytes);

  const validation = validateSetupInitializeInput(bodyRead.value);

  if (!validation.valid) {
    return fail(
      400,
      "VALIDATION_ERROR",
      "Setup input is invalid.",
      {},
      validation.errors
    );
  }

  // Issue #186 — Cloudflare Turnstile bot challenge, BEFORE the multi-row
  // tenant/owner bootstrap below and outside its transaction. A no-op on every
  // local/offline/LAN deployment. Setup is a once-only, singleton-locked
  // endpoint, but still worth gating on a full-online profile: an attacker
  // racing this public, unauthenticated, high-value bootstrap before a real
  // operator completes it is exactly what Turnstile exists for. Bound to a
  // distinct `setup` action so a token minted for the login form cannot be
  // replayed here.
  const turnstileResult = await enforceTurnstileIfRequired(
    (bodyRead.value as Record<string, unknown> | null)?.turnstileToken,
    clientIp,
    { action: SETUP_TURNSTILE_ACTION }
  );

  if (!turnstileResult.ok) {
    return fail(
      400,
      turnstileResult.code,
      turnstileResult.code === "TURNSTILE_REQUIRED"
        ? "Turnstile verification token is required."
        : "Turnstile verification failed."
    );
  }

  const input = validation.value;
  const sql = getSetupDatabaseClient();

  return sql.begin(async (tx) => {
    const result = await bootstrapPlatformTenant(tx, input);

    if (result.outcome === "already_initialized") {
      return fail(403, "ACCESS_DENIED", "Setup has already been completed.");
    }

    return ok({
      tenantId: result.tenantId,
      officeId: result.officeId,
      ownerProfileId: result.ownerProfileId,
      ownerIdentityId: result.ownerIdentityId,
      ownerTenantUserId: result.ownerTenantUserId,
      ownerRoleId: result.ownerRoleId
    });
  });
};
