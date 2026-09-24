/**
 * `POST /api/v1/omes/worker/enroll` — ahliweb/omes#199.
 *
 * Session-UNauthenticated by design (ADR-0027): the caller has no AWCMS
 * session, only a single-use enrollment challenge an operator minted via
 * `POST /api/v1/omes/servers/{id}/enrollment-challenges` (#198). Identity is
 * established here, not assumed — `redeemEnrollmentChallenge` requires the
 * caller to prove possession of the Ed25519 private key matching the
 * presented `public_key` (a signature over the raw challenge value, carried
 * in `X-Omes-Enrollment-Signature`, checked before any database work).
 *
 * Every response — including a rejection — is validated against the pinned
 * `worker-enrollment.response` contract before being sent: this module never
 * sends the OMES-side worker a shape it does not itself enforce.
 */
import type { APIRoute } from "astro";

import { jsonResponse } from "../../../../../modules/_shared/api-response";
import { getDatabaseClient } from "../../../../../lib/database/client";
import { withTenant } from "../../../../../lib/database/tenant-context";
import {
  readCappedText,
  BODY_SIZE_TIER_BYTES
} from "../../../../../lib/security/request-body-limit";
import { checkSharedRateLimit } from "../../../../../lib/security/rate-limit";
import { validateOmesContractText } from "../../../../../modules/omes-control/domain/contracts";
import {
  redeemEnrollmentChallenge
} from "../../../../../modules/omes-control/application/worker-enrollment-exchange";
import { validateEd25519PublicKeyPem } from "../../../../../modules/omes-control/domain/worker-identity";

const RATE_LIMIT = { maxAttempts: 20, windowMs: 60_000 };
const DEFAULT_POLL_INTERVAL_SECONDS = 10;
const DEFAULT_HEARTBEAT_INTERVAL_SECONDS = 60;
/**
 * Informational placeholder, deliberately not a real key: this
 * implementation's transport trust boundary is mandatory outbound TLS
 * (ahliweb/omes#192's own requirement), not an application-layer
 * response-signing scheme the reference worker does not currently verify.
 * See `domain/worker-identity.ts`'s module doc for the full note.
 */
const CONTROL_CENTER_PUBLIC_KEY_PLACEHOLDER =
  "tls-transport-trust:no-response-signing-key-published";

type EnrollBody = {
  tenant_id?: unknown;
  server_id?: unknown;
  enrollment_challenge?: unknown;
  public_key?: unknown;
};

function neutralResponse(
  status: "enrolled" | "rejected" | "token_expired",
  tenantId: string,
  serverId: string,
  workerId: string,
  now: Date,
  enrolledAtIso?: string
): Response {
  return jsonResponse(
    {
      tenant_id: tenantId,
      server_id: serverId,
      worker_id: workerId,
      status,
      control_center_public_key: CONTROL_CENTER_PUBLIC_KEY_PLACEHOLDER,
      poll_interval_seconds: DEFAULT_POLL_INTERVAL_SECONDS,
      heartbeat_interval_seconds: DEFAULT_HEARTBEAT_INTERVAL_SECONDS,
      enrolled_at: enrolledAtIso ?? now.toISOString()
    },
    { status: 200 }
  );
}

export const POST: APIRoute = async ({ request }) => {
  const bodyRead = await readCappedText(request, BODY_SIZE_TIER_BYTES.default);

  if (bodyRead.tooLarge) {
    return jsonResponse({ status: "rejected" }, { status: 413 });
  }

  const now = new Date();

  let parsed: EnrollBody;

  try {
    parsed = JSON.parse(bodyRead.text) as EnrollBody;
  } catch {
    return jsonResponse({ status: "rejected" }, { status: 400 });
  }

  const tenantId = typeof parsed.tenant_id === "string" ? parsed.tenant_id : "";
  const serverId = typeof parsed.server_id === "string" ? parsed.server_id : "";

  // Rate-limited per (tenant, server) BEFORE contract validation — an
  // unauthenticated endpoint that mints a real DB round trip per attempt
  // needs a source-scoped backstop regardless of whether the body even
  // parses as a valid envelope.
  const rateLimitKey = `omes-worker-enroll:${tenantId || "unknown"}:${serverId || "unknown"}`;
  const rateLimit = await checkSharedRateLimit(rateLimitKey, RATE_LIMIT);

  if (!rateLimit.allowed) {
    return jsonResponse(
      { status: "rejected" },
      { status: 429, headers: { "retry-after": String(rateLimit.retryAfterSec) } }
    );
  }

  const contractErrors = await validateOmesContractText(
    "worker-enrollment.request",
    bodyRead.text
  ).catch(() => ["unsupported_contract_version"]);

  if (contractErrors.length > 0) {
    return neutralResponse("rejected", tenantId, serverId, "worker_unknown", now);
  }

  const rawChallenge = parsed.enrollment_challenge as string;
  const publicKeyPem = parsed.public_key as string;

  const keyCheck = validateEd25519PublicKeyPem(publicKeyPem);

  if (!keyCheck.valid) {
    return neutralResponse("rejected", tenantId, serverId, "worker_unknown", now);
  }

  const signatureHeader = request.headers.get("x-omes-enrollment-signature");

  if (!signatureHeader) {
    return neutralResponse("rejected", tenantId, serverId, "worker_unknown", now);
  }

  const sql = getDatabaseClient();

  const outcome = await withTenant(sql, tenantId, (tx) =>
    redeemEnrollmentChallenge(
      tx,
      {
        tenantId,
        serverId,
        rawChallenge,
        publicKeyPem,
        enrollmentSignatureBase64: signatureHeader
      },
      now
    )
  );

  if (outcome instanceof Response) {
    // withTenant refused before running fn (DB busy / idempotency — neither
    // applies here since this write is not idempotency-keyed, but the
    // circuit-breaker/backpressure path still returns a real Response).
    return outcome;
  }

  if (outcome.outcome === "enrolled") {
    return neutralResponse(
      "enrolled",
      tenantId,
      serverId,
      outcome.workerId,
      now,
      outcome.enrolledAt
    );
  }

  if (outcome.outcome === "token_expired") {
    return neutralResponse("token_expired", tenantId, serverId, "worker_unknown", now);
  }

  return neutralResponse("rejected", tenantId, serverId, "worker_unknown", now);
};
