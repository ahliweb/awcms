/**
 * The `telegram_engagement` worker (ADR-0152 sections 3 and 5, TG10, TG14):
 * one pinned-Bun job, `bun run telegram-engagement:dispatch`, with two phases
 * per tenant, both following the repository's dispatch discipline (ADR-0006,
 * ADR-0148 I10): claim in a short transaction, call Telegram OUTSIDE it, finalise
 * in another short transaction guarded by the claim.
 *
 * ## Phase 1: the connector (registration, rotation, revocation)
 *
 * For an endpoint that owes Telegram a `set`: `getMe` (the bot id must equal
 * the account's external id, which registration already refused for the staff
 * bot, so the TOKEN is bound to that id), then `setWebhook` with the per-bot
 * URL, the derived secret token and the minimal `allowed_updates`. Only then is
 * the endpoint `active` and the account reported healthy (which moves it to
 * `connected`). For a revoked endpoint that owes a `delete`: `deleteWebhook`.
 * A `401` from Telegram (token revoked at BotFather) is terminal for the
 * endpoint and reported as failing health; a `429` waits `retry_after`.
 *
 * ## Phase 2: the outbound queue
 *
 * Re-checks at dispatch everything enqueue checked (contact `started`, the
 * purpose's LATEST consent is still an opt-in, the endpoint `active`, the `dm`
 * capability, the breaker closed, the bot's daily ceiling under the deployment
 * cap), then sends with per-BOT and per-CHAT pacing (one pacer per account, not
 * one per run). `ok` means "accepted by Telegram", never "read". A `429` is
 * re-queued after `retry_after` WITHOUT spending retry budget. A `403` means the
 * person blocked the bot: the row fails, the contact is `blocked` and every
 * purpose is withdrawn (`provider_forbidden`), never retried. A network error or
 * timeout after the request left is `uncertain` and is NOT retried (the message
 * may have arrived), and so is a row whose lease expired mid-send (a crash
 * between claim and finalise). Text is cleared at every terminal state.
 *
 * ## Why it runs as `awcms_app`
 *
 * See the module README. In short: `awcms_worker` is deliberately unable to see
 * a bot token (`sql/328` limits it to WhatsApp sender credentials), widening that
 * policy would let `whatsapp:dispatch` decrypt Telegram tokens, and
 * `channel-accounts:secrets:rekey` already runs as `awcms_app` with the same
 * ring. The job is scoped one tenant at a time through the ordinary RLS context.
 */
import type { KeyRing } from "../../../lib/security/field-encryption";
import { withTenantOrThrow } from "../../../lib/database/tenant-context";
import { log } from "../../../lib/logging/logger";
import { decryptChatId, decryptMessageText } from "../domain/contact-crypto";
import { evaluateEligibility } from "../domain/eligibility";
import {
  isTelegramEngagementEnabled,
  resolveDeploymentDailyCap,
  resolveTelegramEngagementRing,
  resolveWebhookOrigin
} from "../domain/telegram-engagement-config";
import {
  ALLOWED_UPDATES,
  BREAKER_OPEN_SECONDS,
  BREAKER_THRESHOLD,
  MAX_DISPATCH_ATTEMPTS,
  PER_BOT_MIN_INTERVAL_MS,
  PER_CHAT_MIN_INTERVAL_MS,
  TELEGRAM_ENGAGEMENT_MODULE_KEY,
  type ContactState,
  type PromptablePurpose,
  type Purpose
} from "../domain/telegram-engagement-constants";
import { consentCallbackData } from "../domain/update-parser";
import {
  buildWebhookUrl,
  deriveHeaderSecret,
  derivePathSecret,
  formatCallbackToken
} from "../domain/webhook-secrets";
import {
  defaultBotApiTransport,
  DEFAULT_TIMEOUT_MS,
  type BotApiOutcome,
  type BotApiTransport
} from "../infrastructure/bot-api-client";
import {
  botCapabilityAllowed,
  fetchBotAccount,
  recordBotHealth,
  resolveBotToken,
  resolveWebhookSeed
} from "../infrastructure/channel-accounts-bridge";
import { latestConsent, withdrawAllPurposes } from "./contact-directory";

export type DispatchOptions = {
  transport?: BotApiTransport;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  env?: NodeJS.ProcessEnv;
  batchSize?: number;
  correlationId?: string;
};

export type DispatchResult = {
  endpointsActivated: number;
  endpointsFailed: number;
  webhooksDeleted: number;
  claimed: number;
  sent: number;
  uncertain: number;
  failed: number;
  retried: number;
  cancelled: number;
  deferred: number;
};

const emptyResult = (): DispatchResult => ({
  endpointsActivated: 0,
  endpointsFailed: 0,
  webhooksDeleted: 0,
  claimed: 0,
  sent: 0,
  uncertain: 0,
  failed: 0,
  retried: 0,
  cancelled: 0,
  deferred: 0
});

const CONNECTOR_LEASE_SECONDS = 60;
const MESSAGE_LEASE_SECONDS = 120;
const MAX_CONNECTOR_ATTEMPTS = 6;

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

function backoffSeconds(attempts: number): number {
  return Math.min(3600, 30 * 2 ** Math.max(0, attempts - 1));
}

/** The fixed code for a Telegram refusal; never its description text. */
function errorCodeOf(
  outcome: Extract<BotApiOutcome, { kind: "error" }>
): string {
  const code = outcome.errorCode ?? outcome.httpStatus;

  if (code === 401 || code === 404) return "TOKEN_REJECTED";
  if (code === 403) return "FORBIDDEN_BY_PROVIDER";
  if (code === 429) return "RATE_LIMITED";
  if (code === 400) return "PROVIDER_REJECTED";

  return "PROVIDER_ERROR";
}

// ---------------------------------------------------------------------------
// Phase 1: connector
// ---------------------------------------------------------------------------

type ClaimedEndpoint = {
  id: string;
  account_id: string;
  secret_id: string | null;
  provider_action: "set" | "delete";
  state: string;
  connector_attempts: number;
};

async function connectorFinalize(
  sql: Bun.SQL,
  tenantId: string,
  endpoint: ClaimedEndpoint,
  patch:
    | { kind: "activated"; botId: string; username: string | null }
    | { kind: "deleted" }
    | { kind: "retry"; code: string; afterSeconds: number }
    | { kind: "failed"; code: string; health: boolean }
): Promise<void> {
  await withTenantOrThrow(
    sql,
    tenantId,
    async (tx) => {
      if (patch.kind === "activated") {
        // Only a still-pending endpoint activates: one revoked or rotated while
        // the call was in flight stays revoked (its successor's setWebhook wins).
        const rows = (await tx`
          UPDATE awcms_telegram_engagement_endpoints
          SET state = 'active', provider_action = NULL,
              verified_bot_id = ${patch.botId}, bot_username = ${patch.username},
              verified_at = now(), activated_at = now(), last_error_code = NULL,
              connector_lease_until = NULL, updated_at = now()
          WHERE tenant_id = ${tenantId} AND id = ${endpoint.id}
            AND state = 'pending'
          RETURNING id
        `) as { id: string }[];

        if (rows.length > 0) {
          await recordBotHealth(tx, tenantId, endpoint.account_id, {
            state: "ok",
            reasonCode: null
          });
        }

        return;
      }

      if (patch.kind === "deleted") {
        await tx`
          UPDATE awcms_telegram_engagement_endpoints
          SET provider_action = NULL, connector_lease_until = NULL,
              last_error_code = NULL, updated_at = now()
          WHERE tenant_id = ${tenantId} AND id = ${endpoint.id}
        `;

        return;
      }

      if (
        patch.kind === "retry" &&
        endpoint.connector_attempts < MAX_CONNECTOR_ATTEMPTS
      ) {
        await tx`
          UPDATE awcms_telegram_engagement_endpoints
          SET last_error_code = ${patch.code}, connector_lease_until = NULL,
              next_attempt_at = now() + make_interval(secs => ${patch.afterSeconds}),
              updated_at = now()
          WHERE tenant_id = ${tenantId} AND id = ${endpoint.id}
        `;

        return;
      }

      const code = patch.code;

      // Terminal for this endpoint. A revoked row just stops owing Telegram a
      // call; a pending one becomes `failed` (the operator rotates to retry).
      await tx`
        UPDATE awcms_telegram_engagement_endpoints
        SET state = CASE WHEN state = 'pending' THEN 'failed' ELSE state END,
            provider_action = NULL, last_error_code = ${code},
            connector_lease_until = NULL, updated_at = now()
        WHERE tenant_id = ${tenantId} AND id = ${endpoint.id}
      `;

      if (patch.kind === "failed" && patch.health) {
        await recordBotHealth(tx, tenantId, endpoint.account_id, {
          state: "failing",
          reasonCode: code
        });
      }
    },
    { workClass: "background_sync" }
  );
}

async function runConnector(
  sql: Bun.SQL,
  tenantId: string,
  transport: BotApiTransport,
  env: NodeJS.ProcessEnv,
  result: DispatchResult
): Promise<void> {
  const claimed = await withTenantOrThrow(
    sql,
    tenantId,
    async (tx) =>
      (await tx`
        UPDATE awcms_telegram_engagement_endpoints e
        SET connector_lease_until = now() + make_interval(secs => ${CONNECTOR_LEASE_SECONDS}),
            connector_attempts = e.connector_attempts + 1, updated_at = now()
        WHERE e.id IN (
          SELECT id FROM awcms_telegram_engagement_endpoints
          WHERE tenant_id = ${tenantId} AND provider_action IS NOT NULL
            AND next_attempt_at <= now()
            AND (connector_lease_until IS NULL OR connector_lease_until < now())
          ORDER BY next_attempt_at
          LIMIT 10
          FOR UPDATE SKIP LOCKED
        ) AND e.tenant_id = ${tenantId}
        RETURNING e.id, e.account_id, e.secret_id, e.provider_action, e.state,
                  e.connector_attempts
      `) as ClaimedEndpoint[],
    { workClass: "background_sync" }
  );

  for (const endpoint of claimed) {
    // Secrets are decrypted in their own short transaction and held in memory
    // for this one endpoint only.
    const material = await withTenantOrThrow(
      sql,
      tenantId,
      async (tx) => {
        const account = await fetchBotAccount(
          tx,
          tenantId,
          endpoint.account_id
        );

        if (!account?.tokenSecretId) return null;

        const tokenSecretId = account.tokenSecretId;
        const seedSecretId =
          endpoint.provider_action === "set" ? endpoint.secret_id : null;

        // A missing ring or an undecryptable secret is an expected refusal, so
        // the reads run in a savepoint: the failure must not abort the
        // transaction the catch then lets commit.
        try {
          return await tx.savepoint(async (sp) => ({
            token: await resolveBotToken(sp, tenantId, tokenSecretId),
            seed: seedSecretId
              ? await resolveWebhookSeed(sp, tenantId, seedSecretId)
              : null,
            externalId: account.externalId
          }));
        } catch {
          return null;
        }
      },
      { workClass: "background_sync" }
    );

    if (!material) {
      await connectorFinalize(sql, tenantId, endpoint, {
        kind: "failed",
        code: "CREDENTIAL_UNAVAILABLE",
        health: false
      });
      result.endpointsFailed += 1;
      continue;
    }

    if (endpoint.provider_action === "delete") {
      const outcome = await transport(
        material.token,
        "deleteWebhook",
        { drop_pending_updates: false },
        DEFAULT_TIMEOUT_MS
      );

      if (outcome.kind === "ok") {
        await connectorFinalize(sql, tenantId, endpoint, { kind: "deleted" });
        result.webhooksDeleted += 1;
      } else {
        await connectorFinalize(sql, tenantId, endpoint, {
          kind: "retry",
          code:
            outcome.kind === "error"
              ? errorCodeOf(outcome)
              : "PROVIDER_UNREACHABLE",
          afterSeconds:
            outcome.kind === "error" && outcome.retryAfterSeconds
              ? outcome.retryAfterSeconds
              : backoffSeconds(endpoint.connector_attempts)
        });
      }

      continue;
    }

    // `set`: getMe, then setWebhook.
    const origin = resolveWebhookOrigin(env);

    if (origin === null || material.seed === null) {
      await connectorFinalize(sql, tenantId, endpoint, {
        kind: "failed",
        code: "WEBHOOK_ORIGIN_UNAVAILABLE",
        health: false
      });
      result.endpointsFailed += 1;
      continue;
    }

    const me = await transport(material.token, "getMe", {}, DEFAULT_TIMEOUT_MS);

    if (me.kind !== "ok") {
      if (me.kind === "error" && errorCodeOf(me) === "TOKEN_REJECTED") {
        await connectorFinalize(sql, tenantId, endpoint, {
          kind: "failed",
          code: "TOKEN_REJECTED",
          health: true
        });
        result.endpointsFailed += 1;
      } else {
        await connectorFinalize(sql, tenantId, endpoint, {
          kind: "retry",
          code: me.kind === "error" ? errorCodeOf(me) : "PROVIDER_UNREACHABLE",
          afterSeconds:
            me.kind === "error" && me.retryAfterSeconds
              ? me.retryAfterSeconds
              : backoffSeconds(endpoint.connector_attempts)
        });
      }

      continue;
    }

    const identity =
      typeof me.result === "object" && me.result !== null
        ? (me.result as Record<string, unknown>)
        : {};
    const botId = typeof identity.id === "number" ? String(identity.id) : null;
    const username =
      typeof identity.username === "string" &&
      /^[A-Za-z0-9_]{1,64}$/.test(identity.username)
        ? identity.username
        : null;

    // The token must belong to the bot the account names, or nothing is
    // registered. Registration already refused an account naming the staff
    // bot, so binding the token to the account's id also keeps the staff bot
    // out without this job ever reading a staff setting.
    if (
      botId === null ||
      identity.is_bot !== true ||
      botId !== material.externalId
    ) {
      await connectorFinalize(sql, tenantId, endpoint, {
        kind: "failed",
        code: "BOT_IDENTITY_MISMATCH",
        health: true
      });
      result.endpointsFailed += 1;
      continue;
    }

    const callbackToken = formatCallbackToken(
      tenantId,
      endpoint.id,
      derivePathSecret(material.seed)
    );
    const set = await transport(
      material.token,
      "setWebhook",
      {
        url: buildWebhookUrl(origin, callbackToken),
        secret_token: deriveHeaderSecret(material.seed),
        allowed_updates: [...ALLOWED_UPDATES],
        max_connections: 10,
        drop_pending_updates: false
      },
      DEFAULT_TIMEOUT_MS
    );

    if (set.kind === "ok") {
      await connectorFinalize(sql, tenantId, endpoint, {
        kind: "activated",
        botId,
        username
      });
      result.endpointsActivated += 1;
    } else if (set.kind === "error" && errorCodeOf(set) === "TOKEN_REJECTED") {
      await connectorFinalize(sql, tenantId, endpoint, {
        kind: "failed",
        code: "TOKEN_REJECTED",
        health: true
      });
      result.endpointsFailed += 1;
    } else {
      await connectorFinalize(sql, tenantId, endpoint, {
        kind: "retry",
        code: set.kind === "error" ? errorCodeOf(set) : "PROVIDER_UNREACHABLE",
        afterSeconds:
          set.kind === "error" && set.retryAfterSeconds
            ? set.retryAfterSeconds
            : backoffSeconds(endpoint.connector_attempts)
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Phase 2: outbound queue
// ---------------------------------------------------------------------------

type ClaimedMessage = {
  id: string;
  account_id: string;
  contact_id: string;
  purpose: Purpose;
  kind: "text" | "consent_prompt";
  prompt_purpose: PromptablePurpose | null;
  prompt_notice_version: string | null;
  attempts: number;
  lease_token: string;
};

type Prepared =
  | {
      ready: true;
      token: string;
      chatId: string;
      text: string;
    }
  | {
      ready: false;
      terminal: "cancelled" | "failed";
      code: string;
    }
  | { ready: false; terminal: "deferred"; until: Date };

async function prepareMessage(
  sql: Bun.SQL,
  tenantId: string,
  message: ClaimedMessage,
  ring: KeyRing,
  tokens: Map<string, string>,
  env: NodeJS.ProcessEnv,
  now: Date
): Promise<Prepared> {
  return withTenantOrThrow(
    sql,
    tenantId,
    async (tx) => {
      const contacts = (await tx`
        SELECT state, chat_ciphertext FROM awcms_telegram_engagement_contacts
        WHERE tenant_id = ${tenantId} AND id = ${message.contact_id}
      `) as { state: ContactState; chat_ciphertext: string | null }[];
      const contact = contacts[0];

      if (!contact || contact.state !== "started" || !contact.chat_ciphertext) {
        return {
          ready: false,
          terminal: "cancelled",
          code: "CONTACT_NOT_STARTED"
        } as const;
      }

      // The withdrawal-wins re-check (ADR-0152 I8 / TG6): the LATEST evidence
      // for the purpose, not the snapshot taken at enqueue.
      const verdict = evaluateEligibility(
        contact.state,
        message.purpose,
        await latestConsent(tx, tenantId, message.contact_id, message.purpose)
      );

      if (!verdict.eligible) {
        return {
          ready: false,
          terminal: "cancelled",
          code: "CONSENT_WITHDRAWN"
        } as const;
      }

      const endpoints = (await tx`
        SELECT id, daily_send_ceiling, breaker_open_until
        FROM awcms_telegram_engagement_endpoints
        WHERE tenant_id = ${tenantId} AND account_id = ${message.account_id}
          AND state = 'active'
      `) as {
        id: string;
        daily_send_ceiling: number;
        breaker_open_until: Date | null;
      }[];
      const endpoint = endpoints[0];

      if (!endpoint) {
        return {
          ready: false,
          terminal: "failed",
          code: "ENDPOINT_NOT_ACTIVE"
        } as const;
      }

      if (endpoint.breaker_open_until && endpoint.breaker_open_until > now) {
        return {
          ready: false,
          terminal: "deferred",
          until: endpoint.breaker_open_until
        } as const;
      }

      if (
        !(await botCapabilityAllowed(tx, tenantId, message.account_id, "dm"))
      ) {
        return {
          ready: false,
          terminal: "failed",
          code: "CAPABILITY_DENIED"
        } as const;
      }

      // Per-bot daily ceiling, never above the deployment cap (ADR-0152 O10).
      const ceiling = Math.min(
        endpoint.daily_send_ceiling,
        resolveDeploymentDailyCap(env)
      );
      const startOfDay = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
      );
      const sentToday = (await tx`
        SELECT count(*)::int AS n FROM awcms_telegram_engagement_messages
        WHERE tenant_id = ${tenantId} AND account_id = ${message.account_id}
          AND sent_at >= ${startOfDay}
      `) as { n: number }[];

      if ((sentToday[0]?.n ?? 0) >= ceiling) {
        const tomorrow = new Date(
          Date.UTC(
            now.getUTCFullYear(),
            now.getUTCMonth(),
            now.getUTCDate() + 1
          )
        );

        return { ready: false, terminal: "deferred", until: tomorrow } as const;
      }

      const textRows = (await tx`
        SELECT text_ciphertext FROM awcms_telegram_engagement_messages
        WHERE tenant_id = ${tenantId} AND id = ${message.id}
      `) as { text_ciphertext: string | null }[];
      const textCiphertext = textRows[0]?.text_ciphertext;

      if (!textCiphertext) {
        return {
          ready: false,
          terminal: "failed",
          code: "CONTENT_UNAVAILABLE"
        } as const;
      }

      let token = tokens.get(message.account_id);
      const account =
        token === undefined
          ? await fetchBotAccount(tx, tenantId, message.account_id)
          : null;

      if (token === undefined && !account?.tokenSecretId) {
        return {
          ready: false,
          terminal: "failed",
          code: "CREDENTIAL_UNAVAILABLE"
        } as const;
      }

      try {
        if (token === undefined) {
          const secretId = account!.tokenSecretId!;

          // In a savepoint: an undecryptable token is an expected refusal.
          token = await tx.savepoint((sp) =>
            resolveBotToken(sp, tenantId, secretId)
          );
          tokens.set(message.account_id, token);
        }

        return {
          ready: true,
          token,
          chatId: decryptChatId(
            contact.chat_ciphertext,
            tenantId,
            message.contact_id,
            ring
          ),
          text: decryptMessageText(textCiphertext, tenantId, message.id, ring)
        } as const;
      } catch {
        return {
          ready: false,
          terminal: "failed",
          code: "SECRET_UNAVAILABLE"
        } as const;
      }
    },
    { workClass: "background_sync" }
  );
}

type Finalization =
  | { kind: "sent"; providerMessageId: number | null }
  | { kind: "uncertain" }
  | { kind: "terminal"; status: "failed" | "cancelled"; code: string }
  | { kind: "requeue"; at: Date; spendAttempt: boolean; code: string | null }
  | { kind: "blocked" }
  | { kind: "token_rejected" };

async function finalizeMessage(
  sql: Bun.SQL,
  tenantId: string,
  message: ClaimedMessage,
  outcome: Finalization,
  correlationId: string,
  now: Date
): Promise<void> {
  await withTenantOrThrow(
    sql,
    tenantId,
    async (tx) => {
      const guard = (await tx`
        SELECT id FROM awcms_telegram_engagement_messages
        WHERE tenant_id = ${tenantId} AND id = ${message.id}
          AND status = 'sending' AND lease_token = ${message.lease_token}
        FOR UPDATE
      `) as { id: string }[];

      // The lease was lost (expired and recovered as uncertain): nothing to do.
      if (guard.length === 0) return;

      switch (outcome.kind) {
        case "sent":
          await tx`
            UPDATE awcms_telegram_engagement_messages
            SET status = 'sent', provider_message_id = ${outcome.providerMessageId},
                sent_at = ${now}, finalized_at = ${now}, text_ciphertext = NULL,
                lease_until = NULL, lease_token = NULL, updated_at = now()
            WHERE tenant_id = ${tenantId} AND id = ${message.id}
          `;
          await tx`
            UPDATE awcms_telegram_engagement_endpoints
            SET consecutive_failures = 0, updated_at = now()
            WHERE tenant_id = ${tenantId} AND account_id = ${message.account_id}
              AND state = 'active' AND consecutive_failures <> 0
          `;

          return;
        case "uncertain":
          await tx`
            UPDATE awcms_telegram_engagement_messages
            SET status = 'uncertain', failure_code = 'DELIVERY_UNCERTAIN',
                finalized_at = ${now}, text_ciphertext = NULL,
                lease_until = NULL, lease_token = NULL, updated_at = now()
            WHERE tenant_id = ${tenantId} AND id = ${message.id}
          `;

          return;
        case "terminal":
          await tx`
            UPDATE awcms_telegram_engagement_messages
            SET status = ${outcome.status}, failure_code = ${outcome.code},
                finalized_at = ${now}, text_ciphertext = NULL,
                lease_until = NULL, lease_token = NULL, updated_at = now()
            WHERE tenant_id = ${tenantId} AND id = ${message.id}
          `;

          return;
        case "requeue":
          await tx`
            UPDATE awcms_telegram_engagement_messages
            SET status = 'queued', next_attempt_at = ${outcome.at},
                attempts = ${outcome.spendAttempt ? message.attempts : Math.max(0, message.attempts - 1)},
                failure_code = ${outcome.code},
                lease_until = NULL, lease_token = NULL, updated_at = now()
            WHERE tenant_id = ${tenantId} AND id = ${message.id}
          `;

          return;
        case "blocked":
          // The person blocked the bot: never retried, and the block withdraws
          // every purpose at once (ADR-0152 section 6, T-C1). The contact row
          // lock is taken first, like every other consent writer, so the
          // evidence order is commit order (audit M-1).
          await tx`
            SELECT id FROM awcms_telegram_engagement_contacts
            WHERE tenant_id = ${tenantId} AND id = ${message.contact_id}
            FOR UPDATE
          `;
          await tx`
            UPDATE awcms_telegram_engagement_messages
            SET status = 'failed', failure_code = 'BLOCKED_BY_USER',
                finalized_at = ${now}, text_ciphertext = NULL,
                lease_until = NULL, lease_token = NULL, updated_at = now()
            WHERE tenant_id = ${tenantId} AND id = ${message.id}
          `;
          await withdrawAllPurposes(tx, tenantId, {
            accountId: message.account_id,
            contactId: message.contact_id,
            method: "provider_forbidden",
            updateId: null,
            occurredAt: now,
            recordedBy: null,
            correlationId
          });
          await tx`
            UPDATE awcms_telegram_engagement_contacts
            SET state = 'blocked', blocked_at = ${now},
                version = version + 1, updated_at = now()
            WHERE tenant_id = ${tenantId} AND id = ${message.contact_id}
              AND state = 'started'
          `;

          return;
        case "token_rejected":
          await tx`
            UPDATE awcms_telegram_engagement_messages
            SET status = 'failed', failure_code = 'TOKEN_REJECTED',
                finalized_at = ${now}, text_ciphertext = NULL,
                lease_until = NULL, lease_token = NULL, updated_at = now()
            WHERE tenant_id = ${tenantId} AND id = ${message.id}
          `;
          await tx`
            UPDATE awcms_telegram_engagement_endpoints
            SET breaker_open_until = ${new Date(now.getTime() + BREAKER_OPEN_SECONDS * 1000)},
                last_error_code = 'TOKEN_REJECTED', updated_at = now()
            WHERE tenant_id = ${tenantId} AND account_id = ${message.account_id}
              AND state = 'active'
          `;
          await recordBotHealth(tx, tenantId, message.account_id, {
            state: "failing",
            reasonCode: "TOKEN_REJECTED"
          });

          return;
      }
    },
    { workClass: "background_sync" }
  );
}

/** Counts one provider failure against the bot's breaker; opens it at the threshold. */
async function chargeBreaker(
  sql: Bun.SQL,
  tenantId: string,
  accountId: string,
  now: Date
): Promise<void> {
  await withTenantOrThrow(
    sql,
    tenantId,
    async (tx) => {
      await tx`
        UPDATE awcms_telegram_engagement_endpoints
        SET consecutive_failures = consecutive_failures + 1,
            breaker_open_until = CASE
              WHEN consecutive_failures + 1 >= ${BREAKER_THRESHOLD}
              THEN ${new Date(now.getTime() + BREAKER_OPEN_SECONDS * 1000)}::timestamptz
              ELSE breaker_open_until END,
            updated_at = now()
        WHERE tenant_id = ${tenantId} AND account_id = ${accountId}
          AND state = 'active'
      `;
    },
    { workClass: "background_sync" }
  );
}

function sendBody(
  message: ClaimedMessage,
  chatId: string,
  text: string
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    chat_id: chatId,
    text,
    link_preview_options: { is_disabled: true }
  };

  if (
    message.kind === "consent_prompt" &&
    message.prompt_purpose &&
    message.prompt_notice_version
  ) {
    body.reply_markup = {
      inline_keyboard: [
        [
          {
            text: "Setuju / I agree",
            callback_data: consentCallbackData(
              message.prompt_purpose,
              message.prompt_notice_version,
              true
            )
          },
          {
            text: "Tidak / No",
            callback_data: consentCallbackData(
              message.prompt_purpose,
              message.prompt_notice_version,
              false
            )
          }
        ]
      ]
    };
  }

  return body;
}

async function dispatchMessages(
  sql: Bun.SQL,
  tenantId: string,
  ring: KeyRing,
  options: Required<
    Pick<DispatchOptions, "transport" | "now" | "sleep" | "env" | "batchSize">
  > & {
    correlationId: string;
  },
  result: DispatchResult
): Promise<void> {
  const now = options.now();

  // Housekeeping first, in one short transaction: a lease that expired mid-send
  // is UNCERTAIN (the process may have died after Telegram accepted it), and a
  // row past its expiry is failed, never sent late.
  const recovered = await withTenantOrThrow(
    sql,
    tenantId,
    async (tx) => {
      const uncertain = (await tx`
        UPDATE awcms_telegram_engagement_messages
        SET status = 'uncertain', failure_code = 'LEASE_EXPIRED',
            text_ciphertext = NULL, finalized_at = now(),
            lease_until = NULL, lease_token = NULL, updated_at = now()
        WHERE tenant_id = ${tenantId} AND status = 'sending'
          AND lease_until < ${now}
        RETURNING id
      `) as { id: string }[];
      const expired = (await tx`
        UPDATE awcms_telegram_engagement_messages
        SET status = 'failed', failure_code = 'EXPIRED',
            text_ciphertext = NULL, finalized_at = now(), updated_at = now()
        WHERE tenant_id = ${tenantId} AND status = 'queued'
          AND expires_at <= ${now}
        RETURNING id
      `) as { id: string }[];

      return { uncertain: uncertain.length, expired: expired.length };
    },
    { workClass: "background_sync" }
  );

  result.uncertain += recovered.uncertain;
  result.failed += recovered.expired;

  const claimed = await withTenantOrThrow(
    sql,
    tenantId,
    async (tx) =>
      (await tx`
        UPDATE awcms_telegram_engagement_messages m
        SET status = 'sending', attempts = m.attempts + 1,
            lease_until = ${new Date(now.getTime() + MESSAGE_LEASE_SECONDS * 1000)},
            lease_token = gen_random_uuid(), updated_at = now()
        WHERE m.id IN (
          SELECT id FROM awcms_telegram_engagement_messages
          WHERE tenant_id = ${tenantId} AND status = 'queued'
            AND next_attempt_at <= ${now}
          ORDER BY next_attempt_at, created_at
          LIMIT ${options.batchSize}
          FOR UPDATE SKIP LOCKED
        ) AND m.tenant_id = ${tenantId}
        RETURNING m.id, m.account_id, m.contact_id, m.purpose, m.kind,
                  m.prompt_purpose, m.prompt_notice_version, m.attempts,
                  m.lease_token
      `) as ClaimedMessage[],
    { workClass: "background_sync" }
  );

  result.claimed += claimed.length;

  // One pacer PER BOT and one PER CHAT (ADR-0152 section 5): the budget is the
  // bot's, so two bots never slow each other down.
  const lastPerBot = new Map<string, number>();
  const lastPerChat = new Map<string, number>();
  const tokens = new Map<string, string>();

  for (const message of claimed) {
    const at = options.now();
    const prepared = await prepareMessage(
      sql,
      tenantId,
      message,
      ring,
      tokens,
      options.env,
      at
    );

    if (!prepared.ready) {
      if (prepared.terminal === "deferred") {
        await finalizeMessage(
          sql,
          tenantId,
          message,
          {
            kind: "requeue",
            at: prepared.until,
            spendAttempt: false,
            code: null
          },
          options.correlationId,
          at
        );
        result.deferred += 1;
      } else {
        await finalizeMessage(
          sql,
          tenantId,
          message,
          { kind: "terminal", status: prepared.terminal, code: prepared.code },
          options.correlationId,
          at
        );

        if (prepared.terminal === "cancelled") result.cancelled += 1;
        else result.failed += 1;
      }

      continue;
    }

    const waitBot =
      (lastPerBot.get(message.account_id) ?? 0) +
      PER_BOT_MIN_INTERVAL_MS -
      Date.now();
    const waitChat =
      (lastPerChat.get(message.contact_id) ?? 0) +
      PER_CHAT_MIN_INTERVAL_MS -
      Date.now();
    const wait = Math.max(waitBot, waitChat);

    if (wait > 0) await options.sleep(wait);

    const outcome = await options.transport(
      prepared.token,
      "sendMessage",
      sendBody(message, prepared.chatId, prepared.text),
      DEFAULT_TIMEOUT_MS
    );

    lastPerBot.set(message.account_id, Date.now());
    lastPerChat.set(message.contact_id, Date.now());

    const finishedAt = options.now();

    if (outcome.kind === "ok") {
      const record =
        typeof outcome.result === "object" && outcome.result !== null
          ? (outcome.result as Record<string, unknown>)
          : {};
      const providerMessageId =
        typeof record.message_id === "number" &&
        Number.isSafeInteger(record.message_id)
          ? record.message_id
          : null;

      await finalizeMessage(
        sql,
        tenantId,
        message,
        { kind: "sent", providerMessageId },
        options.correlationId,
        finishedAt
      );
      result.sent += 1;
      continue;
    }

    if (outcome.kind === "uncertain") {
      await finalizeMessage(
        sql,
        tenantId,
        message,
        { kind: "uncertain" },
        options.correlationId,
        finishedAt
      );
      result.uncertain += 1;
      continue;
    }

    if (outcome.kind === "error") {
      const code = errorCodeOf(outcome);

      if (code === "RATE_LIMITED") {
        // `retry_after` is Telegram's instruction, not our failure: no retry
        // budget is spent and the breaker is not charged.
        await finalizeMessage(
          sql,
          tenantId,
          message,
          {
            kind: "requeue",
            at: new Date(
              finishedAt.getTime() + (outcome.retryAfterSeconds ?? 30) * 1000
            ),
            spendAttempt: false,
            code: "RATE_LIMITED"
          },
          options.correlationId,
          finishedAt
        );
        result.retried += 1;
        continue;
      }

      if (code === "FORBIDDEN_BY_PROVIDER") {
        await finalizeMessage(
          sql,
          tenantId,
          message,
          { kind: "blocked" },
          options.correlationId,
          finishedAt
        );
        result.failed += 1;
        continue;
      }

      if (code === "TOKEN_REJECTED") {
        await finalizeMessage(
          sql,
          tenantId,
          message,
          { kind: "token_rejected" },
          options.correlationId,
          finishedAt
        );
        tokens.delete(message.account_id);
        result.failed += 1;
        continue;
      }

      if (code === "PROVIDER_REJECTED") {
        await finalizeMessage(
          sql,
          tenantId,
          message,
          { kind: "terminal", status: "failed", code },
          options.correlationId,
          finishedAt
        );
        result.failed += 1;
        continue;
      }
    }

    // A 5xx, an unparseable answer, or nothing sent (guard refusal): retry with
    // backoff until the budget is spent, and charge the bot's breaker.
    await chargeBreaker(sql, tenantId, message.account_id, finishedAt);

    if (message.attempts >= MAX_DISPATCH_ATTEMPTS) {
      await finalizeMessage(
        sql,
        tenantId,
        message,
        { kind: "terminal", status: "failed", code: "RETRY_EXHAUSTED" },
        options.correlationId,
        finishedAt
      );
      result.failed += 1;
    } else {
      await finalizeMessage(
        sql,
        tenantId,
        message,
        {
          kind: "requeue",
          at: new Date(
            finishedAt.getTime() + backoffSeconds(message.attempts) * 1000
          ),
          spendAttempt: true,
          code:
            outcome.kind === "error"
              ? errorCodeOf(outcome)
              : "PROVIDER_UNREACHABLE"
        },
        options.correlationId,
        finishedAt
      );
      result.retried += 1;
    }
  }
}

/**
 * One tenant pass: connector, then the queue. A no-op (claims nothing) unless
 * `TELEGRAM_ENGAGEMENT_ENABLED=true` and the module ring is configured.
 */
export async function dispatchTelegramEngagement(
  sql: Bun.SQL,
  tenantId: string,
  options: DispatchOptions = {}
): Promise<DispatchResult> {
  const env = options.env ?? process.env;
  const result = emptyResult();

  if (!isTelegramEngagementEnabled(env)) return result;

  const ring = resolveTelegramEngagementRing(env);

  if (!ring.ok) {
    log("error", "telegram_engagement.dispatch.ring_unavailable", {
      moduleKey: TELEGRAM_ENGAGEMENT_MODULE_KEY
    });

    return result;
  }

  const transport = options.transport ?? defaultBotApiTransport;

  await runConnector(sql, tenantId, transport, env, result);
  await dispatchMessages(
    sql,
    tenantId,
    ring,
    {
      transport,
      now: options.now ?? (() => new Date()),
      sleep: options.sleep ?? defaultSleep,
      env,
      batchSize: options.batchSize ?? 50,
      correlationId: options.correlationId ?? crypto.randomUUID()
    },
    result
  );

  return result;
}
