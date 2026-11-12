/**
 * The `ChannelAccountPort` adapter (Issue #1141, ADR-0148 capability C1; the
 * port is `_shared/ports/channel-account-port.ts`, ADR-0011). It answers one
 * question for a channel module: may this tenant-owned account send a WhatsApp
 * message RIGHT NOW, for this purpose? It returns metadata and a verdict,
 * **never a secret**: this file deliberately does not import the secret store,
 * so a job that only enqueues (booking's reminder dispatch) can reach it
 * without reaching the key ring (`tests/jobs-env-scoped-reach.test.ts`).
 *
 * ## It runs as two roles
 *
 * As `awcms_app` on the enqueue path and as `awcms_worker` in the dispatcher.
 * The worker holds COLUMN-ONLY SELECT (`sql/322`), so every query below names
 * exactly the columns it needs and nothing else; widening a SELECT here without
 * widening the grant fails with `permission denied` under the worker role.
 *
 * ## Fail closed
 *
 * The decision is {@link evaluateCapability} — the same single place that
 * decides every capability use (ADR-0148 I2) — preceded by the account-state
 * reasons it cannot name. Every query is `WHERE tenant_id = $1` inside the
 * caller's tenant-scoped transaction (RLS `FORCE`), so another tenant's account
 * and an unknown id are one answer: `ACCOUNT_NOT_FOUND`.
 */
import {
  PUBLISH_CREDENTIAL_REJECTED_REASON,
  type ChannelAccountPort,
  type ChannelEmailAccountDirectoryPort,
  type ChannelEmailSenderPort,
  type EmailAccountSummary,
  type ChannelPublisherHealthPort,
  type ChannelPublisherPort,
  type EmailSenderUnavailableReason,
  type PublisherUnavailableReason,
  type ResolveEmailSenderResult,
  type ResolvePublisherResult,
  type ResolveWhatsappSenderResult,
  type SenderUnavailableReason,
  type WhatsappSenderProvider
} from "../../_shared/ports/channel-account-port";
import { isChannelAccountsEnabled } from "../domain/channel-accounts-constants";
import {
  isRiskAcknowledgementProvider,
  type RiskAcknowledgementProvider
} from "../domain/risk-acknowledgements";
import { hasActiveRiskAcknowledgement } from "./risk-acknowledgement-check";
import {
  evaluateCapability,
  getProviderRow,
  type CapabilityEvidenceKind,
  type CapabilityRowFacts,
  type ChannelCapability
} from "../domain/provider-matrix";

/** The (provider, kind) pairs that are a WhatsApp SENDING identity. A container (a WABA) holds no capability of its own; its numbers do. */
const WHATSAPP_SENDER_KINDS: Readonly<
  Record<WhatsappSenderProvider, readonly string[]>
> = {
  whatsapp_cloud: ["waba_phone_number"],
  starsender: ["device"]
};

export function isWhatsappSenderShape(
  provider: string,
  accountKind: string
): provider is WhatsappSenderProvider {
  return (
    Object.hasOwn(WHATSAPP_SENDER_KINDS, provider) &&
    WHATSAPP_SENDER_KINDS[provider as WhatsappSenderProvider].includes(
      accountKind
    )
  );
}

/**
 * The (provider, kind) that is an EMAIL sending identity (Issue #1160, ADR-0151
 * section 2): a verified Mailketing from-address. Its parent `esp_account` is a
 * container that holds the token and sends nothing itself.
 */
export function isEmailSenderShape(
  provider: string,
  accountKind: string
): boolean {
  return provider === "mailketing" && accountKind === "sender_identity";
}

export type SenderAccountRow = {
  id: string;
  business_scope_type: string | null;
  business_scope_id: string | null;
  provider: string;
  account_kind: string;
  external_id: string;
  auth_mode: string;
  connection_id: string | null;
  parent_account_id: string | null;
  secret_id: string | null;
  status: string;
};

/** The worker-readable column set of `awcms_channel_accounts` (sql/322). */
export async function loadSenderAccount(
  tx: Bun.SQL,
  tenantId: string,
  accountId: string
): Promise<SenderAccountRow | null> {
  const rows = (await tx`
    SELECT id, business_scope_type, business_scope_id, provider, account_kind,
           external_id, auth_mode, connection_id, parent_account_id, secret_id,
           status
    FROM awcms_channel_accounts
    WHERE tenant_id = ${tenantId} AND id = ${accountId}
      AND deleted_at IS NULL
  `) as SenderAccountRow[];

  return rows[0] ?? null;
}

export function reasonForAccountStatus(
  status: string
): SenderUnavailableReason | null {
  switch (status) {
    case "connected":
      return null;
    case "pending":
      return "ACCOUNT_PENDING";
    case "degraded":
      return "ACCOUNT_DEGRADED";
    case "revoked":
      return "ACCOUNT_REVOKED";
    case "disabled":
      return "ACCOUNT_DISABLED";
    default:
      // `deleted` is filtered by the query; anything unknown is not usable.
      return "ACCOUNT_NOT_FOUND";
  }
}

/**
 * The reason a connection grant cannot lend its token, or `null` when it is
 * `active`. A grant that is `expired` (a refresh failed) or still `pending` is
 * recoverable by the tenant re-authorising, so a send waits (a HOLD); `revoked`,
 * `failed` and an unreadable connection are over (terminal).
 */
export function reasonForGrantState(
  grantState: string
): SenderUnavailableReason | null {
  switch (grantState) {
    case "active":
      return null;
    case "expired":
    case "pending":
      return "CONNECTION_EXPIRED";
    default:
      return "CONNECTION_NOT_ACTIVE";
  }
}

/**
 * A child identity (a WABA phone number) with no credential source of its own
 * borrows its parent container's. A parent only LENDS when it really is that
 * child's container (same provider, the kind the matrix names as its parent) and
 * is itself `connected`: a disabled, revoked, degraded or pending container must
 * not lend its token or its connection to anything. Returns the parent, or the
 * reason it cannot lend.
 */
export async function loadLendingParent(
  tx: Bun.SQL,
  tenantId: string,
  account: SenderAccountRow
): Promise<{ parent: SenderAccountRow } | { reason: SenderUnavailableReason }> {
  if (!account.parent_account_id) return { reason: "CREDENTIAL_UNAVAILABLE" };

  const parent = await loadSenderAccount(
    tx,
    tenantId,
    account.parent_account_id
  );
  const expectedKind = getProviderRow(account.provider)?.kinds[
    account.account_kind
  ]?.parentKind;

  if (
    !parent ||
    parent.provider !== account.provider ||
    !expectedKind ||
    parent.account_kind !== expectedKind
  ) {
    return { reason: "CREDENTIAL_UNAVAILABLE" };
  }

  // Issue #1160 audit M2: a parent lends only to a child whose scope it
  // CONTAINS. A tenant-wide parent lends to any child; a scoped parent only to
  // a child of the same scope. Otherwise brand B's sender would spend brand A's
  // token and credit. Enforced at every lend (enqueue, dispatch, decrypt), not
  // only when the child was registered.
  if (
    parent.business_scope_type !== null &&
    (account.business_scope_type !== parent.business_scope_type ||
      String(account.business_scope_id).toLowerCase() !==
        String(parent.business_scope_id).toLowerCase())
  ) {
    return { reason: "CREDENTIAL_UNAVAILABLE" };
  }

  const statusReason = reasonForAccountStatus(parent.status);

  return statusReason ? { reason: statusReason } : { parent };
}

type CapabilityRow = {
  state: CapabilityRowFacts["state"];
  evidence_kind: CapabilityEvidenceKind | null;
  evidence_ref: string | null;
  matrix_version: number;
};

export type ChannelAccountPortOptions = {
  env?: NodeJS.ProcessEnv;
};

type AccountEvaluation =
  | { usable: true; account: SenderAccountRow }
  | {
      usable: false;
      reason:
        SenderUnavailableReason | "NOT_A_PUBLISHER" | "NOT_AN_EMAIL_SENDER";
    };

/**
 * The ONE evaluation of "may this account use `capability` right now", shared
 * by every channel module (WhatsApp senders, publishers). The caller supplies
 * only what differs: which (provider, kind) pairs count as the right KIND of
 * identity, and the reason to give for any other.
 */
async function evaluateAccountForCapability(
  tx: Bun.SQL,
  env: NodeJS.ProcessEnv,
  input: { tenantId: string; accountId: string },
  capability: ChannelCapability,
  shape: {
    isRightKind: (account: SenderAccountRow) => boolean;
    wrongKindReason:
      "NOT_A_WHATSAPP_SENDER" | "NOT_A_PUBLISHER" | "NOT_AN_EMAIL_SENDER";
    /**
     * A refusal that must be decided BEFORE the account's status (the provider
     * risk acknowledgement of a WhatsApp sender, Issue #1142); `null` lets the
     * evaluation go on.
     */
    gate?: (
      account: SenderAccountRow
    ) => Promise<SenderUnavailableReason | null>;
  }
): Promise<AccountEvaluation> {
  if (!isChannelAccountsEnabled(env)) {
    return { usable: false, reason: "CHANNEL_ACCOUNTS_DISABLED" };
  }

  const account = await loadSenderAccount(tx, input.tenantId, input.accountId);

  if (!account) return { usable: false, reason: "ACCOUNT_NOT_FOUND" };

  if (!getProviderRow(account.provider) || !shape.isRightKind(account)) {
    return { usable: false, reason: shape.wrongKindReason };
  }

  // Asked BEFORE the account's status on purpose (Issue #1142, ADR-0148 section
  // 7): a revocation of an acknowledgement also degrades the tenant's accounts,
  // and a degraded account is only HELD, which would leave non-expiring messages
  // waiting forever on a decision that was made; the unacknowledged provider is
  // terminal.
  const gated = shape.gate ? await shape.gate(account) : null;

  if (gated) return { usable: false, reason: gated };

  const statusReason = reasonForAccountStatus(account.status);

  if (statusReason) return { usable: false, reason: statusReason };

  // The EFFECTIVE connection: the account's own, else (OAuth only) the
  // parent container's it borrows its token from. The credential adapter
  // resolves the same one, so the two ports cannot disagree about whether
  // the token is usable.
  let connectionId = account.connection_id;

  if (
    account.auth_mode === "oauth2" &&
    !connectionId &&
    account.parent_account_id
  ) {
    const lender = await loadLendingParent(tx, input.tenantId, account);

    if ("reason" in lender) return { usable: false, reason: lender.reason };

    connectionId = lender.parent.connection_id;
  }

  let connectionGrantState: string | null = null;

  if (connectionId) {
    const connection = (await tx`
      SELECT grant_state FROM awcms_channel_provider_connections
      WHERE tenant_id = ${input.tenantId} AND id = ${connectionId}
    `) as { grant_state: string }[];

    // A connection that cannot be read is NOT an active one.
    connectionGrantState = connection[0]?.grant_state ?? "missing";

    const grantReason = reasonForGrantState(connectionGrantState);

    if (grantReason) return { usable: false, reason: grantReason };
  }

  const capabilityRows = (await tx`
    SELECT state, evidence_kind, evidence_ref, matrix_version
    FROM awcms_channel_account_capabilities
    WHERE tenant_id = ${input.tenantId} AND account_id = ${account.id}
      AND capability = ${capability}
  `) as CapabilityRow[];
  const row = capabilityRows[0];
  const verdict = evaluateCapability({
    account: {
      provider: account.provider,
      accountKind: account.account_kind,
      status: account.status,
      connectionGrantState
    },
    capability,
    row: row
      ? {
          state: row.state,
          evidenceKind: row.evidence_kind,
          evidenceRef: row.evidence_ref,
          matrixVersion: row.matrix_version
        }
      : null
  });

  if (!verdict.allowed) {
    return {
      usable: false,
      reason:
        verdict.code === "CONNECTION_NOT_ACTIVE"
          ? "CONNECTION_NOT_ACTIVE"
          : verdict.code === "ACCOUNT_NOT_USABLE"
            ? "ACCOUNT_DEGRADED"
            : "CAPABILITY_DENIED"
    };
  }

  return { usable: true, account };
}

/**
 * Whether the provider matrix can EVER let this (provider, kind) publish: a
 * container (a WABA) holds no capability of its own, and a provider whose
 * `publish` cell is not offered, not applicable or barred never can. A pure
 * pre-filter; the capability row and evidence still decide.
 */
export function isPublisherShape(
  provider: string,
  accountKind: string
): boolean {
  const row = getProviderRow(provider);

  if (!row || !row.registrable) return false;

  const kind = Object.hasOwn(row.kinds, accountKind)
    ? row.kinds[accountKind]
    : undefined;

  if (!kind || kind.container === true) return false;

  const cell = row.cells.publish;

  return cell === "candidate" || cell === "restricted" || cell === "unverified";
}

export function createChannelAccountPortAdapter(
  options: ChannelAccountPortOptions = {}
): ChannelAccountPort &
  ChannelPublisherPort &
  ChannelEmailSenderPort &
  ChannelPublisherHealthPort {
  const envOf = () => options.env ?? process.env;

  return {
    async resolveWhatsappSender(
      tx,
      input
    ): Promise<ResolveWhatsappSenderResult> {
      const evaluation = await evaluateAccountForCapability(
        tx,
        envOf(),
        input,
        input.capability,
        {
          isRightKind: (account) =>
            isWhatsappSenderShape(account.provider, account.account_kind),
          wrongKindReason: "NOT_A_WHATSAPP_SENDER",
          // An UNOFFICIAL provider is usable only while the tenant's
          // acknowledgement of its current, approved risk text is in force.
          // Re-read on every call, so a revocation is effective at the next
          // enqueue and the next claim. Fail closed: no row, no use.
          gate: async (account) =>
            isRiskAcknowledgementProvider(account.provider) &&
            !(await hasActiveRiskAcknowledgement(
              tx,
              input.tenantId,
              account.provider as RiskAcknowledgementProvider
            ))
              ? "RISK_ACKNOWLEDGEMENT_REQUIRED"
              : null
        }
      );

      if (!evaluation.usable) {
        return {
          usable: false,
          reason: evaluation.reason as SenderUnavailableReason
        };
      }

      const account = evaluation.account;
      let container: SenderAccountRow | null = null;

      // Issue #1143: a Meta number sends only as part of its WABA. The parent
      // must be a live `waba` container of the same provider, whatever the
      // number's own auth mode (an API-token number with no parent has no
      // verifiable binding). A container that is degraded, pending, revoked or
      // disabled answers its own status reason (held or terminal by the
      // consumer's policy), never "usable".
      if (account.provider === "whatsapp_cloud") {
        const binding = await loadLendingParent(tx, input.tenantId, account);

        if ("reason" in binding) {
          return {
            usable: false,
            reason:
              binding.reason === "CREDENTIAL_UNAVAILABLE"
                ? "CONTAINER_BINDING_INVALID"
                : binding.reason
          };
        }

        container = binding.parent;
      }

      return {
        usable: true,
        sender: {
          accountId: account.id,
          provider: account.provider as WhatsappSenderProvider,
          accountKind: account.account_kind,
          externalId: account.external_id,
          containerAccountId: container?.id ?? null,
          containerExternalId: container?.external_id ?? null,
          businessScope:
            account.business_scope_type && account.business_scope_id
              ? {
                  type: account.business_scope_type,
                  id: account.business_scope_id
                }
              : null
        }
      };
    },

    async resolvePublisher(tx, input): Promise<ResolvePublisherResult> {
      const evaluation = await evaluateAccountForCapability(
        tx,
        envOf(),
        input,
        "publish",
        {
          isRightKind: (account) =>
            isPublisherShape(account.provider, account.account_kind),
          wrongKindReason: "NOT_A_PUBLISHER"
        }
      );

      if (!evaluation.usable)
        return {
          usable: false,
          reason: evaluation.reason as PublisherUnavailableReason
        };

      const account = evaluation.account;

      return {
        usable: true,
        publisher: {
          accountId: account.id,
          provider: account.provider,
          accountKind: account.account_kind,
          externalId: account.external_id,
          businessScope:
            account.business_scope_type && account.business_scope_id
              ? {
                  type: account.business_scope_type,
                  id: account.business_scope_id
                }
              : null
        }
      };
    },

    /**
     * Issue #1160 (ADR-0151 section 2). A Mailketing sender identity may send
     * only while it AND the Mailketing account it borrows its token from are
     * `connected`: a disabled, revoked, degraded or pending account must not
     * lend its credential to any of its senders. The parent is asked after the
     * sender's own verdict, by the same `loadLendingParent` the credential
     * adapter uses, so the two ports cannot disagree about it.
     */
    async resolveEmailSender(tx, input): Promise<ResolveEmailSenderResult> {
      const evaluation = await evaluateAccountForCapability(
        tx,
        envOf(),
        input,
        input.capability,
        {
          isRightKind: (account) =>
            isEmailSenderShape(account.provider, account.account_kind),
          wrongKindReason: "NOT_AN_EMAIL_SENDER"
        }
      );

      if (!evaluation.usable) {
        return {
          usable: false,
          reason: evaluation.reason as EmailSenderUnavailableReason
        };
      }

      const account = evaluation.account;
      const lender = await loadLendingParent(tx, input.tenantId, account);

      if ("reason" in lender) return { usable: false, reason: lender.reason };

      let displayName: string | null = null;

      if (input.withDisplayName === true) {
        // Only on the enqueue path (`awcms_app`): the worker holds no grant on
        // this column, and asking for it there would abort its transaction.
        const named = (await tx`
          SELECT display_name FROM awcms_channel_accounts
          WHERE tenant_id = ${input.tenantId} AND id = ${account.id}
        `) as { display_name: string }[];

        displayName = named[0]?.display_name ?? null;
      }

      return {
        usable: true,
        sender: {
          accountId: account.id,
          provider: "mailketing",
          accountKind: "sender_identity",
          address: account.external_id.trim().toLowerCase(),
          espAccountId: lender.parent.id,
          businessScope:
            account.business_scope_type && account.business_scope_id
              ? {
                  type: account.business_scope_type,
                  id: account.business_scope_id
                }
              : null,
          displayName
        }
      };
    },

    /**
     * Issue #1146: the provider refused a publisher's credential. The same
     * transition `recordAccountHealth` makes for a `failing` report (connected
     * -> degraded, a fixed reason, the latest health row), written here with the
     * few columns the social dispatcher's role holds (`sql/373`) instead of
     * through `fetchAccountRecord`, which reads columns that role is not granted
     * (the display name among them). Its RESTRICTIVE policies refuse anything
     * else: only a live social account, only `connected` -> `degraded`, only a
     * `failing` health row.
     */
    async reportPublishCredentialRejected(tx, input) {
      const accounts = (await tx`
        SELECT id, provider, account_kind FROM awcms_channel_accounts
        WHERE tenant_id = ${input.tenantId} AND id = ${input.accountId}
          AND deleted_at IS NULL
      `) as { id: string; provider: string; account_kind: string }[];
      const account = accounts[0];

      if (
        !account ||
        !isPublisherShape(account.provider, account.account_kind)
      ) {
        return { recorded: false };
      }

      await tx`
        INSERT INTO awcms_channel_account_health
          (tenant_id, account_id, state, reason_code, checked_at)
        VALUES (${input.tenantId}, ${account.id}, 'failing',
                ${PUBLISH_CREDENTIAL_REJECTED_REASON}, now())
        ON CONFLICT (tenant_id, account_id) DO UPDATE
        SET state = EXCLUDED.state, reason_code = EXCLUDED.reason_code,
            checked_at = EXCLUDED.checked_at, updated_at = now()
      `;
      const degraded = (await tx`
        UPDATE awcms_channel_accounts
        SET status = 'degraded',
            status_reason = ${PUBLISH_CREDENTIAL_REJECTED_REASON},
            updated_at = now(), version = version + 1
        WHERE tenant_id = ${input.tenantId} AND id = ${account.id}
          AND status = 'connected' AND deleted_at IS NULL
      `) as unknown[] & { count?: number };

      // The #1271 audit, L5: `recorded` says whether THIS call moved the
      // account to `degraded` (one row updated), not merely that a health row
      // was written. An account already degraded, revoked or disabled answers
      // `false`, and the audit row's `accountDegraded` says the same.
      return { recorded: (degraded.count ?? 0) === 1 };
    }
  };
}

/** The adapter the composition roots hand to `whatsapp_delivery`, `social_publishing` and `email`. Reads `CHANNEL_ACCOUNTS_ENABLED` on every call. */
export const channelAccountPortAdapter: ChannelAccountPort &
  ChannelPublisherPort &
  ChannelEmailSenderPort &
  ChannelPublisherHealthPort = createChannelAccountPortAdapter();

/**
 * Issue #1160: the Mailketing accounts of one tenant and their sender
 * identities, for `email:senders:verify`. Two bounded statements in the
 * caller's tenant transaction; identities and statuses only.
 */
export const emailAccountDirectoryAdapter: ChannelEmailAccountDirectoryPort = {
  async readEmailAccountSecretRef(tx, tenantId, accountId) {
    const rows = (await tx`
      SELECT s.id, s.version
      FROM awcms_channel_accounts a
      JOIN awcms_channel_secrets s
        ON s.tenant_id = a.tenant_id AND s.id = a.secret_id
      WHERE a.tenant_id = ${tenantId} AND a.id = ${accountId}
        AND a.deleted_at IS NULL
    `) as { id: string; version: number }[];

    return rows[0]
      ? { secretId: rows[0].id, version: Number(rows[0].version) }
      : null;
  },

  async listEmailAccounts(tx, tenantId): Promise<EmailAccountSummary[]> {
    const accounts = (await tx`
      SELECT id, status FROM awcms_channel_accounts
      WHERE tenant_id = ${tenantId} AND provider = 'mailketing'
        AND account_kind = 'esp_account' AND deleted_at IS NULL
        AND status IN ('pending', 'connected', 'degraded')
      ORDER BY created_at, id
      LIMIT 200
    `) as { id: string; status: string }[];

    if (accounts.length === 0) return [];

    const senders = (await tx`
      SELECT id, parent_account_id, external_id, status
      FROM awcms_channel_accounts
      WHERE tenant_id = ${tenantId} AND provider = 'mailketing'
        AND account_kind = 'sender_identity' AND deleted_at IS NULL
        AND status IN ('pending', 'connected', 'degraded')
        AND parent_account_id = ANY(${tx.array(
          accounts.map((account) => account.id),
          "uuid"
        )})
      ORDER BY created_at, id
      LIMIT 2000
    `) as {
      id: string;
      parent_account_id: string;
      external_id: string;
      status: string;
    }[];

    return accounts.map((account) => ({
      espAccountId: account.id,
      status: account.status,
      senders: senders
        .filter((sender) => sender.parent_account_id === account.id)
        .map((sender) => ({
          accountId: sender.id,
          address: sender.external_id.trim().toLowerCase(),
          status: sender.status
        }))
    }));
  }
};
