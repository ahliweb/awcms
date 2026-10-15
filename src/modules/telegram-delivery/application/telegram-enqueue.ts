/**
 * Enqueue side of the Telegram queue and the `TelegramDeliveryPort` adapter
 * (Issue #965, ADR-0140 section 8).
 *
 * Takes the CALLER's open tenant transaction, so the message is committed with
 * the fact that produced it (a rolled-back booking sends no reminder). Nothing
 * here touches a provider and nothing here can: sending is
 * `telegram-dispatch.ts`, outside any transaction.
 *
 * Refusals are RETURNED, not thrown. A programming error (an empty idempotency
 * key, no tenant context) IS thrown: no honest result exists for it.
 *
 * ## The tenant comes from the transaction, not from an argument
 *
 * The port has no `tenantId` parameter (ADR-0140 section 8), so the tenant is
 * read from the transaction's own `app.current_tenant_id`, the value RLS already
 * enforces. A caller therefore cannot enqueue "for" a tenant its transaction is
 * not scoped to, and cannot disagree with itself.
 *
 * ## Order of the checks, and why
 *
 * 1. deployment flag, 2. template, 3. expiry, 4. idempotent replay, 5. tenant
 * gate, 6. binding, 7. rate limits, 8. INSERT.
 *
 * Replay precedes the tenant gate and the binding on purpose: a retried enqueue
 * whose original already queued must answer `duplicate`, not "now no binding". A
 * message that exists is never contradicted by state that changed afterwards.
 *
 * `NO_BINDING` is the answer for a principal with no ACTIVE binding. It is
 * returned to the caller and does nothing else: no other channel is tried here.
 */
import { resolveDeclaredBaseUrl } from "../../../lib/http/site-origin";
import { log } from "../../../lib/logging/logger";
import type {
  EnqueueTelegramInput,
  EnqueueTelegramResult,
  TelegramDeliveryPort,
  TelegramStatus,
  TelegramTenantTx
} from "../../_shared/ports/telegram-delivery-port";
import {
  isTelegramEnabled,
  resolveTelegramRatePerBindingPerHour,
  resolveTelegramRatePerTenantPerHour
} from "../domain/telegram-config";
import { TELEGRAM_MODULE_KEY } from "../domain/telegram-constants";
import {
  getTelegramTemplate,
  renderTelegramTemplate
} from "../domain/telegram-templates";
import { isTenantGateOpen, readTelegramTenantGate } from "./telegram-settings";

/** Longest a notice may wait: an operational alert older than this is noise, not delivery. */
export const MAX_TELEGRAM_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;

const NIL_UUID = "00000000-0000-0000-0000-000000000000";

export type EnqueueTelegramOptions = {
  env?: NodeJS.ProcessEnv;
  now?: Date;
};

async function currentTenantId(tx: Bun.SQL): Promise<string> {
  const rows = (await tx`
    SELECT current_setting('app.current_tenant_id', true) AS tenant_id
  `) as { tenant_id: string | null }[];
  const tenantId = rows[0]?.tenant_id ?? "";

  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      tenantId
    ) ||
    tenantId === NIL_UUID
  ) {
    throw new Error(
      "TelegramDeliveryPort needs a tenant transaction (app.current_tenant_id is not set)."
    );
  }

  return tenantId;
}

async function findByIdempotencyKey(
  tx: Bun.SQL,
  tenantId: string,
  idempotencyKey: string
): Promise<string | null> {
  const rows = (await tx`
    SELECT id FROM awcms_telegram_messages
    WHERE tenant_id = ${tenantId} AND idempotency_key = ${idempotencyKey}
  `) as { id: string }[];

  return rows[0]?.id ?? null;
}

/**
 * Bounded counts over the trailing hour: each subquery stops at the limit, so the
 * check costs at most `limit` index rows however busy the tenant is. Racy under
 * concurrency (two enqueues can both pass at limit - 1); the limit is a cost and
 * abuse control, not an exact quota.
 */
async function isRateLimited(
  tx: Bun.SQL,
  tenantId: string,
  bindingId: string,
  env: NodeJS.ProcessEnv
): Promise<boolean> {
  const perBinding = resolveTelegramRatePerBindingPerHour(env);
  const perTenant = resolveTelegramRatePerTenantPerHour(env);

  const rows = (await tx`
    SELECT
      (SELECT count(*) FROM (
        SELECT 1 FROM awcms_telegram_messages
        WHERE tenant_id = ${tenantId} AND binding_id = ${bindingId}
          AND created_at > now() - interval '1 hour'
        LIMIT ${perBinding}) b) AS binding_count,
      (SELECT count(*) FROM (
        SELECT 1 FROM awcms_telegram_messages
        WHERE tenant_id = ${tenantId}
          AND created_at > now() - interval '1 hour'
        LIMIT ${perTenant}) t) AS tenant_count
  `) as { binding_count: string | number; tenant_count: string | number }[];

  return (
    Number(rows[0]?.binding_count ?? 0) >= perBinding ||
    Number(rows[0]?.tenant_count ?? 0) >= perTenant
  );
}

function isValidExpiry(expiresAt: unknown, now: Date): expiresAt is Date {
  return (
    expiresAt instanceof Date &&
    Number.isFinite(expiresAt.getTime()) &&
    expiresAt.getTime() > now.getTime() &&
    expiresAt.getTime() - now.getTime() <= MAX_TELEGRAM_EXPIRY_MS
  );
}

/**
 * Every exported entry point that takes a template key from a caller refuses a
 * `system.*` key (audit N1). Those templates take tokens and counts a module
 * could fill with data that does not belong on this channel, and they are not
 * that module's to send. There is NO option, flag or token that lifts this from
 * outside this file: the only way to enqueue one is `enqueueActivationNotice`
 * below, which fixes the key, and `scripts/telegram-templates-check.ts` fails CI
 * if a file outside `telegram_delivery` names a `system.*` key next to the
 * enqueue path.
 *
 * `system.ops_alert` therefore has NO production sender today; a platform alert
 * sender, when one is wanted, is added inside this module.
 */
export async function enqueueTelegramMessage(
  tx: TelegramTenantTx,
  input: EnqueueTelegramInput,
  options: EnqueueTelegramOptions = {}
): Promise<EnqueueTelegramResult> {
  return enqueueCore(tx, input, options, false);
}

/** `reference` values are `[A-Za-z0-9][A-Za-z0-9_-]{0,63}`; a tenant code is shaped into one. */
export function tenantReference(tenantCode: string): string {
  const shaped = tenantCode
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .replace(/^[^A-Za-z0-9]+/, "")
    .slice(0, 64);

  return shaped === "" ? "tenant" : shaped;
}

const ACTIVATION_NOTICE_TTL_MS = 60 * 60 * 1000;

/**
 * The one message queued when a staff member confirms their chat (ADR-0140 audit
 * M5): "Alerts for <tenant> are now enabled for this chat; /stop to stop them."
 * It goes through the NORMAL queue, in the confirming transaction, so it obeys
 * every gate a real alert does. A refusal (Telegram off, rate limited) is not an
 * error: confirming the binding is what the person asked for.
 *
 * Its template key is fixed here, which is why this function, and not a flag on
 * `enqueueTelegramMessage`, is how a `system.*` template is enqueued. The tenant
 * is named by its CODE shaped into a `reference` value, never by a display name.
 */
export async function enqueueActivationNotice(
  tx: TelegramTenantTx,
  input: {
    tenantId: string;
    principalId: string;
    bindingId: string;
    correlationId?: string;
  },
  options: EnqueueTelegramOptions = {}
): Promise<void> {
  const rows = (await tx`
    SELECT tenant_code FROM awcms_tenants WHERE id = ${input.tenantId}
  `) as { tenant_code: string }[];
  const now = options.now ?? new Date();

  await enqueueCore(
    tx,
    {
      templateKey: "system.binding_activated",
      recipientPrincipalId: input.principalId,
      variables: { tenant: tenantReference(rows[0]?.tenant_code ?? "") },
      idempotencyKey: `binding-activated:${input.bindingId}`,
      expiresAt: new Date(now.getTime() + ACTIVATION_NOTICE_TTL_MS),
      ...(input.correlationId ? { correlationId: input.correlationId } : {})
    },
    { ...options, now },
    true
  );
}

async function enqueueCore(
  tx: TelegramTenantTx,
  input: EnqueueTelegramInput,
  options: EnqueueTelegramOptions,
  allowSystemTemplates: boolean
): Promise<EnqueueTelegramResult> {
  if (!input.idempotencyKey || input.idempotencyKey.length > 200) {
    throw new TypeError(
      "enqueueTelegramMessage requires an idempotencyKey of 1..200 characters."
    );
  }

  const env = options.env ?? process.env;
  const now = options.now ?? new Date();

  if (!isTelegramEnabled(env)) {
    // Nothing is written: a disabled deployment must not accumulate rows that
    // nothing will ever claim.
    return { status: "refused", reason: "DISABLED" };
  }

  const template = getTelegramTemplate(input.templateKey);

  if (
    !template ||
    (template.key.startsWith("system.") && !allowSystemTemplates)
  ) {
    return { status: "refused", reason: "TEMPLATE_UNKNOWN" };
  }

  if (!isValidExpiry(input.expiresAt, now)) {
    return { status: "refused", reason: "EXPIRY_REQUIRED" };
  }

  const tenantId = await currentTenantId(tx);
  const existing = await findByIdempotencyKey(
    tx,
    tenantId,
    input.idempotencyKey
  );

  if (existing) {
    return { status: "duplicate", messageId: existing };
  }

  // Levels 2 and 3 of ADR-0140 section 2. A tenant with the module or the setting
  // off answers DISABLED, exactly as a disabled deployment does.
  if (!isTenantGateOpen(await readTelegramTenantGate(tx, tenantId))) {
    return { status: "refused", reason: "DISABLED" };
  }

  const bindings = (await tx`
    SELECT id FROM awcms_telegram_bindings
    WHERE tenant_id = ${tenantId} AND principal_id = ${input.recipientPrincipalId}
      AND status = 'active'
  `) as { id: string }[];
  const binding = bindings[0];

  if (!binding) {
    return { status: "refused", reason: "NO_BINDING" };
  }

  if (await isRateLimited(tx, tenantId, binding.id, env)) {
    return { status: "refused", reason: "RATE_LIMITED" };
  }

  const rendered = renderTelegramTemplate(
    template,
    input.variables,
    resolveDeclaredBaseUrl(env)
  );

  const inserted = (await tx`
    INSERT INTO awcms_telegram_messages
      (tenant_id, idempotency_key, correlation_id, template_key,
       template_version, purpose, principal_id, binding_id, variables, body,
       status, expires_at, next_attempt_at)
    VALUES (
      ${tenantId}, ${input.idempotencyKey}, ${input.correlationId ?? null},
      ${template.key}, ${template.version}, ${template.purpose},
      ${input.recipientPrincipalId}, ${binding.id},
      ${rendered.variables}::jsonb, ${rendered.body}, 'queued',
      ${input.expiresAt}, ${now}
    )
    ON CONFLICT ON CONSTRAINT awcms_telegram_messages_idempotency_unique
    DO NOTHING
    RETURNING id
  `) as { id: string }[];

  if (inserted.length === 0) {
    // Lost a race to a concurrent enqueue of the same key: that one is the
    // message, and this call is its replay.
    const winner = await findByIdempotencyKey(
      tx,
      tenantId,
      input.idempotencyKey
    );

    if (winner) {
      return { status: "duplicate", messageId: winner };
    }

    throw new Error("Telegram enqueue conflicted but found no existing row.");
  }

  log("info", "telegram.enqueue.queued", {
    tenantId,
    moduleKey: TELEGRAM_MODULE_KEY,
    correlationId: input.correlationId,
    templateKey: template.key,
    droppedVariableCount: rendered.droppedVariables.length
  });

  return { status: "queued", messageId: inserted[0]!.id };
}

type StatusRow = {
  id: string;
  template_key: string;
  status: TelegramStatus["status"];
  failure_code: string | null;
  sent_at: Date | string | null;
  created_at: Date | string;
};

const iso = (value: Date | string): string =>
  value instanceof Date ? value.toISOString() : new Date(value).toISOString();

export async function getTelegramStatusByCorrelation(
  tx: TelegramTenantTx,
  correlationId: string
): Promise<TelegramStatus[]> {
  const tenantId = await currentTenantId(tx);
  const rows = (await tx`
    SELECT id, template_key, status, failure_code, sent_at, created_at
    FROM awcms_telegram_messages
    WHERE tenant_id = ${tenantId} AND correlation_id = ${correlationId}
    ORDER BY created_at, id
    LIMIT 200
  `) as StatusRow[];

  return rows.map((row) => ({
    messageId: row.id,
    templateKey: row.template_key,
    status: row.status,
    failureCode: row.failure_code,
    sentAt: row.sent_at ? iso(row.sent_at) : null,
    createdAt: iso(row.created_at)
  }));
}

/**
 * Cancels still-waiting messages for a correlation id. Refuses `sending` (already
 * in a provider call), so it is a no-op once sent, as the port promises.
 */
export async function cancelTelegramByCorrelation(
  tx: TelegramTenantTx,
  correlationId: string
): Promise<number> {
  const tenantId = await currentTenantId(tx);
  const rows = (await tx`
    UPDATE awcms_telegram_messages
    SET status = 'cancelled', next_attempt_at = NULL,
        failure_code = 'cancelled', body = '', variables = '{}'::jsonb,
        updated_at = now()
    WHERE tenant_id = ${tenantId} AND correlation_id = ${correlationId}
      AND status IN ('queued', 'retry_wait')
    RETURNING id
  `) as { id: string }[];

  return rows.length;
}

/** The adapter the composition root hands to consumers (ADR-0011). */
export const telegramDeliveryPortAdapter: TelegramDeliveryPort = {
  enqueue: (tx, input) => enqueueTelegramMessage(tx, input),
  getStatusByCorrelation: getTelegramStatusByCorrelation,
  cancelByCorrelation: cancelTelegramByCorrelation
};
