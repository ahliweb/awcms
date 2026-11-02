/**
 * Admin reads and the withdrawal of website submissions (ADR-0155 sections 5
 * and 8). Every function takes the caller's OWN tenant-scoped transaction.
 *
 * ## Masked by default, decrypted only on purpose
 *
 * `listSubmissions` and `fetchSubmission` return MASKED projections only
 * (`emailMasked`, `phoneMasked`); no path in them touches the ciphertext.
 * `revealSubmission` is the single function that decrypts, behind its own
 * permission, and its caller audits it.
 */
import {
  decryptFieldToString,
  FieldEncryptionError,
  type KeyRing
} from "../../../lib/security/field-encryption";
import { appendDomainEvent } from "../../domain-event-runtime/application/append-domain-event";
import { buildSubmissionWithdrawnPayload } from "../domain/engagement-events";
import type { ListSubmissionsQuery } from "../domain/source-validation";
import {
  SUBMISSION_CONTACT_AAD_PURPOSE,
  WEBSITE_ENGAGEMENT_EVENT_VERSION,
  WEBSITE_ENGAGEMENT_MODULE_KEY,
  WEBSITE_ENGAGEMENT_SUBMISSION_AGGREGATE_TYPE,
  WEBSITE_ENGAGEMENT_SUBMISSION_WITHDRAWN_EVENT_TYPE,
  type ChallengeOutcome,
  type ConsentPurpose,
  type InteractionType,
  type SubmissionKind,
  type SubmissionPrivacyClass,
  type SubmissionStatus,
  type WithdrawalReason
} from "../domain/website-engagement-constants";

type Sql = Bun.SQL;

export type SubmissionView = {
  id: string;
  sourceId: string;
  sourceCode: string;
  kind: SubmissionKind;
  interactionType: InteractionType | null;
  topic: string | null;
  locale: string | null;
  status: SubmissionStatus;
  privacyClass: SubmissionPrivacyClass;
  occurredAt: string;
  receivedAt: string;
  emailMasked: string | null;
  phoneMasked: string | null;
  consent: {
    purposes: ConsentPurpose[];
    copyVersion: string | null;
    pagePath: string | null;
    consentAt: string | null;
  };
  attribution: {
    landingPath: string | null;
    referrerHost: string | null;
    utmSource: string | null;
    utmMedium: string | null;
    utmCampaign: string | null;
    utmTerm: string | null;
    utmContent: string | null;
  };
  provenance: {
    originHost: string;
    originVia: "origin" | "referer";
    challenge: ChallengeOutcome;
  };
  withdrawnAt: string | null;
  withdrawalReason: WithdrawalReason | null;
};

type SubmissionRow = {
  id: string;
  source_id: string;
  source_code: string;
  kind: SubmissionKind;
  interaction_type: InteractionType | null;
  topic: string | null;
  locale: string | null;
  status: SubmissionStatus;
  privacy_class: SubmissionPrivacyClass;
  occurred_at: Date;
  received_at: Date;
  email_masked: string | null;
  phone_masked: string | null;
  consent_purposes: ConsentPurpose[];
  consent_copy_version: string | null;
  consent_page_path: string | null;
  consent_at: Date | null;
  landing_path: string | null;
  referrer_host: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_term: string | null;
  utm_content: string | null;
  origin_host: string;
  origin_via: "origin" | "referer";
  challenge_outcome: ChallengeOutcome;
  withdrawn_at: Date | null;
  withdrawal_reason: WithdrawalReason | null;
};

function toView(row: SubmissionRow): SubmissionView {
  return {
    id: row.id,
    sourceId: row.source_id,
    sourceCode: row.source_code,
    kind: row.kind,
    interactionType: row.interaction_type,
    topic: row.topic,
    locale: row.locale,
    status: row.status,
    privacyClass: row.privacy_class,
    occurredAt: row.occurred_at.toISOString(),
    receivedAt: row.received_at.toISOString(),
    emailMasked: row.email_masked,
    phoneMasked: row.phone_masked,
    consent: {
      purposes: row.consent_purposes,
      copyVersion: row.consent_copy_version,
      pagePath: row.consent_page_path,
      consentAt: row.consent_at?.toISOString() ?? null
    },
    attribution: {
      landingPath: row.landing_path,
      referrerHost: row.referrer_host,
      utmSource: row.utm_source,
      utmMedium: row.utm_medium,
      utmCampaign: row.utm_campaign,
      utmTerm: row.utm_term,
      utmContent: row.utm_content
    },
    provenance: {
      originHost: row.origin_host,
      originVia: row.origin_via,
      challenge: row.challenge_outcome
    },
    withdrawnAt: row.withdrawn_at?.toISOString() ?? null,
    withdrawalReason: row.withdrawal_reason
  };
}

/** `(received_at, id)` keyset cursor, opaque to the caller. */
function encodeCursor(row: { received_at: Date; id: string }): string {
  return Buffer.from(
    JSON.stringify({ t: row.received_at.toISOString(), id: row.id })
  ).toString("base64url");
}

function decodeCursor(cursor: string): { t: Date; id: string } | null {
  try {
    const parsed = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8")
    );
    const t = new Date(parsed?.t);

    if (
      typeof parsed?.id !== "string" ||
      !/^[0-9a-f-]{36}$/i.test(parsed.id) ||
      Number.isNaN(t.getTime())
    ) {
      return null;
    }

    return { t, id: parsed.id };
  } catch {
    return null;
  }
}

export async function listSubmissions(
  tx: Sql,
  tenantId: string,
  query: ListSubmissionsQuery
): Promise<
  | { ok: true; items: SubmissionView[]; nextCursor: string | null }
  | { ok: false }
> {
  const cursor = query.cursor ? decodeCursor(query.cursor) : null;

  if (query.cursor && !cursor) return { ok: false };

  const rows = (await tx`
    SELECT s.id, s.source_id, src.code AS source_code, s.kind, s.interaction_type,
           s.topic, s.locale, s.status, s.privacy_class, s.occurred_at,
           s.received_at, s.email_masked, s.phone_masked, s.consent_purposes,
           s.consent_copy_version, s.consent_page_path, s.consent_at,
           s.landing_path, s.referrer_host, s.utm_source, s.utm_medium,
           s.utm_campaign, s.utm_term, s.utm_content, s.origin_host,
           s.origin_via, s.challenge_outcome, s.withdrawn_at, s.withdrawal_reason
    FROM awcms_engagement_submissions s
    JOIN awcms_engagement_sources src
      ON src.tenant_id = s.tenant_id AND src.id = s.source_id
    WHERE s.tenant_id = ${tenantId}
      AND (${query.sourceId}::uuid IS NULL OR s.source_id = ${query.sourceId}::uuid)
      AND (${query.kind}::text IS NULL OR s.kind = ${query.kind}::text)
      AND (${query.status}::text IS NULL OR s.status = ${query.status}::text)
      AND (${cursor?.t ?? null}::timestamptz IS NULL
           OR (s.received_at, s.id) < (${cursor?.t ?? null}::timestamptz, ${cursor?.id ?? null}::uuid))
    ORDER BY s.received_at DESC, s.id DESC
    LIMIT ${query.limit + 1}
  `) as SubmissionRow[];

  const page = rows.slice(0, query.limit);
  const last = page[page.length - 1];

  return {
    ok: true,
    items: page.map(toView),
    nextCursor: rows.length > query.limit && last ? encodeCursor(last) : null
  };
}

export async function fetchSubmission(
  tx: Sql,
  tenantId: string,
  submissionId: string
): Promise<SubmissionView | null> {
  const rows = (await tx`
    SELECT s.id, s.source_id, src.code AS source_code, s.kind, s.interaction_type,
           s.topic, s.locale, s.status, s.privacy_class, s.occurred_at,
           s.received_at, s.email_masked, s.phone_masked, s.consent_purposes,
           s.consent_copy_version, s.consent_page_path, s.consent_at,
           s.landing_path, s.referrer_host, s.utm_source, s.utm_medium,
           s.utm_campaign, s.utm_term, s.utm_content, s.origin_host,
           s.origin_via, s.challenge_outcome, s.withdrawn_at, s.withdrawal_reason
    FROM awcms_engagement_submissions s
    JOIN awcms_engagement_sources src
      ON src.tenant_id = s.tenant_id AND src.id = s.source_id
    WHERE s.tenant_id = ${tenantId} AND s.id = ${submissionId}
  `) as SubmissionRow[];

  return rows[0] ? toView(rows[0]) : null;
}

export type RevealedContact = {
  name: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
  subject: string | null;
  message: string | null;
};

/**
 * Decrypts a submission's contact blob. `null` for an unknown id AND for a
 * submission that holds none (an interaction); a ciphertext that cannot be
 * decrypted (wrong ring, tampering, a row copied elsewhere) is a thrown
 * `FieldEncryptionError`, never an empty value.
 */
export async function revealSubmission(
  tx: Sql,
  tenantId: string,
  submissionId: string,
  ring: KeyRing
): Promise<RevealedContact | null> {
  const rows = (await tx`
    SELECT contact_encrypted
    FROM awcms_engagement_submissions
    WHERE tenant_id = ${tenantId} AND id = ${submissionId}
  `) as { contact_encrypted: string | null }[];
  const envelope = rows[0]?.contact_encrypted;

  if (!envelope) return null;

  const plain = decryptFieldToString(
    envelope,
    {
      purpose: SUBMISSION_CONTACT_AAD_PURPOSE,
      tenantId,
      rowId: submissionId
    },
    ring
  );

  try {
    const parsed = JSON.parse(plain) as Partial<RevealedContact>;

    return {
      name: parsed.name ?? null,
      email: parsed.email ?? null,
      phone: parsed.phone ?? null,
      company: parsed.company ?? null,
      subject: parsed.subject ?? null,
      message: parsed.message ?? null
    };
  } catch {
    throw new FieldEncryptionError(
      "MALFORMED_ENVELOPE",
      "Unrecognized field ciphertext format."
    );
  }
}

export type WithdrawResult =
  | { outcome: "withdrawn"; submission: SubmissionView }
  | { outcome: "already_withdrawn"; submission: SubmissionView }
  | { outcome: "not_found" };

/**
 * One-way, and idempotent: withdrawing a withdrawn submission answers the same
 * and publishes nothing. The `UPDATE ... WHERE status = 'received'` is the
 * decision, so two concurrent withdrawals emit exactly one event.
 */
export async function withdrawSubmission(
  tx: Sql,
  tenantId: string,
  actor: string,
  submissionId: string,
  reason: WithdrawalReason,
  correlationId: string | undefined,
  now: Date = new Date()
): Promise<WithdrawResult> {
  const updated = (await tx`
    UPDATE awcms_engagement_submissions
    SET status = 'withdrawn', withdrawn_at = ${now},
        withdrawal_reason = ${reason}, withdrawn_by = ${actor}
    WHERE tenant_id = ${tenantId} AND id = ${submissionId} AND status = 'received'
    RETURNING id, source_id, privacy_class
  `) as {
    id: string;
    source_id: string;
    privacy_class: SubmissionPrivacyClass;
  }[];

  const current = await fetchSubmission(tx, tenantId, submissionId);

  if (!current) return { outcome: "not_found" };

  const changed = updated[0];

  if (!changed) return { outcome: "already_withdrawn", submission: current };

  await appendDomainEvent(tx, tenantId, {
    eventType: WEBSITE_ENGAGEMENT_SUBMISSION_WITHDRAWN_EVENT_TYPE,
    eventVersion: WEBSITE_ENGAGEMENT_EVENT_VERSION,
    aggregateType: WEBSITE_ENGAGEMENT_SUBMISSION_AGGREGATE_TYPE,
    aggregateId: submissionId,
    producerModule: WEBSITE_ENGAGEMENT_MODULE_KEY,
    correlationId: correlationId ?? null,
    actorTenantUserId: actor,
    payload: buildSubmissionWithdrawnPayload({
      submissionId,
      sourceId: changed.source_id,
      sourceCode: current.sourceCode,
      reason,
      withdrawnAt: now,
      privacyClass: changed.privacy_class
    }),
    occurredAt: now
  });

  return { outcome: "withdrawn", submission: current };
}
