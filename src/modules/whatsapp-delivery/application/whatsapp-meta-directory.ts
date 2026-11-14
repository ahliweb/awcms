/**
 * Meta Cloud API state of `whatsapp_delivery` (Issue #1143): template approvals
 * per WABA, 24-hour service windows, WABA restriction and messaging-limit
 * signals, and the application of a VERIFIED Meta webhook.
 *
 * Approvals and signals are keyed by the WABA id (Meta's id, the `external_id`
 * of the `waba` container account), never by the container's record id, so
 * deleting and re-registering a container neither loses nor resets them
 * (security review L-3).
 *
 * Runs as `awcms_app` (enqueue, the routes, the webhook) and, for the READS
 * only, as `awcms_worker` (the dispatcher re-checks immediately before each
 * send). Every query is `WHERE tenant_id = $1` inside a tenant-scoped
 * transaction under FORCE RLS.
 */
import type { VerifiedMetaWebhookBinding } from "../../_shared/ports/channel-account-port";
import type { WhatsappPurpose } from "../../_shared/ports/whatsapp-delivery-port";
import { appendDomainEvent } from "../../domain-event-runtime/application/append-domain-event";
import { recordAuditEvent } from "../../logging/application/audit-log";
import {
  decideMetaSend,
  isMetaTemplateSendable,
  isServiceWindowOpen,
  nextProviderStatus,
  templateChangeWins,
  type MetaDeliveryStatus,
  type MetaMessagingLimitTier,
  type MetaRestrictionReason,
  type MetaSendDecision,
  type MetaTemplateCategory,
  type MetaTemplateStatus,
  type MetaWebhookAction,
  META_DELIVERY_STATUS_RANK
} from "../domain/meta-cloud-policy";
import {
  WHATSAPP_EVENT_VERSION,
  WHATSAPP_MESSAGE_AGGREGATE_TYPE,
  WHATSAPP_MESSAGE_PROVIDER_STATUS_CHANGED_EVENT_TYPE,
  WHATSAPP_MODULE_KEY
} from "../domain/whatsapp-events";
import {
  buildRecipientHashes,
  hashListParam,
  type RecipientHashes,
  type RecipientKeyRing
} from "../domain/whatsapp-recipient";

const iso = (value: Date | string): string =>
  value instanceof Date ? value.toISOString() : new Date(value).toISOString();

/** Most rows a list returns; one more is read to say `truncated` instead of silently cutting (security review L-6). */
export const META_LIST_LIMIT = 500;

// ---------------------------------------------------------------------------
// Reads used at enqueue AND at dispatch
// ---------------------------------------------------------------------------

export async function readMetaTemplateApproval(
  tx: Bun.SQL,
  tenantId: string,
  wabaId: string,
  name: string,
  language: string
): Promise<{
  status: MetaTemplateStatus;
  category: MetaTemplateCategory;
} | null> {
  const rows = (await tx`
    SELECT provider_status, category
    FROM awcms_whatsapp_meta_templates
    WHERE tenant_id = ${tenantId}
      AND waba_external_id = ${wabaId}
      AND template_name = ${name} AND language = ${language}
  `) as {
    provider_status: MetaTemplateStatus;
    category: MetaTemplateCategory;
  }[];

  return rows[0]
    ? { status: rows[0].provider_status, category: rows[0].category }
    : null;
}

/** The latest verified inbound time of this recipient to THIS sender, under any ring key. */
export async function readServiceWindow(
  tx: Bun.SQL,
  tenantId: string,
  senderAccountId: string,
  hashes: RecipientHashes
): Promise<Date | null> {
  const rows = (await tx`
    SELECT max(last_inbound_at) AS last_inbound_at
    FROM awcms_whatsapp_service_windows
    WHERE tenant_id = ${tenantId} AND sender_account_id = ${senderAccountId}
      AND recipient_hash = ANY(string_to_array(${hashListParam(hashes)}, ','))
  `) as { last_inbound_at: Date | string | null }[];
  const value = rows[0]?.last_inbound_at ?? null;

  return value === null ? null : new Date(value);
}

/** The WABA's current restriction, or `null` when it is not restricted. */
export async function readMetaRestriction(
  tx: Bun.SQL,
  tenantId: string,
  wabaId: string
): Promise<MetaRestrictionReason | null> {
  const rows = (await tx`
    SELECT restriction_reason
    FROM awcms_whatsapp_meta_sender_signals
    WHERE tenant_id = ${tenantId} AND waba_external_id = ${wabaId}
  `) as { restriction_reason: MetaRestrictionReason | null }[];

  return rows[0]?.restriction_reason ?? null;
}

/**
 * The whole Meta send rule for one message through one Meta sender: the
 * template's approval on THAT sender's WABA, or (for a registration without a
 * provider template) the window opened by this recipient writing to THAT
 * number. Read inside the caller's transaction.
 */
export async function decideMetaSendForMessage(
  tx: Bun.SQL,
  input: {
    tenantId: string;
    senderAccountId: string;
    wabaId: string;
    purpose: WhatsappPurpose;
    providerTemplate: { name: string; language: string } | undefined;
    hashes: RecipientHashes;
    now: Date;
  }
): Promise<MetaSendDecision> {
  if (input.providerTemplate) {
    return decideMetaSend({
      purpose: input.purpose,
      hasProviderTemplate: true,
      approval: await readMetaTemplateApproval(
        tx,
        input.tenantId,
        input.wabaId,
        input.providerTemplate.name,
        input.providerTemplate.language
      ),
      windowOpen: false
    });
  }

  return decideMetaSend({
    purpose: input.purpose,
    hasProviderTemplate: false,
    approval: null,
    windowOpen:
      input.purpose !== "marketing" &&
      isServiceWindowOpen(
        await readServiceWindow(
          tx,
          input.tenantId,
          input.senderAccountId,
          input.hashes
        ),
        input.now
      )
  });
}

// ---------------------------------------------------------------------------
// Operator surface
// ---------------------------------------------------------------------------

export type MetaTemplateView = {
  id: string;
  /** The live `waba` account of this WABA id (the API never returns the WABA id itself). */
  containerAccountId: string;
  name: string;
  language: string;
  category: MetaTemplateCategory;
  providerStatus: MetaTemplateStatus;
  source: "operator" | "webhook";
  hasEvidence: boolean;
  lastEventAt: string;
  updatedAt: string;
};

type TemplateRow = {
  id: string;
  container_account_id: string;
  template_name: string;
  language: string;
  category: MetaTemplateCategory;
  provider_status: MetaTemplateStatus;
  source: "operator" | "webhook";
  evidence_ref: string | null;
  last_event_at: Date | string;
  updated_at: Date | string;
};

function toTemplateView(row: TemplateRow): MetaTemplateView {
  return {
    id: row.id,
    containerAccountId: row.container_account_id,
    name: row.template_name,
    language: row.language,
    category: row.category,
    providerStatus: row.provider_status,
    source: row.source,
    hasEvidence: row.evidence_ref !== null,
    lastEventAt: iso(row.last_event_at),
    updatedAt: iso(row.updated_at)
  };
}

/**
 * Template rows of the WABAs that have a LIVE container account of this tenant
 * (a row whose container is gone is not listed: there is no account to decide
 * visibility against). `truncated` says there were more than {@link META_LIST_LIMIT}.
 */
export async function listMetaTemplates(
  tx: Bun.SQL,
  tenantId: string
): Promise<{ items: MetaTemplateView[]; truncated: boolean }> {
  const rows = (await tx`
    SELECT t.id, a.id AS container_account_id, t.template_name, t.language,
           t.category, t.provider_status, t.source, t.evidence_ref,
           t.last_event_at, t.updated_at
    FROM awcms_whatsapp_meta_templates t
    JOIN awcms_channel_accounts a
      ON a.tenant_id = t.tenant_id AND a.external_id = t.waba_external_id
     AND a.provider = 'whatsapp_cloud' AND a.account_kind = 'waba'
     AND a.deleted_at IS NULL
    WHERE t.tenant_id = ${tenantId}
    ORDER BY a.id, t.template_name, t.language
    LIMIT ${META_LIST_LIMIT + 1}
  `) as TemplateRow[];

  return {
    items: rows.slice(0, META_LIST_LIMIT).map(toTemplateView),
    truncated: rows.length > META_LIST_LIMIT
  };
}

export type MetaSignalView = {
  containerAccountId: string;
  restrictionReason: MetaRestrictionReason | null;
  restrictedAt: string | null;
  messagingLimitTier: MetaMessagingLimitTier | null;
  updatedAt: string;
};

export async function listMetaSignals(
  tx: Bun.SQL,
  tenantId: string
): Promise<{ items: MetaSignalView[]; truncated: boolean }> {
  const rows = (await tx`
    SELECT a.id AS container_account_id, s.restriction_reason, s.restricted_at,
           s.messaging_limit_tier, s.updated_at
    FROM awcms_whatsapp_meta_sender_signals s
    JOIN awcms_channel_accounts a
      ON a.tenant_id = s.tenant_id AND a.external_id = s.waba_external_id
     AND a.provider = 'whatsapp_cloud' AND a.account_kind = 'waba'
     AND a.deleted_at IS NULL
    WHERE s.tenant_id = ${tenantId}
    ORDER BY a.id
    LIMIT ${META_LIST_LIMIT + 1}
  `) as {
    container_account_id: string;
    restriction_reason: MetaRestrictionReason | null;
    restricted_at: Date | string | null;
    messaging_limit_tier: MetaMessagingLimitTier | null;
    updated_at: Date | string;
  }[];

  return {
    items: rows.slice(0, META_LIST_LIMIT).map((row) => ({
      containerAccountId: row.container_account_id,
      restrictionReason: row.restriction_reason,
      restrictedAt: row.restricted_at ? iso(row.restricted_at) : null,
      messagingLimitTier: row.messaging_limit_tier,
      updatedAt: iso(row.updated_at)
    })),
    truncated: rows.length > META_LIST_LIMIT
  };
}

/** The WABA id of a live `waba` container of THIS tenant, or `null` (another tenant's id and an unknown one are one answer). */
export async function resolveWabaExternalId(
  tx: Bun.SQL,
  tenantId: string,
  accountId: string
): Promise<string | null> {
  const rows = (await tx`
    SELECT external_id FROM awcms_channel_accounts
    WHERE tenant_id = ${tenantId} AND id = ${accountId}
      AND provider = 'whatsapp_cloud' AND account_kind = 'waba'
      AND deleted_at IS NULL
  `) as { external_id: string }[];

  return rows[0]?.external_id ?? null;
}

export type RecordMetaTemplateInput = {
  containerAccountId: string;
  name: string;
  language: string;
  category: MetaTemplateCategory;
  status: MetaTemplateStatus;
  evidenceRef: string | null;
};

export type RecordMetaTemplateOutcome =
  | {
      outcome: "recorded";
      template: MetaTemplateView;
      previousStatus: MetaTemplateStatus | null;
    }
  | { outcome: "container_not_found" };

/**
 * An operator records what Meta shows for a template on one WABA. The write is
 * stamped with the statement time; a later signed webhook (newer `entry.time`)
 * overrides it, an older one does not.
 */
export async function recordMetaTemplate(
  tx: Bun.SQL,
  tenantId: string,
  actor: string,
  input: RecordMetaTemplateInput
): Promise<RecordMetaTemplateOutcome> {
  const wabaId = await resolveWabaExternalId(
    tx,
    tenantId,
    input.containerAccountId
  );

  if (!wabaId) return { outcome: "container_not_found" };

  const previous = (await tx`
    SELECT provider_status FROM awcms_whatsapp_meta_templates
    WHERE tenant_id = ${tenantId} AND waba_external_id = ${wabaId}
      AND template_name = ${input.name} AND language = ${input.language}
    FOR UPDATE
  `) as { provider_status: MetaTemplateStatus }[];

  const rows = (await tx`
    INSERT INTO awcms_whatsapp_meta_templates
      (tenant_id, waba_external_id, template_name, language, category,
       provider_status, evidence_ref, source, last_event_at, updated_by)
    VALUES (${tenantId}, ${wabaId}, ${input.name},
            ${input.language}, ${input.category}, ${input.status},
            ${input.evidenceRef}, 'operator', clock_timestamp(), ${actor})
    ON CONFLICT ON CONSTRAINT awcms_whatsapp_meta_templates_identity_key
    DO UPDATE SET category = EXCLUDED.category,
                  provider_status = EXCLUDED.provider_status,
                  evidence_ref = EXCLUDED.evidence_ref,
                  source = 'operator',
                  last_event_at = GREATEST(
                    awcms_whatsapp_meta_templates.last_event_at,
                    EXCLUDED.last_event_at),
                  updated_by = EXCLUDED.updated_by,
                  updated_at = now()
    RETURNING id, ${input.containerAccountId}::uuid AS container_account_id,
              template_name, language, category, provider_status, source,
              evidence_ref, last_event_at, updated_at
  `) as TemplateRow[];

  return {
    outcome: "recorded",
    template: toTemplateView(rows[0]!),
    previousStatus: previous[0]?.provider_status ?? null
  };
}

export type ClearRestrictionOutcome =
  | { outcome: "cleared"; previousReason: MetaRestrictionReason }
  | { outcome: "not_restricted" };

export async function clearMetaRestriction(
  tx: Bun.SQL,
  tenantId: string,
  actor: string,
  wabaId: string
): Promise<ClearRestrictionOutcome> {
  const previous = (await tx`
    SELECT restriction_reason FROM awcms_whatsapp_meta_sender_signals
    WHERE tenant_id = ${tenantId} AND waba_external_id = ${wabaId}
      AND restriction_reason IS NOT NULL
    FOR UPDATE
  `) as { restriction_reason: MetaRestrictionReason }[];

  if (!previous[0]) return { outcome: "not_restricted" };

  await tx`
    UPDATE awcms_whatsapp_meta_sender_signals
    SET restriction_reason = NULL, restricted_at = NULL,
        -- #1298 L1: the clear moves the event clock STRICTLY past both the
        -- event that set the restriction and the moment of the clear, so the
        -- same (or any older) restrict event arriving later, through another
        -- subscription or another body, no longer re-restricts the WABA. Only
        -- an event Meta stamped after this clear can.
        restriction_event_at = GREATEST(
          restriction_event_at + interval '1 microsecond',
          clock_timestamp()),
        cleared_by = ${actor}, cleared_at = now(), updated_at = now()
    WHERE tenant_id = ${tenantId} AND waba_external_id = ${wabaId}
  `;

  return { outcome: "cleared", previousReason: previous[0].restriction_reason };
}

// ---------------------------------------------------------------------------
// The verified webhook
// ---------------------------------------------------------------------------

export type ApplyMetaWebhookResult = {
  duplicate: boolean;
  statusesApplied: number;
  /** Statuses whose provider message id is not a row of THIS sender (or whose recipient does not match): never applied anywhere else. */
  statusesUnmatched: number;
  windowsOpened: number;
  templatesUpdated: number;
  signalsUpdated: number;
};

/** Records the body hash; `false` when this exact body was already applied for the subscription (a replay or a provider retry). */
export async function recordWebhookReceipt(
  tx: Bun.SQL,
  tenantId: string,
  subscriptionId: string,
  payloadSha256: string
): Promise<boolean> {
  // #1298 L2: "seen" is per TENANT, not per subscription. Rotating a number's
  // webhook token mints a new subscription, and the app secret that signs the
  // body does not change, so a body captured before the rotation would apply
  // again under the new token if the receipt were keyed to the old one. The
  // lookup uses `awcms_whatsapp_webhook_receipts_tenant_payload_idx` (sql/393).
  const rows = (await tx`
    INSERT INTO awcms_whatsapp_webhook_receipts
      (tenant_id, subscription_id, payload_sha256)
    SELECT ${tenantId}, ${subscriptionId}, ${payloadSha256}
    WHERE NOT EXISTS (
      SELECT 1 FROM awcms_whatsapp_webhook_receipts
      WHERE tenant_id = ${tenantId} AND payload_sha256 = ${payloadSha256}
    )
    ON CONFLICT ON CONSTRAINT awcms_whatsapp_webhook_receipts_payload_key
    DO NOTHING
    RETURNING id
  `) as { id: string }[];

  return rows.length > 0;
}

type StatusTarget = {
  id: string;
  template_key: string;
  recipient_hash: string;
  provider_status: MetaDeliveryStatus | null;
  correlation_id: string | null;
};

/**
 * Audits a WABA-level change a signed webhook made (security review M-1 b): ids
 * and fixed codes only, never a number, a hash, provider text or a secret. No
 * person acted, so there is no actor; the subscription and the number it was
 * minted for say where it came from.
 */
async function auditWebhookChange(
  tx: Bun.SQL,
  tenantId: string,
  binding: VerifiedMetaWebhookBinding,
  input: {
    action: string;
    severity: "info" | "warning";
    message: string;
    attributes: Record<string, unknown>;
  }
): Promise<void> {
  await recordAuditEvent(tx, {
    tenantId,
    moduleKey: WHATSAPP_MODULE_KEY,
    action: input.action,
    resourceType: "channel_account",
    resourceId: binding.containerAccountId,
    severity: input.severity,
    message: input.message,
    attributes: {
      source: "meta_webhook",
      subscriptionId: binding.subscriptionId,
      senderAccountId: binding.accountId,
      ...input.attributes
    }
  });
}

/**
 * Applies the actions of a verified, deduplicated webhook. Tenant and binding
 * come from the callback token (`binding`), never from the payload; the parser
 * has already dropped everything naming another WABA or number.
 */
export async function applyMetaWebhookActions(
  tx: Bun.SQL,
  tenantId: string,
  binding: VerifiedMetaWebhookBinding,
  actions: readonly MetaWebhookAction[],
  ring: Extract<RecipientKeyRing, { ok: true }>,
  now: Date = new Date()
): Promise<Omit<ApplyMetaWebhookResult, "duplicate">> {
  const result = {
    statusesApplied: 0,
    statusesUnmatched: 0,
    windowsOpened: 0,
    templatesUpdated: 0,
    signalsUpdated: 0
  };

  for (const action of actions) {
    switch (action.kind) {
      case "status": {
        // Only a row this SENDER sent, under this provider message id. A
        // status naming another sender's message (even of the same tenant)
        // matches nothing.
        const rows = (await tx`
          SELECT id, template_key, recipient_hash, provider_status,
                 correlation_id
          FROM awcms_whatsapp_messages
          WHERE tenant_id = ${tenantId}
            AND sender_account_id = ${binding.accountId}
            AND provider_message_id = ${action.providerMessageId}
            AND status = 'sent'
          FOR UPDATE
        `) as StatusTarget[];
        const target = rows[0];

        if (!target) {
          result.statusesUnmatched += 1;
          break;
        }

        // When Meta names the recipient, it must be the row's own (under any
        // ring key): a mismatch is not this message.
        if (action.recipientDigits !== null) {
          const hashes = buildRecipientHashes(
            tenantId,
            `+${action.recipientDigits}`,
            ring
          );

          if (!hashes.all.includes(target.recipient_hash)) {
            result.statusesUnmatched += 1;
            break;
          }
        }

        const next = nextProviderStatus(target.provider_status, action.status);

        if (!next) break;

        const updated = (await tx`
          UPDATE awcms_whatsapp_messages
          SET provider_status = ${next},
              provider_status_rank = ${META_DELIVERY_STATUS_RANK[next]},
              provider_status_at = now(),
              provider_failure_code = ${next === "failed" ? action.failureCode : null},
              updated_at = now()
          WHERE tenant_id = ${tenantId} AND id = ${target.id}
            AND provider_status_rank < ${META_DELIVERY_STATUS_RANK[next]}
          RETURNING id
        `) as { id: string }[];

        if (updated.length === 0) break;

        result.statusesApplied += 1;

        await appendDomainEvent(tx, tenantId, {
          eventType: WHATSAPP_MESSAGE_PROVIDER_STATUS_CHANGED_EVENT_TYPE,
          eventVersion: WHATSAPP_EVENT_VERSION,
          aggregateType: WHATSAPP_MESSAGE_AGGREGATE_TYPE,
          aggregateId: target.id,
          correlationId: target.correlation_id,
          producerModule: WHATSAPP_MODULE_KEY,
          actorTenantUserId: null,
          payload: {
            messageId: target.id,
            templateKey: target.template_key,
            senderAccountId: binding.accountId,
            providerStatus: next,
            ...(next === "failed" && action.failureCode
              ? { failureCode: action.failureCode }
              : {})
          }
        });
        break;
      }

      case "inbound": {
        const hashes = buildRecipientHashes(
          tenantId,
          `+${action.fromDigits}`,
          ring
        );
        const before = await readServiceWindow(
          tx,
          tenantId,
          binding.accountId,
          hashes
        );

        await tx`
          INSERT INTO awcms_whatsapp_service_windows
            (tenant_id, sender_account_id, recipient_hash, last_inbound_at)
          VALUES (${tenantId}, ${binding.accountId}, ${hashes.primary},
                  ${action.at})
          ON CONFLICT (tenant_id, sender_account_id, recipient_hash)
          DO UPDATE SET last_inbound_at = GREATEST(
                          awcms_whatsapp_service_windows.last_inbound_at,
                          EXCLUDED.last_inbound_at),
                        updated_at = now()
        `;
        result.windowsOpened += 1;

        // A window that was CLOSED and is now open lets free text go out to
        // that person: audited. Extending an open window is not a new decision.
        if (
          !isServiceWindowOpen(before, now) &&
          isServiceWindowOpen(action.at, now)
        ) {
          await auditWebhookChange(tx, tenantId, binding, {
            action: "whatsapp_meta_webhook.window_opened",
            severity: "info",
            message:
              "A verified inbound message opened a 24-hour service window (content not stored).",
            attributes: {}
          });
        }

        break;
      }

      case "template": {
        const current = (await tx`
          SELECT provider_status, last_event_at
          FROM awcms_whatsapp_meta_templates
          WHERE tenant_id = ${tenantId}
            AND waba_external_id = ${binding.wabaId}
            AND template_name = ${action.name}
            AND language = ${action.language}
          FOR UPDATE
        `) as {
          provider_status: MetaTemplateStatus;
          last_event_at: Date | string;
        }[];

        if (
          !templateChangeWins({
            current: current[0]
              ? {
                  status: current[0].provider_status,
                  eventAt: new Date(current[0].last_event_at)
                }
              : null,
            incoming: { status: action.status, eventAt: action.eventAt }
          })
        ) {
          break;
        }

        await tx`
          INSERT INTO awcms_whatsapp_meta_templates
            (tenant_id, waba_external_id, template_name, language,
             category, provider_status, source, last_event_at)
          VALUES (${tenantId}, ${binding.wabaId}, ${action.name},
                  ${action.language}, ${action.category}, ${action.status},
                  'webhook', ${action.eventAt})
          ON CONFLICT ON CONSTRAINT awcms_whatsapp_meta_templates_identity_key
          DO UPDATE SET category = EXCLUDED.category,
                        provider_status = EXCLUDED.provider_status,
                        source = 'webhook',
                        evidence_ref = NULL,
                        last_event_at = EXCLUDED.last_event_at,
                        updated_by = NULL,
                        updated_at = now()
        `;
        result.templatesUpdated += 1;

        const previous = current[0]?.provider_status ?? null;

        await auditWebhookChange(tx, tenantId, binding, {
          action: "whatsapp_meta_webhook.template_status",
          severity:
            isMetaTemplateSendable(action.status) ||
            (previous !== null && isMetaTemplateSendable(previous))
              ? "warning"
              : "info",
          message:
            "A signed Meta webhook changed a template's status on a WABA.",
          attributes: {
            templateName: action.name,
            language: action.language,
            category: action.category,
            providerStatus: action.status,
            previousStatus: previous
          }
        });
        break;
      }

      case "limit": {
        await tx`
          INSERT INTO awcms_whatsapp_meta_sender_signals
            (tenant_id, waba_external_id, messaging_limit_tier, limit_event_at)
          VALUES (${tenantId}, ${binding.wabaId}, ${action.tier},
                  ${action.eventAt})
          ON CONFLICT (tenant_id, waba_external_id)
          DO UPDATE SET messaging_limit_tier = EXCLUDED.messaging_limit_tier,
                        limit_event_at = EXCLUDED.limit_event_at,
                        updated_at = now()
          WHERE awcms_whatsapp_meta_sender_signals.limit_event_at IS NULL
             OR awcms_whatsapp_meta_sender_signals.limit_event_at
                  <= EXCLUDED.limit_event_at
        `;
        result.signalsUpdated += 1;
        break;
      }

      case "account": {
        if (action.signal.kind === "restrict") {
          // A restriction applies unless a STRICTLY newer event already moved
          // the WABA; on a tie the restriction wins.
          const applied = (await tx`
            INSERT INTO awcms_whatsapp_meta_sender_signals
              (tenant_id, waba_external_id, restriction_reason,
               restricted_at, restriction_event_at)
            VALUES (${tenantId}, ${binding.wabaId},
                    ${action.signal.reason}, now(), ${action.eventAt})
            ON CONFLICT (tenant_id, waba_external_id)
            DO UPDATE SET restriction_reason = EXCLUDED.restriction_reason,
                          restricted_at = now(),
                          restriction_event_at = EXCLUDED.restriction_event_at,
                          updated_at = now()
            WHERE awcms_whatsapp_meta_sender_signals.restriction_event_at IS NULL
               OR awcms_whatsapp_meta_sender_signals.restriction_event_at
                    <= EXCLUDED.restriction_event_at
            RETURNING tenant_id
          `) as unknown[];

          if (applied.length > 0) {
            await auditWebhookChange(tx, tenantId, binding, {
              action: "whatsapp_meta_webhook.restriction_set",
              severity: "warning",
              message:
                "A signed Meta webhook restricted a WABA: its numbers stop sending.",
              attributes: { reason: action.signal.reason }
            });
          }
        } else if (action.signal.kind === "clear") {
          // Lifts ONLY the restriction it reverses, and only when strictly
          // newer than the event that set it.
          const cleared = (await tx`
            UPDATE awcms_whatsapp_meta_sender_signals
            SET restriction_reason = NULL, restricted_at = NULL,
                restriction_event_at = ${action.eventAt}, updated_at = now()
            WHERE tenant_id = ${tenantId}
              AND waba_external_id = ${binding.wabaId}
              AND restriction_reason = ${action.signal.reason}
              AND (restriction_event_at IS NULL
                   OR restriction_event_at < ${action.eventAt})
            RETURNING tenant_id
          `) as unknown[];

          if (cleared.length > 0) {
            await auditWebhookChange(tx, tenantId, binding, {
              action: "whatsapp_meta_webhook.restriction_cleared",
              severity: "warning",
              message:
                "A signed Meta webhook lifted a WABA restriction: its numbers may send again.",
              attributes: { reason: action.signal.reason }
            });
          }
        }

        result.signalsUpdated += 1;
        break;
      }
    }
  }

  return result;
}
