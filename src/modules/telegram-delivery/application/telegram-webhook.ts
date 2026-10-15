/**
 * The webhook's two commands (Issue #965, ADR-0140 sections 3 and 4): `/start
 * <code>` and `/stop`, both from a private chat only. Everything else is ignored
 * with no reply (`parseTelegramUpdate` decides that; this file never sees it).
 *
 * The caller (`POST /api/v1/telegram/webhook`) has ALREADY verified the secret
 * header, the body limit and the rate limit. This file does the work.
 *
 * ## The tenant is never taken from the payload
 *
 * `/start`: the tenant comes from the CODE (`awcms_telegram_resolve_link_code`,
 * `sql/217`), and the principal from the code row the atomic consume returns.
 * `/stop`: the tenant comes from the BINDING found by the chat's KEYED hash. The
 * hash is bound to the tenant, so it cannot be looked up without knowing the
 * tenant; the candidate list is therefore one hash per active tenant per ring
 * key, built here from the secret ring. Nothing the sender wrote selects a tenant.
 *
 * ## Replies are the webhook's HTTP response, not a provider call
 *
 * ADR-0140 section 4 says the acknowledgements "go through the same queue".
 * That cannot hold for all of them, and the contradiction is recorded in the
 * module README rather than resolved by guessing: a queue row carries a binding
 * and a tenant, and the reply to an unknown code has neither, while `/stop` has
 * just erased the only copy of the chat id. So a reply is returned to the route,
 * which sends it as the response to Telegram's own request (the Bot API's
 * webhook-reply form). The webhook therefore makes no outbound call, never holds
 * the bot token, and stores no chat id anywhere new.
 */
import { withTenantOrThrow } from "../../../lib/database/tenant-context";
import { log } from "../../../lib/logging/logger";
import { resolveTenantPrincipalForTenantUser } from "../../identity-access/application/auth-context";
import { recordAuditEvent } from "../../logging/application/audit-log";
import {
  chatHashCandidates,
  sanitizeDisplayName
} from "../domain/telegram-chat";
import {
  resolveTelegramEncryptionRing,
  resolveTelegramHashRing
} from "../domain/telegram-config";
import { TELEGRAM_MODULE_KEY } from "../domain/telegram-constants";
import {
  hashLinkCode,
  parseTelegramUpdate,
  TELEGRAM_REPLY_CODE_NOT_VALID,
  TELEGRAM_REPLY_STOPPED,
  telegramReplyAlreadyLinked,
  telegramReplyLinked
} from "../domain/telegram-link-code";
import {
  auditEndedBindings,
  createPendingBinding,
  endBindings
} from "./telegram-bindings";
import { consumeLinkCode } from "./telegram-link-codes";
import { isTenantGateOpen, readTelegramTenantGate } from "./telegram-settings";

export type TelegramWebhookResult = {
  /** Plain-text reply to send as the webhook response, or `null` for none. */
  reply: string | null;
  /**
   * The chat the reply goes back to: Telegram's own id for the chat that just
   * wrote to the bot, held in memory for the length of one request and handed
   * straight back in the HTTP response. Never stored, logged or audited.
   */
  replyChatId: string | null;
  /** What happened, for tests and counters. Never includes the chat or the code. */
  outcome:
    | "ignored"
    | "linked"
    | "already_linked"
    | "code_not_valid"
    | "stopped"
    | "misconfigured";
};

export type HandleTelegramWebhookOptions = {
  env?: NodeJS.ProcessEnv;
  now?: Date;
  correlationId?: string;
};

type LinkOutcome =
  | { kind: "linked"; tenantLabel: string | null; pin: string }
  | { kind: "already_linked"; tenantLabel: string | null }
  | { kind: "invalid" };

/**
 * `getSql` is a thunk so an update that is ignored, or answered from the shape
 * alone, never so much as obtains a database client.
 */
export async function handleTelegramWebhookUpdate(
  getSql: () => Bun.SQL,
  update: unknown,
  options: HandleTelegramWebhookOptions = {}
): Promise<TelegramWebhookResult> {
  const env = options.env ?? process.env;
  const now = options.now ?? new Date();
  const command = parseTelegramUpdate(update);

  if (command.kind === "ignored") {
    return { reply: null, replyChatId: null, outcome: "ignored" };
  }

  if (command.kind === "start_invalid") {
    return {
      reply: TELEGRAM_REPLY_CODE_NOT_VALID,
      replyChatId: command.chatId,
      outcome: "code_not_valid"
    };
  }

  const hashRing = resolveTelegramHashRing(env);

  if (command.kind === "stop") {
    // Fail closed: without the hash ring no lookup is possible. Say nothing
    // rather than claim an alert stopped that did not.
    if (!hashRing.ok) {
      log("error", "telegram.webhook.hash_keys_unavailable", {
        moduleKey: TELEGRAM_MODULE_KEY
      });

      return { reply: null, replyChatId: null, outcome: "misconfigured" };
    }

    const sql = getSql();
    const tenants = (await sql`
      SELECT id FROM awcms_tenants WHERE status = 'active'
    `) as { id: string }[];
    const candidates = tenants.flatMap((tenant) =>
      chatHashCandidates(command.chatId, tenant.id, hashRing)
    );

    if (candidates.length > 0) {
      const found = (await sql`
        SELECT tenant_id, binding_id
        FROM awcms_telegram_find_bindings_by_chat_hash(${candidates.join(",")})
      `) as { tenant_id: string; binding_id: string }[];

      for (const match of found) {
        await withTenantOrThrow(
          sql,
          match.tenant_id,
          async (tx) => {
            const ended = await endBindings(
              tx,
              match.tenant_id,
              { bindingId: match.binding_id },
              "self_stop"
            );

            await auditEndedBindings(tx, match.tenant_id, ended, "self_stop", {
              ...(options.correlationId
                ? { correlationId: options.correlationId }
                : {})
            });
          },
          { workClass: "interactive" }
        );
      }
    }

    // The same reply whether or not a binding was found: not an oracle.
    return {
      reply: TELEGRAM_REPLY_STOPPED,
      replyChatId: command.chatId,
      outcome: "stopped"
    };
  }

  const encryptionRing = resolveTelegramEncryptionRing(env);

  // Fail closed: no usable ring means no binding is created.
  if (!encryptionRing.ok || !hashRing.ok) {
    log("error", "telegram.webhook.keys_unavailable", {
      moduleKey: TELEGRAM_MODULE_KEY
    });

    return { reply: null, replyChatId: null, outcome: "misconfigured" };
  }

  const sql = getSql();
  const resolved = (await sql`
    SELECT tenant_id FROM awcms_telegram_resolve_link_code(${hashLinkCode(command.code)})
  `) as { tenant_id: string }[];
  const tenantId = resolved[0]?.tenant_id;

  if (!tenantId) {
    return {
      reply: TELEGRAM_REPLY_CODE_NOT_VALID,
      replyChatId: command.chatId,
      outcome: "code_not_valid"
    };
  }

  const outcome: LinkOutcome = await withTenantOrThrow(
    sql,
    tenantId,
    async (tx): Promise<LinkOutcome> => {
      // A tenant with the module or the setting off binds nobody (levels 2 and 3
      // of ADR-0140 section 2). The code is left unconsumed.
      if (!isTenantGateOpen(await readTelegramTenantGate(tx, tenantId))) {
        return { kind: "invalid" };
      }

      const consumed = await consumeLinkCode(tx, tenantId, command.code);

      // Lost the race (two parallel `/start`s) or expired between the two reads.
      if (!consumed) {
        return { kind: "invalid" };
      }

      // The person must still be an active member of staff holding a role.
      const principal = await resolveTenantPrincipalForTenantUser(
        tx,
        tenantId,
        consumed.principalId
      );

      if (!principal || principal.context.roles.length === 0) {
        return { kind: "invalid" };
      }

      const tenantRows = (await tx`
        SELECT tenant_name FROM awcms_tenants WHERE id = ${tenantId}
      `) as { tenant_name: string }[];
      const tenantLabel = sanitizeDisplayName(tenantRows[0]?.tenant_name, null);

      const created = await createPendingBinding(tx, {
        tenantId,
        principalId: consumed.principalId,
        chatId: command.chatId,
        firstName: command.firstName,
        lastName: command.lastName,
        username: command.username,
        encryptionRing,
        hashRing,
        now,
        ...(options.correlationId
          ? { correlationId: options.correlationId }
          : {})
      });

      if (created.outcome === "chat_in_use") {
        await recordAuditEvent(tx, {
          tenantId,
          moduleKey: TELEGRAM_MODULE_KEY,
          action: "telegram_binding.rejected",
          resourceType: "telegram_binding",
          severity: "warning",
          message:
            "A Telegram chat that is already linked to another staff member used a link code.",
          attributes: {
            reason: "chat_in_use",
            principalId: consumed.principalId
          },
          ...(options.correlationId
            ? { correlationId: options.correlationId }
            : {})
        });

        return { kind: "invalid" };
      }

      if (created.outcome === "already_active") {
        return { kind: "already_linked", tenantLabel };
      }

      return { kind: "linked", tenantLabel, pin: created.pin };
    },
    { workClass: "interactive" }
  );

  if (outcome.kind === "linked") {
    return {
      reply: telegramReplyLinked(outcome.tenantLabel, outcome.pin),
      replyChatId: command.chatId,
      outcome: "linked"
    };
  }

  if (outcome.kind === "already_linked") {
    return {
      reply: telegramReplyAlreadyLinked(outcome.tenantLabel),
      replyChatId: command.chatId,
      outcome: "already_linked"
    };
  }

  return {
    reply: TELEGRAM_REPLY_CODE_NOT_VALID,
    replyChatId: command.chatId,
    outcome: "code_not_valid"
  };
}
