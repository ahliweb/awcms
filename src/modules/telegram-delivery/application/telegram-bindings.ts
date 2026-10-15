/**
 * Chat bindings (Issue #965, ADR-0140 section 3): create, confirm, reject,
 * revoke, suspend, list. Every function takes an already-open TENANT transaction
 * (RLS in force) and every state change is audited with the chat appearing only
 * as its mask.
 *
 * ## The one revocation path
 *
 * Every way a binding stops being live (the person, an administrator, the
 * webhook's `/stop`, a deactivated principal, a switched-off module or tenant,
 * Telegram answering 403, a rejected or expired confirmation, a re-bind) runs
 * through `endBindings`. It is one statement that flips the status, **nulls the
 * ciphertext** (the schema has a CHECK that a non-live binding holds none) and
 * clears the captured display data, followed by one statement that cancels the
 * queue rows still waiting for that binding. A row already `sending` is bounded
 * by the provider timeout, exactly as WhatsApp's opt-out is. The hash stays as a
 * tombstone: the same chat cannot be re-linked without a fresh handshake by its
 * owner.
 */
import type { KeyRing } from "../../../lib/security/field-encryption";
import { recordAuditEvent } from "../../logging/application/audit-log";
import {
  chatHashCandidates,
  encryptChatId,
  hashChatId,
  maskChatId,
  maskUsername,
  sanitizeDisplayName
} from "../domain/telegram-chat";
import {
  TELEGRAM_MODULE_KEY,
  type TelegramBindingStatus,
  type TelegramRevokeCause
} from "../domain/telegram-constants";
import { PENDING_CONFIRMATION_TTL_MS } from "../domain/telegram-link-code";
import {
  generateVerificationPin,
  hashVerificationPin,
  PIN_MAX_ATTEMPTS,
  verifyVerificationPin
} from "../domain/telegram-pin";

export type TelegramBindingView = {
  id: string;
  principalId: string;
  /** The principal's login, masked; `null` when it cannot be read. */
  principalLabel: string | null;
  status: TelegramBindingStatus;
  chatMasked: string;
  /** Present only while `pending_confirmation`; cleared on confirm, reject and expiry. */
  displayName: string | null;
  usernameMasked: string | null;
  pendingExpiresAt: string | null;
  confirmedAt: string | null;
  revokedAt: string | null;
  revokeCause: TelegramRevokeCause | null;
  createdAt: string;
};

type BindingRow = {
  id: string;
  principal_id: string;
  login_identifier?: string | null;
  status: TelegramBindingStatus;
  chat_masked: string;
  display_name: string | null;
  username_masked: string | null;
  pending_expires_at: Date | string | null;
  confirmed_at: Date | string | null;
  revoked_at: Date | string | null;
  revoke_cause: TelegramRevokeCause | null;
  created_at: Date | string;
};

const iso = (value: Date | string): string =>
  value instanceof Date ? value.toISOString() : new Date(value).toISOString();
const isoOrNull = (value: Date | string | null): string | null =>
  value === null ? null : iso(value);

/** `b***@example.com`-style: enough to tell colleagues apart, not enough to look anyone up. */
export function maskLoginIdentifier(
  value: string | null | undefined
): string | null {
  if (!value) {
    return null;
  }

  const at = value.indexOf("@");

  if (at > 0) {
    return `${value[0]}${"*".repeat(Math.max(at - 1, 1))}${value.slice(at)}`;
  }

  return value.length <= 2
    ? "*".repeat(value.length)
    : `${value[0]}${"*".repeat(value.length - 2)}${value.at(-1)}`;
}

function toView(row: BindingRow): TelegramBindingView {
  return {
    id: row.id,
    principalId: row.principal_id,
    principalLabel: maskLoginIdentifier(row.login_identifier),
    status: row.status,
    chatMasked: row.chat_masked,
    displayName: row.display_name,
    usernameMasked: row.username_masked,
    pendingExpiresAt: isoOrNull(row.pending_expires_at),
    confirmedAt: isoOrNull(row.confirmed_at),
    revokedAt: isoOrNull(row.revoked_at),
    revokeCause: row.revoke_cause,
    createdAt: iso(row.created_at)
  };
}

export type EndedBinding = {
  id: string;
  principalId: string;
  previousStatus: "pending_confirmation" | "active";
  chatMasked: string;
};

export type EndBindingsFilter = {
  bindingId?: string;
  /** Several bindings at once (the liveness sweep). An EMPTY list matches nothing. */
  bindingIds?: readonly string[];
  principalId?: string;
  /** Restrict to bindings currently in this status (e.g. only the PENDING one on a re-link). */
  onlyStatus?: "pending_confirmation" | "active";
  /** Bindings whose pending window has passed. */
  pendingExpiredBefore?: Date;
  /** Every live binding in the tenant (module or tenant switched off). Must be explicit: an empty filter is a bug, not "all". */
  all?: true;
};

export type EndBindingsResult = {
  ended: EndedBinding[];
  cancelledMessages: number;
};

/**
 * Ends the matching live bindings and cancels what is queued for them. `{ all:
 * true }` ends EVERY live binding in the tenant (module or tenant switched off).
 */
export async function endBindings(
  tx: Bun.SQL,
  tenantId: string,
  filter: EndBindingsFilter,
  cause: TelegramRevokeCause,
  options: {
    status?: "revoked" | "suspended";
    actorTenantUserId?: string | null;
  } = {}
): Promise<EndBindingsResult> {
  if (
    filter.all !== true &&
    filter.bindingId === undefined &&
    filter.bindingIds === undefined &&
    filter.principalId === undefined &&
    filter.pendingExpiredBefore === undefined
  ) {
    throw new TypeError(
      "endBindings needs a filter; pass { all: true } to end every live binding."
    );
  }

  const status = options.status ?? "revoked";
  const bindingId = filter.bindingId ?? null;
  const bindingIds =
    filter.bindingIds === undefined ? null : filter.bindingIds.join(",");
  const principalId = filter.principalId ?? null;
  const onlyStatus = filter.onlyStatus ?? null;
  const pendingExpiredBefore = filter.pendingExpiredBefore ?? null;

  const rows = (await tx`
    WITH target AS (
      SELECT id, status AS previous_status
      FROM awcms_telegram_bindings
      WHERE tenant_id = ${tenantId}
        AND status IN ('pending_confirmation', 'active')
        AND (${bindingId}::uuid IS NULL OR id = ${bindingId}::uuid)
        AND (${bindingIds}::text IS NULL
             OR id = ANY(string_to_array(${bindingIds}::text, ',')::uuid[]))
        AND (${principalId}::uuid IS NULL OR principal_id = ${principalId}::uuid)
        AND (${onlyStatus}::text IS NULL OR status = ${onlyStatus}::text)
        AND (${pendingExpiredBefore}::timestamptz IS NULL
             OR (status = 'pending_confirmation'
                 AND pending_expires_at <= ${pendingExpiredBefore}::timestamptz))
      FOR UPDATE
    ),
    ended AS (
      UPDATE awcms_telegram_bindings b
      SET status = ${status}, chat_ciphertext = NULL, display_name = NULL,
          username_masked = NULL, pending_expires_at = NULL, pin_hash = NULL,
          revoked_at = now(),
          revoke_cause = ${cause}, revoked_by = ${options.actorTenantUserId ?? null},
          updated_at = now()
      FROM target t
      WHERE b.tenant_id = ${tenantId} AND b.id = t.id
      RETURNING b.id, b.principal_id, b.chat_masked, t.previous_status
    )
    SELECT id, principal_id, chat_masked, previous_status FROM ended
  `) as {
    id: string;
    principal_id: string;
    chat_masked: string;
    previous_status: "pending_confirmation" | "active";
  }[];

  const ended = rows.map((row) => ({
    id: row.id,
    principalId: row.principal_id,
    previousStatus: row.previous_status,
    chatMasked: row.chat_masked
  }));

  let cancelledMessages = 0;

  if (ended.length > 0) {
    const cancelled = (await tx`
      UPDATE awcms_telegram_messages
      SET status = 'cancelled', next_attempt_at = NULL,
          failure_code = 'binding_revoked', body = '', variables = '{}'::jsonb,
          updated_at = now()
      WHERE tenant_id = ${tenantId}
        AND binding_id = ANY(string_to_array(${ended.map((entry) => entry.id).join(",")}, ',')::uuid[])
        AND status IN ('queued', 'retry_wait')
      RETURNING id
    `) as { id: string }[];

    cancelledMessages = cancelled.length;
  }

  return { ended, cancelledMessages };
}

const HIGH_ATTENTION_CAUSES: ReadonlySet<TelegramRevokeCause> = new Set([
  "admin",
  "provider_blocked",
  "tenant_disabled",
  "tenant_suspended",
  "module_disabled",
  "principal_deactivated"
]);

/** One `telegram_binding.revoked` audit row per ended binding. The chat appears only as its mask. */
export async function auditEndedBindings(
  tx: Bun.SQL,
  tenantId: string,
  result: EndBindingsResult,
  cause: TelegramRevokeCause,
  context: { actorTenantUserId?: string | null; correlationId?: string }
): Promise<void> {
  for (const binding of result.ended) {
    await recordAuditEvent(tx, {
      tenantId,
      ...(context.actorTenantUserId
        ? { actorTenantUserId: context.actorTenantUserId }
        : {}),
      moduleKey: TELEGRAM_MODULE_KEY,
      action: "telegram_binding.revoked",
      resourceType: "telegram_binding",
      resourceId: binding.id,
      severity: HIGH_ATTENTION_CAUSES.has(cause) ? "warning" : "info",
      message: `Telegram binding ended: cause=${cause}.`,
      attributes: {
        cause,
        principalId: binding.principalId,
        previousStatus: binding.previousStatus,
        chatMasked: binding.chatMasked,
        cancelledMessages: result.cancelledMessages
      },
      ...(context.correlationId ? { correlationId: context.correlationId } : {})
    });
  }
}

export type CreatePendingBindingInput = {
  tenantId: string;
  principalId: string;
  chatId: string;
  firstName: unknown;
  lastName: unknown;
  username: unknown;
  encryptionRing: KeyRing;
  hashRing: KeyRing;
  now: Date;
  correlationId?: string;
};

export type CreatePendingBindingResult =
  /**
   * `pin` is the plaintext verification PIN (Issue #1008), returned ONCE so the
   * webhook can hand it back to the chat that sent `/start`. Only its keyed hash
   * is stored; the caller must not log, audit or persist it.
   */
  | { outcome: "created"; bindingId: string; pin: string }
  /** The chat is already live in another principal in this tenant, or won a race. */
  | { outcome: "chat_in_use" }
  /** The same principal already has this chat active. Nothing to confirm. */
  | { outcome: "already_active" };

/**
 * The webhook's `/start <code>` after the code was consumed: writes a
 * `pending_confirmation` binding. The tenant and principal came from the CODE
 * ROW, never from the payload.
 */
export async function createPendingBinding(
  tx: Bun.SQL,
  input: CreatePendingBindingInput
): Promise<CreatePendingBindingResult> {
  // Every ring key's candidate, not just the primary: after a rotation the same
  // chat may sit under an older key's hash.
  const candidates = chatHashCandidates(
    input.chatId,
    input.tenantId,
    input.hashRing
  );

  const live = (await tx`
    SELECT id, principal_id, status
    FROM awcms_telegram_bindings
    WHERE tenant_id = ${input.tenantId}
      AND chat_hash = ANY(string_to_array(${candidates.join(",")}, ','))
      AND status IN ('pending_confirmation', 'active')
  `) as { id: string; principal_id: string; status: string }[];

  const sameActive = live.find(
    (row) => row.principal_id === input.principalId && row.status === "active"
  );

  if (sameActive) {
    return { outcome: "already_active" };
  }

  // A chat that is live in ANOTHER principal is refused. A live PENDING row for
  // this same principal and chat is simply replaced below (superseded).
  if (live.some((row) => row.principal_id !== input.principalId)) {
    return { outcome: "chat_in_use" };
  }

  await endBindings(
    tx,
    input.tenantId,
    { principalId: input.principalId, onlyStatus: "pending_confirmation" },
    "superseded"
  );

  const bindingId = crypto.randomUUID();
  const { chatHash, hashKeyId } = hashChatId(
    input.chatId,
    input.tenantId,
    input.hashRing
  );
  const ciphertext = encryptChatId(
    input.chatId,
    input.tenantId,
    bindingId,
    input.encryptionRing
  );
  const displayName = sanitizeDisplayName(input.firstName, input.lastName);
  const usernameMasked = maskUsername(input.username);
  const chatMasked = maskChatId(input.chatId);
  const pendingExpiresAt = new Date(
    input.now.getTime() + PENDING_CONFIRMATION_TTL_MS
  );
  const pin = generateVerificationPin();
  const pinHash = hashVerificationPin(
    pin,
    input.tenantId,
    bindingId,
    input.hashRing
  );

  const inserted = (await tx`
    INSERT INTO awcms_telegram_bindings
      (id, tenant_id, principal_id, status, chat_ciphertext, chat_hash,
       hash_key_id, chat_masked, display_name, username_masked,
       pending_expires_at, pin_hash)
    VALUES (${bindingId}, ${input.tenantId}, ${input.principalId},
            'pending_confirmation', ${ciphertext}, ${chatHash}, ${hashKeyId},
            ${chatMasked}, ${displayName}, ${usernameMasked},
            ${pendingExpiresAt}, ${pinHash})
    ON CONFLICT DO NOTHING
    RETURNING id
  `) as { id: string }[];

  if (inserted.length === 0) {
    return { outcome: "chat_in_use" };
  }

  await recordAuditEvent(tx, {
    tenantId: input.tenantId,
    moduleKey: TELEGRAM_MODULE_KEY,
    action: "telegram_binding.created",
    resourceType: "telegram_binding",
    resourceId: bindingId,
    severity: "info",
    message:
      "Telegram chat reached the bot with a valid code; awaiting confirmation.",
    attributes: {
      principalId: input.principalId,
      chatMasked,
      status: "pending_confirmation"
    },
    ...(input.correlationId ? { correlationId: input.correlationId } : {})
  });

  return { outcome: "created", bindingId, pin };
}

/** The caller's own current binding (a live one, else the latest ended one for context), with the captured name while pending. */
export async function getOwnBinding(
  tx: Bun.SQL,
  tenantId: string,
  principalId: string
): Promise<TelegramBindingView | null> {
  const rows = (await tx`
    SELECT b.id, b.principal_id, i.login_identifier, b.status, b.chat_masked,
           b.display_name, b.username_masked, b.pending_expires_at,
           b.confirmed_at, b.revoked_at, b.revoke_cause, b.created_at
    FROM awcms_telegram_bindings b
    LEFT JOIN awcms_tenant_users tu
      ON tu.tenant_id = b.tenant_id AND tu.id = b.principal_id
    LEFT JOIN awcms_identities i
      ON i.tenant_id = tu.tenant_id AND i.id = tu.identity_id
    WHERE b.tenant_id = ${tenantId} AND b.principal_id = ${principalId}
      AND b.status IN ('pending_confirmation', 'active')
    ORDER BY (b.status = 'pending_confirmation') DESC, b.created_at DESC
    LIMIT 1
  `) as BindingRow[];

  const row = rows[0];

  if (!row) {
    return null;
  }

  // A pending binding past its window is not offered for confirmation; the
  // sweep (dispatcher and purge) ends it and erases its ciphertext.
  if (
    row.status === "pending_confirmation" &&
    row.pending_expires_at !== null &&
    new Date(row.pending_expires_at).getTime() <= Date.now()
  ) {
    return null;
  }

  return toView(row);
}

export type ListBindingsOptions = {
  status?: TelegramBindingStatus;
  limit: number;
};

/** The tenant's bindings, newest first, masked. Never a ciphertext, hash or full chat id. */
export async function listBindings(
  tx: Bun.SQL,
  tenantId: string,
  options: ListBindingsOptions
): Promise<{ bindings: TelegramBindingView[]; hasMore: boolean }> {
  const status = options.status ?? null;
  const rows = (await tx`
    SELECT b.id, b.principal_id, i.login_identifier, b.status, b.chat_masked,
           NULL::text AS display_name, b.username_masked, b.pending_expires_at,
           b.confirmed_at, b.revoked_at, b.revoke_cause, b.created_at
    FROM awcms_telegram_bindings b
    LEFT JOIN awcms_tenant_users tu
      ON tu.tenant_id = b.tenant_id AND tu.id = b.principal_id
    LEFT JOIN awcms_identities i
      ON i.tenant_id = tu.tenant_id AND i.id = tu.identity_id
    WHERE b.tenant_id = ${tenantId}
      AND (${status}::text IS NULL OR b.status = ${status})
    ORDER BY b.created_at DESC, b.id
    LIMIT ${options.limit + 1}
  `) as BindingRow[];

  return {
    bindings: rows.slice(0, options.limit).map(toView),
    hasMore: rows.length > options.limit
  };
}

export type ConfirmOwnBindingResult =
  | {
      outcome: "confirmed";
      bindingId: string;
      replacedBindingId: string | null;
    }
  | { outcome: "none" }
  /** The caller named a binding that is not the one now waiting for them (they may be answering a stale prompt). */
  | { outcome: "mismatch" }
  /** The PIN was wrong (or the row has none). `attemptsLeft` is how many wrong answers remain before the binding is ended. */
  | { outcome: "pin_invalid"; attemptsLeft: number }
  /** Too many wrong PINs: the pending binding was ended and its chat id erased. */
  | { outcome: "pin_locked" };

/**
 * The staff member answers "is this you?" in their own authenticated session,
 * WITH the PIN the bot sent to the chat (Issue #1008). Only here does a binding
 * become `active`: a code that was forwarded, phished or shoulder-surfed binds
 * an attacker's chat at most to `pending_confirmation`, the prompt appears only
 * in the victim's session, and answering it needs something only the holder of
 * the chat saw. An existing active binding of the same principal is replaced
 * (audited as a re-bind).
 *
 * A wrong PIN is counted in the same transaction (`pin_attempts`, a database
 * column, so Redis being down changes nothing); the `PIN_MAX_ATTEMPTS`-th wrong
 * answer ends the binding. The caller must COMMIT after a `pin_invalid` or
 * `pin_locked` outcome: the tenant route does, because it returns a response
 * rather than throwing.
 */
export async function confirmOwnBinding(
  tx: Bun.SQL,
  tenantId: string,
  principalId: string,
  bindingId: string,
  pin: string,
  hashRing: KeyRing,
  context: { correlationId?: string } = {}
): Promise<ConfirmOwnBindingResult> {
  const pending = (await tx`
    SELECT id, chat_masked, pin_hash, pin_attempts
    FROM awcms_telegram_bindings
    WHERE tenant_id = ${tenantId} AND principal_id = ${principalId}
      AND status = 'pending_confirmation' AND pending_expires_at > now()
    FOR UPDATE
  `) as {
    id: string;
    chat_masked: string;
    pin_hash: string | null;
    pin_attempts: number;
  }[];

  const target = pending[0];

  if (!target) {
    return { outcome: "none" };
  }

  // The answer is to THE chat the person was shown. If a newer code replaced it
  // between the prompt and the click, confirming "whatever is pending" would
  // activate a chat they never looked at.
  if (target.id !== bindingId) {
    return { outcome: "mismatch" };
  }

  const verified =
    Number(target.pin_attempts) < PIN_MAX_ATTEMPTS &&
    verifyVerificationPin(pin, target.pin_hash, tenantId, target.id, hashRing);

  if (!verified) {
    const attempts = Number(target.pin_attempts) + 1;

    await tx`
      UPDATE awcms_telegram_bindings
      SET pin_attempts = ${attempts}, updated_at = now()
      WHERE tenant_id = ${tenantId} AND id = ${target.id}
        AND status = 'pending_confirmation'
    `;

    if (attempts < PIN_MAX_ATTEMPTS) {
      await recordAuditEvent(tx, {
        tenantId,
        actorTenantUserId: principalId,
        moduleKey: TELEGRAM_MODULE_KEY,
        action: "telegram_binding.pin_failed",
        resourceType: "telegram_binding",
        resourceId: target.id,
        severity: "warning",
        message: "A wrong Telegram verification PIN was entered.",
        attributes: {
          chatMasked: target.chat_masked,
          principalId,
          attempts
        },
        ...(context.correlationId
          ? { correlationId: context.correlationId }
          : {})
      });

      return {
        outcome: "pin_invalid",
        attemptsLeft: PIN_MAX_ATTEMPTS - attempts
      };
    }

    const ended = await endBindings(
      tx,
      tenantId,
      { bindingId: target.id, onlyStatus: "pending_confirmation" },
      "rejected",
      { actorTenantUserId: principalId }
    );

    await recordAuditEvent(tx, {
      tenantId,
      actorTenantUserId: principalId,
      moduleKey: TELEGRAM_MODULE_KEY,
      action: "telegram_binding.pin_locked",
      resourceType: "telegram_binding",
      resourceId: target.id,
      severity: "warning",
      message:
        "A pending Telegram binding was ended after too many wrong verification PINs.",
      attributes: {
        chatMasked: target.chat_masked,
        principalId,
        attempts
      },
      ...(context.correlationId ? { correlationId: context.correlationId } : {})
    });
    await auditEndedBindings(tx, tenantId, ended, "rejected", {
      actorTenantUserId: principalId,
      ...(context.correlationId ? { correlationId: context.correlationId } : {})
    });

    return { outcome: "pin_locked" };
  }

  // The unique index allows one ACTIVE binding per principal, so the previous
  // one must end before the new one begins.
  const replaced = await endBindings(
    tx,
    tenantId,
    { principalId, onlyStatus: "active" },
    "rebound",
    { actorTenantUserId: principalId }
  );

  await auditEndedBindings(tx, tenantId, replaced, "rebound", {
    actorTenantUserId: principalId,
    ...(context.correlationId ? { correlationId: context.correlationId } : {})
  });

  await tx`
    UPDATE awcms_telegram_bindings
    SET status = 'active', confirmed_at = now(), display_name = NULL,
        username_masked = NULL, pending_expires_at = NULL, pin_hash = NULL,
        updated_at = now()
    WHERE tenant_id = ${tenantId} AND id = ${target.id}
      AND status = 'pending_confirmation'
  `;

  const replacedBindingId = replaced.ended[0]?.id ?? null;

  await recordAuditEvent(tx, {
    tenantId,
    actorTenantUserId: principalId,
    moduleKey: TELEGRAM_MODULE_KEY,
    action: "telegram_binding.confirmed",
    resourceType: "telegram_binding",
    resourceId: target.id,
    severity: "info",
    message: "Staff member confirmed their Telegram chat with its PIN.",
    attributes: { chatMasked: target.chat_masked, principalId },
    ...(context.correlationId ? { correlationId: context.correlationId } : {})
  });

  if (replacedBindingId) {
    await recordAuditEvent(tx, {
      tenantId,
      actorTenantUserId: principalId,
      moduleKey: TELEGRAM_MODULE_KEY,
      action: "telegram_binding.rebound",
      resourceType: "telegram_binding",
      resourceId: target.id,
      severity: "info",
      message: "A new Telegram chat replaced the previous binding.",
      attributes: { replacedBindingId, principalId },
      ...(context.correlationId ? { correlationId: context.correlationId } : {})
    });
  }

  return { outcome: "confirmed", bindingId: target.id, replacedBindingId };
}

/** The staff member rejects the displayed chat ("not me"): the pending binding ends and its data is erased. */
export async function rejectOwnBinding(
  tx: Bun.SQL,
  tenantId: string,
  principalId: string,
  bindingId: string,
  context: { correlationId?: string } = {}
): Promise<{ rejected: boolean; mismatch: boolean }> {
  const waiting = (await tx`
    SELECT id FROM awcms_telegram_bindings
    WHERE tenant_id = ${tenantId} AND principal_id = ${principalId}
      AND status = 'pending_confirmation'
  `) as { id: string }[];

  if (waiting.length > 0 && waiting[0]!.id !== bindingId) {
    return { rejected: false, mismatch: true };
  }

  const result = await endBindings(
    tx,
    tenantId,
    { bindingId, principalId, onlyStatus: "pending_confirmation" },
    "rejected",
    { actorTenantUserId: principalId }
  );

  for (const binding of result.ended) {
    await recordAuditEvent(tx, {
      tenantId,
      actorTenantUserId: principalId,
      moduleKey: TELEGRAM_MODULE_KEY,
      action: "telegram_binding.rejected",
      resourceType: "telegram_binding",
      resourceId: binding.id,
      severity: "warning",
      message:
        "Staff member rejected a Telegram chat that used their link code.",
      attributes: { chatMasked: binding.chatMasked, principalId },
      ...(context.correlationId ? { correlationId: context.correlationId } : {})
    });
  }

  return { rejected: result.ended.length > 0, mismatch: false };
}

/** Sweeps pending bindings whose confirmation window passed: ciphertext erased, display data cleared. */
export async function expirePendingBindings(
  tx: Bun.SQL,
  tenantId: string,
  now: Date,
  context: { correlationId?: string } = {}
): Promise<number> {
  const result = await endBindings(
    tx,
    tenantId,
    { pendingExpiredBefore: now },
    "confirmation_expired"
  );

  await auditEndedBindings(
    tx,
    tenantId,
    result,
    "confirmation_expired",
    context
  );

  return result.ended.length;
}
