import { fail, ok } from "../../../../../modules/_shared/api-response";
import { defineClientCredentialTenantRoute } from "../../../../../modules/_shared/tenant-route";
import {
  bodyTooLargeResponse,
  readJsonBody
} from "../../../../../lib/security/request-body-limit";
import { resolveLoginPolicyConfig } from "../../../../../modules/identity-access/application/login-policy";
import {
  authenticateBffClient,
  redeemHandoffCode
} from "../../../../../modules/identity-access/application/session-handoff-directory";
import { log } from "../../../../../lib/logging/logger";
import {
  checkSharedRateLimit,
  resolveClientIp
} from "../../../../../lib/security/rate-limit";

/**
 * `POST /api/v1/auth/session-handoff/redeem` (ADR-0050) — a registered BFF
 * spends a one-time code, server-to-server, and receives a session token for
 * the human who authenticated here.
 *
 * ## The only endpoint in this repo authenticated by a client secret
 *
 * Not a session (there is none yet — this is the request that obtains one) and
 * not a machine credential (ADR-0049 credentials are read-only by construction,
 * and a read-only principal minting a human session would be an escalation
 * path). Hence `defineClientCredentialTenantRoute`, whose header explains why
 * that is a seam and not an exception.
 *
 * ## Every failure is one answer
 *
 * Unknown code, expired code, already-redeemed code, wrong client, wrong
 * `redirect_uri`, bad secret — all `401 HANDOFF_REJECTED`. The distinctions are
 * real and are recorded in the audit trail; handing them to the caller tells
 * whoever holds a stolen code whether it was ever valid, and tells an
 * unauthenticated prober which client keys exist.
 *
 * ## No Idempotency-Key, deliberately
 *
 * The code IS the idempotency key, and its contract is the opposite one: it may
 * be spent exactly once, and the second attempt must fail rather than replay
 * the first response. Storing the minted token under an idempotency record
 * would keep a live session credential at rest for the record's lifetime, to
 * serve a retry that must not succeed.
 */
export const POST = defineClientCredentialTenantRoute({
  workClass: "interactive",
  // Same generic shape as every other failure here: an unauthenticated caller
  // must not learn whether the tenant it named exists.
  onMissingTenant: () =>
    fail(401, "HANDOFF_REJECTED", "Session handoff could not be completed."),
  // ADR-0066 — anti-automation on every authentication surface, not most.
  // Server-to-server, so the ceiling is generous — but a leaked client secret
  // otherwise buys unlimited code guesses, and the codes are short-lived rather
  // than high-entropy-forever.
  beforeTransaction: async ({ request, clientAddress }) => {
    const rate = await checkSharedRateLimit(
      `handoff-redeem:${resolveClientIp(request, clientAddress)}`,
      { maxAttempts: 20, windowMs: 60_000 }
    );

    return rate.allowed
      ? undefined
      : fail(429, "RATE_LIMITED", "Too many requests. Try again shortly.");
  },
  handler: async ({ tx, tenantId, request, locals, now }) => {
    const bodyRead = await readJsonBody(request);

    if (bodyRead.tooLarge) {
      return bodyTooLargeResponse(bodyRead.limitBytes);
    }

    const body = (bodyRead.value ?? {}) as Record<string, unknown>;
    const clientKey = typeof body.clientKey === "string" ? body.clientKey : "";
    const clientSecret =
      typeof body.clientSecret === "string" ? body.clientSecret : "";
    const code = typeof body.code === "string" ? body.code : "";
    const redirectUri =
      typeof body.redirectUri === "string" ? body.redirectUri : "";

    // Shape failure answers the SAME 401, not a 400. A 400 for "you forgot a
    // field" and a 401 for "your secret is wrong" is already an oracle: it
    // separates well-formed guesses from malformed ones.
    if (
      clientKey === "" ||
      clientSecret === "" ||
      code === "" ||
      redirectUri === ""
    ) {
      return fail(
        401,
        "HANDOFF_REJECTED",
        "Session handoff could not be completed."
      );
    }

    const client = await authenticateBffClient(
      tx,
      tenantId,
      clientKey,
      clientSecret
    );

    if (!client) {
      log("warning", "identity-access.session_handoff.client_rejected", {
        correlationId: locals.correlationId,
        tenantId,
        moduleKey: "identity_access"
      });

      return fail(
        401,
        "HANDOFF_REJECTED",
        "Session handoff could not be completed."
      );
    }

    const result = await redeemHandoffCode(
      tx,
      tenantId,
      {
        code,
        client,
        redirectUri,
        sessionTtlMinutes: resolveLoginPolicyConfig().sessionTtlMin,
        now
      },
      locals.correlationId
    );

    if (!result.ok) {
      log("warning", "identity-access.session_handoff.redeem_rejected", {
        correlationId: locals.correlationId,
        tenantId,
        moduleKey: "identity_access",
        reason: result.reason
      });

      return fail(
        401,
        "HANDOFF_REJECTED",
        "Session handoff could not be completed."
      );
    }

    // No cookies are set. The token goes to the BFF's server, which stores it
    // server-side and gives the browser its own portal cookie (ADR-0050 §3) —
    // setting `awcms_session` here would put an awcms-origin cookie on a
    // response the browser never sees, and imply the token belongs to it.
    return ok({
      token: result.token,
      expiresAt: result.expiresAt,
      assuranceLevel: result.assuranceLevel
    });
  }
});
