import { recordAuditEvent } from "../../logging/application/audit-log";
import { maskIdentifierValue } from "../../profile-identity/domain/identifier";
import {
  encodeKeysetCursor,
  keysetCursorCreatedAtSql,
  type KeysetCursor
} from "../../_shared/keyset-pagination";
import type { NewsletterSubscriberStatus } from "../domain/subscriber-status";
import type { SubscriptionRequest } from "../domain/subscription-request";
import {
  generateSubscriptionToken,
  hashSubscriptionToken
} from "../domain/subscription-token";

/**
 * Reads and writes for `awcms_newsletter_subscribers` (Issue #598, ADR-0103).
 *
 * Every function takes an already tenant-scoped `Bun.SQL` from `withTenant`;
 * none opens its own transaction, matching every other directory here.
 *
 * ## Nothing in this file returns a token
 *
 * The two tokens are bearer credentials. `subscribe` hands its caller the raw
 * confirmation token exactly once — the caller's only legitimate use for it is
 * putting it in the mail it is about to send — and nothing else ever reads one
 * back out. The admin list does not select them at all.
 *
 * ## Audit records the MASKED address
 *
 * An audit row outlives the subscriber it describes, including past an erasure
 * request. Writing the full address into it would make the audit trail a second
 * copy of the list that subject-rights erasure does not reach.
 */

const AUDIT_MODULE_KEY = "newsletter";
const AUDIT_RESOURCE_TYPE = "newsletter_subscriber";

export type NewsletterSubscriberView = {
  id: string;
  email: string;
  status: NewsletterSubscriberStatus;
  source: string;
  locale: string | null;
  confirmedAt: Date | null;
  consentAt: Date | null;
  unsubscribedAt: Date | null;
  suppressedAt: Date | null;
  suppressionReason: string | null;
  createdAt: Date;
};

type SubscriberRow = {
  id: string;
  email: string;
  status: NewsletterSubscriberStatus;
  source: string;
  locale: string | null;
  confirmed_at: Date | null;
  consent_at: Date | null;
  unsubscribed_at: Date | null;
  suppressed_at: Date | null;
  suppression_reason: string | null;
  created_at: Date;
};

function toView(row: SubscriberRow): NewsletterSubscriberView {
  return {
    id: row.id,
    email: row.email,
    status: row.status,
    source: row.source,
    locale: row.locale,
    confirmedAt: row.confirmed_at,
    consentAt: row.consent_at,
    unsubscribedAt: row.unsubscribed_at,
    suppressedAt: row.suppressed_at,
    suppressionReason: row.suppression_reason,
    createdAt: row.created_at
  };
}

/** Deliberately excludes both token columns — see this file's header. */
const SELECT_COLUMNS =
  "id, email, status, source, locale, confirmed_at, consent_at, " +
  "unsubscribed_at, suppressed_at, suppression_reason, created_at";

export type SubscribeOutcome = {
  /**
   * The raw confirmation token, for the mail the caller is about to send.
   * `null` when no mail should go out: the address is suppressed, or it is
   * already active and there is nothing to confirm.
   */
  confirmationToken: string | null;
};

/**
 * Subscribe an address (FR-NWL-005 — idempotent).
 *
 * ## One statement, and the uniqueness is the database's job
 *
 * `ON CONFLICT (tenant_id, email_normalized)` rather than a read-then-write:
 * two readers submitting the same address in the same instant would both find
 * nothing and both insert, and the second would fail on the index anyway. Doing
 * it in one statement makes the race impossible instead of unlikely.
 *
 * ## A suppressed row is left completely alone
 *
 * The `WHERE` on the upsert refuses to touch it — ADR-0103's reason for four
 * states. Re-subscribing must not be a way to clear a suppression somebody
 * applied for abuse, and doing it here rather than in a caller means no future
 * caller can forget.
 *
 * ## The caller cannot tell which branch ran
 *
 * A new row, a re-subscribe, an already-active address and a suppressed one all
 * return the same SHAPE, and the endpoint answers the same body for all four.
 * That is what stops the public endpoint being an enumeration oracle.
 */
export async function subscribe(
  tx: Bun.SQL,
  tenantId: string,
  request: SubscriptionRequest,
  source: string
): Promise<SubscribeOutcome> {
  const token = generateSubscriptionToken();
  const tokenHash = hashSubscriptionToken(token);
  const unsubscribeToken = generateSubscriptionToken();

  const rows = (await tx`
    INSERT INTO awcms_newsletter_subscribers
      (tenant_id, email, email_normalized, status, source, locale,
       confirmation_token_hash, confirmation_sent_at, unsubscribe_token_hash)
    VALUES
      (${tenantId}, ${request.email}, ${request.emailNormalized}, 'pending',
       ${source}, ${request.locale},
       ${tokenHash}, now(), ${hashSubscriptionToken(unsubscribeToken)})
    ON CONFLICT (tenant_id, email_normalized) DO UPDATE
      SET status = 'pending',
          email = EXCLUDED.email,
          locale = COALESCE(EXCLUDED.locale, awcms_newsletter_subscribers.locale),
          confirmation_token_hash = EXCLUDED.confirmation_token_hash,
          confirmation_sent_at = now(),
          unsubscribed_at = NULL,
          updated_at = now()
      WHERE awcms_newsletter_subscribers.status <> 'suppressed'
        AND awcms_newsletter_subscribers.status <> 'active'
    RETURNING id
  `) as { id: string }[];

  // No row means the upsert's WHERE refused it: suppressed, or already active.
  // Both are cases where no mail should go out, and neither is distinguishable
  // to the caller.
  return { confirmationToken: rows.length > 0 ? token : null };
}

export type ConfirmOutcome = {
  confirmed: boolean;
  /** The raw unsubscribe token, so the welcome mail can carry a working link. `null` when nothing was confirmed. */
  unsubscribeToken: string | null;
};

/**
 * Confirm a pending subscription — the moment consent is actually recorded.
 *
 * `consent_at` and `consent_ip_hash` are written HERE and nowhere else: the
 * record has to say what happened, and what happened is that somebody followed
 * a link from an inbox, not that a form was submitted.
 *
 * The token is spent on use (`confirmation_token_hash = NULL`), because keeping
 * a used bearer credential is keeping a credential.
 *
 * Returns the unsubscribe token because the row already has its hash and the
 * raw form is needed for the footer link — regenerating one here would break
 * every link in every message already sent.
 */
export async function confirmSubscription(
  tx: Bun.SQL,
  tenantId: string,
  tokenHash: string,
  consentIpHash: string | null,
  correlationId?: string
): Promise<ConfirmOutcome> {
  const unsubscribeToken = generateSubscriptionToken();

  const rows = (await tx`
    UPDATE awcms_newsletter_subscribers
    SET status = 'active',
        confirmed_at = now(),
        consent_at = now(),
        consent_ip_hash = ${consentIpHash},
        confirmation_token_hash = NULL,
        -- Issued on confirmation and stable from then on. A row that never
        -- confirms never needs one, and re-issuing on a LATER confirmation is
        -- correct: no message has gone out yet carrying the old one.
        unsubscribe_token_hash = ${hashSubscriptionToken(unsubscribeToken)},
        updated_at = now()
    WHERE tenant_id = ${tenantId}
      AND confirmation_token_hash = ${tokenHash}
      AND status = 'pending'
    RETURNING id, email
  `) as { id: string; email: string }[];

  const row = rows[0];

  if (!row) {
    return { confirmed: false, unsubscribeToken: null };
  }

  await recordAuditEvent(tx, {
    tenantId,
    // Anonymous by design: the subscriber acted, and they have no account here.
    moduleKey: AUDIT_MODULE_KEY,
    action: "newsletter.subscription.confirmed",
    resourceType: AUDIT_RESOURCE_TYPE,
    resourceId: row.id,
    severity: "info",
    message: `Newsletter subscription confirmed: ${maskIdentifierValue(row.email)}.`,
    correlationId
  });

  return { confirmed: true, unsubscribeToken };
}

/**
 * Unsubscribe by token — no session, no tenant header, no address (PRD §30).
 *
 * Requiring any of those would mean a person who wants out has to prove who they
 * are first, which is hostile and unnecessary: the token already proves they
 * hold the link.
 *
 * The row is KEPT rather than deleted. "This person asked to stop on this date"
 * is the record that answers a later complaint, and deleting it would leave
 * nothing to answer with. Subject-rights erasure is the path that removes it,
 * and it is a different request made by a different person.
 */
export async function unsubscribeByToken(
  tx: Bun.SQL,
  tenantId: string,
  tokenHash: string,
  correlationId?: string
): Promise<boolean> {
  const rows = (await tx`
    UPDATE awcms_newsletter_subscribers
    SET status = 'unsubscribed',
        unsubscribed_at = now(),
        updated_at = now()
    WHERE tenant_id = ${tenantId}
      AND unsubscribe_token_hash = ${tokenHash}
      AND status <> 'suppressed'
    RETURNING id, email
  `) as { id: string; email: string }[];

  const row = rows[0];

  if (!row) {
    return false;
  }

  await recordAuditEvent(tx, {
    tenantId,
    // Anonymous by design: the subscriber acted, and they have no account here.
    moduleKey: AUDIT_MODULE_KEY,
    action: "newsletter.subscription.unsubscribed",
    resourceType: AUDIT_RESOURCE_TYPE,
    resourceId: row.id,
    severity: "info",
    message: `Newsletter subscription ended by the subscriber: ${maskIdentifierValue(row.email)}.`,
    correlationId
  });

  return true;
}

/** Suppress a subscriber — an OPERATOR's decision, and one they must give a reason for. */
export async function suppressSubscriber(
  tx: Bun.SQL,
  tenantId: string,
  actorTenantUserId: string,
  subscriberId: string,
  reason: string,
  correlationId?: string
): Promise<boolean> {
  const rows = (await tx`
    UPDATE awcms_newsletter_subscribers
    SET status = 'suppressed',
        suppressed_at = now(),
        suppression_reason = ${reason},
        updated_at = now()
    WHERE tenant_id = ${tenantId} AND id = ${subscriberId}
    RETURNING id, email
  `) as { id: string; email: string }[];

  const row = rows[0];

  if (!row) {
    return false;
  }

  await recordAuditEvent(tx, {
    tenantId,
    actorTenantUserId,
    moduleKey: AUDIT_MODULE_KEY,
    action: "newsletter.subscriber.suppressed",
    resourceType: AUDIT_RESOURCE_TYPE,
    resourceId: subscriberId,
    // `warning`, not `info`: this is the state a subscriber cannot leave by
    // re-subscribing, so it is the one somebody will later ask about.
    severity: "warning",
    message: `Newsletter subscriber suppressed: ${maskIdentifierValue(row.email)}.`,
    attributes: { reason },
    correlationId
  });

  return true;
}

export const SUBSCRIBER_LIST_LIMIT = 50;

export type SubscriberListFilter = { status?: NewsletterSubscriberStatus };

/**
 * The admin list — keyset paginated, newest first.
 *
 * The cursor carries FULL-PRECISION `created_at` text, never a JS `Date`, so a
 * page boundary cannot skip rows sharing a millisecond. A list import writes
 * many rows inside one millisecond, which is exactly when that bites.
 */
export async function listSubscribers(
  tx: Bun.SQL,
  tenantId: string,
  filter: SubscriberListFilter = {},
  cursor?: KeysetCursor
): Promise<{ items: NewsletterSubscriberView[]; nextCursor: string | null }> {
  const statusParam = filter.status ?? null;
  const cursorCreatedAt = cursor?.createdAt ?? null;
  const cursorId = cursor?.id ?? null;

  const rows = (await tx`
    SELECT ${tx.unsafe(SELECT_COLUMNS)},
      ${tx.unsafe(keysetCursorCreatedAtSql())}
    FROM awcms_newsletter_subscribers
    WHERE tenant_id = ${tenantId}
      AND (${statusParam}::text IS NULL OR status = ${statusParam})
      AND (
        ${cursorCreatedAt}::text IS NULL
        OR (created_at, id) < (${cursorCreatedAt}::timestamptz, ${cursorId}::uuid)
      )
    ORDER BY created_at DESC, id DESC
    LIMIT ${SUBSCRIBER_LIST_LIMIT + 1}
  `) as (SubscriberRow & { created_at_cursor: string })[];

  const hasMore = rows.length > SUBSCRIBER_LIST_LIMIT;
  const page = hasMore ? rows.slice(0, SUBSCRIBER_LIST_LIMIT) : rows;
  const last = page[page.length - 1];

  return {
    items: page.map(toView),
    nextCursor:
      hasMore && last
        ? encodeKeysetCursor(last.created_at_cursor, last.id)
        : null
  };
}

/** Per-status counts for the admin screen's summary. Bounded by the status vocabulary itself. */
export async function countSubscribersByStatus(
  tx: Bun.SQL,
  tenantId: string
): Promise<Record<string, number>> {
  const rows = (await tx`
    SELECT status, count(*)::int AS count
    FROM awcms_newsletter_subscribers
    WHERE tenant_id = ${tenantId}
    GROUP BY status
  `) as { status: string; count: number }[];

  return Object.fromEntries(rows.map((row) => [row.status, Number(row.count)]));
}
