/**
 * Internal email dispatcher (Issue #495). NOT a public HTTP endpoint — same
 * "trusted internal worker only" boundary as
 * `sync-storage/application/object-dispatch.ts`. Invoked by
 * `scripts/email-dispatch.ts`, one tenant at a time.
 *
 * Three-phase pattern (ADR-0006 — never call a provider inside a DB
 * transaction), directly mirroring `object-dispatch.ts`:
 *
 * 1. CLAIM — one short transaction flips eligible `queued`/`retry_wait`
 *    rows to a transient `sending` status (`FOR UPDATE SKIP LOCKED`),
 *    reusing `next_attempt_at` as the claim lease expiry (no new column —
 *    same reuse `sql/020`'s own comment documents). The lease is
 *    *readable*, not write-only: a `sending` row whose lease has expired is
 *    re-claimed by a later pass (Issue #143).
 * 2. SEND — for each claimed row, renders the body from its
 *    `template_key`/`variables` (`../domain/email-template-render.ts`,
 *    safe rendering: per-category variable allowlist + locale resolution,
 *    Issue #498) and calls the resolved `EmailProvider`
 *    (`../infrastructure/email-provider-resolver.ts`) *outside* any
 *    transaction. Rendering locale is the tenant's `default_locale`
 *    (`awcms_tenants`, no per-message override yet — #496/#497 can add
 *    one if a real need surfaces).
 * 3. FINALIZE — one short transaction per row flips `sending` to `sent`,
 *    or (on failure) to `retry_wait` with backoff
 *    (`../domain/email-retry.ts`) or `failed` once retries are exhausted
 *    or the failure is marked non-retryable. Every attempt — success or
 *    failure — is recorded in `awcms_email_delivery_attempts`.
 *
 * If `EMAIL_ENABLED` is not `"true"`, `dispatchEmailQueue` returns
 * immediately without claiming anything — a disabled/misconfigured
 * provider never causes claimed rows to pile up in `sending` limbo (doc 18
 * feature-flag rule: provider off never touches the provider at all).
 */
import { getProviderCircuitBreaker } from "../../../lib/database/circuit-breaker";
import { withTenant } from "../../../lib/database/tenant-context";
import { log } from "../../../lib/logging/logger";
import { fetchActiveEmailTemplateByKey } from "./email-template-directory";
import { resolveEmailSendMaxRetries } from "../domain/email-config";
import { redactEmailAddressesInText } from "../domain/email-log-redaction";
import { evaluateEmailRetry } from "../domain/email-retry";
import { fetchSuppressedRecipientHashes } from "./suppression-directory";
import {
  renderEmailTemplate,
  type EmailTemplateSource
} from "../domain/email-template-render";
import type { EmailProvider } from "../domain/email-provider-contract";
import { resolveEmailProvider } from "../infrastructure/email-provider-resolver";

const DEFAULT_RENDER_LOCALE = "en";

const MODULE_KEY = "email";
const CIRCUIT_BREAKER_KEY = "email-mailketing";

export const EMAIL_DISPATCH_DEFAULT_LIMIT = 25;
export const EMAIL_DISPATCH_LEASE_MINUTES = 2;
const MAX_RESPONSE_SNIPPET_LENGTH = 500;

type ClaimedRow = {
  id: string;
  correlation_id: string | null;
  category: string;
  template_key: string | null;
  to_address: string;
  to_address_hash: string;
  subject: string;
  variables: Record<string, unknown> | null;
  retry_count: string | number;
};

export type DispatchEmailQueueOptions = {
  limit?: number;
  now?: Date;
  correlationId?: string;
  resolveProvider?: (env?: NodeJS.ProcessEnv) => EmailProvider;
  fromAddress?: string;
  fromName?: string;
  env?: NodeJS.ProcessEnv;
};

export type DispatchEmailQueueResult = {
  claimed: number;
  sent: number;
  retried: number;
  failed: number;
  suppressed: number;
  breakerOpen: boolean;
};

function toStringVariables(
  variables: Record<string, unknown> | null
): Record<string, string> {
  if (!variables) {
    return {};
  }

  const output: Record<string, string> = {};

  for (const [key, value] of Object.entries(variables)) {
    output[key] = typeof value === "string" ? value : String(value);
  }

  return output;
}

/**
 * Issue #143 — the claim predicate must mirror the lease it writes.
 * `next_attempt_at = ${leaseExpiry}` is the claim lease; a worker that dies
 * between CLAIM and FINALIZE leaves the row `sending` forever, and since
 * every finalize is guarded by `status = 'sending'` and
 * `cancelEmailMessage` refuses `sending`, such a row becomes permanent
 * limbo — unsendable, uncancellable, unretryable. Re-claiming expired
 * leases (`OR (status = 'sending' AND next_attempt_at <= ${now})`) is
 * exactly what the sibling dispatcher
 * `sync-storage/application/object-dispatch.ts` already does.
 *
 * The accepted trade-off (identical to `object-dispatch`'s): a crash in the
 * narrow window *after* the provider accepted the message but *before*
 * FINALIZE can produce one duplicate send. Mailketing is single-recipient
 * per call, so the blast radius is one duplicate email — strictly better
 * than a message stuck forever. `recordDeliveryAttempt` is idempotent per
 * `(message_id, attempt_no)` so the re-claim cannot crash the pass.
 */
async function claimEligibleEntries(
  sql: Bun.SQL,
  tenantId: string,
  now: Date,
  limit: number
): Promise<ClaimedRow[]> {
  const leaseExpiry = new Date(
    now.getTime() + EMAIL_DISPATCH_LEASE_MINUTES * 60_000
  );

  return withTenant(
    sql,
    tenantId,
    async (tx) => {
      const rows = await tx`
        UPDATE awcms_email_messages
        SET status = 'sending', next_attempt_at = ${leaseExpiry}
        WHERE id IN (
          SELECT id FROM awcms_email_messages
          WHERE tenant_id = ${tenantId}
            AND (
              (status IN ('queued', 'retry_wait')
                AND (next_attempt_at IS NULL OR next_attempt_at <= ${now}))
              OR (status = 'sending' AND next_attempt_at <= ${now})
            )
          ORDER BY
            CASE priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END,
            created_at
          LIMIT ${limit}
          FOR UPDATE SKIP LOCKED
        )
        RETURNING id, correlation_id, category, template_key, to_address, to_address_hash, subject, variables, retry_count
      `;

      return rows as unknown as ClaimedRow[];
    },
    { workClass: "background_sync" }
  );
}

/** `awcms_tenants` has no RLS (it's the root table, not tenant-scoped data — same reasoning `object-sync-dispatch.ts` relies on) — queried directly, no `withTenant` needed. Falls back to `DEFAULT_RENDER_LOCALE` if the tenant row is somehow missing (defensive; should never happen for an active tenant). */
async function fetchTenantDefaultLocale(
  sql: Bun.SQL,
  tenantId: string
): Promise<string> {
  const rows = (await sql`
    SELECT default_locale FROM awcms_tenants WHERE id = ${tenantId}
  `) as { default_locale: string }[];

  return rows[0]?.default_locale ?? DEFAULT_RENDER_LOCALE;
}

/**
 * `ON CONFLICT DO NOTHING` on `awcms_email_delivery_attempts_unique_attempt`
 * (`UNIQUE (message_id, attempt_no)`, `sql/014`) — required by the expired-
 * lease re-claim above (Issue #143). A crash *after* this insert but
 * *before* FINALIZE leaves `retry_count` untouched, so the re-claiming pass
 * computes the same `attempt_no` and would hit the unique constraint; an
 * unhandled `23505` would abort the whole dispatch pass and take the other
 * claimed messages down with it. The ledger keeps the first record for that
 * attempt number, which is the truthful one: it is the attempt that actually
 * reached the provider.
 */
async function recordDeliveryAttempt(
  sql: Bun.SQL,
  tenantId: string,
  messageId: string,
  attemptNo: number,
  outcome: "success" | "failure",
  providerName: string,
  providerResponseSnippet: string | null,
  errorMessage: string | null
): Promise<void> {
  await withTenant(
    sql,
    tenantId,
    (tx) => tx`
      INSERT INTO awcms_email_delivery_attempts
        (tenant_id, message_id, attempt_no, outcome, provider_name, provider_response_snippet, error_message)
      VALUES (
        ${tenantId}, ${messageId}, ${attemptNo}, ${outcome}, ${providerName},
        ${providerResponseSnippet}, ${errorMessage}
      )
      ON CONFLICT ON CONSTRAINT awcms_email_delivery_attempts_unique_attempt
      DO NOTHING
    `,
    { workClass: "background_sync" }
  );
}

async function finalizeSent(
  sql: Bun.SQL,
  tenantId: string,
  id: string,
  providerName: string,
  providerMessageId: string | undefined
): Promise<void> {
  await withTenant(
    sql,
    tenantId,
    (tx) => tx`
      UPDATE awcms_email_messages
      SET status = 'sent', sent_at = now(), next_attempt_at = null,
          provider_name = ${providerName}, provider_message_id = ${providerMessageId ?? null}
      WHERE tenant_id = ${tenantId} AND id = ${id} AND status = 'sending'
    `,
    { workClass: "background_sync" }
  );
}

/**
 * A recipient can land on the suppression list (bounce/complaint/manual/
 * unsubscribe) *after* a message was enqueued but *before* the dispatcher
 * gets to it — `enqueueAnnouncement`/`requestPasswordReset` only check the
 * list at enqueue time. Checked again here, right before the provider call,
 * so a fresh suppression always wins. No provider call is made and no
 * `awcms_email_delivery_attempts` row is written (that table's
 * `outcome` constraint only allows `success`/`failure` — this was never a
 * delivery attempt at all).
 */
async function finalizeSuppressed(
  sql: Bun.SQL,
  tenantId: string,
  id: string
): Promise<void> {
  await withTenant(
    sql,
    tenantId,
    (tx) => tx`
      UPDATE awcms_email_messages
      SET status = 'suppressed', next_attempt_at = null,
          last_error = 'Recipient is on the suppression list.'
      WHERE tenant_id = ${tenantId} AND id = ${id} AND status = 'sending'
    `,
    { workClass: "background_sync" }
  );
}

async function finalizeFailure(
  sql: Bun.SQL,
  tenantId: string,
  id: string,
  currentRetryCount: number,
  maxRetries: number,
  retryable: boolean,
  now: Date,
  errorMessage: string
): Promise<{ eligible: boolean }> {
  const evaluation = retryable
    ? evaluateEmailRetry(currentRetryCount, maxRetries, now)
    : { eligible: false as const };

  if (evaluation.eligible) {
    await withTenant(
      sql,
      tenantId,
      (tx) => tx`
        UPDATE awcms_email_messages
        SET status = 'retry_wait', retry_count = ${currentRetryCount + 1},
            next_attempt_at = ${evaluation.nextAttemptAt}, last_error = ${errorMessage}
        WHERE tenant_id = ${tenantId} AND id = ${id} AND status = 'sending'
      `,
      { workClass: "background_sync" }
    );

    return { eligible: true };
  }

  await withTenant(
    sql,
    tenantId,
    (tx) => tx`
      UPDATE awcms_email_messages
      SET status = 'failed', retry_count = ${currentRetryCount + 1},
          next_attempt_at = null, last_error = ${errorMessage}
      WHERE tenant_id = ${tenantId} AND id = ${id} AND status = 'sending'
    `,
    { workClass: "background_sync" }
  );

  return { eligible: false };
}

/**
 * Per-pass template cache (Issue #153). `fetchActiveEmailTemplateByKey` was
 * called inside the per-message loop, each wrapped in its own `withTenant`
 * transaction — a batch of 25 announcement rows sharing one `template_key`
 * cost 25 transactions running 25 identical queries. Templates are
 * low-cardinality admin data; one lookup per distinct key per pass is
 * enough. Cache lifetime is deliberately a single `dispatchEmailQueue`
 * call: a template edited between passes is picked up by the next pass, and
 * every message in one pass renders from one consistent template version.
 * Negative results (`null` — no active template) are cached too, so 25
 * messages pointing at a deleted template also cost one query.
 */
function createTemplateLoader(
  sql: Bun.SQL,
  tenantId: string
): (templateKey: string) => Promise<EmailTemplateSource | null> {
  const cache = new Map<string, EmailTemplateSource | null>();

  return async (templateKey: string) => {
    const cached = cache.get(templateKey);

    if (cached !== undefined) {
      return cached;
    }

    const template = await withTenant(
      sql,
      tenantId,
      (tx) => fetchActiveEmailTemplateByKey(tx, tenantId, templateKey),
      { workClass: "background_sync" }
    );

    cache.set(templateKey, template);

    return template;
  };
}

/**
 * Dispatches one batch (default `EMAIL_DISPATCH_DEFAULT_LIMIT` rows) of due
 * `awcms_email_messages` entries for a single tenant. Safe to call
 * repeatedly (claim-lease pattern); the CLI script loops per tenant to
 * drain a larger backlog.
 */
export async function dispatchEmailQueue(
  sql: Bun.SQL,
  tenantId: string,
  options: DispatchEmailQueueOptions = {}
): Promise<DispatchEmailQueueResult> {
  const env = options.env ?? process.env;
  const now = options.now ?? new Date();
  const limit = options.limit ?? EMAIL_DISPATCH_DEFAULT_LIMIT;
  const correlationId = options.correlationId ?? crypto.randomUUID();
  const maxRetries = resolveEmailSendMaxRetries(env);
  const breaker = getProviderCircuitBreaker(CIRCUIT_BREAKER_KEY);
  const breakerOpen = !breaker.canAttempt(now);

  const result: DispatchEmailQueueResult = {
    claimed: 0,
    sent: 0,
    retried: 0,
    failed: 0,
    suppressed: 0,
    breakerOpen
  };

  if (env.EMAIL_ENABLED !== "true") {
    return result;
  }

  if (breakerOpen) {
    log("warning", "email.dispatch.breaker_open", {
      correlationId,
      tenantId,
      moduleKey: MODULE_KEY
    });
    return result;
  }

  const claimed = await claimEligibleEntries(sql, tenantId, now, limit);
  result.claimed = claimed.length;

  if (claimed.length === 0) {
    return result;
  }

  log("info", "email.dispatch.claimed", {
    correlationId,
    tenantId,
    moduleKey: MODULE_KEY,
    count: claimed.length
  });

  const provider = (options.resolveProvider ?? resolveEmailProvider)(env);
  const fromAddress = options.fromAddress ?? env.EMAIL_FROM_ADDRESS ?? "";
  const fromName = options.fromName ?? env.EMAIL_FROM_NAME ?? "";
  const renderLocale = await fetchTenantDefaultLocale(sql, tenantId);
  const loadTemplate = createTemplateLoader(sql, tenantId);
  const suppressedHashes = await withTenant(
    sql,
    tenantId,
    (tx) => fetchSuppressedRecipientHashes(tx, tenantId),
    { workClass: "background_sync" }
  );

  for (const entry of claimed) {
    if (suppressedHashes.has(entry.to_address_hash)) {
      await finalizeSuppressed(sql, tenantId, entry.id);
      log("info", "email.dispatch.suppressed", {
        correlationId: entry.correlation_id ?? correlationId,
        tenantId,
        moduleKey: MODULE_KEY,
        category: entry.category
      });
      result.suppressed += 1;
      continue;
    }

    const retryCount = Number(entry.retry_count);
    const attemptNo = retryCount + 1;
    const messageCorrelationId = entry.correlation_id ?? correlationId;

    let template: EmailTemplateSource | null = null;

    if (entry.template_key) {
      template = await loadTemplate(entry.template_key);
    }

    if (!template) {
      const errorMessage = entry.template_key
        ? `Template not found or inactive: ${entry.template_key}`
        : "Message has no template_key.";

      await recordDeliveryAttempt(
        sql,
        tenantId,
        entry.id,
        attemptNo,
        "failure",
        env.EMAIL_PROVIDER ?? "unknown",
        null,
        errorMessage
      );
      await finalizeFailure(
        sql,
        tenantId,
        entry.id,
        retryCount,
        maxRetries,
        false,
        now,
        errorMessage
      );
      result.failed += 1;
      continue;
    }

    const rendered = renderEmailTemplate(
      template,
      toStringVariables(entry.variables),
      entry.template_key!,
      renderLocale
    );

    const deliveryResult = await provider.send({
      to: [{ address: entry.to_address }],
      from: { address: fromAddress, name: fromName },
      subject: entry.subject || rendered.subject,
      textBody: rendered.textBody,
      htmlBody: rendered.htmlBody,
      correlationId: messageCorrelationId
    });

    if (deliveryResult.ok) {
      await recordDeliveryAttempt(
        sql,
        tenantId,
        entry.id,
        attemptNo,
        "success",
        env.EMAIL_PROVIDER ?? "unknown",
        deliveryResult.providerMessageId
          ? redactEmailAddressesInText(
              deliveryResult.providerMessageId.slice(
                0,
                MAX_RESPONSE_SNIPPET_LENGTH
              )
            )
          : null,
        null
      );
      await finalizeSent(
        sql,
        tenantId,
        entry.id,
        env.EMAIL_PROVIDER ?? "unknown",
        deliveryResult.providerMessageId
      );
      log("info", "email.dispatch.sent", {
        correlationId: messageCorrelationId,
        tenantId,
        moduleKey: MODULE_KEY,
        category: entry.category
      });
      result.sent += 1;
      continue;
    }

    const safeError = redactEmailAddressesInText(
      deliveryResult.error.slice(0, MAX_RESPONSE_SNIPPET_LENGTH)
    );

    await recordDeliveryAttempt(
      sql,
      tenantId,
      entry.id,
      attemptNo,
      "failure",
      env.EMAIL_PROVIDER ?? "unknown",
      safeError,
      safeError
    );

    const finalized = await finalizeFailure(
      sql,
      tenantId,
      entry.id,
      retryCount,
      maxRetries,
      deliveryResult.retryable,
      now,
      safeError
    );

    if (finalized.eligible) {
      log("warning", "email.dispatch.retry_scheduled", {
        correlationId: messageCorrelationId,
        tenantId,
        moduleKey: MODULE_KEY,
        category: entry.category,
        retryCount: retryCount + 1,
        error: safeError
      });
      result.retried += 1;
    } else {
      log("error", "email.dispatch.failed", {
        correlationId: messageCorrelationId,
        tenantId,
        moduleKey: MODULE_KEY,
        category: entry.category,
        retryCount: retryCount + 1,
        error: safeError
      });
      result.failed += 1;
    }
  }

  return result;
}
