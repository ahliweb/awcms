/**
 * The Mailketing webhook's aggregated rejection record (Issue #1161, ADR-0151
 * section 5 "aggregates rejection audit as in ADR-0140 section 9"). The same
 * shape as `telegram-delivery/application/telegram-webhook-guard.ts`, kept
 * separate on purpose: each webhook owns its counters and its audit action, and
 * a shared helper would be one place where one provider's flood hid another's.
 *
 * A rejected request has no proven tenant, so it costs only an in-process
 * counter. At most once a minute, and only when something was rejected, the
 * next rejection flushes the counts as ONE `warning` audit row on the PLATFORM
 * tenant. Counts and fixed reasons only: no address, no path, no token, no body.
 */
import { withTenantOrThrow } from "../../../lib/database/tenant-context";
import { log } from "../../../lib/logging/logger";
import { resolvePlatformTenantIdIgnoringStatus } from "../../../lib/tenant/platform-tenant";
import { recordAuditEvent } from "../../logging/application/audit-log";

const MODULE_KEY = "email";

/**
 * Reason names avoid "secret"/"token"/"credential": they are keys in an audit
 * row's `attributes`, and the redactor blanks the value of any key that looks
 * like one.
 */
export type EmailWebhookRejectionReason =
  | "proof_malformed"
  | "proof_mismatch"
  | "pre_verify_rate_limited"
  | "denied_rate_limited"
  | "callback_rate_limited"
  | "too_large"
  | "malformed";

const FLUSH_INTERVAL_MS = 60_000;

const counts = new Map<EmailWebhookRejectionReason, number>();
let windowStartedAt = 0;

/** Test seam only. */
export function resetEmailWebhookRejectionsForTests(): void {
  counts.clear();
  windowStartedAt = 0;
}

export function pendingEmailWebhookRejections(): Record<string, number> {
  return Object.fromEntries(counts);
}

/** Pure in-process work: no database, no network. */
export function recordEmailWebhookRejection(
  reason: EmailWebhookRejectionReason,
  nowMs: number = Date.now()
): void {
  if (counts.size === 0) {
    windowStartedAt = nowMs;
  }

  counts.set(reason, (counts.get(reason) ?? 0) + 1);
}

/** Best effort, never throws; counters are cleared whether or not the write succeeded. */
export async function flushEmailWebhookRejections(
  getSql: () => Bun.SQL,
  nowMs: number = Date.now()
): Promise<boolean> {
  if (counts.size === 0 || nowMs - windowStartedAt < FLUSH_INTERVAL_MS) {
    return false;
  }

  const snapshot = Object.fromEntries(counts);
  const windowSeconds = Math.round((nowMs - windowStartedAt) / 1000);

  counts.clear();
  windowStartedAt = nowMs;

  try {
    const sql = getSql();
    const platformTenantId = await resolvePlatformTenantIdIgnoringStatus(sql);

    if (!platformTenantId) {
      log("warning", "email.webhook.rejections", {
        moduleKey: MODULE_KEY,
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
          moduleKey: MODULE_KEY,
          action: "email_webhook.rejected",
          resourceType: "email_webhook",
          severity: "warning",
          message: `Mailketing webhook rejected ${Object.values(snapshot).reduce((a, b) => a + b, 0)} request(s) in ${windowSeconds}s.`,
          attributes: { counts: snapshot, windowSeconds }
        }),
      { workClass: "background_sync" }
    );

    return true;
  } catch (error) {
    log("warning", "email.webhook.rejections_flush_failed", {
      moduleKey: MODULE_KEY,
      error: error instanceof Error ? error.name : "unknown"
    });

    return false;
  }
}
