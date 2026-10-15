/**
 * One-time link codes (Issue #965, ADR-0140 section 3, steps 1 and 2).
 *
 * The plaintext code exists in exactly two places: the return value of
 * `createLinkCode` (shown to the requester once) and the webhook payload that
 * carries it back. The database holds only its SHA-256. It is never logged,
 * never audited and never part of an event.
 */
import { recordAuditEvent } from "../../logging/application/audit-log";
import { TELEGRAM_MODULE_KEY } from "../domain/telegram-constants";
import {
  generateLinkCode,
  hashLinkCode,
  LINK_CODE_TTL_MS
} from "../domain/telegram-link-code";

/** A staff member may request this many codes an hour; a stuck flow is not a reason to mint hundreds. */
export const LINK_CODE_REQUESTS_PER_HOUR = 5;

export type CreateLinkCodeResult =
  | { outcome: "created"; code: string; expiresAt: Date }
  | { outcome: "rate_limited" };

/**
 * Requests a code for the principal THEMSELVES (there is no "bind on behalf of
 * another person": the bound chat receives that person's operational alerts).
 * A newer code invalidates the previous one.
 */
export async function createLinkCode(
  tx: Bun.SQL,
  tenantId: string,
  principalId: string,
  context: { now?: Date; correlationId?: string } = {}
): Promise<CreateLinkCodeResult> {
  const now = context.now ?? new Date();

  const recent = (await tx`
    SELECT count(*) AS count
    FROM awcms_telegram_link_codes
    WHERE tenant_id = ${tenantId} AND principal_id = ${principalId}
      AND created_at > now() - interval '1 hour'
  `) as { count: string | number }[];

  if (Number(recent[0]?.count ?? 0) >= LINK_CODE_REQUESTS_PER_HOUR) {
    return { outcome: "rate_limited" };
  }

  await tx`
    UPDATE awcms_telegram_link_codes
    SET invalidated_at = now()
    WHERE tenant_id = ${tenantId} AND principal_id = ${principalId}
      AND consumed_at IS NULL AND invalidated_at IS NULL
  `;

  const code = generateLinkCode();
  const expiresAt = new Date(now.getTime() + LINK_CODE_TTL_MS);

  await tx`
    INSERT INTO awcms_telegram_link_codes
      (tenant_id, principal_id, code_hash, expires_at)
    VALUES (${tenantId}, ${principalId}, ${hashLinkCode(code)}, ${expiresAt})
  `;

  await recordAuditEvent(tx, {
    tenantId,
    actorTenantUserId: principalId,
    moduleKey: TELEGRAM_MODULE_KEY,
    action: "telegram_link.requested",
    resourceType: "telegram_link_code",
    severity: "info",
    message: "Staff member requested a Telegram link code for themselves.",
    attributes: { expiresAtIso: expiresAt.toISOString() },
    ...(context.correlationId ? { correlationId: context.correlationId } : {})
  });

  return { outcome: "created", code, expiresAt };
}

/**
 * The atomic consume: `UPDATE ... WHERE consumed_at IS NULL AND expires_at >
 * now() RETURNING`, so two parallel `/start`s with one code yield ONE row. The
 * tenant and principal come from this row and nowhere else.
 */
export async function consumeLinkCode(
  tx: Bun.SQL,
  tenantId: string,
  code: string
): Promise<{ principalId: string } | null> {
  const rows = (await tx`
    UPDATE awcms_telegram_link_codes
    SET consumed_at = now()
    WHERE tenant_id = ${tenantId} AND code_hash = ${hashLinkCode(code)}
      AND consumed_at IS NULL AND invalidated_at IS NULL
      AND expires_at > now()
    RETURNING principal_id
  `) as { principal_id: string }[];

  return rows[0] ? { principalId: rows[0].principal_id } : null;
}
