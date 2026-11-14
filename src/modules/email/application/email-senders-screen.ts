/**
 * What `/admin/email-senders` shows and offers one caller (Issue #1162,
 * ADR-0151 sections 2, 6 and 7, ADR-0149).
 *
 * It is a function in this module, not frontmatter, so a real database can test
 * the rules that matter: an account of another tenant or another brand never
 * appears, a stale fact is not read as a verified one, and the "make default"
 * action is offered only where `PUT /api/v1/email/sender-policy` would accept it.
 *
 * ## It reads what the API reads, through the API's rules
 *
 * - the accounts come from the channel registry under its own visibility rules
 *   (assignment gate, business scope decided per row at the chokepoint) via
 *   `tryLoadMailketingAccountLister`;
 * - the queue lanes and the default-sender policies are `summarizeEmailSenders`
 *   and `listEmailSenderPolicies`, narrowed by `filterVisibleEmailSenders`, the
 *   function `GET /api/v1/email/senders` itself applies;
 * - "may this sender send now" is the dispatcher's own freshness gate
 *   (`evaluateEmailSenderHealth`) plus the port's `resolveEmailSender`.
 *
 * ## What is never read
 *
 * No credential, no secret reference, no token, no webhook secret, no recipient.
 * The account view carries only `hasCredential`; the health row carries a state,
 * a coarse reason code, a timestamp and a credit balance.
 *
 * One query at a time: `tx` is one reserved connection.
 */
import type { ChannelEmailSenderPort } from "../../_shared/ports/channel-account-port";
import {
  resolveEmailMailketingCreditFloor,
  resolveEmailSenderHealthMaxAgeMs,
  isEmailSenderRoutingEnabled
} from "../domain/email-sender-config";
import {
  accountConnection,
  creditReading,
  mailketingMigrationNotice,
  maskSenderAddress,
  classifyCheckFreshness,
  senderHealthHold,
  senderVerification,
  type AccountConnection,
  type CheckFreshness,
  type CreditReading,
  type MailketingMigrationNotice,
  type SenderVerification
} from "../domain/email-senders-view";
import type {
  EmailAccountHealthFacts,
  EmailSenderHealthHold
} from "../domain/email-sender";
import {
  loadEmailSenderAccess,
  tryLoadEmailSenderPort,
  tryLoadMailketingAccountLister,
  type EmailMailketingAccountView,
  type EmailSenderAccessContext,
  type EmailSenderAccessGuard
} from "../infrastructure/channel-account-loaders";
import {
  listEmailSenderPolicies,
  summarizeEmailSenders,
  type EmailSenderDiagnostics,
  type EmailSenderPolicyView
} from "./email-sender-directory";
import { filterVisibleEmailSenders } from "./email-sender-visibility";

export const EMAIL_SENDERS_READ_GUARD: EmailSenderAccessGuard = {
  moduleKey: "email",
  activityCode: "senders",
  action: "read"
};
export const EMAIL_SENDER_POLICY_GUARD: EmailSenderAccessGuard = {
  moduleKey: "email",
  activityCode: "sender_policy",
  action: "configure"
};

/** How many Mailketing accounts (logins and sender identities together) the screen loads. */
export const EMAIL_SENDERS_ACCOUNT_LIMIT = 100;

type Can = (request: EmailSenderAccessGuard) => Promise<boolean>;

export type EmailSenderLane = {
  waiting: number;
  sending: number;
  failedLastDay: number;
  oldestPendingAt: string | null;
  sentLastHour: number;
  hourlyLimit: number;
  throttled: boolean;
};

export type EmailEspAccountRow = {
  id: string;
  displayName: string;
  status: string;
  businessScope: { type: string; id: string } | null;
  connection: AccountConnection;
  freshness: CheckFreshness;
  checkedAt: string | null;
  credit: CreditReading;
  /** Tenant-owned senders always use the Mailketing API v2. */
  apiVersion: "v2";
  senderCount: number;
};

/** Why the "make default" action is withheld; `null` means it is offered. */
export type DefaultSenderWithheld =
  | "not_permitted"
  | "routing_disabled"
  | "not_connected"
  | "not_ready"
  | "not_yours"
  | "scope_not_held";

export type EmailSenderRow = {
  id: string;
  displayName: string;
  addressMasked: string;
  status: string;
  businessScope: { type: string; id: string } | null;
  /** The Mailketing login this identity borrows its token from, when the caller may see that login. */
  parentAccountId: string | null;
  parentName: string | null;
  verification: SenderVerification;
  freshness: CheckFreshness;
  checkedAt: string | null;
  /** The dispatcher's freshness verdict: `null` means nothing holds this sender. */
  hold: EmailSenderHealthHold | null;
  /** The channel registry's verdict (status, capability, parent login), as a coarse code when not usable. */
  unusableReason: string | null;
  readyToSend: boolean;
  /** `null` when the caller may not learn it. */
  isDefault: boolean | null;
  /** `null` = the "make default" action is offered. */
  defaultWithheld: DefaultSenderWithheld | null;
  lane: EmailSenderLane | null;
};

export type EmailSendersScreen = {
  /** The channel module could not be loaded: nothing below is known, and that is not "no senders". */
  unavailable: boolean;
  channelAccountsEnabled: boolean;
  routingEnabled: boolean;
  migration: MailketingMigrationNotice & {
    deploymentApiVersion: string | null;
  };
  freshnessWindowMinutes: number;
  creditFloor: number;
  accounts: EmailEspAccountRow[];
  senders: EmailSenderRow[];
  /** More Mailketing accounts exist than the screen loads. */
  truncated: boolean;
  canConfigurePolicy: boolean;
  confined: boolean;
  /** The deployment sender's lane, for a caller who may see it (not scope-confined). */
  deploymentLane: EmailSenderLane | null;
  /** Whether the tenant-wide policy picks the deployment sender explicitly; `null` when not visible. */
  deploymentIsDefault: boolean | null;
};

const iso = (value: Date): string => value.toISOString();

function laneOf(
  entry: EmailSenderDiagnostics | undefined
): EmailSenderLane | null {
  return entry
    ? {
        waiting: entry.queue.waiting,
        sending: entry.queue.sending,
        failedLastDay: entry.queue.failed,
        oldestPendingAt: entry.queue.oldestPendingAt,
        sentLastHour: entry.quota.sentLastHour,
        hourlyLimit: entry.quota.hourlyLimit,
        throttled: entry.quota.throttled
      }
    : null;
}

type HealthDbRow = {
  account_id: string;
  state: string;
  reason_code: string | null;
  checked_at: Date | string;
  quota_remaining: string | number | null;
};

/**
 * Every recorded health fact of the tenant's live Mailketing accounts in ONE
 * statement (no per-row query). The caller passes only the ids of accounts it may
 * already see (the lister's narrowed list), so no fact of an account the caller
 * cannot see is loaded.
 */
export async function loadMailketingHealth(
  tx: Bun.SQL,
  tenantId: string,
  accountIds: string[]
): Promise<Map<string, EmailAccountHealthFacts>> {
  const facts = new Map<string, EmailAccountHealthFacts>();

  // Only the accounts the caller may see are asked about: a fact of an account
  // the caller cannot see is never read, and the statement is bounded by the
  // (already capped) visible list instead of an arbitrary LIMIT cut.
  if (accountIds.length === 0) return facts;

  const rows = (await tx`
    SELECT h.account_id, h.state, h.reason_code, h.checked_at,
           h.quota_remaining::float8 AS quota_remaining
    FROM awcms_channel_account_health AS h
    JOIN awcms_channel_accounts AS a
      ON a.tenant_id = h.tenant_id AND a.id = h.account_id
    WHERE h.tenant_id = ${tenantId}
      AND a.provider = 'mailketing'
      AND a.deleted_at IS NULL
      AND h.account_id = ANY(${tx.array(accountIds, "uuid")}::uuid[])
    LIMIT 1000
  `) as HealthDbRow[];

  for (const row of rows) {
    facts.set(row.account_id, {
      state: row.state,
      reasonCode: row.reason_code,
      checkedAt: new Date(row.checked_at),
      quotaRemaining:
        row.quota_remaining === null ? null : Number(row.quota_remaining)
    });
  }

  return facts;
}

export async function resolveEmailSendersScreen(
  context: EmailSenderAccessContext,
  can: Can,
  options: {
    env?: NodeJS.ProcessEnv;
    senderPort?: ChannelEmailSenderPort | null;
    /** The page spells the guard out as a literal (coverage gate); a test holds it equal to the default. */
    policyGuard?: EmailSenderAccessGuard;
  } = {}
): Promise<EmailSendersScreen> {
  const env = options.env ?? process.env;
  const now = context.now;
  const maxAgeMs = resolveEmailSenderHealthMaxAgeMs(env);
  const creditFloor = resolveEmailMailketingCreditFloor(env);
  const routingEnabled = isEmailSenderRoutingEnabled(env);
  const base = {
    routingEnabled,
    migration: mailketingMigrationNotice(env),
    freshnessWindowMinutes: Math.round(maxAgeMs / 60_000),
    creditFloor
  };
  const empty = (
    unavailable: boolean,
    channelAccountsEnabled: boolean
  ): EmailSendersScreen => ({
    ...base,
    unavailable,
    channelAccountsEnabled,
    accounts: [],
    senders: [],
    truncated: false,
    canConfigurePolicy: false,
    confined: true,
    deploymentLane: null,
    deploymentIsDefault: null
  });
  const lister = await tryLoadMailketingAccountLister();
  const access = await loadEmailSenderAccess();

  // Default-deny: a dependency that cannot be loaded is "unavailable", not "none".
  if (!lister || !access) return empty(true, false);
  if (!lister.enabled()) return empty(false, false);

  const port =
    options.senderPort === undefined
      ? await tryLoadEmailSenderPort()
      : options.senderPort;
  const policyGuard = options.policyGuard ?? EMAIL_SENDER_POLICY_GUARD;
  const canConfigurePolicy = await can(policyGuard);
  const listed = await lister.list(
    context,
    EMAIL_SENDERS_READ_GUARD,
    EMAIL_SENDERS_ACCOUNT_LIMIT
  );
  const policies = await listEmailSenderPolicies(context.tx, context.tenantId);
  const diagnostics = await summarizeEmailSenders(
    context.tx,
    context.tenantId,
    port,
    env
  );
  const visible = await filterVisibleEmailSenders(
    context,
    EMAIL_SENDERS_READ_GUARD,
    access,
    diagnostics,
    policies
  );
  const health = await loadMailketingHealth(
    context.tx,
    context.tenantId,
    listed.accounts.map((account) => account.id)
  );
  const lanes = new Map<string | null, EmailSenderDiagnostics>(
    visible.senders.map((entry) => [entry.senderAccountId, entry])
  );
  const espById = new Map<string, EmailMailketingAccountView>();

  for (const account of listed.accounts) {
    if (account.accountKind === "esp_account") espById.set(account.id, account);
  }

  const senderAccounts = listed.accounts.filter(
    (account) => account.accountKind === "sender_identity"
  );
  const accounts: EmailEspAccountRow[] = [];

  for (const account of espById.values()) {
    const facts = health.get(account.id) ?? null;

    accounts.push({
      id: account.id,
      displayName: account.displayName,
      status: account.status,
      businessScope: account.businessScope,
      connection: accountConnection({
        status: account.status,
        facts,
        now,
        maxAgeMs
      }),
      freshness: classifyCheckFreshness(
        facts?.checkedAt ?? null,
        now,
        maxAgeMs
      ),
      checkedAt: facts ? iso(facts.checkedAt) : null,
      credit: creditReading(facts, now, maxAgeMs, creditFloor),
      apiVersion: "v2",
      senderCount: senderAccounts.filter(
        (sender) => sender.parentAccountId === account.id
      ).length
    });
  }

  const policyScopeKey = (scope: { type: string; id: string } | null) =>
    scope === null ? "" : `${scope.type}:${scope.id}`;
  const isDefaultFor = (account: {
    id: string;
    businessScope: { type: string; id: string } | null;
  }): boolean | null => {
    // A tenant-wide sender's policy is the tenant-wide policy, which a confined
    // caller does not hold (same rule as `GET /senders`).
    if (account.businessScope === null && visible.confined) return null;

    return visible.policies.some(
      (policy) =>
        policy.defaultSenderAccountId === account.id &&
        policyScopeKey(policy.businessScope) ===
          policyScopeKey(account.businessScope)
    );
  };
  const senders: EmailSenderRow[] = [];

  for (const account of senderAccounts) {
    const parent =
      account.parentAccountId !== null
        ? (espById.get(account.parentAccountId) ?? null)
        : null;
    const senderFacts = health.get(account.id) ?? null;
    // The parent's facts feed the credit hold only when the caller may see the
    // parent; otherwise the hold reads "credit unknown", which is a hold.
    const accountFacts =
      parent !== null ? (health.get(parent.id) ?? null) : null;
    const hold = senderHealthHold({
      sender: senderFacts,
      account: accountFacts,
      now,
      maxAgeMs,
      creditFloor
    });
    let unusableReason: string | null = null;

    // The registry verdict is only worth asking when its cheap preconditions
    // hold; a non-connected identity is not usable by definition.
    if (account.status !== "connected") {
      unusableReason = `STATUS_${account.status.toUpperCase()}`;
    } else if (lanes.get(account.id)?.availability) {
      // Already asked of the port for this lane by `summarizeEmailSenders`.
      const known = lanes.get(account.id)!.availability!;

      unusableReason = known.usable ? null : known.reason;
    } else if (!port) {
      unusableReason = "CHANNEL_ACCOUNTS_UNAVAILABLE";
    } else {
      const verdict = await port.resolveEmailSender(context.tx, {
        tenantId: context.tenantId,
        accountId: account.id,
        capability: "dm"
      });

      unusableReason = verdict.usable ? null : verdict.reason;
    }

    // A parent login the caller cannot see must not have its lifecycle (revoked,
    // disabled, degraded, pending) readable through this sender's reason: one
    // generic code, the same for every parent state.
    if (
      unusableReason !== null &&
      account.parentAccountId !== null &&
      parent === null &&
      (unusableReason.startsWith("ACCOUNT_") ||
        unusableReason === "CREDENTIAL_UNAVAILABLE")
    ) {
      unusableReason = "PARENT_UNAVAILABLE";
    }

    const readyToSend = hold === null && unusableReason === null;
    let defaultWithheld: DefaultSenderWithheld | null = null;

    if (!canConfigurePolicy) {
      defaultWithheld = "not_permitted";
    } else if (!routingEnabled) {
      defaultWithheld = "routing_disabled";
    } else if (account.status !== "connected") {
      defaultWithheld = "not_connected";
    } else if (!readyToSend) {
      defaultWithheld = "not_ready";
    } else if (
      !(await access.canUseAccount(
        context,
        policyGuard,
        account.id,
        "operator"
      ))
    ) {
      defaultWithheld = "not_yours";
    } else if (
      account.businessScope === null
        ? visible.confined
        : !(await access.scopeCovered(
            context,
            policyGuard,
            account.businessScope
          ))
    ) {
      defaultWithheld = "scope_not_held";
    }

    senders.push({
      id: account.id,
      displayName: account.displayName,
      addressMasked: maskSenderAddress(account.externalId),
      status: account.status,
      businessScope: account.businessScope,
      parentAccountId: parent?.id ?? null,
      parentName: parent?.displayName ?? null,
      verification: senderVerification(senderFacts, now, maxAgeMs),
      freshness: classifyCheckFreshness(
        senderFacts?.checkedAt ?? null,
        now,
        maxAgeMs
      ),
      checkedAt: senderFacts ? iso(senderFacts.checkedAt) : null,
      hold,
      unusableReason,
      readyToSend,
      isDefault: isDefaultFor(account),
      defaultWithheld,
      lane: laneOf(lanes.get(account.id))
    });
  }

  const tenantWidePolicy = visible.policies.find(
    (policy) => policy.businessScope === null
  );
  // A tenant-wide policy that exists but was filtered out (its default sender is
  // one the caller cannot see) makes the answer UNKNOWN, not "the deployment
  // sender is the default".
  const tenantWideHidden =
    tenantWidePolicy === undefined &&
    policies.some((policy) => policy.businessScope === null);

  return {
    ...base,
    unavailable: false,
    channelAccountsEnabled: true,
    accounts,
    senders,
    truncated: listed.more,
    canConfigurePolicy,
    confined: visible.confined,
    deploymentLane: visible.confined ? null : laneOf(lanes.get(null)),
    deploymentIsDefault:
      visible.confined || tenantWideHidden
        ? null
        : tenantWidePolicy === undefined
          ? true
          : tenantWidePolicy.defaultSenderAccountId === null
  };
}

export type { EmailSenderPolicyView };
