/**
 * The quarantine of provider-reported, UNAUTHENTICATED Mailketing events and
 * its one-time operator review (Issue #1161, ADR-0151 section 5 `strict`).
 *
 * Reading: recipients masked, never an address, never a URL, never a token.
 * Every view says `authenticity: "unauthenticated"` so no screen can present a
 * provider report as ground truth (ADR-0151 M12).
 *
 * Reviewing is the ONLY path by which a provider report changes anything, and
 * it is a human decision:
 *
 * - `confirm` a `bounce` (hard; or soft/unclassified once the recipient has
 *   bounced `threshold` times in 30 days) adds a `bounced` suppression; `confirm`
 *   an `unsubscribe` adds an `unsubscribed` one. Both are written with
 *   `source = 'provider_report'`, which never blocks security mail
 *   (`domain/suppression-policy.ts`). An address that is already suppressed
 *   keeps its existing entry (a bounce and an unsubscribe for the same person
 *   do not race: one row per recipient, `ON CONFLICT DO NOTHING`).
 * - `dismiss` records that the operator did not act on it.
 *
 * Nothing here touches a message's status, a newsletter subscriber, consent or
 * a customer.
 */
import type {
  BounceClass,
  ProviderEventType
} from "../domain/mailketing-webhook";
import {
  bounceMeetsSuppressionThreshold,
  projectProviderReportedStatus,
  SOFT_BOUNCE_WINDOW_DAYS,
  type ProviderReportedStatus
} from "../domain/suppression-policy";

export type ProviderEventReviewStatus =
  "pending" | "confirmed" | "dismissed" | "informational";

export type ProviderEventView = {
  id: string;
  eventType: ProviderEventType;
  correlation: "provider_message_id" | "recipient_only";
  emailMessageId: string;
  espAccountId: string;
  recipientMasked: string;
  bounceClass: BounceClass | null;
  statusCode: string | null;
  /** Host only; the link itself is never stored, rendered as a link, or fetched. */
  linkHost: string | null;
  providerReportedAt: string | null;
  receivedAt: string;
  reviewStatus: ProviderEventReviewStatus;
  reviewedBy: string | null;
  reviewedAt: string | null;
  suppressionId: string | null;
  authenticity: "unauthenticated";
};

type EventRow = {
  id: string;
  event_type: ProviderEventType;
  correlation: ProviderEventView["correlation"];
  email_message_id: string;
  esp_account_id: string;
  recipient_masked: string;
  recipient_hash: string;
  bounce_class: BounceClass | null;
  status_code: string | null;
  link_host: string | null;
  provider_reported_at: Date | null;
  received_at: Date;
  review_status: ProviderEventReviewStatus;
  reviewed_by: string | null;
  reviewed_at: Date | null;
  suppression_id: string | null;
};

const EVENT_COLUMNS = `id, event_type, correlation, email_message_id, esp_account_id,
  recipient_masked, recipient_hash, bounce_class, status_code, link_host,
  provider_reported_at, received_at, review_status, reviewed_by, reviewed_at,
  suppression_id`;

function toView(row: EventRow): ProviderEventView {
  return {
    id: row.id,
    eventType: row.event_type,
    correlation: row.correlation,
    emailMessageId: row.email_message_id,
    espAccountId: row.esp_account_id,
    recipientMasked: row.recipient_masked,
    bounceClass: row.bounce_class,
    statusCode: row.status_code,
    linkHost: row.link_host,
    providerReportedAt: row.provider_reported_at
      ? row.provider_reported_at.toISOString()
      : null,
    receivedAt: row.received_at.toISOString(),
    reviewStatus: row.review_status,
    reviewedBy: row.reviewed_by,
    reviewedAt: row.reviewed_at ? row.reviewed_at.toISOString() : null,
    suppressionId: row.suppression_id,
    authenticity: "unauthenticated"
  };
}

export const PROVIDER_EVENT_PAGE_LIMIT = 50;

export type ProviderEventCursor = { receivedAt: string; id: string };

export function encodeProviderEventCursor(view: ProviderEventView): string {
  return Buffer.from(
    JSON.stringify({ r: view.receivedAt, i: view.id }),
    "utf8"
  ).toString("base64url");
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** `null` for anything that is not a cursor this module produced. */
export function decodeProviderEventCursor(
  raw: string | null
): ProviderEventCursor | null {
  if (!raw || raw.length > 200) return null;

  try {
    const parsed = JSON.parse(
      Buffer.from(raw, "base64url").toString("utf8")
    ) as { r?: unknown; i?: unknown };

    if (
      typeof parsed.r !== "string" ||
      typeof parsed.i !== "string" ||
      !UUID.test(parsed.i) ||
      Number.isNaN(Date.parse(parsed.r))
    ) {
      return null;
    }

    return { receivedAt: parsed.r, id: parsed.i };
  } catch {
    return null;
  }
}

export type ListProviderEventsFilter = {
  reviewStatus: ProviderEventReviewStatus | null;
  emailMessageId: string | null;
  cursor: ProviderEventCursor | null;
};

/**
 * Newest first, keyset-paged on `(received_at, id)`, one page more than asked
 * to say whether more exist. The caller filters by account visibility.
 */
export async function listProviderEvents(
  tx: Bun.SQL,
  tenantId: string,
  filter: ListProviderEventsFilter
): Promise<{ events: ProviderEventView[]; nextCursor: string | null }> {
  const limit = PROVIDER_EVENT_PAGE_LIMIT;
  const cursorAt = filter.cursor ? new Date(filter.cursor.receivedAt) : null;
  const cursorId = filter.cursor?.id ?? null;

  const rows = (await tx.unsafe(
    `SELECT ${EVENT_COLUMNS}
     FROM awcms_email_provider_events
     WHERE tenant_id = $1
       AND ($2::text IS NULL OR review_status = $2::text)
       AND ($3::uuid IS NULL OR email_message_id = $3::uuid)
       AND ($4::timestamptz IS NULL OR (received_at, id) < ($4::timestamptz, $5::uuid))
     ORDER BY received_at DESC, id DESC
     LIMIT $6`,
    [
      tenantId,
      filter.reviewStatus,
      filter.emailMessageId,
      cursorAt,
      cursorId,
      limit + 1
    ]
  )) as EventRow[];

  const page = rows.slice(0, limit).map(toView);
  const more = rows.length > limit;

  return {
    events: page,
    nextCursor: more ? encodeProviderEventCursor(page[page.length - 1]!) : null
  };
}

export type ProviderReportedProjection = {
  emailMessageId: string;
  messageStatus: string;
  providerReportedStatus: ProviderReportedStatus | null;
  authenticity: "unauthenticated";
};

/**
 * The provider-reported state of ONE message: the maximum over its recorded
 * events (forward-only, replay- and order-safe). `null` when the message is
 * unknown in this tenant. Never written onto the message.
 */
export async function projectMessageProviderStatus(
  tx: Bun.SQL,
  tenantId: string,
  emailMessageId: string
): Promise<ProviderReportedProjection | null> {
  const messages = (await tx`
    SELECT status FROM awcms_email_messages
    WHERE tenant_id = ${tenantId} AND id = ${emailMessageId}
  `) as { status: string }[];

  if (messages.length === 0) return null;

  const events = (await tx`
    SELECT DISTINCT event_type FROM awcms_email_provider_events
    WHERE tenant_id = ${tenantId} AND email_message_id = ${emailMessageId}
  `) as { event_type: ProviderEventType }[];

  return {
    emailMessageId,
    messageStatus: messages[0]!.status,
    providerReportedStatus: projectProviderReportedStatus(
      messages[0]!.status,
      events.map((row) => row.event_type)
    ),
    authenticity: "unauthenticated"
  };
}

/** The account a quarantined event belongs to, for the route's visibility check. `null` when unknown in this tenant. */
export async function fetchProviderEventAccount(
  tx: Bun.SQL,
  tenantId: string,
  id: string
): Promise<string | null> {
  const rows = (await tx`
    SELECT esp_account_id FROM awcms_email_provider_events
    WHERE tenant_id = ${tenantId} AND id = ${id}
  `) as { esp_account_id: string }[];

  return rows[0]?.esp_account_id ?? null;
}

export type ReviewDecision = "confirm" | "dismiss";

export type ReviewProviderEventResult =
  | {
      outcome: "reviewed";
      event: ProviderEventView;
      suppression: { id: string; created: boolean } | null;
    }
  | { outcome: "not_found" }
  | { outcome: "not_reviewable"; reviewStatus: ProviderEventReviewStatus }
  | {
      outcome: "below_threshold";
      softBounces: number;
      threshold: number;
    };

export async function reviewProviderEvent(
  tx: Bun.SQL,
  tenantId: string,
  actorTenantUserId: string,
  id: string,
  decision: ReviewDecision,
  softBounceThreshold: number
): Promise<ReviewProviderEventResult> {
  const rows = (await tx.unsafe(
    `SELECT ${EVENT_COLUMNS} FROM awcms_email_provider_events
     WHERE tenant_id = $1 AND id = $2
     FOR UPDATE`,
    [tenantId, id]
  )) as EventRow[];
  const row = rows[0];

  if (!row) return { outcome: "not_found" };

  if (row.review_status !== "pending") {
    return { outcome: "not_reviewable", reviewStatus: row.review_status };
  }

  if (decision === "dismiss") {
    const updated = (await tx.unsafe(
      `UPDATE awcms_email_provider_events
       SET review_status = 'dismissed', reviewed_by = $3
       WHERE tenant_id = $1 AND id = $2
       RETURNING ${EVENT_COLUMNS}`,
      [tenantId, id, actorTenantUserId]
    )) as EventRow[];

    return {
      outcome: "reviewed",
      event: toView(updated[0]!),
      suppression: null
    };
  }

  if (row.event_type === "bounce") {
    const counted = (await tx`
      -- DISTINCT messages (audit M-2 of PR #1272): repeated reports about ONE
      -- message are one bounce, however many times they arrive.
      SELECT count(DISTINCT email_message_id)::int AS n
      FROM awcms_email_provider_events
      WHERE tenant_id = ${tenantId}
        AND recipient_hash = ${row.recipient_hash}
        AND event_type = 'bounce'
        AND bounce_class IN ('soft', 'unknown')
        AND received_at > now() - make_interval(days => ${SOFT_BOUNCE_WINDOW_DAYS})
    `) as { n: number }[];
    const softBounces = counted[0]?.n ?? 0;

    if (
      !bounceMeetsSuppressionThreshold(
        row.bounce_class ?? "unknown",
        softBounces,
        softBounceThreshold
      )
    ) {
      return {
        outcome: "below_threshold",
        softBounces,
        threshold: softBounceThreshold
      };
    }
  }

  const reason = row.event_type === "bounce" ? "bounced" : "unsubscribed";
  const inserted = (await tx`
    INSERT INTO awcms_email_suppression_list
      (tenant_id, recipient_hash, recipient_masked, reason, created_by,
       source, provider_event_id)
    VALUES
      (${tenantId}, ${row.recipient_hash}, ${row.recipient_masked}, ${reason},
       ${actorTenantUserId}, 'provider_report', ${row.id})
    ON CONFLICT (tenant_id, recipient_hash) DO NOTHING
    RETURNING id
  `) as { id: string }[];

  let suppression: { id: string; created: boolean };

  if (inserted[0]) {
    suppression = { id: inserted[0].id, created: true };
  } else {
    const existing = (await tx`
      SELECT id FROM awcms_email_suppression_list
      WHERE tenant_id = ${tenantId} AND recipient_hash = ${row.recipient_hash}
    `) as { id: string }[];

    suppression = { id: existing[0]!.id, created: false };
  }

  const updated = (await tx.unsafe(
    `UPDATE awcms_email_provider_events
     SET review_status = 'confirmed', reviewed_by = $3, suppression_id = $4
     WHERE tenant_id = $1 AND id = $2
     RETURNING ${EVENT_COLUMNS}`,
    [tenantId, id, actorTenantUserId, suppression.id]
  )) as EventRow[];

  return { outcome: "reviewed", event: toView(updated[0]!), suppression };
}
