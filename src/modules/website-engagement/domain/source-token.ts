/**
 * The per-source bearer token (ADR-0155 section 3).
 *
 * `wes1.<tenantId>.<sourceId>.<secret>`
 *
 * ## Why the tenant and source ids are IN the token
 *
 * The public endpoint has no session and no tenant context, and the source
 * table is behind `FORCE ROW LEVEL SECURITY`: a lookup by token hash with no
 * tenant set returns nothing. Rather than add a second `SECURITY DEFINER`
 * bootstrap path (every one of which is a standing cross-tenant read), the token
 * NAMES the tenant and source it claims. The server then opens that tenant's
 * context and verifies the secret half against the stored keyed hash INSIDE it.
 * A token that names the wrong tenant simply finds no row.
 *
 * The two ids are not secrets (a website's page source carries them), and the
 * decision to trust them is not made here: they only select WHERE to look. The
 * proof is the 256-bit secret, and a body or query `tenant_id` is still ignored
 * or rejected (ADR-0155 section 3.1).
 *
 * ## Shown once
 *
 * The full token exists in memory at creation/rotation and in the one response
 * that returns it. Only a keyed hash and a short, non-sensitive prefix are
 * stored. Nothing here logs.
 *
 * Pure module: no database, no I/O.
 */
import { randomBytes } from "node:crypto";

import { SOURCE_TOKEN_VERSION } from "./website-engagement-constants";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** 32 random bytes, base64url: 43 characters. */
const SECRET_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** Bound before any parsing: an anonymous endpoint must not split an arbitrary string. */
export const MAX_SOURCE_TOKEN_LENGTH = 160;

export type ParsedSourceToken = {
  tenantId: string;
  sourceId: string;
  secret: string;
};

export function generateSourceSecret(): string {
  return randomBytes(32).toString("base64url");
}

export function formatSourceToken(
  tenantId: string,
  sourceId: string,
  secret: string
): string {
  return [SOURCE_TOKEN_VERSION, tenantId, sourceId, secret].join(".");
}

/**
 * A short, non-sensitive handle an administrator can recognise a token by
 * ("which one is on the site?"). The first six characters of a 43-character
 * random secret leave 202 bits unknown, and it is never accepted as proof.
 */
export function sourceTokenPrefix(secret: string): string {
  return secret.slice(0, 6);
}

/** `null` for everything that is not exactly the format above. Never throws. */
export function parseSourceToken(value: unknown): ParsedSourceToken | null {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_SOURCE_TOKEN_LENGTH
  ) {
    return null;
  }

  const parts = value.split(".");

  if (parts.length !== 4 || parts[0] !== SOURCE_TOKEN_VERSION) {
    return null;
  }

  const [, tenantId, sourceId, secret] = parts as [
    string,
    string,
    string,
    string
  ];

  if (
    !UUID_PATTERN.test(tenantId) ||
    !UUID_PATTERN.test(sourceId) ||
    !SECRET_PATTERN.test(secret)
  ) {
    return null;
  }

  return { tenantId, sourceId, secret };
}
