/**
 * Mailketing webhook intake in ADR-0151 `strict` mode (Issue #1161), as two
 * short tenant transactions:
 *
 *   phase 1  `verifyMailketingCallback`   the tenant is opened FROM the token;
 *                                          tenant active, `email` enabled, the
 *                                          subscription live on a CONNECTED
 *                                          Mailketing `esp_account`, and the
 *                                          secret's hash equal (constant time)
 *   phase 2  `recordMailketingEvents`     bind each event to OUR message, then
 *                                          insert it into the quarantine ledger
 *                                          (replay collapses on the dedupe key)
 *
 * ## What an event can change: nothing but the ledger
 *
 * The callback is UNAUTHENTICATED (Mailketing documents no signature; see
 * `domain/mailketing-webhook.ts`). So no event here writes a message status, a
 * suppression, a newsletter subscriber, consent or a customer. A bounce or an
 * unsubscribe waits as `pending` for an operator (`provider-event-directory`).
 *
 * ## Binding: only this account's own messages
 *
 * An event is kept only when it names a message THIS tenant sent through a
 * sender identity whose parent is THIS Mailketing account:
 *
 * - `bounce`, `open`, `delivered` carry the provider message id we stored after
 *   acceptance (ADR-0151 M2); the row must also be addressed to the reported
 *   recipient. An id we did not issue, another account's id, another tenant's
 *   id, or a mismatched recipient is DISCARDED (counted, not stored).
 * - `click` and `unsubscribe` carry no id (the vendor's payload); they are kept
 *   only when this account sent that recipient a message in the last 30 days.
 *
 * The deployment sender (env token, `sender_account_id IS NULL`) has no
 * account to hang a callback on and is not covered: binding across tenants by
 * a provider id alone is exactly what this refuses to do.
 *
 * ## Every pre-proof failure is the same failure
 *
 * A malformed token, an unknown tenant or subscription, a wrong secret, a
 * revoked subscription, a disconnected account, a disabled module: phase 1
 * returns `null` for all of them, after the same reads and the same hash
 * comparison.
 */
import { withTenantOrThrow } from "../../../lib/database/tenant-context";
import {
  hashIdentifierValue,
  maskIdentifierValue,
  normalizeIdentifierValue
} from "../../profile-identity/domain/identifier";
import {
  callbackHashesEqual,
  DUMMY_CALLBACK_HASH,
  hashCallbackSecret,
  parseReportedAt,
  providerEventDedupeKey,
  reportedDay,
  type IgnoredEventReason,
  type ParsedCallbackToken,
  type ParsedProviderEvent
} from "../domain/mailketing-webhook";
import { resolveEmailWebhookMaxPending } from "../domain/email-webhook-config";
import type { EmailWebhookSubscriptionDirectory } from "../infrastructure/channel-account-loaders";

const EMAIL_MODULE_KEY = "email";
const RECIPIENT_ONLY_WINDOW_DAYS = 30;

export type VerifiedMailketingCallback = {
  tenantId: string;
  subscriptionId: string;
  espAccountId: string;
};

export async function verifyMailketingCallback(
  sql: Bun.SQL,
  token: ParsedCallbackToken,
  directory: EmailWebhookSubscriptionDirectory
): Promise<VerifiedMailketingCallback | null> {
  return withTenantOrThrow(sql, token.tenantId, async (tx) => {
    // One read for the tenant and the module switch (the registry read the
    // telegram webhook uses: no tenant_modules row means enabled).
    const tenantRows = (await tx`
      SELECT t.status,
             COALESCE((SELECT m.enabled FROM awcms_tenant_modules m
                       WHERE m.tenant_id = t.id
                         AND m.module_key = ${EMAIL_MODULE_KEY}), true) AS module_enabled
      FROM awcms_tenants t
      WHERE t.id = ${token.tenantId}
    `) as { status: string; module_enabled: boolean }[];
    const subscription =
      await directory.fetchWebhookSubscriptionForVerification(
        tx,
        token.tenantId,
        token.subscriptionId,
        { provider: "mailketing", accountKind: "esp_account" }
      );

    // Always computed, always compared.
    const matches = callbackHashesEqual(
      subscription?.callbackTokenHash ?? DUMMY_CALLBACK_HASH,
      hashCallbackSecret(token.tenantId, token.subscriptionId, token.secret)
    );

    const accepted =
      subscription !== null &&
      matches &&
      subscription.live &&
      subscription.verificationMode === "unauthenticated" &&
      tenantRows[0]?.status === "active" &&
      tenantRows[0]?.module_enabled === true;

    if (!accepted || !subscription) return null;

    return {
      tenantId: token.tenantId,
      subscriptionId: subscription.id,
      espAccountId: subscription.accountId
    };
  });
}

export type MailketingIntakeResult = {
  recorded: number;
  duplicate: number;
  unmatched: number;
  stale: number;
  /** Pending (reviewable) events refused because the tenant's review queue is full. */
  quotaExceeded: number;
  ignored: Record<IgnoredEventReason, number>;
};

export function emptyIntakeResult(): MailketingIntakeResult {
  return {
    recorded: 0,
    duplicate: 0,
    unmatched: 0,
    stale: 0,
    quotaExceeded: 0,
    ignored: { newsubscriber_ignored: 0, unknown_type: 0, invalid_event: 0 }
  };
}

async function bindByProviderMessageId(
  tx: Bun.SQL,
  callback: VerifiedMailketingCallback,
  providerMessageId: string,
  recipientHash: string
): Promise<string | null> {
  const rows = (await tx`
    SELECT m.id
    FROM awcms_email_messages m
    JOIN awcms_channel_accounts s
      ON s.tenant_id = m.tenant_id AND s.id = m.sender_account_id
    WHERE m.tenant_id = ${callback.tenantId}
      AND m.provider_message_id = ${providerMessageId}
      AND m.sender_account_id IS NOT NULL
      AND m.to_address_hash = ${recipientHash}
      AND m.status = 'sent'
      AND s.parent_account_id = ${callback.espAccountId}
    LIMIT 1
  `) as { id: string }[];

  return rows[0]?.id ?? null;
}

async function bindByRecipient(
  tx: Bun.SQL,
  callback: VerifiedMailketingCallback,
  recipientHash: string
): Promise<string | null> {
  const rows = (await tx`
    SELECT m.id
    FROM awcms_email_messages m
    JOIN awcms_channel_accounts s
      ON s.tenant_id = m.tenant_id AND s.id = m.sender_account_id
    WHERE m.tenant_id = ${callback.tenantId}
      AND m.to_address_hash = ${recipientHash}
      AND m.sender_account_id IS NOT NULL
      AND m.status = 'sent'
      AND m.sent_at > now() - make_interval(days => ${RECIPIENT_ONLY_WINDOW_DAYS})
      AND s.parent_account_id = ${callback.espAccountId}
    ORDER BY m.sent_at DESC
    LIMIT 1
  `) as { id: string }[];

  return rows[0]?.id ?? null;
}

/**
 * Phase 2: one transaction for the whole request. Returns counts only: never a
 * recipient, never a message id (the provider is the caller, and it learns
 * nothing it did not send).
 */
export async function recordMailketingEvents(
  sql: Bun.SQL,
  callback: VerifiedMailketingCallback,
  events: readonly ParsedProviderEvent[],
  directory: EmailWebhookSubscriptionDirectory,
  now: Date = new Date(),
  maxPending: number = resolveEmailWebhookMaxPending()
): Promise<MailketingIntakeResult> {
  const result = emptyIntakeResult();

  return withTenantOrThrow(sql, callback.tenantId, async (tx) => {
    // Audit M-2 of PR #1272: the review queue is bounded per tenant. Counted
    // once per request (a request carries at most 25 events), so the bound can
    // be overshot by at most that many under concurrency, never unboundedly.
    const pendingRows = (await tx`
      SELECT count(*)::int AS n FROM awcms_email_provider_events
      WHERE tenant_id = ${callback.tenantId} AND review_status = 'pending'
    `) as { n: number }[];
    let pending = pendingRows[0]?.n ?? 0;

    for (const parsed of events) {
      if (!parsed.ok) {
        result.ignored[parsed.reason] += 1;
        continue;
      }

      const event = parsed.event;
      const reported = parseReportedAt(event.reportedAtRaw, now);

      if (reported.outOfWindow) {
        result.stale += 1;
        continue;
      }

      const normalized = normalizeIdentifierValue("email", event.recipient);
      const recipientHash = hashIdentifierValue(normalized);
      const providerMessageId =
        event.type === "click" || event.type === "unsubscribe"
          ? null
          : event.providerMessageId;

      const messageId =
        providerMessageId === null
          ? await bindByRecipient(tx, callback, recipientHash)
          : await bindByProviderMessageId(
              tx,
              callback,
              providerMessageId,
              recipientHash
            );

      if (messageId === null) {
        result.unmatched += 1;
        continue;
      }

      const linkHost = event.type === "click" ? event.linkHost : null;
      const linkHash = event.type === "click" ? event.linkHash : null;
      const bounceClass = event.type === "bounce" ? event.bounceClass : null;
      const statusCode = event.type === "bounce" ? event.statusCode : null;
      const reviewable =
        event.type === "bounce" || event.type === "unsubscribe";
      const reviewStatus = reviewable ? "pending" : "informational";

      if (reviewable && pending >= maxPending) {
        result.quotaExceeded += 1;
        continue;
      }

      const dedupeKey =
        event.type === "click" || event.type === "unsubscribe"
          ? providerEventDedupeKey({
              espAccountId: callback.espAccountId,
              type: event.type,
              recipientHash,
              reportedDay: reportedDay(reported.value!)
            })
          : providerEventDedupeKey({
              espAccountId: callback.espAccountId,
              type: event.type,
              emailMessageId: messageId
            });

      const inserted = (await tx`
        INSERT INTO awcms_email_provider_events
          (tenant_id, subscription_id, esp_account_id, email_message_id,
           event_type, correlation, provider_message_id, recipient_hash,
           recipient_masked, bounce_class, status_code, link_host, link_hash,
           provider_reported_at, dedupe_key, review_status)
        VALUES
          (${callback.tenantId}, ${callback.subscriptionId},
           ${callback.espAccountId}, ${messageId}, ${event.type},
           ${providerMessageId === null ? "recipient_only" : "provider_message_id"},
           ${providerMessageId}, ${recipientHash},
           ${maskIdentifierValue(normalized)}, ${bounceClass}, ${statusCode},
           ${linkHost}, ${linkHash}, ${reported.value}, ${dedupeKey},
           ${reviewStatus})
        ON CONFLICT DO NOTHING
        RETURNING id
      `) as { id: string }[];

      // `ON CONFLICT DO NOTHING` without a target: both the dedupe key and the
      // one-pending-unsubscribe-per-recipient key (sql/379) collapse a repeat.
      if (inserted.length === 0) {
        result.duplicate += 1;
      } else {
        result.recorded += 1;
        if (reviewable) pending += 1;
      }
    }

    await directory.touchWebhookSubscription(
      tx,
      callback.tenantId,
      callback.subscriptionId
    );

    return result;
  });
}
