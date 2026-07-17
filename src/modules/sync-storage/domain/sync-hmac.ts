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
 * UUID and `nodeCode` / `timestamp` come from HTTP headers, which cannot
 * contain the `:` delimiter's problematic neighbours (raw CR/LF) — and `body`
 * is the trailing field, so any `:` it contains cannot shift an earlier field
 * boundary.
 */

export const SYNC_SIGNATURE_VERSION_HEADER = "X-AWCMS-Signature-Version";
export const SYNC_SIGNATURE_VERSION_V2 = "2";

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
