/**
 * Enqueue side of the WhatsApp queue and the `WhatsappDeliveryPort` adapter
 * (Issue #963, ADR-0133 section 8).
 *
 * Takes the CALLER's open transaction, so the message is committed with the
 * fact that produced it (a rolled-back booking sends no reminder). Nothing here
 * touches a provider and nothing here can: sending is `whatsapp-dispatch.ts`,
 * outside any transaction.
 *
 * Refusals are RETURNED, not thrown, so a booking is never rolled back because
 * a reminder could not be queued. A programming error (an empty idempotency
 * key) IS thrown: no honest result exists for it.
 *
 * ## Order of the checks, and why
 *
 * 1. disabled flag, 2. template, 3. expiry rule, 4. recipient, 5. idempotent
 *    replay, 6. suppression/consent, 7. rate limits, 8. INSERT.
 *
 * The replay check precedes eligibility on purpose: a retried enqueue whose
 * original already queued must answer `duplicate`, not "now suppressed". A
 * message that exists is never contradicted by state that changed afterwards.
 */
import { log } from "../../../lib/logging/logger";
import type {
  EnqueueWhatsappInput,
  EnqueueWhatsappResult,
  WhatsappDeliveryPort,
  WhatsappStatus,
  WhatsappTenantTx
} from "../../_shared/ports/whatsapp-delivery-port";
import {
  isWhatsappEnabled,
  resolveWhatsappDefaultCountryCode,
  resolveWhatsappRatePerRecipientPerHour,
  resolveWhatsappRatePerTenantPerHour,
  resolveWhatsappRateSecurityPerRecipientPerHour
} from "../domain/whatsapp-config";
import { decideEligibility } from "../domain/whatsapp-eligibility";
import { WHATSAPP_MESSAGE_QUEUED_EVENT_TYPE } from "../domain/whatsapp-events";
import {
  buildRecipientHashes,
  hashListParam,
  maskRecipient,
  normalizePhoneNumber,
  parseRecipientHashKeys,
  type RecipientHashes
} from "../domain/whatsapp-recipient";
import {
  getWhatsappTemplate,
  renderWhatsappTemplate
} from "../domain/whatsapp-templates";
import { readEligibilityFacts } from "./whatsapp-consent-directory";
import { emitWhatsappMessageEvent } from "./whatsapp-event-emit";

const MODULE_KEY = "whatsapp_delivery";

export type EnqueueWhatsappOptions = {
  env?: NodeJS.ProcessEnv;
  now?: Date;
};

type ResolvedRecipient =
  | { ok: true; e164: string; profileId: string | null }
  | { ok: false; reason: "RECIPIENT_INVALID" | "RECIPIENT_UNRESOLVED" };

async function resolveRecipient(
  tx: Bun.SQL,
  input: EnqueueWhatsappInput,
  env: NodeJS.ProcessEnv
): Promise<ResolvedRecipient> {
  const defaultCountryCode = resolveWhatsappDefaultCountryCode(env);

  if (input.recipient.kind === "address") {
    const phone = normalizePhoneNumber(
      input.recipient.phone,
      defaultCountryCode
    );

    return phone.valid
      ? { ok: true, e164: phone.e164, profileId: null }
      : { ok: false, reason: "RECIPIENT_INVALID" };
  }

  const profileId = input.recipient.profileId;
  const rows = (await tx`
    SELECT normalized_value
    FROM awcms_profile_identifiers
    WHERE tenant_id = ${input.tenantId} AND profile_id = ${profileId}
      AND identifier_type IN ('whatsapp', 'phone') AND deleted_at IS NULL
    ORDER BY (identifier_type = 'whatsapp') DESC, is_primary DESC, created_at
    LIMIT 1
  `) as { normalized_value: string }[];

  if (!rows[0]) {
    return { ok: false, reason: "RECIPIENT_UNRESOLVED" };
  }

  const phone = normalizePhoneNumber(
    rows[0].normalized_value,
    defaultCountryCode
  );

  return phone.valid
    ? { ok: true, e164: phone.e164, profileId }
    : { ok: false, reason: "RECIPIENT_UNRESOLVED" };
}

async function findByIdempotencyKey(
  tx: Bun.SQL,
  tenantId: string,
  idempotencyKey: string
): Promise<string | null> {
  const rows = (await tx`
    SELECT id FROM awcms_whatsapp_messages
    WHERE tenant_id = ${tenantId} AND idempotency_key = ${idempotencyKey}
  `) as { id: string }[];

  return rows[0]?.id ?? null;
}

/**
 * Bounded counts over the trailing hour: each subquery stops at the limit, so
 * the check costs at most `limit` index rows however busy the tenant is. The
 * count is racy under concurrency (two enqueues can both pass at limit - 1);
 * the limit is a cost and abuse control, not an exact quota.
 */
async function isRateLimited(
  tx: Bun.SQL,
  tenantId: string,
  hashes: RecipientHashes,
  purpose: string,
  env: NodeJS.ProcessEnv
): Promise<boolean> {
  const security = purpose === "security";
  // Two buckets per recipient: `security` (OTP) and everything else count
  // separately, each against its own limit.
  const perRecipient = security
    ? resolveWhatsappRateSecurityPerRecipientPerHour(env)
    : resolveWhatsappRatePerRecipientPerHour(env);
  const perTenant = resolveWhatsappRatePerTenantPerHour(env);
  const list = hashListParam(hashes);

  const rows = (await tx`
    SELECT
      (SELECT count(*) FROM (
        SELECT 1 FROM awcms_whatsapp_messages
        WHERE tenant_id = ${tenantId}
          AND recipient_hash = ANY(string_to_array(${list}, ','))
          AND (purpose = 'security') = ${security}
          AND created_at > now() - interval '1 hour'
        LIMIT ${perRecipient}) r) AS recipient_count,
      (SELECT count(*) FROM (
        SELECT 1 FROM awcms_whatsapp_messages
        WHERE tenant_id = ${tenantId}
          AND created_at > now() - interval '1 hour'
        LIMIT ${perTenant}) t) AS tenant_count
  `) as { recipient_count: string | number; tenant_count: string | number }[];

  return (
    Number(rows[0]?.recipient_count ?? 0) >= perRecipient ||
    Number(rows[0]?.tenant_count ?? 0) >= perTenant
  );
}

export async function enqueueWhatsappMessage(
  tx: WhatsappTenantTx,
  input: EnqueueWhatsappInput,
  options: EnqueueWhatsappOptions = {}
): Promise<EnqueueWhatsappResult> {
  if (!input.idempotencyKey || input.idempotencyKey.length > 200) {
    throw new TypeError(
      "enqueueWhatsappMessage requires an idempotencyKey of 1..200 characters."
    );
  }

  const env = options.env ?? process.env;
  const now = options.now ?? new Date();

  if (!isWhatsappEnabled(env)) {
    // Nothing is written: a disabled deployment must not accumulate rows that
    // nothing will ever claim.
    return { status: "refused", reason: "DISABLED" };
  }

  // Fail closed: without a usable key ring there is no safe way to look a
  // recipient up in the consent and suppression stores, so nothing is queued.
  const ring = parseRecipientHashKeys(env);

  if (!ring.ok) {
    return { status: "refused", reason: "MISCONFIGURED" };
  }

  const template = getWhatsappTemplate(input.templateKey);

  if (!template) {
    return { status: "refused", reason: "TEMPLATE_UNKNOWN" };
  }

  if (template.purpose === "security" && !input.expiresAt) {
    return { status: "refused", reason: "EXPIRY_REQUIRED" };
  }

  const recipient = await resolveRecipient(tx, input, env);

  if (!recipient.ok) {
    return { status: "refused", reason: recipient.reason };
  }

  const existing = await findByIdempotencyKey(
    tx,
    input.tenantId,
    input.idempotencyKey
  );

  if (existing) {
    return { status: "duplicate", messageId: existing };
  }

  const hashes = buildRecipientHashes(input.tenantId, recipient.e164, ring);
  const recipientMasked = maskRecipient(recipient.e164);

  const decision = decideEligibility(
    template.purpose,
    await readEligibilityFacts(tx, input.tenantId, hashes)
  );

  if (!decision.eligible) {
    return decision.kind === "consent_required"
      ? { status: "refused", reason: "CONSENT_REQUIRED" }
      : { status: "suppressed", reason: decision.reason };
  }

  if (await isRateLimited(tx, input.tenantId, hashes, template.purpose, env)) {
    return { status: "refused", reason: "RATE_LIMITED" };
  }

  const rendered = renderWhatsappTemplate(template, input.variables);
  const dueAt = input.notBefore ?? now;

  const inserted = (await tx`
    INSERT INTO awcms_whatsapp_messages
      (tenant_id, idempotency_key, correlation_id, template_key,
       template_version, purpose, recipient, recipient_hash, recipient_masked,
       profile_id, variables, body, contains_secret, status, not_before,
       expires_at, next_attempt_at, created_by)
    VALUES (
      ${input.tenantId}, ${input.idempotencyKey}, ${input.correlationId ?? null},
      ${template.key}, ${template.version}, ${template.purpose},
      ${recipient.e164}, ${hashes.primary}, ${recipientMasked},
      ${recipient.profileId}, ${rendered.variables}::jsonb, ${rendered.body},
      ${rendered.containsSecret}, 'queued', ${input.notBefore ?? null},
      ${input.expiresAt ?? null}, ${dueAt}, ${input.createdBy ?? null}
    )
    ON CONFLICT ON CONSTRAINT awcms_whatsapp_messages_idempotency_unique
    DO NOTHING
    RETURNING id
  `) as { id: string }[];

  if (inserted.length === 0) {
    // Lost a race to a concurrent enqueue of the same key: that one is the
    // message, and this call is its replay.
    const winner = await findByIdempotencyKey(
      tx,
      input.tenantId,
      input.idempotencyKey
    );

    if (winner) {
      return { status: "duplicate", messageId: winner };
    }

    throw new Error("WhatsApp enqueue conflicted but found no existing row.");
  }

  const messageId = inserted[0]!.id;

  await emitWhatsappMessageEvent(
    tx,
    input.tenantId,
    WHATSAPP_MESSAGE_QUEUED_EVENT_TYPE,
    {
      messageId,
      templateKey: template.key,
      purpose: template.purpose,
      recipientMasked,
      status: "queued",
      correlationId: input.correlationId ?? null,
      actorTenantUserId: input.createdBy ?? null
    }
  );

  log("info", "whatsapp.enqueue.queued", {
    tenantId: input.tenantId,
    moduleKey: MODULE_KEY,
    correlationId: input.correlationId,
    templateKey: template.key,
    purpose: template.purpose,
    recipient: recipientMasked,
    droppedVariableCount: rendered.droppedVariables.length
  });

  return { status: "queued", messageId };
}

type StatusRow = {
  id: string;
  template_key: string;
  purpose: WhatsappStatus["purpose"];
  status: WhatsappStatus["status"];
  recipient_masked: string;
  failure_code: string | null;
  sent_at: Date | string | null;
  created_at: Date | string;
};

const iso = (value: Date | string): string =>
  value instanceof Date ? value.toISOString() : new Date(value).toISOString();

export async function getWhatsappStatusByCorrelation(
  tx: Bun.SQL,
  tenantId: string,
  correlationId: string
): Promise<WhatsappStatus[]> {
  const rows = (await tx`
    SELECT id, template_key, purpose, status, recipient_masked, failure_code,
           sent_at, created_at
    FROM awcms_whatsapp_messages
    WHERE tenant_id = ${tenantId} AND correlation_id = ${correlationId}
    ORDER BY created_at, id
    LIMIT 200
  `) as StatusRow[];

  return rows.map((row) => ({
    messageId: row.id,
    templateKey: row.template_key,
    purpose: row.purpose,
    status: row.status,
    recipientMasked: row.recipient_masked,
    failureCode: row.failure_code,
    sentAt: row.sent_at ? iso(row.sent_at) : null,
    createdAt: iso(row.created_at)
  }));
}

/**
 * Cancels still-waiting messages for a correlation id. Refuses `sending`
 * (already in a provider call), so it is a no-op once sent — as the port
 * promises. Secrets are cleared with the cancel.
 */
export async function cancelWhatsappByCorrelation(
  tx: Bun.SQL,
  tenantId: string,
  correlationId: string
): Promise<number> {
  const rows = (await tx`
    UPDATE awcms_whatsapp_messages
    SET status = 'cancelled', next_attempt_at = NULL,
        failure_code = 'cancelled',
        body = CASE WHEN contains_secret THEN '' ELSE body END,
        variables = CASE WHEN contains_secret THEN '{}'::jsonb ELSE variables END,
        updated_at = now()
    WHERE tenant_id = ${tenantId} AND correlation_id = ${correlationId}
      AND status IN ('queued', 'retry_wait')
    RETURNING id
  `) as { id: string }[];

  return rows.length;
}

/** Cancels one message by id (the operator action). Same rules as the correlation form. */
export async function cancelWhatsappMessage(
  tx: Bun.SQL,
  tenantId: string,
  messageId: string
): Promise<{ cancelled: boolean }> {
  const rows = (await tx`
    UPDATE awcms_whatsapp_messages
    SET status = 'cancelled', next_attempt_at = NULL,
        failure_code = 'cancelled',
        body = CASE WHEN contains_secret THEN '' ELSE body END,
        variables = CASE WHEN contains_secret THEN '{}'::jsonb ELSE variables END,
        updated_at = now()
    WHERE tenant_id = ${tenantId} AND id = ${messageId}
      AND status IN ('queued', 'retry_wait')
    RETURNING id
  `) as { id: string }[];

  return { cancelled: rows.length > 0 };
}

/** The adapter the composition root hands to consumers (ADR-0011). */
export const whatsappDeliveryPortAdapter: WhatsappDeliveryPort = {
  enqueue: (tx, input) => enqueueWhatsappMessage(tx, input),
  getStatusByCorrelation: getWhatsappStatusByCorrelation,
  cancelByCorrelation: cancelWhatsappByCorrelation
};
