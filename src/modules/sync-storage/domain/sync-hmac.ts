import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Versioned sync HMAC signatures (security advisory GHSA-c972-3q5p-g3h4).
 *
 * v1 (legacy, VULNERABLE): `HMAC(secret, "<timestamp>.<body>")`. Neither the
 * tenant nor the node is part of the signed material, so — combined with a
 * single deployment-wide secret — a signature computed for one tenant is
 * byte-for-byte valid for *every* tenant. It is kept only so already-deployed
 * nodes keep working during migration, and only while
 * `SYNC_HMAC_ALLOW_LEGACY` is not `false`.
 *
 * v2 (canonical): binds tenant + node into the signed material with an explicit
 * version tag:
 *
 *   HMAC(secret, "v2:<tenantId>:<nodeCode>:<timestamp>:<body>")
 *
 * A v2 signature minted for tenant A no longer verifies when the request's
 * `X-AWCMS-Tenant-ID` header is swapped to tenant B, because the tenant id is
 * inside the signed material (different material → different HMAC). v2 is the
 * canonical scheme mirrored across awcms, awcms-mini, and the `awcms-sync-hmac`
 * skill; nodes MUST send `X-AWCMS-Signature-Version: 2`.
 *
 * Field constraints that keep the v2 material unambiguous: `tenantId` is a
 * UUID (enforced below) and `nodeCode` / `timestamp` come from HTTP headers,
 * which cannot contain the `:` delimiter's problematic neighbours (raw CR/LF) —
 * and `body` is the trailing field, so any `:` it contains cannot shift an
 * earlier field boundary.
 *
 * L1 delimiter hardening (audit PR #161, GHSA-c972-3q5p-g3h4): the schema
 * (`sql/010`, `node_code text`) puts no format constraint on `nodeCode`, so
 * `nodeCode` MAY contain `:`. Without a constrained `tenantId` that makes the
 * tenant/node boundary in `v2:<tenantId>:<nodeCode>:...` ambiguous —
 * `(tenantId="A", nodeCode="x:y")` and `(tenantId="A:x", nodeCode="y")` both
 * render `v2:A:x:y:...`, so their signatures are byte-identical and mutually
 * accepted. The auditor confirmed this is NOT cross-tenant exploitable (a
 * request's `tenantId` must be a valid UUID — no `:` — to reach any tenant data
 * via `withTenant`), but it is a latent ambiguity in security-signature code.
 *
 * Fix = Option A (zero regression): require `tenantId` to be a UUID at the v2
 * compute/verify boundary, BEFORE the material is built. A UUID is a fixed 36
 * chars and contains no `:`, so the tenant field boundary becomes unambiguous
 * and no two distinct (tenantId, nodeCode) pairs can collide on the tenant/node
 * split. This constrains ONLY `tenantId` — `nodeCode` is untouched, so every
 * already-deployed v1/v2 node (whose tenant id is a UUID) is unaffected. v1
 * material has no tenant field and is therefore not touched by this change.
 */

export const SYNC_SIGNATURE_VERSION_HEADER = "X-AWCMS-Signature-Version";
export const SYNC_SIGNATURE_VERSION_V2 = "2";

/**
 * Canonical tenant-id shape accepted in v2 material. Mirrors `UUID_PATTERN` in
 * `src/lib/database/tenant-context.ts` — the exact shape `withTenant` requires
 * before any tenant-scoped SQL runs. Kept as a local copy on purpose so this
 * domain module stays free of database/runtime imports (it only needs
 * `node:crypto`).
 */
const TENANT_ID_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isTenantIdUuid(tenantId: string): boolean {
  return TENANT_ID_UUID_PATTERN.test(tenantId);
}

/** v1 legacy material — tenant/node NOT bound (see file header). */
export function computeSyncSignature(
  secret: string,
  timestamp: string,
  body: string
): string {
  return createHmac("sha256", secret)
    .update(`${timestamp}.${body}`)
    .digest("hex");
}

/** v2 canonical material — binds tenant + node into the signature. */
export function computeSyncSignatureV2(
  secret: string,
  tenantId: string,
  nodeCode: string,
  timestamp: string,
  body: string
): string {
  // A non-UUID tenantId is the only input that makes the v2 material
  // delimiter-ambiguous (see file header). Fail loudly rather than sign
  // ambiguous material — every legitimate caller already holds a UUID tenant
  // id, so this never fires on a real node.
  if (!isTenantIdUuid(tenantId)) {
    throw new Error(
      "computeSyncSignatureV2: tenantId must be a UUID (v2 material integrity)."
    );
  }

  return createHmac("sha256", secret)
    .update(`v2:${tenantId}:${nodeCode}:${timestamp}:${body}`)
    .digest("hex");
}

/** Timing-safe comparison of two hex-encoded digests. */
function timingSafeHexEqual(expected: string, provided: string): boolean {
  const expectedBuffer = Buffer.from(expected, "hex");
  const providedBuffer = Buffer.from(provided, "hex");

  if (expectedBuffer.length !== providedBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, providedBuffer);
}

export function verifySyncSignature(
  secret: string,
  timestamp: string,
  body: string,
  providedSignature: string
): boolean {
  return timingSafeHexEqual(
    computeSyncSignature(secret, timestamp, body),
    providedSignature
  );
}

export function verifySyncSignatureV2(
  secret: string,
  tenantId: string,
  nodeCode: string,
  timestamp: string,
  body: string,
  providedSignature: string
): boolean {
  // Fail-closed on a non-UUID tenant id: it is the only input that makes the v2
  // material delimiter-ambiguous, and a real request's tenantId must be a UUID
  // to reach any tenant-scoped data (`withTenant`). Rejecting here — before the
  // material is built — means an ambiguous material is never even a candidate
  // match, and keeps `computeSyncSignatureV2`'s throw from escaping `verify`.
  if (!isTenantIdUuid(tenantId)) {
    return false;
  }

  return timingSafeHexEqual(
    computeSyncSignatureV2(secret, tenantId, nodeCode, timestamp, body),
    providedSignature
  );
}

export function isTimestampWithinSkew(
  timestamp: string,
  now: Date,
  maxSkewSeconds: number
): boolean {
  const parsed = new Date(timestamp);

  if (Number.isNaN(parsed.getTime())) {
    return false;
  }

  const skewSeconds = Math.abs(now.getTime() - parsed.getTime()) / 1000;

  return skewSeconds <= maxSkewSeconds;
}
