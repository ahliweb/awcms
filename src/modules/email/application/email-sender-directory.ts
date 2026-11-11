/**
 * Sender selection, the default-sender policy, per-sender diagnostics and the
 * dispatcher's per-sender reads of `email` (Issue #1160, ADR-0151 section 2).
 * The twin of `whatsapp-delivery/application/whatsapp-sender-directory.ts`.
 *
 * ## Enqueue-time selection (`resolveEnqueueEmailSender`)
 *
 * Runs in the CALLER's transaction. It decides the sender by the pure precedence
 * in `domain/email-sender.ts` and then asks `ChannelEmailSenderPort` whether
 * that sender may send for this purpose RIGHT NOW. Every failure is a returned
 * refusal; there is no branch that picks another sender after a refusal.
 *
 * With routing switched off, or no sender named and no policy configured,
 * nothing below the single policy SELECT runs and the message takes the
 * deployment sender exactly as before (`sender_account_id` NULL).
 *
 * ## The policy is prospective
 *
 * `setEmailSenderPolicy` writes the CURRENT configuration and bumps its
 * version. A message snapshots the sender and the version at enqueue
 * (immutable, `sql/346`), so a change affects later messages only. A no-op
 * write changes nothing and bumps nothing (which also makes a replayed request
 * naturally idempotent).
 */
import type {
  ChannelEmailSenderPort,
  ResolvedEmailSender
} from "../../_shared/ports/channel-account-port";
import { log } from "../../../lib/logging/logger";
import {
  isEmailSenderRoutingEnabled,
  resolveEmailSenderRatePerHour
} from "../domain/email-sender-config";
import {
  capabilityForEmailPurpose,
  chooseEmailSender,
  emailSenderScopeAllows,
  isEmailRecordUuid,
  parseEmailBusinessScope,
  pickEmailPolicy,
  type EmailAccountHealthFacts,
  type EmailBusinessScope,
  type EmailPolicyRow,
  type EmailPurpose,
  type EmailSenderSelection
} from "../domain/email-sender";

const MODULE_KEY = "email";

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

export type EmailSenderPolicyView = {
  id: string;
  businessScope: EmailBusinessScope | null;
  /** `null` is an explicit decision to use the deployment sender. */
  defaultSenderAccountId: string | null;
  configVersion: number;
  effectiveFrom: string;
  updatedAt: string;
};

function toPolicyRow(row: PolicyDbRow): EmailPolicyRow {
  return {
    businessScope:
      row.business_scope_type && row.business_scope_id
        ? { type: row.business_scope_type, id: row.business_scope_id }
        : null,
    defaultSenderAccountId: row.default_sender_account_id,
    configVersion: Number(row.config_version)
  };
}

function toPolicyView(row: PolicyDbRow): EmailSenderPolicyView {
  return {
    id: row.id,
    ...toPolicyRow(row),
    effectiveFrom: iso(row.effective_from),
    updatedAt: iso(row.updated_at)
  };
}

/** The full list, for the admin view only (never used to choose a sender). Bounded. */
export async function listEmailSenderPolicies(
  tx: Bun.SQL,
  tenantId: string
): Promise<EmailSenderPolicyView[]> {
  const rows = (await tx`
    SELECT id, business_scope_type, business_scope_id,
           default_sender_account_id, config_version, effective_from, updated_at
    FROM awcms_email_sender_policies
    WHERE tenant_id = ${tenantId}
    ORDER BY business_scope_type NULLS FIRST, business_scope_id
    LIMIT 500
  `) as PolicyDbRow[];

  return rows.map(toPolicyView);
}

/** The rows that can decide a message of `scope`: its own scope row and the tenant-wide row, each by its key (never filtered out of a capped list). */
async function loadApplicablePolicies(
  tx: Bun.SQL,
  tenantId: string,
  scope: EmailBusinessScope | null
): Promise<PolicyDbRow[]> {
  const scopeType = scope?.type ?? null;
  const scopeId = scope?.id ?? null;

  return (await tx`
    SELECT id, business_scope_type, business_scope_id,
           default_sender_account_id, config_version, effective_from, updated_at
    FROM awcms_email_sender_policies
    WHERE tenant_id = ${tenantId}
      AND (
        (business_scope_type IS NULL AND business_scope_id IS NULL)
        OR (
          ${scopeType}::text IS NOT NULL
          AND business_scope_type = ${scopeType}
          AND business_scope_id = ${scopeId}::uuid
        )
      )
  `) as PolicyDbRow[];
}

// ---------------------------------------------------------------------------
// Enqueue-time selection
// ---------------------------------------------------------------------------

export type EmailEnqueueSenderRefusal =
  "SENDER_UNAVAILABLE" | "SENDER_ROUTING_DISABLED";

/** What the enqueue writes on every row of the message (all NULL for the deployment sender). */
export type EmailSenderSnapshot = {
  senderAccountId: string | null;
  selection: EmailSenderSelection;
  policyVersion: number | null;
  senderAddress: string | null;
  senderName: string | null;
  businessScope: EmailBusinessScope | null;
};

export const DEPLOYMENT_SENDER_SNAPSHOT: EmailSenderSnapshot = Object.freeze({
  senderAccountId: null,
  selection: "deployment",
  policyVersion: null,
  senderAddress: null,
  senderName: null,
  businessScope: null
});

export type EmailEnqueueSenderDecision =
  | { ok: true; snapshot: EmailSenderSnapshot }
  | { ok: false; reason: EmailEnqueueSenderRefusal; detail: string };

const refuse = (
  reason: EmailEnqueueSenderRefusal,
  detail: string
): EmailEnqueueSenderDecision => ({ ok: false, reason, detail });

/**
 * `detail` is a coarse, non-sensitive code for logs (never an address, a token
 * or another tenant's fact); the CALLER only ever sees `reason`, so a probe
 * learns nothing about whether an id belongs to another tenant.
 */
export async function resolveEnqueueEmailSender(
  tx: Bun.SQL,
  context: {
    tenantId: string;
    explicitSenderAccountId: unknown;
    businessScope: unknown;
    purpose: EmailPurpose;
    senders: () => Promise<ChannelEmailSenderPort | null>;
    env?: NodeJS.ProcessEnv;
  }
): Promise<EmailEnqueueSenderDecision> {
  const env = context.env ?? process.env;
  const scope = parseEmailBusinessScope(context.businessScope);

  if (scope === "invalid") return refuse("SENDER_UNAVAILABLE", "scope_invalid");

  const explicitRaw = context.explicitSenderAccountId;
  const explicit =
    explicitRaw === undefined || explicitRaw === null ? null : explicitRaw;

  if (explicit !== null && !isEmailRecordUuid(explicit)) {
    return refuse("SENDER_UNAVAILABLE", "sender_id_invalid");
  }

  // ADR-0151 Q7: security mail never leaves the deployment sender, whatever the
  // caller asked for. Naming a sender on it is a refusal, not a silent override.
  if (context.purpose === "security") {
    return explicit === null && scope === null
      ? { ok: true, snapshot: DEPLOYMENT_SENDER_SNAPSHOT }
      : refuse("SENDER_UNAVAILABLE", "security_mail_uses_deployment_sender");
  }

  if (!isEmailSenderRoutingEnabled(env)) {
    // Off: the policy is not consulted; asking for a tenant sender is refused
    // loudly rather than quietly mailed from the deployment address.
    return explicit === null && scope === null
      ? { ok: true, snapshot: DEPLOYMENT_SENDER_SNAPSHOT }
      : refuse("SENDER_ROUTING_DISABLED", "routing_disabled");
  }

  const policy =
    explicit === null
      ? pickEmailPolicy(
          (await loadApplicablePolicies(tx, context.tenantId, scope)).map(
            toPolicyRow
          ),
          scope
        )
      : null;
  const choice = chooseEmailSender({
    explicitSenderAccountId: explicit === null ? null : explicit.toLowerCase(),
    policy
  });

  if (choice.senderAccountId === null) {
    return {
      ok: true,
      snapshot: {
        ...DEPLOYMENT_SENDER_SNAPSHOT,
        policyVersion: choice.policyVersion,
        businessScope: scope
      }
    };
  }

  const port = await context.senders();

  if (!port) return refuse("SENDER_UNAVAILABLE", "no_channel_account_port");

  // Not wrapped in a catch: the port's only failure is a database error, which
  // has aborted the CALLER's transaction, so nothing can be queued either way.
  const verdict = await port.resolveEmailSender(tx, {
    tenantId: context.tenantId,
    accountId: choice.senderAccountId,
    capability: capabilityForEmailPurpose(context.purpose),
    withDisplayName: true
  });

  if (!verdict.usable) {
    return refuse("SENDER_UNAVAILABLE", `denied_${verdict.reason}`);
  }

  if (!emailSenderScopeAllows(verdict.sender.businessScope, scope)) {
    return refuse("SENDER_UNAVAILABLE", "scope_mismatch");
  }

  return {
    ok: true,
    snapshot: {
      senderAccountId: verdict.sender.accountId,
      selection: choice.selection,
      policyVersion: choice.policyVersion,
      senderAddress: verdict.sender.address,
      senderName: verdict.sender.displayName,
      businessScope: scope
    }
  };
}

export function logEmailSenderRefusal(
  tenantId: string,
  detail: string,
  correlationId: string | undefined
): void {
  log("warning", "email.enqueue.sender_refused", {
    tenantId,
    moduleKey: MODULE_KEY,
    correlationId,
    detail
  });
}

// ---------------------------------------------------------------------------
// The default-sender policy
// ---------------------------------------------------------------------------

export type SetEmailSenderPolicyInput = {
  businessScope: EmailBusinessScope | null;
  /** `null` selects the deployment sender for this scope, explicitly. */
  defaultSenderAccountId: string | null;
};

export type SetEmailSenderPolicyOutcome =
  | {
      outcome: "set";
      policy: EmailSenderPolicyView;
      changed: boolean;
      previous: {
        defaultSenderAccountId: string | null;
        configVersion: number;
      } | null;
    }
  | {
      outcome: "refused";
      code:
        | "SENDER_UNAVAILABLE"
        | "CHANNEL_ACCOUNTS_UNAVAILABLE"
        | "SENDER_ROUTING_DISABLED";
    };

/**
 * Sets the default sender of a business scope (or tenant-wide). The sender must
 * be one this tenant may use for a transactional email RIGHT NOW (the same check
 * the enqueue makes), inside the policy's scope. The database guard (`sql/346`)
 * enforces tenant ownership, shape, `connected` and scope again.
 */
export async function setEmailSenderPolicy(
  tx: Bun.SQL,
  tenantId: string,
  actorTenantUserId: string,
  input: SetEmailSenderPolicyInput,
  senders: ChannelEmailSenderPort | null,
  env: NodeJS.ProcessEnv = process.env
): Promise<SetEmailSenderPolicyOutcome> {
  if (!isEmailSenderRoutingEnabled(env)) {
    return { outcome: "refused", code: "SENDER_ROUTING_DISABLED" };
  }

  if (input.defaultSenderAccountId !== null) {
    if (!senders) {
      return { outcome: "refused", code: "CHANNEL_ACCOUNTS_UNAVAILABLE" };
    }

    const verdict = await senders.resolveEmailSender(tx, {
      tenantId,
      accountId: input.defaultSenderAccountId,
      capability: "dm"
    });

    if (
      !verdict.usable ||
      !emailSenderScopeAllows(verdict.sender.businessScope, input.businessScope)
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
    FROM awcms_email_sender_policies
    WHERE tenant_id = ${tenantId}
      AND business_scope_type IS NOT DISTINCT FROM ${scopeType}::text
      AND business_scope_id IS NOT DISTINCT FROM ${scopeId}::uuid
    FOR UPDATE
  `) as PolicyDbRow[];
  const current = existing[0];

  if (current) {
    const previous = {
      defaultSenderAccountId: current.default_sender_account_id,
      configVersion: Number(current.config_version)
    };

    if (current.default_sender_account_id === input.defaultSenderAccountId) {
      return {
        outcome: "set",
        policy: toPolicyView(current),
        changed: false,
        previous
      };
    }

    const updated = (await tx`
      UPDATE awcms_email_sender_policies
      SET default_sender_account_id = ${input.defaultSenderAccountId},
          config_version = config_version + 1, effective_from = now(),
          changed_by = ${actorTenantUserId}, updated_at = now()
      WHERE tenant_id = ${tenantId} AND id = ${current.id}
      RETURNING id, business_scope_type, business_scope_id,
                default_sender_account_id, config_version, effective_from,
                updated_at
    `) as PolicyDbRow[];

    return {
      outcome: "set",
      policy: toPolicyView(updated[0]!),
      changed: true,
      previous
    };
  }

  const inserted = (await tx`
    INSERT INTO awcms_email_sender_policies
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
// Health facts and quota (read by the dispatcher as `awcms_worker`)
// ---------------------------------------------------------------------------

type HealthDbRow = {
  account_id: string;
  state: string;
  reason_code: string | null;
  checked_at: Date | string;
  quota_remaining: string | number | null;
};

/**
 * The latest health of a sender and of its Mailketing account, in ONE
 * statement, reading exactly the columns `sql/348` grants the worker. A missing
 * row is `null`, which the freshness gate treats as unknown (a hold).
 */
export async function loadEmailSenderHealth(
  tx: Bun.SQL,
  tenantId: string,
  sender: Pick<ResolvedEmailSender, "accountId" | "espAccountId">
): Promise<{
  sender: EmailAccountHealthFacts | null;
  account: EmailAccountHealthFacts | null;
}> {
  const rows = (await tx`
    SELECT account_id, state, reason_code, checked_at,
           quota_remaining::float8 AS quota_remaining
    FROM awcms_channel_account_health
    WHERE tenant_id = ${tenantId}
      AND account_id IN (${sender.accountId}::uuid, ${sender.espAccountId}::uuid)
  `) as HealthDbRow[];
  const facts = (accountId: string): EmailAccountHealthFacts | null => {
    const row = rows.find((candidate) => candidate.account_id === accountId);

    return row
      ? {
          state: row.state,
          reasonCode: row.reason_code,
          checkedAt: new Date(row.checked_at),
          quotaRemaining:
            row.quota_remaining === null ? null : Number(row.quota_remaining)
        }
      : null;
  };

  return {
    sender: facts(sender.accountId),
    account: facts(sender.espAccountId)
  };
}

/**
 * How many messages a sender may still have claimed this hour: the cap minus
 * what it really sent in the trailing hour minus what is in flight. Counted
 * from the queue itself, so it cannot drift from what was sent. Never negative.
 * The caller holds the per-sender advisory lock (see the dispatcher).
 */
export async function emailSenderAllowance(
  tx: Bun.SQL,
  tenantId: string,
  senderAccountId: string,
  env: NodeJS.ProcessEnv
): Promise<number> {
  const rows = (await tx`
    SELECT
      count(*) FILTER (WHERE status = 'sent'
                         AND sent_at > now() - interval '1 hour') AS sent_hour,
      count(*) FILTER (WHERE status = 'sending') AS in_flight
    FROM awcms_email_messages
    WHERE tenant_id = ${tenantId} AND sender_account_id = ${senderAccountId}
      AND (status = 'sending'
           OR (status = 'sent' AND sent_at > now() - interval '1 hour'))
  `) as { sent_hour: string | number; in_flight: string | number }[];

  return Math.max(
    0,
    resolveEmailSenderRatePerHour(env) -
      Number(rows[0]?.sent_hour ?? 0) -
      Number(rows[0]?.in_flight ?? 0)
  );
}

// ---------------------------------------------------------------------------
// Per-sender diagnostics (GET /api/v1/email/senders)
// ---------------------------------------------------------------------------

export type EmailSenderDiagnostics = {
  /** `null` is the deployment sender. */
  senderAccountId: string | null;
  /** `null` for the deployment sender, which has no account record. */
  availability: { usable: true } | { usable: false; reason: string } | null;
  queue: {
    waiting: number;
    sending: number;
    failed: number;
    oldestPendingAt: string | null;
  };
  quota: {
    sentLastHour: number;
    hourlyLimit: number;
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
};

/**
 * One entry per sender that has any queue row in the last 35 days (and the
 * deployment sender), from ONE statement over the tenant's own queue. Reads no
 * credential and no recipient. Availability is asked of the port per sender
 * (bounded by the 200-lane limit).
 */
export async function summarizeEmailSenders(
  tx: Bun.SQL,
  tenantId: string,
  senders: ChannelEmailSenderPort | null,
  env: NodeJS.ProcessEnv = process.env
): Promise<EmailSenderDiagnostics[]> {
  const rows = (await tx`
    SELECT m.sender_account_id,
           count(*) FILTER (WHERE m.status IN ('queued', 'retry_wait')) AS waiting,
           count(*) FILTER (WHERE m.status = 'sending') AS sending,
           count(*) FILTER (WHERE m.status = 'failed'
                              AND m.updated_at > now() - interval '1 day') AS failed,
           min(m.created_at) FILTER (WHERE m.status IN ('queued', 'retry_wait')) AS oldest_pending_at,
           count(*) FILTER (WHERE m.status = 'sent'
                              AND m.sent_at > now() - interval '1 hour') AS sent_hour
    FROM awcms_email_messages m
    WHERE m.tenant_id = ${tenantId}
      AND m.created_at > now() - interval '35 days'
    GROUP BY m.sender_account_id
    ORDER BY m.sender_account_id NULLS FIRST
    LIMIT 200
  `) as LaneRow[];
  const hourly = resolveEmailSenderRatePerHour(env);
  const result: EmailSenderDiagnostics[] = [];

  for (const row of rows) {
    let availability: EmailSenderDiagnostics["availability"] = null;

    if (row.sender_account_id !== null) {
      const verdict = senders
        ? await senders.resolveEmailSender(tx, {
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

    result.push({
      senderAccountId: row.sender_account_id,
      availability,
      queue: {
        waiting: Number(row.waiting),
        sending: Number(row.sending),
        failed: Number(row.failed),
        oldestPendingAt: row.oldest_pending_at
          ? iso(row.oldest_pending_at)
          : null
      },
      quota: {
        sentLastHour: sentHour,
        hourlyLimit: hourly,
        throttled: row.sender_account_id !== null && sentHour >= hourly
      }
    });
  }

  return result;
}
