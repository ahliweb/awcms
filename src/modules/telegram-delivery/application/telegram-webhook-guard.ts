/**
 * The webhook's pre-work checks and its aggregated rejection record (Issue #965,
 * ADR-0140 sections 7 and 9).
 *
 * ## Verification first, and cheap
 *
 * `verifyWebhookSecret` is a constant-time comparison of two SHA-256 digests (so
 * neither the value nor even its length can be timed out of the response) against
 * `TELEGRAM_WEBHOOK_SECRET`. A missing header, a wrong one, and an UNSET secret on
 * the server all fail identically. The route calls this before it reads the body,
 * touches the database or parses anything.
 *
 * ## Rejections are counted, then audited in aggregate
 *
 * A rejected request has no tenant (the tenant comes from a code or a binding,
 * which a rejected request never gets to), and ADR-0140 section 7 forbids doing
 * work for it. So each rejection only increments an in-process counter. At most once a minute, and only when something was rejected, the NEXT
 * rejection flushes the counts as ONE `warning` audit row on the PLATFORM tenant:
 * the audit log is tenant-scoped, and an unauthenticated flood is a platform
 * concern, not any one tenant's. A flood therefore costs one small write a
 * minute, never one per request. The row carries counts and reasons only: no
 * address, no header, no body.
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import { withTenantOrThrow } from "../../../lib/database/tenant-context";
import { log } from "../../../lib/logging/logger";
import { resolvePlatformTenantIdIgnoringStatus } from "../../../lib/tenant/platform-tenant";
import { recordAuditEvent } from "../../logging/application/audit-log";
import { isValidTelegramWebhookSecret } from "../domain/telegram-config";
import { TELEGRAM_MODULE_KEY } from "../domain/telegram-constants";

const digest = (value: string): Buffer =>
  createHash("sha256").update(value, "utf8").digest();

/**
 * True only when the configured secret is well-formed AND the presented header
 * equals it. An unconfigured or malformed server secret verifies nothing, so a
 * misconfigured deployment refuses every request instead of accepting any.
 */
export function verifyWebhookSecret(
  presented: string | null,
  configured: string | undefined
): boolean {
  if (!isValidTelegramWebhookSecret(configured)) {
    return false;
  }

  // Both digests are always computed and compared, whatever `presented` is.
  const equal = timingSafeEqual(digest(presented ?? ""), digest(configured));

  return presented !== null && equal;
}

/**
 * The per-chat rate-limit key (Issue #1008, L3). Telegram calls the webhook from
 * a small set of addresses, so a per-address bucket cannot tell one noisy user
 * from another; this one is per chat, and is only ever built AFTER the secret
 * header verified.
 *
 * The chat id is HMAC-ed with the webhook secret and truncated, so the limiter's
 * store (Redis, when configured) never holds a chat id, readable or reversible
 * without the secret. It is a short-lived counter key, not an identifier.
 */
export function telegramChatRateLimitKey(
  chatKey: string,
  secret: string
): string {
  return `telegram-webhook-chat:${createHmac("sha256", secret)
    .update(`telegram:chat-rate:${chatKey}`, "utf8")
    .digest("hex")
    .slice(0, 32)}`;
}

/**
 * The reason names avoid words like "secret" and "credential" on purpose: they are keys in an audit
 * row's `attributes`, and the audit redactor (rightly) blanks the VALUE of any
 * key that looks like one, which turned the counts into `[REDACTED]`.
 */
export type WebhookRejectionReason =
  | "header_mismatch"
  | "header_absent"
  | "rate_limited"
  | "chat_rate_limited"
  | "too_large"
  | "malformed";

const FLUSH_INTERVAL_MS = 60_000;

const counts = new Map<WebhookRejectionReason, number>();
let windowStartedAt = 0;

/** Test seam only. */
export function resetWebhookRejectionsForTests(): void {
  counts.clear();
  windowStartedAt = 0;
}

export function pendingWebhookRejections(): Record<string, number> {
  return Object.fromEntries(counts);
}

/** Counts one rejection. Pure in-process work: no database, no network. */
export function recordWebhookRejection(
  reason: WebhookRejectionReason,
  nowMs: number = Date.now()
): void {
  if (counts.size === 0) {
    windowStartedAt = nowMs;
  }

  counts.set(reason, (counts.get(reason) ?? 0) + 1);
}

/**
 * Writes the aggregate if the window elapsed. `getSql` is a thunk so nothing
 * database-shaped is created unless a flush is actually due. Best effort: it never throws, and
 * the counters are cleared whether or not the write succeeded, so a down database
 * cannot make this map grow.
 */
export async function flushWebhookRejections(
  getSql: () => Bun.SQL,
  nowMs: number = Date.now(),
  correlationId?: string
): Promise<boolean> {
  if (counts.size === 0 || nowMs - windowStartedAt < FLUSH_INTERVAL_MS) {
    return false;
  }

  const snapshot = Object.fromEntries(counts);
  const windowSeconds = Math.round((nowMs - windowStartedAt) / 1000);

  counts.clear();
  windowStartedAt = nowMs;

  try {
    // The client is obtained only now: a rejection that is not due to flush must
    // not so much as touch the database layer.
    const sql = getSql();
    const platformTenantId = await resolvePlatformTenantIdIgnoringStatus(sql);

    if (!platformTenantId) {
      log("warning", "telegram.webhook.rejections", {
        moduleKey: TELEGRAM_MODULE_KEY,
        windowSeconds,
        counts: snapshot
      });

      return false;
    }

    await withTenantOrThrow(
      sql,
      platformTenantId,
      (tx) =>
        recordAuditEvent(tx, {
          tenantId: platformTenantId,
          moduleKey: TELEGRAM_MODULE_KEY,
          action: "telegram_webhook.rejected",
          resourceType: "telegram_webhook",
          severity: "warning",
          message: `Telegram webhook rejected ${Object.values(snapshot).reduce((a, b) => a + b, 0)} request(s) in ${windowSeconds}s.`,
          attributes: { counts: snapshot, windowSeconds },
          ...(correlationId ? { correlationId } : {})
        }),
      { workClass: "background_sync" }
    );

    return true;
  } catch (error) {
    log("warning", "telegram.webhook.rejections_flush_failed", {
      moduleKey: TELEGRAM_MODULE_KEY,
      error: error instanceof Error ? error.name : "unknown"
    });

    return false;
  }
}
