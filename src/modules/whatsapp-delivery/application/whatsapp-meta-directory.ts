/**
 * Meta Cloud API state of `whatsapp_delivery` (Issue #1143): template approvals
 * per WABA, 24-hour service windows, WABA restriction and messaging-limit
 * signals, and the application of a VERIFIED Meta webhook.
 *
 * Runs as `awcms_app` (enqueue, the routes, the webhook) and, for the READS
 * only, as `awcms_worker` (the dispatcher re-checks immediately before each
 * send). Every query is `WHERE tenant_id = $1` inside a tenant-scoped
 * transaction under FORCE RLS.
 */
import type { VerifiedMetaWebhookBinding } from "../../_shared/ports/channel-account-port";
import type { WhatsappPurpose } from "../../_shared/ports/whatsapp-delivery-port";
import {
  decideMetaSend,
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
import { WHATSAPP_MESSAGE_PROVIDER_STATUS_CHANGED_EVENT_TYPE } from "../domain/whatsapp-events";
import {
  buildRecipientHashes,
  hashListParam,
  type RecipientHashes,
  type RecipientKeyRing
} from "../domain/whatsapp-recipient";
import { appendDomainEvent } from "../../domain-event-runtime/application/append-domain-event";
import {
  WHATSAPP_EVENT_VERSION,
  WHATSAPP_MESSAGE_AGGREGATE_TYPE,
  WHATSAPP_MODULE_KEY
} from "../domain/whatsapp-events";

const iso = (value: Date | string): string =>
  value instanceof Date ? value.toISOString() : new Date(value).toISOString();

// ---------------------------------------------------------------------------
// Reads used at enqueue AND at dispatch
// ---------------------------------------------------------------------------

export async function readMetaTemplateApproval(
  tx: Bun.SQL,
  tenantId: string,
  containerAccountId: string,
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
      AND container_account_id = ${containerAccountId}
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
  containerAccountId: string
): Promise<MetaRestrictionReason | null> {
  const rows = (await tx`
    SELECT restriction_reason
    FROM awcms_whatsapp_meta_sender_signals
    WHERE tenant_id = ${tenantId}
      AND container_account_id = ${containerAccountId}
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
    containerAccountId: string;
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
        input.containerAccountId,
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

export async function listMetaTemplates(
  tx: Bun.SQL,
  tenantId: string
): Promise<MetaTemplateView[]> {
  const rows = (await tx`
    SELECT id, container_account_id, template_name, language, category,
           provider_status, source, evidence_ref, last_event_at, updated_at
    FROM awcms_whatsapp_meta_templates
    WHERE tenant_id = ${tenantId}
    ORDER BY container_account_id, template_name, language
    LIMIT 500
  `) as TemplateRow[];

  return rows.map(toTemplateView);
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
): Promise<MetaSignalView[]> {
  const rows = (await tx`
    SELECT container_account_id, restriction_reason, restricted_at,
           messaging_limit_tier, updated_at
    FROM awcms_whatsapp_meta_sender_signals
    WHERE tenant_id = ${tenantId}
    ORDER BY container_account_id
    LIMIT 500
  `) as {
    container_account_id: string;
    restriction_reason: MetaRestrictionReason | null;
    restricted_at: Date | string | null;
    messaging_limit_tier: MetaMessagingLimitTier | null;
    updated_at: Date | string;
  }[];

  return rows.map((row) => ({
    containerAccountId: row.container_account_id,
    restrictionReason: row.restriction_reason,
    restrictedAt: row.restricted_at ? iso(row.restricted_at) : null,
    messagingLimitTier: row.messaging_limit_tier,
    updatedAt: iso(row.updated_at)
  }));
}

/** Is `accountId` a live `waba` container of THIS tenant? (Another tenant's id and an unknown one are one answer.) */
export async function isLiveWabaContainer(
  tx: Bun.SQL,
  tenantId: string,
  accountId: string
): Promise<boolean> {
  const rows = (await tx`
    SELECT 1 FROM awcms_channel_accounts
    WHERE tenant_id = ${tenantId} AND id = ${accountId}
      AND provider = 'whatsapp_cloud' AND account_kind = 'waba'
      AND deleted_at IS NULL
  `) as unknown[];

  return rows.length > 0;
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
  if (!(await isLiveWabaContainer(tx, tenantId, input.containerAccountId))) {
    return { outcome: "container_not_found" };
  }

  const previous = (await tx`
    SELECT provider_status FROM awcms_whatsapp_meta_templates
    WHERE tenant_id = ${tenantId}
      AND container_account_id = ${input.containerAccountId}
      AND template_name = ${input.name} AND language = ${input.language}
    FOR UPDATE
  `) as { provider_status: MetaTemplateStatus }[];

  const rows = (await tx`
    INSERT INTO awcms_whatsapp_meta_templates
      (tenant_id, container_account_id, template_name, language, category,
       provider_status, evidence_ref, source, last_event_at, updated_by)
    VALUES (${tenantId}, ${input.containerAccountId}, ${input.name},
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
    RETURNING id, container_account_id, template_name, language, category,
              provider_status, source, evidence_ref, last_event_at, updated_at
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
  containerAccountId: string
): Promise<ClearRestrictionOutcome> {
  const previous = (await tx`
    SELECT restriction_reason FROM awcms_whatsapp_meta_sender_signals
    WHERE tenant_id = ${tenantId}
      AND container_account_id = ${containerAccountId}
      AND restriction_reason IS NOT NULL
    FOR UPDATE
  `) as { restriction_reason: MetaRestrictionReason }[];

  if (!previous[0]) return { outcome: "not_restricted" };

  await tx`
    UPDATE awcms_whatsapp_meta_sender_signals
    SET restriction_reason = NULL, restricted_at = NULL,
        cleared_by = ${actor}, cleared_at = now(), updated_at = now()
    WHERE tenant_id = ${tenantId}
      AND container_account_id = ${containerAccountId}
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
  const rows = (await tx`
    INSERT INTO awcms_whatsapp_webhook_receipts
      (tenant_id, subscription_id, payload_sha256)
    VALUES (${tenantId}, ${subscriptionId}, ${payloadSha256})
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
 * Applies the actions of a verified, deduplicated webhook. Tenant and binding
 * come from the callback token (`binding`), never from the payload; the parser
 * has already dropped everything naming another WABA or number.
 */
export async function applyMetaWebhookActions(
  tx: Bun.SQL,
  tenantId: string,
  binding: VerifiedMetaWebhookBinding,
  actions: readonly MetaWebhookAction[],
  ring: Extract<RecipientKeyRing, { ok: true }>
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
        break;
      }

      case "template": {
        const current = (await tx`
          SELECT provider_status, last_event_at
          FROM awcms_whatsapp_meta_templates
          WHERE tenant_id = ${tenantId}
            AND container_account_id = ${binding.containerAccountId}
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
            (tenant_id, container_account_id, template_name, language,
             category, provider_status, source, last_event_at)
          VALUES (${tenantId}, ${binding.containerAccountId}, ${action.name},
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
        break;
      }

      case "limit": {
        await tx`
          INSERT INTO awcms_whatsapp_meta_sender_signals
            (tenant_id, container_account_id, messaging_limit_tier,
             limit_event_at)
          VALUES (${tenantId}, ${binding.containerAccountId}, ${action.tier},
                  ${action.eventAt})
          ON CONFLICT (tenant_id, container_account_id)
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
          await tx`
            INSERT INTO awcms_whatsapp_meta_sender_signals
              (tenant_id, container_account_id, restriction_reason,
               restricted_at, restriction_event_at)
            VALUES (${tenantId}, ${binding.containerAccountId},
                    ${action.signal.reason}, now(), ${action.eventAt})
            ON CONFLICT (tenant_id, container_account_id)
            DO UPDATE SET restriction_reason = EXCLUDED.restriction_reason,
                          restricted_at = now(),
                          restriction_event_at = EXCLUDED.restriction_event_at,
                          updated_at = now()
            WHERE awcms_whatsapp_meta_sender_signals.restriction_event_at IS NULL
               OR awcms_whatsapp_meta_sender_signals.restriction_event_at
                    <= EXCLUDED.restriction_event_at
          `;
        } else if (action.signal.kind === "clear") {
          // Lifts ONLY the restriction it reverses, and only when strictly
          // newer than the event that set it.
          await tx`
            UPDATE awcms_whatsapp_meta_sender_signals
            SET restriction_reason = NULL, restricted_at = NULL,
                restriction_event_at = ${action.eventAt}, updated_at = now()
            WHERE tenant_id = ${tenantId}
              AND container_account_id = ${binding.containerAccountId}
              AND restriction_reason = ${action.signal.reason}
              AND (restriction_event_at IS NULL
                   OR restriction_event_at < ${action.eventAt})
          `;
        }

        result.signalsUpdated += 1;
        break;
      }
    }
  }

  return result;
}
