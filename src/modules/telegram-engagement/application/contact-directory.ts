/**
 * Contacts and their consent evidence (ADR-0152 section 6, TG6 to TG8).
 *
 * A contact is created ONLY by a verified `/start` from a private chat
 * (`webhook-ingest.ts`). There is no other way to make one: no import, no handle
 * or phone lookup, no API that takes a Telegram id (T-N2). Reads return a masked
 * label and states, never a Telegram id, chat id, username or message.
 *
 * Consent evidence is append-only (`sql/350` revokes UPDATE): `recordConsent`
 * inserts a row and appends `consent.changed` in the same transaction.
 */
import type { KeyRing } from "../../../lib/security/field-encryption";
import { appendDomainEvent } from "../../domain-event-runtime/application/append-domain-event";
import {
  contactHashCandidates,
  erasedContactHash
} from "../domain/contact-crypto";
import {
  evaluateEligibility,
  type EligibilityVerdict,
  type LatestConsent
} from "../domain/eligibility";
import { buildConsentChangedPayload } from "../domain/telegram-engagement-events";
import {
  PURPOSES,
  TELEGRAM_ENGAGEMENT_CONSENT_CHANGED_EVENT_TYPE,
  TELEGRAM_ENGAGEMENT_CONTACT_AGGREGATE_TYPE,
  TELEGRAM_ENGAGEMENT_EVENT_VERSION,
  TELEGRAM_ENGAGEMENT_MODULE_KEY,
  type ConsentMethod,
  type ContactState,
  type Purpose
} from "../domain/telegram-engagement-constants";
import {
  encodeContactCursor,
  type ListContactsQuery
} from "../domain/telegram-engagement-validation";
import { cancelQueuedMessages } from "./message-cancellation";

export type ContactRow = {
  id: string;
  account_id: string;
  contact_hash: string;
  chat_ciphertext: string | null;
  masked_label: string | null;
  state: ContactState;
  start_param: string | null;
  started_at: Date;
  last_inbound_at: Date | null;
  stopped_at: Date | null;
  blocked_at: Date | null;
  ended_at: Date | null;
};

/** Finds the contact of (tenant, account, Telegram user id) through every ring key. */
export async function findContactByUser(
  tx: Bun.SQL,
  tenantId: string,
  accountId: string,
  userId: string,
  ring: KeyRing
): Promise<ContactRow | null> {
  const candidates = contactHashCandidates(userId, tenantId, accountId, ring);
  const rows = (await tx`
    SELECT id, account_id, contact_hash, chat_ciphertext, masked_label, state,
           start_param, started_at, last_inbound_at, stopped_at, blocked_at,
           ended_at
    FROM awcms_telegram_engagement_contacts
    WHERE tenant_id = ${tenantId} AND account_id = ${accountId}
      AND contact_hash = ANY(${tx.array(candidates, "text")})
    FOR UPDATE
  `) as ContactRow[];

  return rows[0] ?? null;
}

export async function latestConsent(
  tx: Bun.SQL,
  tenantId: string,
  contactId: string,
  purpose: Purpose
): Promise<LatestConsent> {
  const rows = (await tx`
    SELECT id, action, method
    FROM awcms_telegram_engagement_consents
    WHERE tenant_id = ${tenantId} AND contact_id = ${contactId}
      AND purpose = ${purpose}
    -- Commit order for this contact (evidence_seq is drawn while the writer
    -- holds the contact row lock), never the provider's clock and never
    -- now(), which is the START of a transaction (audit M-1 of PR #1260).
    ORDER BY evidence_seq DESC
    LIMIT 1
  `) as { id: string; action: "opt_in" | "opt_out"; method: string }[];

  return rows[0] ?? null;
}

export async function eligibilityFor(
  tx: Bun.SQL,
  tenantId: string,
  contact: { id: string; state: ContactState },
  purpose: Purpose
): Promise<EligibilityVerdict> {
  return evaluateEligibility(
    contact.state,
    purpose,
    await latestConsent(tx, tenantId, contact.id, purpose)
  );
}

export async function recordConsent(
  tx: Bun.SQL,
  tenantId: string,
  input: {
    accountId: string;
    contactId: string;
    purpose: Purpose;
    action: "opt_in" | "opt_out";
    method: ConsentMethod;
    noticeVersion: string | null;
    updateId: number | null;
    occurredAt: Date;
    recordedBy: string | null;
    correlationId: string | null;
  }
): Promise<string> {
  const rows = (await tx`
    INSERT INTO awcms_telegram_engagement_consents
      (tenant_id, contact_id, purpose, action, notice_version, update_id,
       method, occurred_at, recorded_by)
    VALUES (${tenantId}, ${input.contactId}, ${input.purpose}, ${input.action},
            ${input.noticeVersion}, ${input.updateId}, ${input.method},
            ${input.occurredAt}, ${input.recordedBy})
    RETURNING id
  `) as { id: string }[];

  await appendDomainEvent(tx, tenantId, {
    eventType: TELEGRAM_ENGAGEMENT_CONSENT_CHANGED_EVENT_TYPE,
    eventVersion: TELEGRAM_ENGAGEMENT_EVENT_VERSION,
    aggregateType: TELEGRAM_ENGAGEMENT_CONTACT_AGGREGATE_TYPE,
    aggregateId: input.contactId,
    producerModule: TELEGRAM_ENGAGEMENT_MODULE_KEY,
    correlationId: input.correlationId,
    payload: buildConsentChangedPayload({
      channelAccountId: input.accountId,
      contactId: input.contactId,
      purpose: input.purpose,
      action: input.action,
      method: input.method,
      noticeVersion: input.noticeVersion,
      occurredAt: input.occurredAt
    }),
    occurredAt: input.occurredAt
  });

  return rows[0]!.id;
}

/**
 * Withdraws EVERY purpose that is currently opted in and cancels the contact's
 * queued messages (a withdrawal wins over everything queued, ADR-0133 section 4).
 * Purposes already withdrawn get no duplicate row.
 */
export async function withdrawAllPurposes(
  tx: Bun.SQL,
  tenantId: string,
  input: {
    accountId: string;
    contactId: string;
    method: ConsentMethod;
    updateId: number | null;
    occurredAt: Date;
    recordedBy: string | null;
    correlationId: string | null;
  }
): Promise<{ withdrawn: Purpose[]; cancelled: number }> {
  const withdrawn: Purpose[] = [];

  for (const purpose of PURPOSES) {
    const latest = await latestConsent(tx, tenantId, input.contactId, purpose);

    if (latest?.action !== "opt_in") continue;

    await recordConsent(tx, tenantId, {
      accountId: input.accountId,
      contactId: input.contactId,
      purpose,
      action: "opt_out",
      method: input.method,
      noticeVersion: null,
      updateId: input.updateId,
      occurredAt: input.occurredAt,
      recordedBy: input.recordedBy,
      correlationId: input.correlationId
    });
    withdrawn.push(purpose);
  }

  const cancelled = await cancelQueuedMessages(
    tx,
    tenantId,
    { contactId: input.contactId },
    "CONSENT_WITHDRAWN"
  );

  return { withdrawn, cancelled };
}

// ---------------------------------------------------------------------------
// Reads (masked)
// ---------------------------------------------------------------------------

export type ContactView = {
  id: string;
  accountId: string;
  label: string | null;
  state: ContactState;
  startParam: string | null;
  startedAt: string;
  lastInboundAt: string | null;
  stoppedAt: string | null;
  blockedAt: string | null;
  endedAt: string | null;
  privacyClass: "conversation_meta";
};

const iso = (value: Date | null): string | null => value?.toISOString() ?? null;

function toView(row: ContactRow): ContactView {
  return {
    id: row.id,
    accountId: row.account_id,
    label: row.masked_label,
    state: row.state,
    startParam: row.start_param,
    startedAt: row.started_at.toISOString(),
    lastInboundAt: iso(row.last_inbound_at),
    stoppedAt: iso(row.stopped_at),
    blockedAt: iso(row.blocked_at),
    endedAt: iso(row.ended_at),
    privacyClass: "conversation_meta"
  };
}

export async function listContacts(
  tx: Bun.SQL,
  tenantId: string,
  query: ListContactsQuery
): Promise<{ items: ContactView[]; nextCursor: string | null }> {
  const fetchCount = query.limit + 1;
  const rows = (
    query.cursor
      ? await tx`
    SELECT id, account_id, contact_hash, chat_ciphertext, masked_label, state,
           start_param, started_at, last_inbound_at, stopped_at, blocked_at,
           ended_at
    FROM awcms_telegram_engagement_contacts
    WHERE tenant_id = ${tenantId} AND account_id = ${query.accountId}
      AND (started_at, id) < (${query.cursor.startedAt}::timestamptz, ${query.cursor.id}::uuid)
    ORDER BY started_at DESC, id DESC
    LIMIT ${fetchCount}
  `
      : await tx`
    SELECT id, account_id, contact_hash, chat_ciphertext, masked_label, state,
           start_param, started_at, last_inbound_at, stopped_at, blocked_at,
           ended_at
    FROM awcms_telegram_engagement_contacts
    WHERE tenant_id = ${tenantId} AND account_id = ${query.accountId}
    ORDER BY started_at DESC, id DESC
    LIMIT ${fetchCount}
  `
  ) as ContactRow[];

  const page = rows.slice(0, query.limit);
  const last = page[page.length - 1];

  return {
    items: page.map(toView),
    nextCursor:
      rows.length > query.limit && last
        ? encodeContactCursor(last.started_at, last.id)
        : null
  };
}

export async function fetchContact(
  tx: Bun.SQL,
  tenantId: string,
  contactId: string,
  options: { lock?: boolean } = {}
): Promise<ContactRow | null> {
  const rows = (
    options.lock
      ? await tx`
    SELECT id, account_id, contact_hash, chat_ciphertext, masked_label, state,
           start_param, started_at, last_inbound_at, stopped_at, blocked_at,
           ended_at
    FROM awcms_telegram_engagement_contacts
    WHERE tenant_id = ${tenantId} AND id = ${contactId}
    FOR UPDATE
  `
      : await tx`
    SELECT id, account_id, contact_hash, chat_ciphertext, masked_label, state,
           start_param, started_at, last_inbound_at, stopped_at, blocked_at,
           ended_at
    FROM awcms_telegram_engagement_contacts
    WHERE tenant_id = ${tenantId} AND id = ${contactId}
  `
  ) as ContactRow[];

  return rows[0] ?? null;
}

export type ContactDetail = ContactView & {
  eligibility: Record<Purpose, { eligible: boolean; reason: string | null }>;
  recentMessages: {
    id: string;
    purpose: Purpose;
    kind: "text" | "consent_prompt";
    status: string;
    failureCode: string | null;
    createdAt: string;
    sentAt: string | null;
  }[];
};

export async function contactDetail(
  tx: Bun.SQL,
  tenantId: string,
  contact: ContactRow
): Promise<ContactDetail> {
  const eligibility = {} as ContactDetail["eligibility"];

  for (const purpose of PURPOSES) {
    const verdict = await eligibilityFor(tx, tenantId, contact, purpose);

    eligibility[purpose] = verdict.eligible
      ? { eligible: true, reason: null }
      : { eligible: false, reason: verdict.reason };
  }

  const messages = (await tx`
    SELECT id, purpose, kind, status, failure_code, created_at, sent_at
    FROM awcms_telegram_engagement_messages
    WHERE tenant_id = ${tenantId} AND contact_id = ${contact.id}
    ORDER BY created_at DESC, id DESC
    LIMIT 20
  `) as {
    id: string;
    purpose: Purpose;
    kind: "text" | "consent_prompt";
    status: string;
    failure_code: string | null;
    created_at: Date;
    sent_at: Date | null;
  }[];

  return {
    ...toView(contact),
    eligibility,
    recentMessages: messages.map((row) => ({
      id: row.id,
      purpose: row.purpose,
      kind: row.kind,
      status: row.status,
      failureCode: row.failure_code,
      createdAt: row.created_at.toISOString(),
      sentAt: iso(row.sent_at)
    }))
  };
}

export type EndContactOutcome =
  | { outcome: "ended"; withdrawn: Purpose[]; cancelled: number }
  | { outcome: "already_ended" }
  | { outcome: "not_found" };

/**
 * Ends a contact (data-subject request or controller decision, T-D1): withdraws
 * every purpose, cancels queued messages, and in ONE statement erases the chat
 * ciphertext and the masked label and replaces the keyed hash with a random
 * value, so the row can no longer be found from the person's Telegram id. The
 * consent evidence stays for its proof window (ADR-0152 section 6.4).
 */
export async function endContact(
  tx: Bun.SQL,
  tenantId: string,
  contactId: string,
  actor: string | null,
  correlationId: string | null,
  now: Date = new Date()
): Promise<EndContactOutcome> {
  const contact = await fetchContact(tx, tenantId, contactId, { lock: true });

  if (!contact) return { outcome: "not_found" };

  if (contact.state === "ended") return { outcome: "already_ended" };

  const result = await withdrawAllPurposes(tx, tenantId, {
    accountId: contact.account_id,
    contactId,
    method: "operator_withdrawal",
    updateId: null,
    occurredAt: now,
    recordedBy: actor,
    correlationId
  });

  await tx`
    UPDATE awcms_telegram_engagement_contacts
    SET state = 'ended', ended_at = ${now}, chat_ciphertext = NULL,
        masked_label = NULL, contact_hash = ${erasedContactHash()},
        version = version + 1, updated_at = now()
    WHERE tenant_id = ${tenantId} AND id = ${contactId}
  `;

  return { outcome: "ended", ...result };
}
