/**
 * Sender selection, the default-sender policy and per-sender diagnostics of
 * `whatsapp_delivery` (Issue #1141, ADR-0148 section 4).
 *
 * ## Enqueue-time selection (`resolveEnqueueSender`)
 *
 * Runs in the CALLER's transaction, after the idempotent-replay check and before
 * eligibility. It decides the sender by the pure precedence in
 * `domain/whatsapp-sender.ts` and then asks `ChannelAccountPort` whether that
 * sender may send for this purpose RIGHT NOW. Every failure is a returned
 * refusal. There is no branch that picks another sender after a refusal.
 *
 * With no sender named, no thread and no policy configured, nothing below the
 * single policy SELECT runs and the message takes the deployment sender exactly
 * as before (`senderAccountId = null`).
 *
 * ## The policy is prospective
 *
 * `setSenderPolicy` writes the CURRENT configuration and bumps its version. A
 * message snapshots the sender and the version it was given at enqueue
 * (immutable, `sql/322`), so a change affects later messages only. A no-op write
 * (same default again) changes nothing and bumps nothing, which also makes a
 * replayed request naturally idempotent.
 */
import type {
  ChannelAccountPort,
  ResolvedWhatsappSender
} from "../../_shared/ports/channel-account-port";
import type {
  EnqueueWhatsappInput,
  WhatsappPurpose
} from "../../_shared/ports/whatsapp-delivery-port";
import { log } from "../../../lib/logging/logger";
import {
  resolveWhatsappSenderRatePerDay,
  resolveWhatsappSenderRatePerHour
} from "../domain/whatsapp-config";
import {
  hashListParam,
  type RecipientHashes
} from "../domain/whatsapp-recipient";
import {
  capabilityForSend,
  chooseSender,
  isWhatsappRecordUuid,
  parseBusinessScope,
  pickPolicy,
  sameBusinessScope,
  senderScopeAllows,
  type PolicyRow,
  type WhatsappBusinessScope,
  type WhatsappSenderSelection
} from "../domain/whatsapp-sender";
import { hasWhatsappSenderAdapter } from "../infrastructure/whatsapp-sender-providers";
import { readMetaRestriction } from "./whatsapp-meta-directory";

const MODULE_KEY = "whatsapp_delivery";

type PolicyDbRow = {
  id: string;
  business_scope_type: string | null;
  business_scope_id: string | null;
  default_sender_account_id: string | null;
  config_version: number;
  effective_from: Date | string;
  updated_at: Date | string;
};

const iso = (value: Date | string): string =>
  value instanceof Date ? value.toISOString() : new Date(value).toISOString();

export type SenderPolicyView = {
  id: string;
  businessScope: WhatsappBusinessScope | null;
  /** `null` is an explicit decision to use the deployment sender. */
  defaultSenderAccountId: string | null;
  configVersion: number;
  effectiveFrom: string;
  updatedAt: string;
};

function toPolicyRow(row: PolicyDbRow): PolicyRow {
  return {
    businessScope:
      row.business_scope_type && row.business_scope_id
        ? { type: row.business_scope_type, id: row.business_scope_id }
        : null,
    defaultSenderAccountId: row.default_sender_account_id,
    configVersion: Number(row.config_version)
  };
}

function toPolicyView(row: PolicyDbRow): SenderPolicyView {
  return {
    id: row.id,
    ...toPolicyRow(row),
    effectiveFrom: iso(row.effective_from),
    updatedAt: iso(row.updated_at)
  };
}

/** The full list, for the admin view only (never used to choose a sender). */
async function loadPolicies(
  tx: Bun.SQL,
  tenantId: string
): Promise<PolicyDbRow[]> {
  return (await tx`
    SELECT id, business_scope_type, business_scope_id,
           default_sender_account_id, config_version, effective_from, updated_at
    FROM awcms_whatsapp_sender_policies
    WHERE tenant_id = ${tenantId}
    ORDER BY business_scope_type NULLS FIRST, business_scope_id
    LIMIT 500
  `) as PolicyDbRow[];
}

/**
 * The policy rows that can decide a message of `scope`: its OWN scope row and the
 * tenant-wide row, each by its key (Issue #1233 L2). Never filtered out of a
 * capped list: a tenant with more than 500 scopes would otherwise lose a scope's
 * own row (including an explicit NULL "deployment sender") and silently fall back
 * to the tenant-wide default.
 */
async function loadApplicablePolicies(
  tx: Bun.SQL,
  tenantId: string,
  scope: WhatsappBusinessScope | null
): Promise<PolicyDbRow[]> {
  const scopeType = scope?.type ?? null;
  const scopeId = scope?.id ?? null;

  return (await tx`
    SELECT id, business_scope_type, business_scope_id,
           default_sender_account_id, config_version, effective_from, updated_at
    FROM awcms_whatsapp_sender_policies
    WHERE tenant_id = ${tenantId}
      AND (
        (business_scope_type IS NULL AND business_scope_id IS NULL)
        OR (
          ${scopeType}::text IS NOT NULL
          AND business_scope_type = ${scopeType}
          AND business_scope_id = ${scopeId}
        )
      )
  `) as PolicyDbRow[];
}

export async function listSenderPolicies(
  tx: Bun.SQL,
  tenantId: string
): Promise<SenderPolicyView[]> {
  return (await loadPolicies(tx, tenantId)).map(toPolicyView);
}

// ---------------------------------------------------------------------------
// Enqueue-time selection
// ---------------------------------------------------------------------------

export type EnqueueSenderRefusal =
  "SENDER_UNAVAILABLE" | "SENDER_AFFINITY_CONFLICT" | "REPLY_TARGET_UNKNOWN";

export type EnqueueSenderDecision =
  | {
      ok: true;
      senderAccountId: string | null;
      selection: WhatsappSenderSelection;
      policyVersion: number | null;
      businessScope: WhatsappBusinessScope | null;
      /**
       * Issue #1143. The verified identity of a tenant-owned sender as the port
       * resolved it (provider, phone number id, WABA). Absent for the
       * deployment sender. Snapshotted on the row; never from the caller.
       */
      resolved?: ResolvedWhatsappSender;
    }
  | { ok: false; reason: EnqueueSenderRefusal; detail: string };

/** Loading the adapter is a module import, not a query: its failure is a refusal (no port), never a half-open transaction. */
async function loadPort(
  load: (() => Promise<ChannelAccountPort | null>) | null
): Promise<ChannelAccountPort | null> {
  if (!load) return null;

  try {
    return await load();
  } catch {
    return null;
  }
}

const refuse = (
  reason: EnqueueSenderRefusal,
  detail: string
): EnqueueSenderDecision => ({ ok: false, reason, detail });

/**
 * `detail` is a coarse, non-sensitive code for logs and metrics (never an
 * address, a token or an account's identity); the CALLER only ever sees
 * `reason`, so a probe learns nothing about whether an id belongs to another
 * tenant.
 */
export async function resolveEnqueueSender(
  tx: Bun.SQL,
  context: {
    tenantId: string;
    input: Pick<
      EnqueueWhatsappInput,
      "senderAccountId" | "inReplyToMessageId" | "businessScope"
    >;
    purpose: WhatsappPurpose;
    hashes: RecipientHashes;
    senders: (() => Promise<ChannelAccountPort | null>) | null;
    /** Deployment switches (an unofficial adapter exists only when enabled). Defaults to the process environment. */
    env?: NodeJS.ProcessEnv;
  }
): Promise<EnqueueSenderDecision> {
  const { tenantId, input, purpose } = context;

  let scope = parseBusinessScope(input.businessScope);

  if (scope === "invalid") return refuse("SENDER_UNAVAILABLE", "scope_invalid");

  const explicit = input.senderAccountId ?? null;

  if (explicit !== null && !isWhatsappRecordUuid(explicit)) {
    return refuse("SENDER_UNAVAILABLE", "sender_id_invalid");
  }

  let thread: { senderAccountId: string | null } | null = null;

  if (input.inReplyToMessageId !== undefined) {
    if (!isWhatsappRecordUuid(input.inReplyToMessageId)) {
      return refuse("REPLY_TARGET_UNKNOWN", "reply_target_invalid");
    }

    // Same tenant (the predicate AND RLS) and the SAME recipient: a thread is
    // between this business and one person, so a message to somebody else is not
    // its continuation and must not inherit its sender.
    const targets = (await tx`
      SELECT sender_account_id, business_scope_type, business_scope_id
      FROM awcms_whatsapp_messages
      WHERE tenant_id = ${tenantId} AND id = ${input.inReplyToMessageId}
        AND recipient_hash = ANY(string_to_array(${hashListParam(context.hashes)}, ','))
    `) as {
      sender_account_id: string | null;
      business_scope_type: string | null;
      business_scope_id: string | null;
    }[];
    const target = targets[0];

    if (!target) return refuse("REPLY_TARGET_UNKNOWN", "reply_target_unknown");

    const targetScope: WhatsappBusinessScope | null =
      target.business_scope_type && target.business_scope_id
        ? { type: target.business_scope_type, id: target.business_scope_id }
        : null;

    if (scope !== null && !sameBusinessScope(scope, targetScope)) {
      return refuse("SENDER_AFFINITY_CONFLICT", "reply_scope_differs");
    }

    scope = targetScope;
    thread = { senderAccountId: target.sender_account_id };
  }

  // The policy is read only when nothing else decides the sender.
  const policy =
    explicit === null && thread === null
      ? pickPolicy(
          (await loadApplicablePolicies(tx, tenantId, scope)).map(toPolicyRow),
          scope
        )
      : null;

  const choice = chooseSender({
    explicitSenderAccountId: explicit,
    thread,
    policy
  });

  if (choice.kind === "refused") {
    return refuse(choice.reason, "thread_sender_differs");
  }

  if (choice.senderAccountId === null) {
    return {
      ok: true,
      senderAccountId: null,
      selection: "deployment",
      policyVersion: choice.policyVersion,
      businessScope: scope
    };
  }

  // A tenant-owned sender: the port decides, fail closed, no fallback.
  const port = await loadPort(context.senders);

  if (!port) return refuse("SENDER_UNAVAILABLE", "no_channel_account_port");

  // Not wrapped in a catch: the port's only failure is a database error, which
  // has aborted the CALLER's transaction, so nothing can be queued either way.
  // Swallowing it would only turn a loud failure into a confusing refusal.
  const verdict = await port.resolveWhatsappSender(tx, {
    tenantId,
    accountId: choice.senderAccountId,
    capability: capabilityForSend(purpose, choice.selection === "reply")
  });

  if (!verdict.usable) {
    return refuse("SENDER_UNAVAILABLE", `denied_${verdict.reason}`);
  }

  if (
    !hasWhatsappSenderAdapter(
      verdict.sender.provider,
      context.env ?? process.env
    )
  ) {
    return refuse("SENDER_UNAVAILABLE", "provider_has_no_adapter");
  }

  if (!senderScopeAllows(verdict.sender.businessScope, scope)) {
    return refuse("SENDER_UNAVAILABLE", "scope_mismatch");
  }

  // Issue #1143: a Meta number sends only as part of a verified WABA, and
  // not while Meta reports that WABA restricted (banned, restricted, deleted,
  // offboarded, app uninstalled). Never another number instead.
  if (verdict.sender.provider === "whatsapp_cloud") {
    const wabaId = verdict.sender.containerExternalId ?? null;

    if (!wabaId || !verdict.sender.containerAccountId) {
      return refuse("SENDER_UNAVAILABLE", "meta_container_binding_missing");
    }

    if (await readMetaRestriction(tx, tenantId, wabaId)) {
      return refuse("SENDER_UNAVAILABLE", "meta_waba_restricted");
    }
  }

  return {
    ok: true,
    senderAccountId: choice.senderAccountId,
    selection: choice.selection,
    policyVersion: choice.policyVersion,
    businessScope: scope,
    resolved: verdict.sender
  };
}

// ---------------------------------------------------------------------------
// The default-sender policy
// ---------------------------------------------------------------------------

export type SetSenderPolicyInput = {
  businessScope: WhatsappBusinessScope | null;
  /** `null` selects the deployment sender for this scope, explicitly. */
  defaultSenderAccountId: string | null;
};

export type SetSenderPolicyOutcome =
  | {
      outcome: "set";
      policy: SenderPolicyView;
      changed: boolean;
      /** What the policy was before this change (`null`: it did not exist), for the audit row. */
      previous: {
        defaultSenderAccountId: string | null;
        configVersion: number;
      } | null;
    }
  | {
      outcome: "refused";
      code: "SENDER_UNAVAILABLE" | "CHANNEL_ACCOUNTS_UNAVAILABLE";
    };

/**
 * Sets the default sender of a business scope (or tenant-wide). The sender must
 * be one this tenant may use for a business-initiated message RIGHT NOW (the
 * same check the enqueue makes, so a policy can never name a sender that every
 * message would be refused for) and must have an adapter on this deployment.
 * The database guard (`sql/322`) enforces tenant ownership and scope again.
 */
export async function setSenderPolicy(
  tx: Bun.SQL,
  tenantId: string,
  actorTenantUserId: string,
  input: SetSenderPolicyInput,
  senders: ChannelAccountPort | null,
  env: NodeJS.ProcessEnv = process.env
): Promise<SetSenderPolicyOutcome> {
  if (input.defaultSenderAccountId !== null) {
    if (!senders) {
      return { outcome: "refused", code: "CHANNEL_ACCOUNTS_UNAVAILABLE" };
    }

    const verdict = await senders.resolveWhatsappSender(tx, {
      tenantId,
      accountId: input.defaultSenderAccountId,
      capability: "dm"
    });

    if (
      !verdict.usable ||
      !hasWhatsappSenderAdapter(verdict.sender.provider, env) ||
      !senderScopeAllows(verdict.sender.businessScope, input.businessScope)
    ) {
      return { outcome: "refused", code: "SENDER_UNAVAILABLE" };
    }
  }

  const scopeType = input.businessScope?.type ?? null;
  const scopeId = input.businessScope?.id ?? null;
  // `FOR UPDATE`: two concurrent changes of one scope serialise, so versions
  // are strictly ordered and a snapshot always names a real configuration.
  const existing = (await tx`
    SELECT id, business_scope_type, business_scope_id,
           default_sender_account_id, config_version, effective_from, updated_at
    FROM awcms_whatsapp_sender_policies
    WHERE tenant_id = ${tenantId}
      AND business_scope_type IS NOT DISTINCT FROM ${scopeType}
      AND business_scope_id IS NOT DISTINCT FROM ${scopeId}
    FOR UPDATE
  `) as PolicyDbRow[];

  if (existing[0]) {
    if (
      existing[0].default_sender_account_id === input.defaultSenderAccountId
    ) {
      return {
        outcome: "set",
        policy: toPolicyView(existing[0]),
        changed: false,
        previous: {
          defaultSenderAccountId: existing[0].default_sender_account_id,
          configVersion: Number(existing[0].config_version)
        }
      };
    }

    const updated = (await tx`
      UPDATE awcms_whatsapp_sender_policies
      SET default_sender_account_id = ${input.defaultSenderAccountId},
          config_version = config_version + 1, effective_from = now(),
          changed_by = ${actorTenantUserId}, updated_at = now()
      WHERE tenant_id = ${tenantId} AND id = ${existing[0].id}
      RETURNING id, business_scope_type, business_scope_id,
                default_sender_account_id, config_version, effective_from,
                updated_at
    `) as PolicyDbRow[];

    return {
      outcome: "set",
      policy: toPolicyView(updated[0]!),
      changed: true,
      previous: {
        defaultSenderAccountId: existing[0].default_sender_account_id,
        configVersion: Number(existing[0].config_version)
      }
    };
  }

  const inserted = (await tx`
    INSERT INTO awcms_whatsapp_sender_policies
      (tenant_id, business_scope_type, business_scope_id,
       default_sender_account_id, changed_by)
    VALUES (${tenantId}, ${scopeType}, ${scopeId},
            ${input.defaultSenderAccountId}, ${actorTenantUserId})
    RETURNING id, business_scope_type, business_scope_id,
              default_sender_account_id, config_version, effective_from,
              updated_at
  `) as PolicyDbRow[];

  return {
    outcome: "set",
    policy: toPolicyView(inserted[0]!),
    changed: true,
    previous: null
  };
}

// ---------------------------------------------------------------------------
// Per-sender diagnostics
// ---------------------------------------------------------------------------

export type SenderDiagnostics = {
  /** `null` is the deployment sender. */
  senderAccountId: string | null;
  /** `null` for the deployment sender, which has no account record. */
  availability: { usable: true } | { usable: false; reason: string } | null;
  queue: {
    waiting: number;
    sending: number;
    failed: number;
    oldestPendingAt: string | null;
    lastFailureCode: string | null;
  };
  quota: {
    sentLastHour: number;
    sentLastDay: number;
    hourlyLimit: number;
    dailyLimit: number;
    /** True when a cap is reached: the dispatcher stops claiming this sender's rows until the window moves. Nothing is rerouted. */
    throttled: boolean;
  };
};

type LaneRow = {
  sender_account_id: string | null;
  waiting: string | number;
  sending: string | number;
  failed: string | number;
  oldest_pending_at: Date | string | null;
  sent_hour: string | number;
  sent_day: string | number;
  last_failure_code: string | null;
};

/**
 * One entry per sender that has any queue row (and the deployment sender), from
 * ONE statement over the tenant's own queue, so the numbers share a snapshot.
 * Reads no credential and no number. Availability is asked of the port per
 * sender (bounded by the 200-lane limit).
 */
export async function summarizeWhatsappSenders(
  tx: Bun.SQL,
  tenantId: string,
  senders: ChannelAccountPort | null,
  env: NodeJS.ProcessEnv = process.env
): Promise<SenderDiagnostics[]> {
  const rows = (await tx`
    SELECT m.sender_account_id,
           count(*) FILTER (WHERE m.status IN ('queued', 'retry_wait')) AS waiting,
           count(*) FILTER (WHERE m.status = 'sending') AS sending,
           count(*) FILTER (WHERE m.status = 'failed'
                              AND m.updated_at > now() - interval '1 day') AS failed,
           min(m.created_at) FILTER (WHERE m.status IN ('queued', 'retry_wait')) AS oldest_pending_at,
           count(*) FILTER (WHERE m.status = 'sent'
                              AND m.sent_at > now() - interval '1 hour') AS sent_hour,
           count(*) FILTER (WHERE m.status = 'sent'
                              AND m.sent_at > now() - interval '1 day') AS sent_day,
           (array_agg(m.failure_code ORDER BY m.updated_at DESC)
              FILTER (WHERE m.status = 'failed'))[1] AS last_failure_code
    FROM awcms_whatsapp_messages m
    WHERE m.tenant_id = ${tenantId}
      AND m.created_at > now() - interval '35 days'
    GROUP BY m.sender_account_id
    ORDER BY m.sender_account_id NULLS FIRST
    LIMIT 200
  `) as LaneRow[];

  const hourly = resolveWhatsappSenderRatePerHour(env);
  const daily = resolveWhatsappSenderRatePerDay(env);
  const result: SenderDiagnostics[] = [];

  for (const row of rows) {
    let availability: SenderDiagnostics["availability"] = null;

    if (row.sender_account_id !== null) {
      const verdict = senders
        ? await senders.resolveWhatsappSender(tx, {
            tenantId,
            accountId: row.sender_account_id,
            capability: "dm"
          })
        : null;

      availability = verdict
        ? verdict.usable
          ? { usable: true }
          : { usable: false, reason: verdict.reason }
        : { usable: false, reason: "CHANNEL_ACCOUNTS_UNAVAILABLE" };
    }

    const sentHour = Number(row.sent_hour);
    const sentDay = Number(row.sent_day);

    result.push({
      senderAccountId: row.sender_account_id,
      availability,
      queue: {
        waiting: Number(row.waiting),
        sending: Number(row.sending),
        failed: Number(row.failed),
        oldestPendingAt: row.oldest_pending_at
          ? iso(row.oldest_pending_at)
          : null,
        lastFailureCode: row.last_failure_code
      },
      quota: {
        sentLastHour: sentHour,
        sentLastDay: sentDay,
        hourlyLimit: hourly,
        dailyLimit: daily,
        throttled:
          row.sender_account_id !== null &&
          (sentHour >= hourly || sentDay >= daily)
      }
    });
  }

  return result;
}

/**
 * How many messages a sender may still have claimed: the smaller of what is left
 * of its hourly and daily caps, counting what it really sent plus what is in
 * flight (`sending`, which another worker may hold). Never negative.
 */
export async function senderAllowance(
  tx: Bun.SQL,
  tenantId: string,
  senderAccountId: string,
  env: NodeJS.ProcessEnv
): Promise<number> {
  const rows = (await tx`
    SELECT
      count(*) FILTER (WHERE status = 'sent'
                         AND sent_at > now() - interval '1 hour') AS sent_hour,
      count(*) FILTER (WHERE status = 'sent'
                         AND sent_at > now() - interval '1 day') AS sent_day,
      count(*) FILTER (WHERE status = 'sending') AS in_flight
    FROM awcms_whatsapp_messages
    WHERE tenant_id = ${tenantId} AND sender_account_id = ${senderAccountId}
      AND (status = 'sending' OR (status = 'sent' AND sent_at > now() - interval '1 day'))
  `) as {
    sent_hour: string | number;
    sent_day: string | number;
    in_flight: string | number;
  }[];
  const inFlight = Number(rows[0]?.in_flight ?? 0);

  return Math.max(
    0,
    Math.min(
      resolveWhatsappSenderRatePerHour(env) -
        Number(rows[0]?.sent_hour ?? 0) -
        inFlight,
      resolveWhatsappSenderRatePerDay(env) -
        Number(rows[0]?.sent_day ?? 0) -
        inFlight
    )
  );
}

export function logSenderRefusal(
  tenantId: string,
  detail: string,
  correlationId: string | undefined
): void {
  log("warning", "whatsapp.enqueue.sender_refused", {
    tenantId,
    moduleKey: MODULE_KEY,
    correlationId,
    detail
  });
}
