/**
 * The customer-bot webhook: verification and idempotent ingestion (ADR-0152
 * section 4, TG3 to TG5; ADR-0150 sections 2 to 4).
 *
 * ## Verification, before the body is read
 *
 * `verifyWebhookRequest` runs before the route reads one byte of the body:
 *
 *   1. the callback token is parsed (pure; a malformed token costs nothing);
 *   2. the NAMED tenant's context is opened and the endpoint row read by id;
 *      its stored hash is compared with the hash of the presented path secret
 *      in constant time, the endpoint must be `active`, its account a live
 *      telegram bot, and the tenant's module toggle on;
 *   3. the endpoint's seed is decrypted and the expected header derived and
 *      compared in constant time with `X-Telegram-Bot-Api-Secret-Token`.
 *
 * Every failure is ONE answer (`{ ok: false }`, the route sends one generic
 * 401), so the route is not an oracle for which tokens, tenants or bots exist
 * (T-W1). The one database read before the header is proven is unavoidable
 * where the secret is stored by reference (ADR-0152 section 3) and is a
 * primary-key lookup; it is noted in the module README.
 *
 * ## Ingestion, in one short transaction
 *
 * `ingestVerifiedUpdate` then: checks the replay key (TG4), applies the
 * per-update binding rules (`update-parser.ts`), changes contact and consent
 * state, appends the domain events, and writes the receipt LAST. The receipt is
 * unique on (tenant, account, update_id), so two concurrent deliveries of the
 * same update serialise on that index and the loser's whole transaction (its
 * contact, consent and events too) rolls back: one effect, however many times
 * Telegram retries or the process crashes between ingest and commit (T-W2). No
 * provider call happens here; replies go through the outbound queue.
 */
import { createHash } from "node:crypto";

import { withTenantOrThrow } from "../../../lib/database/tenant-context";
import type { KeyRing } from "../../../lib/security/field-encryption";
import { log } from "../../../lib/logging/logger";
import { resolvePlatformTenantIdIgnoringStatus } from "../../../lib/tenant/platform-tenant";
import { appendDomainEvent } from "../../domain-event-runtime/application/append-domain-event";
import { recordAuditEvent } from "../../logging/application/audit-log";
import { fetchTenantModuleEntry } from "../../module-management/application/tenant-module-lifecycle";
import {
  contactHash,
  encryptChatId,
  maskedLabelFor
} from "../domain/contact-crypto";
import {
  buildInteractionReceivedPayload,
  type InteractionEventKind
} from "../domain/telegram-engagement-events";
import {
  TELEGRAM_ENGAGEMENT_CONTACT_AGGREGATE_TYPE,
  TELEGRAM_ENGAGEMENT_EVENT_VERSION,
  TELEGRAM_ENGAGEMENT_INTERACTION_RECEIVED_EVENT_TYPE,
  TELEGRAM_ENGAGEMENT_MODULE_KEY,
  type PrivacyClass,
  type WebhookRejectionReason
} from "../domain/telegram-engagement-constants";
import {
  parseTelegramUpdate,
  type ParsedUpdate
} from "../domain/update-parser";
import {
  constantTimeEquals,
  deriveHeaderSecret,
  hashPathSecret,
  type ParsedCallbackToken
} from "../domain/webhook-secrets";
import {
  botCapabilityAllowed,
  fetchBotAccount,
  resolveWebhookSeed
} from "../infrastructure/channel-accounts-bridge";
import {
  findContactByUser,
  latestConsent,
  recordConsent,
  withdrawAllPurposes,
  type ContactRow
} from "./contact-directory";

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

export type VerifiedEndpoint = {
  tenantId: string;
  endpointId: string;
  accountId: string;
  /** A per-endpoint key for the per-chat rate-limit bucket; never the secret itself. */
  rateKeySalt: string;
};

export type VerifyResult =
  | { ok: true; endpoint: VerifiedEndpoint }
  | { ok: false; reason: WebhookRejectionReason };

type EndpointAuthRow = {
  id: string;
  account_id: string;
  secret_id: string | null;
  callback_hash: string;
  state: string;
};

/** A digest compared on the unknown-endpoint path too, so it costs what a known one does. */
const DECOY_HASH = hashPathSecret("telegram_engagement:decoy");

export async function verifyWebhookRequest(
  sql: Bun.SQL,
  token: ParsedCallbackToken,
  presentedHeader: string | null
): Promise<VerifyResult> {
  return withTenantOrThrow(
    sql,
    token.tenantId,
    async (tx) => {
      const rows = (await tx`
        SELECT id, account_id, secret_id, callback_hash, state
        FROM awcms_telegram_engagement_endpoints
        WHERE tenant_id = ${token.tenantId} AND id = ${token.endpointId}
      `) as EndpointAuthRow[];
      const row = rows[0];
      const presentedHash = hashPathSecret(token.pathSecret);
      const hashMatches = constantTimeEquals(
        presentedHash,
        row?.callback_hash ?? DECOY_HASH
      );

      if (!row || !hashMatches || row.state !== "active" || !row.secret_id) {
        return { ok: false, reason: "endpoint_unknown" } as const;
      }

      const account = await fetchBotAccount(tx, token.tenantId, row.account_id);
      const moduleEntry = await fetchTenantModuleEntry(
        tx,
        token.tenantId,
        TELEGRAM_ENGAGEMENT_MODULE_KEY
      );

      if (
        !account ||
        account.status === "revoked" ||
        account.status === "disabled" ||
        !(moduleEntry?.tenantEnabled ?? false)
      ) {
        return { ok: false, reason: "endpoint_unknown" } as const;
      }

      let seed: string;

      try {
        const secretId = row.secret_id;

        // A savepoint: an undecryptable seed is a refusal, not an abort.
        seed = await tx.savepoint((sp) =>
          resolveWebhookSeed(sp, token.tenantId, secretId)
        );
      } catch {
        return { ok: false, reason: "endpoint_unknown" } as const;
      }

      if (!constantTimeEquals(presentedHeader, deriveHeaderSecret(seed))) {
        return {
          ok: false,
          reason: presentedHeader === null ? "header_absent" : "header_mismatch"
        } as const;
      }

      return {
        ok: true,
        endpoint: {
          tenantId: token.tenantId,
          endpointId: row.id,
          accountId: row.account_id,
          rateKeySalt: createHash("sha256")
            .update(`telegram_engagement:rate:${seed}`, "utf8")
            .digest("hex")
        }
      } as const;
    },
    { workClass: "interactive" }
  );
}

// ---------------------------------------------------------------------------
// Aggregated rejection record (the ADR-0140 section 9 idiom, ADR-0150 N1)
// ---------------------------------------------------------------------------

const FLUSH_INTERVAL_MS = 60_000;
const counts = new Map<WebhookRejectionReason, number>();
let windowStartedAt = 0;

export function recordWebhookRejection(
  reason: WebhookRejectionReason,
  nowMs: number = Date.now()
): void {
  if (counts.size === 0) windowStartedAt = nowMs;

  counts.set(reason, (counts.get(reason) ?? 0) + 1);
}

export function pendingWebhookRejections(): Record<string, number> {
  return Object.fromEntries(counts);
}

export function resetWebhookRejectionsForTests(): void {
  counts.clear();
  windowStartedAt = 0;
}

/** One aggregated row on the platform tenant, in its own transaction. Throws on failure. */
async function writeRejectionAudit(
  sql: Bun.SQL,
  snapshot: Record<string, number>,
  windowSeconds: number
): Promise<boolean> {
  const platformTenantId = await resolvePlatformTenantIdIgnoringStatus(sql);

  if (!platformTenantId) return false;

  const total = Object.values(snapshot).reduce((a, b) => a + b, 0);

  await withTenantOrThrow(
    sql,
    platformTenantId,
    async (auditTx) => {
      await recordAuditEvent(auditTx, {
        tenantId: platformTenantId,
        moduleKey: TELEGRAM_ENGAGEMENT_MODULE_KEY,
        action: "telegram_engagement_webhook.rejected",
        resourceType: "telegram_engagement_webhook",
        severity: "warning",
        message: `Customer Telegram webhook rejected ${total} request(s) in ${windowSeconds}s.`,
        attributes: { counts: snapshot, windowSeconds }
      });
    },
    { workClass: "background_sync" }
  );

  return true;
}

/**
 * At most once a minute, ONE `warning` audit row on the PLATFORM tenant with
 * counts per reason: no address, no header, no token, no body. Best effort:
 * never throws, and the counters are cleared whatever happens.
 */
export async function flushWebhookRejections(
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
    return await writeRejectionAudit(getSql(), snapshot, windowSeconds);
  } catch (error) {
    log("warning", "telegram_engagement.webhook.rejections_flush_failed", {
      moduleKey: TELEGRAM_ENGAGEMENT_MODULE_KEY,
      error: error instanceof Error ? error.name : "unknown"
    });

    return false;
  }
}

// ---------------------------------------------------------------------------
// Ingestion
// ---------------------------------------------------------------------------

export type IngestOutcome =
  | "duplicate"
  | "invalid"
  | "ignored"
  | "started"
  | "restarted"
  | "stopped"
  | "message"
  | "blocked"
  | "consent_recorded"
  | "not_admitted";

export type IngestResult = {
  outcome: IngestOutcome;
  /** For `answerCallbackQuery` in the webhook reply; opaque, not personal. */
  callbackQueryId: string | null;
};

function payloadHash(raw: unknown): string {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(raw ?? null), "utf8")
    .digest("hex")}`;
}

function callbackQueryIdOf(raw: unknown): string | null {
  const record =
    typeof raw === "object" && raw !== null
      ? (raw as Record<string, unknown>)
      : null;
  const callback =
    record &&
    typeof record.callback_query === "object" &&
    record.callback_query !== null
      ? (record.callback_query as Record<string, unknown>)
      : null;
  const id = callback?.id;

  return typeof id === "string" && /^[0-9A-Za-z_-]{1,64}$/.test(id) ? id : null;
}

type Receipt = {
  kind: "message" | "command" | "consent_button" | "membership" | "other";
  outcome: "published" | "recorded" | "ignored" | "rejected";
  contactId: string | null;
  privacyClass: PrivacyClass;
};

async function writeReceipt(
  tx: Bun.SQL,
  endpoint: VerifiedEndpoint,
  updateId: number,
  receipt: Receipt,
  hash: string,
  correlationId: string
): Promise<void> {
  await tx`
    INSERT INTO awcms_telegram_engagement_inbound
      (tenant_id, account_id, endpoint_id, update_id, update_kind, outcome,
       contact_id, privacy_class, payload_hash, correlation_id)
    VALUES (${endpoint.tenantId}, ${endpoint.accountId}, ${endpoint.endpointId},
            ${updateId}, ${receipt.kind}, ${receipt.outcome}, ${receipt.contactId},
            ${receipt.privacyClass}, ${hash}, ${correlationId})
  `;
  await tx`
    UPDATE awcms_telegram_engagement_endpoints
    SET last_update_at = now(), updated_at = now()
    WHERE tenant_id = ${endpoint.tenantId} AND id = ${endpoint.endpointId}
  `;
}

async function publishInteraction(
  tx: Bun.SQL,
  endpoint: VerifiedEndpoint,
  contactId: string,
  facts: {
    updateId: number;
    eventKind: InteractionEventKind;
    contentKinds: ("text" | "media" | "contact" | "location" | "other")[];
    forwarded: boolean;
    occurredAt: Date;
    privacyClass: PrivacyClass;
  },
  correlationId: string,
  now: Date
): Promise<void> {
  await appendDomainEvent(tx, endpoint.tenantId, {
    eventType: TELEGRAM_ENGAGEMENT_INTERACTION_RECEIVED_EVENT_TYPE,
    eventVersion: TELEGRAM_ENGAGEMENT_EVENT_VERSION,
    aggregateType: TELEGRAM_ENGAGEMENT_CONTACT_AGGREGATE_TYPE,
    aggregateId: contactId,
    producerModule: TELEGRAM_ENGAGEMENT_MODULE_KEY,
    correlationId,
    payload: buildInteractionReceivedPayload({
      channelAccountId: endpoint.accountId,
      contactId,
      updateId: facts.updateId,
      eventKind: facts.eventKind,
      contentKinds: facts.contentKinds,
      forwarded: facts.forwarded,
      occurredAt: facts.occurredAt,
      receivedAt: now,
      correlationId,
      privacyClass: facts.privacyClass
    }),
    occurredAt: facts.occurredAt
  });
}

async function handleStart(
  tx: Bun.SQL,
  endpoint: VerifiedEndpoint,
  update: Extract<ParsedUpdate, { kind: "start" }>,
  ring: KeyRing,
  correlationId: string,
  now: Date
): Promise<{ outcome: IngestOutcome; receipt: Receipt }> {
  const existing = await findContactByUser(
    tx,
    endpoint.tenantId,
    endpoint.accountId,
    update.userId,
    ring
  );
  let contactId: string;
  let outcome: IngestOutcome;

  if (!existing) {
    contactId = crypto.randomUUID();
    const hash = contactHash(
      update.userId,
      endpoint.tenantId,
      endpoint.accountId,
      ring
    );

    await tx`
      INSERT INTO awcms_telegram_engagement_contacts
        (id, tenant_id, account_id, contact_hash, chat_ciphertext, masked_label,
         state, start_param, started_at, last_inbound_at)
      VALUES (${contactId}, ${endpoint.tenantId}, ${endpoint.accountId}, ${hash},
              ${encryptChatId(update.userId, endpoint.tenantId, contactId, ring)},
              ${maskedLabelFor(hash)}, 'started', ${update.startParam},
              ${update.occurredAt}, ${now})
    `;
    outcome = "started";
  } else {
    contactId = existing.id;

    // A stopped or blocked person who starts again re-opens the conversation;
    // the original provenance is kept (the first /start's parameter).
    await tx`
      UPDATE awcms_telegram_engagement_contacts
      SET state = 'started', last_inbound_at = ${now},
          version = version + 1, updated_at = now()
      WHERE tenant_id = ${endpoint.tenantId} AND id = ${contactId}
    `;
    outcome = existing.state === "started" ? "started" : "restarted";
  }

  // `/start` is SUPPORT and nothing else (TG7). Re-recorded only when support is
  // not already opted in, so a repeated /start adds no duplicate evidence.
  const latest = existing
    ? await latestConsent(tx, endpoint.tenantId, contactId, "support")
    : null;

  if (latest?.action !== "opt_in") {
    await recordConsent(tx, endpoint.tenantId, {
      accountId: endpoint.accountId,
      contactId,
      purpose: "support",
      action: "opt_in",
      method: "start_command",
      noticeVersion: null,
      updateId: update.updateId,
      occurredAt: update.occurredAt,
      recordedBy: null,
      correlationId
    });
  }

  await publishInteraction(
    tx,
    endpoint,
    contactId,
    {
      updateId: update.updateId,
      eventKind: "command",
      contentKinds: ["text"],
      forwarded: false,
      occurredAt: update.occurredAt,
      privacyClass: "conversation_meta"
    },
    correlationId,
    now
  );

  return {
    outcome,
    receipt: {
      kind: "command",
      outcome: "published",
      contactId,
      privacyClass: "consent"
    }
  };
}

async function handleWithdrawal(
  tx: Bun.SQL,
  endpoint: VerifiedEndpoint,
  contact: ContactRow,
  input: {
    updateId: number;
    occurredAt: Date;
    method: "stop_command" | "bot_blocked";
    state: "stopped" | "blocked";
  },
  correlationId: string
): Promise<void> {
  await withdrawAllPurposes(tx, endpoint.tenantId, {
    accountId: endpoint.accountId,
    contactId: contact.id,
    method: input.method,
    updateId: input.updateId,
    occurredAt: input.occurredAt,
    recordedBy: null,
    correlationId
  });

  if (input.state === "stopped") {
    await tx`
      UPDATE awcms_telegram_engagement_contacts
      SET state = 'stopped', stopped_at = ${input.occurredAt},
          version = version + 1, updated_at = now()
      WHERE tenant_id = ${endpoint.tenantId} AND id = ${contact.id}
    `;
  } else {
    await tx`
      UPDATE awcms_telegram_engagement_contacts
      SET state = 'blocked', blocked_at = ${input.occurredAt},
          version = version + 1, updated_at = now()
      WHERE tenant_id = ${endpoint.tenantId} AND id = ${contact.id}
    `;
  }
}

/**
 * Ingests one VERIFIED update. `raw` is the parsed JSON body. Returns what
 * happened; throws only on a database error (the route answers 503 and
 * Telegram retries, which the replay key makes safe).
 */
export async function ingestVerifiedUpdate(
  sql: Bun.SQL,
  endpoint: VerifiedEndpoint,
  raw: unknown,
  ring: KeyRing,
  options: { correlationId?: string; now?: Date } = {}
): Promise<IngestResult> {
  const now = options.now ?? new Date();
  const correlationId = options.correlationId ?? crypto.randomUUID();
  const update = parseTelegramUpdate(raw, now);
  const callbackQueryId = callbackQueryIdOf(raw);

  if (update.kind === "invalid") {
    return { outcome: "invalid", callbackQueryId: null };
  }

  const hash = payloadHash(raw);

  try {
    return await withTenantOrThrow(
      sql,
      endpoint.tenantId,
      async (tx) => {
        const seen = (await tx`
          SELECT 1 AS seen FROM awcms_telegram_engagement_inbound
          WHERE tenant_id = ${endpoint.tenantId}
            AND account_id = ${endpoint.accountId}
            AND update_id = ${update.updateId}
        `) as { seen: number }[];

        if (seen.length > 0) {
          return { outcome: "duplicate", callbackQueryId } as const;
        }

        if (update.kind === "ignored") {
          await writeReceipt(
            tx,
            endpoint,
            update.updateId,
            {
              kind: "other",
              outcome: "ignored",
              contactId: null,
              privacyClass: "operational"
            },
            hash,
            correlationId
          );

          return { outcome: "ignored", callbackQueryId: null } as const;
        }

        // Fail closed per account (ADR-0148 I2): the account must be connected
        // and hold `inbound` with evidence. Otherwise the update is receipted
        // and nothing else happens.
        if (
          !(await botCapabilityAllowed(
            tx,
            endpoint.tenantId,
            endpoint.accountId,
            "inbound"
          ))
        ) {
          await writeReceipt(
            tx,
            endpoint,
            update.updateId,
            {
              kind: "other",
              outcome: "rejected",
              contactId: null,
              privacyClass: "operational"
            },
            hash,
            correlationId
          );

          return { outcome: "not_admitted", callbackQueryId: null } as const;
        }

        if (update.kind === "start") {
          const result = await handleStart(
            tx,
            endpoint,
            update,
            ring,
            correlationId,
            now
          );

          await writeReceipt(
            tx,
            endpoint,
            update.updateId,
            result.receipt,
            hash,
            correlationId
          );

          return { outcome: result.outcome, callbackQueryId: null } as const;
        }

        const contact = await findContactByUser(
          tx,
          endpoint.tenantId,
          endpoint.accountId,
          update.userId,
          ring
        );

        // No contact (never started) or an ended one: nothing is created from
        // anything but /start, and nothing is published for a stranger.
        if (!contact || contact.state === "ended") {
          await writeReceipt(
            tx,
            endpoint,
            update.updateId,
            {
              kind:
                update.kind === "consent_button"
                  ? "consent_button"
                  : update.kind === "stop"
                    ? "command"
                    : update.kind,
              outcome: "ignored",
              contactId: null,
              privacyClass: "operational"
            },
            hash,
            correlationId
          );

          return { outcome: "ignored", callbackQueryId } as const;
        }

        if (update.kind === "stop") {
          if (contact.state === "started") {
            await handleWithdrawal(
              tx,
              endpoint,
              contact,
              {
                updateId: update.updateId,
                occurredAt: update.occurredAt,
                method: "stop_command",
                state: "stopped"
              },
              correlationId
            );
          }

          await writeReceipt(
            tx,
            endpoint,
            update.updateId,
            {
              kind: "command",
              outcome: "recorded",
              contactId: contact.id,
              privacyClass: "consent"
            },
            hash,
            correlationId
          );

          return { outcome: "stopped", callbackQueryId: null } as const;
        }

        if (update.kind === "membership") {
          if (update.change === "blocked" && contact.state !== "blocked") {
            await handleWithdrawal(
              tx,
              endpoint,
              contact,
              {
                updateId: update.updateId,
                occurredAt: update.occurredAt,
                method: "bot_blocked",
                state: "blocked"
              },
              correlationId
            );
          }

          // An UNBLOCK grants nothing: the person must /start again.
          await writeReceipt(
            tx,
            endpoint,
            update.updateId,
            {
              kind: "membership",
              outcome: "recorded",
              contactId: contact.id,
              privacyClass: "consent"
            },
            hash,
            correlationId
          );

          return {
            outcome: update.change === "blocked" ? "blocked" : "ignored",
            callbackQueryId: null
          } as const;
        }

        if (update.kind === "consent_button") {
          // The button must sit on a consent prompt THIS module sent to THIS
          // contact, for this purpose and notice version. Callback data is
          // attacker-controllable; it only names what to look up.
          const prompts = (await tx`
            SELECT id FROM awcms_telegram_engagement_messages
            WHERE tenant_id = ${endpoint.tenantId} AND contact_id = ${contact.id}
              AND account_id = ${endpoint.accountId}
              AND kind = 'consent_prompt' AND status = 'sent'
              AND provider_message_id = ${update.messageId}
              AND prompt_purpose = ${update.purpose}
              AND prompt_notice_version = ${update.noticeVersion}
          `) as { id: string }[];

          if (prompts.length === 0 || contact.state !== "started") {
            await writeReceipt(
              tx,
              endpoint,
              update.updateId,
              {
                kind: "consent_button",
                outcome: "ignored",
                contactId: contact.id,
                privacyClass: "operational"
              },
              hash,
              correlationId
            );

            return { outcome: "ignored", callbackQueryId } as const;
          }

          await recordConsent(tx, endpoint.tenantId, {
            accountId: endpoint.accountId,
            contactId: contact.id,
            purpose: update.purpose,
            action: update.accept ? "opt_in" : "opt_out",
            method: update.accept ? "consent_button" : "withdraw_button",
            noticeVersion: update.noticeVersion,
            updateId: update.updateId,
            occurredAt: update.occurredAt,
            recordedBy: null,
            correlationId
          });

          if (!update.accept) {
            // Withdrawal wins over everything queued for that purpose.
            await tx`
              UPDATE awcms_telegram_engagement_messages
              SET status = 'cancelled', failure_code = 'CONSENT_WITHDRAWN',
                  text_ciphertext = NULL, finalized_at = now(), updated_at = now()
              WHERE tenant_id = ${endpoint.tenantId} AND contact_id = ${contact.id}
                AND purpose = ${update.purpose} AND status = 'queued'
            `;
          }

          await writeReceipt(
            tx,
            endpoint,
            update.updateId,
            {
              kind: "consent_button",
              outcome: "recorded",
              contactId: contact.id,
              privacyClass: "consent"
            },
            hash,
            correlationId
          );

          return { outcome: "consent_recorded", callbackQueryId } as const;
        }

        // A plain message from a started contact: announce it, never store it.
        if (contact.state !== "started") {
          await writeReceipt(
            tx,
            endpoint,
            update.updateId,
            {
              kind: "message",
              outcome: "ignored",
              contactId: contact.id,
              privacyClass: "operational"
            },
            hash,
            correlationId
          );

          return { outcome: "ignored", callbackQueryId: null } as const;
        }

        await tx`
          UPDATE awcms_telegram_engagement_contacts
          SET last_inbound_at = ${now}, updated_at = now()
          WHERE tenant_id = ${endpoint.tenantId} AND id = ${contact.id}
        `;
        await publishInteraction(
          tx,
          endpoint,
          contact.id,
          {
            updateId: update.updateId,
            eventKind: "message",
            contentKinds: update.contentKinds,
            forwarded: update.forwarded,
            occurredAt: update.occurredAt,
            privacyClass: "conversation_meta"
          },
          correlationId,
          now
        );
        await writeReceipt(
          tx,
          endpoint,
          update.updateId,
          {
            kind: "message",
            outcome: "published",
            contactId: contact.id,
            privacyClass: "conversation_meta"
          },
          hash,
          correlationId
        );

        return { outcome: "message", callbackQueryId: null } as const;
      },
      { workClass: "interactive" }
    );
  } catch (error) {
    // The replay key raced: a concurrent delivery of the same update won and
    // this transaction (with every effect it made) rolled back. One effect.
    // Checked by constraint NAME, never by SQLSTATE alone (audit L-2).
    if (isUniqueViolation(error)) {
      return { outcome: "duplicate", callbackQueryId };
    }

    // Another unique key lost a race (two deliveries of the SAME first /start
    // collide on the contact key before either reaches the receipt). It is a
    // duplicate only if the winner's receipt for THIS update now exists; any
    // other collision is rethrown and Telegram retries.
    if (
      String((error as { errno?: unknown } | null)?.errno) === "23505" &&
      (await receiptExists(sql, endpoint, update.updateId))
    ) {
      return { outcome: "duplicate", callbackQueryId };
    }

    throw error;
  }
}

/**
 * ONLY the replay key's own violation is a duplicate (audit L-2 of PR #1260).
 * Any other unique violation (two first `/start`s racing on the contact key)
 * is rethrown: the route answers 503, Telegram retries, and the retry finds the
 * state the winner committed, so nothing is silently lost.
 */
export const REPLAY_KEY_CONSTRAINT =
  "awcms_telegram_engagement_inbound_replay_key";

async function receiptExists(
  sql: Bun.SQL,
  endpoint: VerifiedEndpoint,
  updateId: number
): Promise<boolean> {
  return withTenantOrThrow(
    sql,
    endpoint.tenantId,
    async (tx) =>
      (
        (await tx`
          SELECT 1 AS seen FROM awcms_telegram_engagement_inbound
          WHERE tenant_id = ${endpoint.tenantId}
            AND account_id = ${endpoint.accountId}
            AND update_id = ${updateId}
        `) as { seen: number }[]
      ).length > 0,
    { workClass: "interactive" }
  );
}

function isUniqueViolation(error: unknown): boolean {
  const failure = error as { errno?: unknown; constraint?: unknown } | null;

  return (
    String(failure?.errno) === "23505" &&
    failure?.constraint === REPLAY_KEY_CONSTRAINT
  );
}
