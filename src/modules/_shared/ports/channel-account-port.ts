/**
 * `ChannelAccountPort` and `ChannelSenderCredentialPort` — what a channel
 * module (today `whatsapp_delivery`, Issue #1141) may ask `channel_accounts`
 * (Issue #1140, ADR-0148 capability C1) about a tenant's own connected
 * accounts (ADR-0011: a consumer depends on THIS shape, never on
 * `channel_accounts`' application or domain code).
 *
 * ## Two ports, because they are two different trust levels
 *
 * - {@link ChannelAccountPort} answers "may this account send RIGHT NOW, for
 *   this purpose?" and returns identity metadata. It returns **no secret** and
 *   is safe on the enqueue path (a request transaction).
 * - {@link ChannelSenderCredentialPort} returns plaintext. It is for the
 *   dispatcher and provider adapters ONLY, inside the call that needs the
 *   credential, in memory, for the claimed row's tenant (ADR-0148 section 5).
 *   It is a separate type so that a module that only enqueues can never be
 *   handed it, and a job that imports it is granted the key ring on purpose.
 *
 * ## Fail closed (ADR-0148 I2, I5)
 *
 * Every refusal is a RETURNED value, never a thrown error and never a
 * fallback. The only thing either port throws is a DATABASE error, which has
 * already aborted the caller's transaction (so nothing is queued or sent); a
 * caller that catches it must treat it as a refusal. There is no
 * "try the other account", no "try the other provider": the only answers are
 * "this account may send" and "it may not, for this reason".
 *
 * ## Tenant authority
 *
 * Both ports look an account up by `(tenantId, accountId)` inside the
 * caller's tenant-scoped transaction. An account of another tenant, an unknown
 * id and a deleted account are INDISTINGUISHABLE (`ACCOUNT_NOT_FOUND`): the
 * port is not an oracle for another tenant's accounts. Nothing in either
 * input type is a token, a phone number id or a device id: those are read from
 * the account record, never from the caller.
 */

/** The provider-neutral use of a sender: a business-initiated message (`dm`), a reply inside a thread (`reply`), or a marketing send (`broadcast`). The names are the capabilities of the provider matrix (ADR-0148 section 3). */
export type WhatsappSenderCapability = "dm" | "reply" | "broadcast";

/** The WhatsApp rows of the provider matrix. A provider listed here is not necessarily one this deployment can SEND through: an adapter must exist. */
export type WhatsappSenderProvider = "whatsapp_cloud" | "starsender";

export type SenderUnavailableReason =
  /** `CHANNEL_ACCOUNTS_ENABLED` is not on: the control plane is off, so no tenant account may send. */
  | "CHANNEL_ACCOUNTS_DISABLED"
  /** Unknown, deleted, or another tenant's account: one answer for all three. */
  | "ACCOUNT_NOT_FOUND"
  /** The account is not a WhatsApp sending identity (another provider, or a container such as a WABA). */
  | "NOT_A_WHATSAPP_SENDER"
  /** `pending`: never finished connecting. */
  | "ACCOUNT_PENDING"
  /** `degraded`: a connector reported a problem; not usable, not dead. */
  | "ACCOUNT_DEGRADED"
  /** `revoked`: the tenant disconnected it or the provider revoked the grant. Terminal. */
  | "ACCOUNT_REVOKED"
  /** `disabled`: an administrator switched it off. */
  | "ACCOUNT_DISABLED"
  /** The connection behind the account has no active grant and never will (revoked, failed, missing). Terminal. */
  | "CONNECTION_NOT_ACTIVE"
  /** The grant has expired (a refresh failed) or is still pending: the tenant can re-authorise, so a send WAITS rather than fails. */
  | "CONNECTION_EXPIRED"
  /** The capability is not granted with evidence for this account, or the provider matrix does not allow it ("unapproved"). */
  | "CAPABILITY_DENIED"
  /** The provider is UNOFFICIAL (StarSender) and the tenant holds no active acknowledgement of its CURRENT, approved risk text (Issue #1142, ADR-0148 section 7). Terminal: it is a decision of the tenant's people, and rows must not wait on it silently. */
  | "RISK_ACKNOWLEDGEMENT_REQUIRED"
  /** The provider's adapter is switched off on this deployment (an UNOFFICIAL provider behind its flag, Issue #1142). Asked BEFORE any secret is read, so a device key is never decrypted while the adapter is off. Terminal. */
  | "PROVIDER_ADAPTER_DISABLED"
  /** No credential is stored for the account, or the stored token has expired. */
  | "CREDENTIAL_UNAVAILABLE"
  /** The key ring is missing or the ciphertext does not authenticate: an operator problem, not this message's. */
  | "SECRET_STORE_UNAVAILABLE";

export type ResolvedWhatsappSender = {
  accountId: string;
  provider: WhatsappSenderProvider;
  accountKind: string;
  /** The provider-stable identity: the `phone_number_id` of a WABA number, the device id of a StarSender device. Read from the account, never from a caller. */
  externalId: string;
  /** `null` is tenant-wide. */
  businessScope: { type: string; id: string } | null;
};

export type ResolveWhatsappSenderInput = {
  tenantId: string;
  accountId: string;
  capability: WhatsappSenderCapability;
};

export type ResolveWhatsappSenderResult =
  | { usable: true; sender: ResolvedWhatsappSender }
  | { usable: false; reason: SenderUnavailableReason };

export interface ChannelAccountPort {
  /**
   * Whether `accountId` of `tenantId` may send a WhatsApp message under
   * `capability` right now. Re-evaluated on every call (a revoked connection
   * or a disabled account denies at once, whatever a capability row still
   * says). Never returns a credential.
   */
  resolveWhatsappSender(
    tx: Bun.SQL,
    input: ResolveWhatsappSenderInput
  ): Promise<ResolveWhatsappSenderResult>;
}

export type ResolveSenderCredentialResult =
  /** `credential` is the provider bearer token (Meta Cloud API) or device key (StarSender), whichever the account's auth mode stores. */
  | { ok: true; credential: string }
  | { ok: false; reason: SenderUnavailableReason };

export interface ChannelSenderCredentialPort {
  /**
   * DISPATCHER AND PROVIDER ADAPTERS ONLY. Decrypts the credential of a
   * sender the caller has ALREADY resolved as usable, for the transaction's
   * tenant, in memory. The value must not be logged, stored, evented, audited
   * or put in a job payload (ADR-0148 I3). Every call is counted per tenant and
   * purpose (`snapshotSecretDecryptCounts`).
   */
  resolveWhatsappCredential(
    tx: Bun.SQL,
    input: { tenantId: string; accountId: string }
  ): Promise<ResolveSenderCredentialResult>;
}

// ---------------------------------------------------------------------------
// Publishing (Issue #1145, ADR-0157; capability `channel_account` 1.1.0)
// ---------------------------------------------------------------------------
//
// `social_publishing` asks the same two questions of an account that
// `whatsapp_delivery` does, for the `publish` capability instead of a WhatsApp
// one, and under the same rules: every refusal is a returned value, a database
// error is the only thing that throws, another tenant's account and an unknown
// id are one answer, and there is no fallback to another account or provider.
//
// These are SEPARATE types from {@link ChannelAccountPort} and
// {@link ChannelSenderCredentialPort} (not new methods on them) so that an
// existing implementer or fake of the 1.0.0 ports keeps compiling: the bump is
// a MINOR one, additive by construction.

/** The publishing reasons are the sender reasons plus one: the account has no publishing identity. */
export type PublisherUnavailableReason =
  | SenderUnavailableReason
  /** The provider matrix has no `publish` cell for this (provider, kind): a container, or a provider that cannot publish. */
  | "NOT_A_PUBLISHER";

export type ResolvedPublisher = {
  accountId: string;
  provider: string;
  accountKind: string;
  /** The provider-stable identity (page id, channel id, profile id), read from the account and never from a caller. */
  externalId: string;
  /** `null` is tenant-wide. */
  businessScope: { type: string; id: string } | null;
};

export type ResolvePublisherInput = { tenantId: string; accountId: string };

export type ResolvePublisherResult =
  | { usable: true; publisher: ResolvedPublisher }
  | { usable: false; reason: PublisherUnavailableReason };

export interface ChannelPublisherPort {
  /**
   * Whether `accountId` of `tenantId` may publish right now: the account is
   * `connected`, its connection grant `active`, and its `publish` capability is
   * `granted` with evidence under the current provider matrix. Re-evaluated on
   * every call. Never returns a credential.
   */
  resolvePublisher(
    tx: Bun.SQL,
    input: ResolvePublisherInput
  ): Promise<ResolvePublisherResult>;
}

export type ResolvePublishCredentialResult =
  | { ok: true; credential: string }
  | { ok: false; reason: PublisherUnavailableReason };

// ---------------------------------------------------------------------------
// Publisher health (Issue #1146; capability `channel_account` 1.3.0, additive)
// ---------------------------------------------------------------------------

/** The fixed reason a publisher's account is degraded when its provider refuses the credential. */
export const PUBLISH_CREDENTIAL_REJECTED_REASON = "PUBLISH_CREDENTIAL_REJECTED";

export interface ChannelPublisherHealthPort {
  /**
   * DISPATCHER ONLY. The provider refused the account's credential (an expired
   * or revoked token, a permission the person withdrew): record a `failing`
   * health row and move a `connected` account to `degraded` with the fixed
   * reason {@link PUBLISH_CREDENTIAL_REJECTED_REASON}. Every other job of the
   * account is then HELD at its next claim (never failed, never rerouted) until a
   * person re-authorises. Never moves an account to `connected`, never touches a
   * revoked, disabled, pending or deleted one. `recorded` is `true` only when
   * THIS call moved the account from `connected` to `degraded` (one row; the
   * #1271 audit, L5): an account already degraded, not `connected`, or not a
   * live publisher of the caller's tenant answers `false`.
   */
  reportPublishCredentialRejected(
    tx: Bun.SQL,
    input: ResolvePublisherInput
  ): Promise<{ recorded: boolean }>;
}

export interface ChannelPublisherCredentialPort {
  /**
   * DISPATCHER AND PROVIDER ADAPTERS ONLY. Decrypts the credential of an
   * account the caller has ALREADY resolved as a usable publisher, for the
   * transaction's tenant, in memory. The value must not be logged, stored,
   * evented, audited or put in a job payload (ADR-0148 I3). Counted per tenant
   * and purpose like every other decrypt.
   */
  resolvePublishCredential(
    tx: Bun.SQL,
    input: ResolvePublisherInput
  ): Promise<ResolvePublishCredentialResult>;
}

// ---------------------------------------------------------------------------
// Email senders (Issue #1160, ADR-0151 section 2; capability `channel_account`
// 1.2.0)
// ---------------------------------------------------------------------------
//
// `email` asks the same two questions of a Mailketing SENDER IDENTITY that
// `whatsapp_delivery` asks of a WhatsApp number, under the same rules: every
// refusal is a returned value, a database error is the only thing that throws,
// another tenant's account and an unknown id are one answer, and there is no
// fallback to another sender, account or provider (ADR-0151 M5, M6).
//
// A sender identity (`mailketing` / `sender_identity`) is a verified from-address
// and holds no credential of its own: it borrows the API token of its parent
// Mailketing account (`esp_account`, a container), and only while that parent is
// `connected`. SEPARATE types again, so a 1.1.0 implementer or fake still
// compiles (a MINOR bump).

/** The provider-matrix capability an email needs: a transactional send (`dm`) or a marketing send (`broadcast`). */
export type EmailSenderCapability = "dm" | "broadcast";

/** The email reasons are the sender reasons plus one: the account is not a Mailketing sender identity. */
export type EmailSenderUnavailableReason =
  | SenderUnavailableReason
  /** Another provider or kind (a Mailketing `esp_account` container, a WhatsApp number). */
  | "NOT_AN_EMAIL_SENDER";

export type ResolvedEmailSender = {
  accountId: string;
  provider: "mailketing";
  accountKind: "sender_identity";
  /** The verified from-address (the account's `external_id`, lower case). Read from the account, never from a caller. */
  address: string;
  /** The Mailketing account (connection) whose token this sender borrows; the per-connection breaker and failure budget key. */
  espAccountId: string;
  /** `null` is tenant-wide. */
  businessScope: { type: string; id: string } | null;
  /** The display name, ONLY when `withDisplayName` was asked (the enqueue path, as `awcms_app`); `null` otherwise. The worker role cannot read it. */
  displayName: string | null;
};

export type ResolveEmailSenderInput = {
  tenantId: string;
  accountId: string;
  capability: EmailSenderCapability;
  /** Read the display name too. Only on the enqueue path: `awcms_worker` holds no grant on it (`sql/322`). */
  withDisplayName?: boolean;
};

export type ResolveEmailSenderResult =
  | { usable: true; sender: ResolvedEmailSender }
  | { usable: false; reason: EmailSenderUnavailableReason };

export interface ChannelEmailSenderPort {
  /**
   * Whether `accountId` of `tenantId` may send an email under `capability`
   * right now: a Mailketing `sender_identity` that is `connected` (verified),
   * whose parent Mailketing account is `connected`, with the capability
   * `granted` with evidence under the current provider matrix. Re-evaluated on
   * every call. Never returns a credential.
   */
  resolveEmailSender(
    tx: Bun.SQL,
    input: ResolveEmailSenderInput
  ): Promise<ResolveEmailSenderResult>;
}

export type ResolveEmailCredentialResult =
  /** `credential` is the parent Mailketing account's API token. */
  | { ok: true; credential: string }
  | { ok: false; reason: EmailSenderUnavailableReason };

export interface ChannelEmailCredentialPort {
  /**
   * DISPATCHER ONLY. Decrypts the API token a sender identity the caller has
   * ALREADY resolved as usable borrows from its parent Mailketing account, for
   * the transaction's tenant, in memory. The value must not be logged, stored,
   * evented, audited, put in a URL, a job payload or a response (ADR-0151 M1).
   * Counted per tenant and purpose like every other decrypt.
   */
  resolveEmailCredential(
    tx: Bun.SQL,
    input: { tenantId: string; accountId: string }
  ): Promise<ResolveEmailCredentialResult>;
}

/**
 * The verification job's view of a tenant's Mailketing accounts (Issue #1160):
 * each live account with its live sender identities. Identities and statuses
 * only; never a credential, a secret reference or a display name.
 */
export type EmailAccountSummary = {
  espAccountId: string;
  status: string;
  senders: { accountId: string; address: string; status: string }[];
};

/** Which stored credential, at which version, a Mailketing account holds right now (no value). */
export type EmailAccountSecretRef = { secretId: string; version: number };

export interface ChannelEmailAccountDirectoryPort {
  /** Live (`pending`, `connected`, `degraded`) Mailketing accounts of `tenantId` and their live sender identities. Bounded. */
  listEmailAccounts(
    tx: Bun.SQL,
    tenantId: string
  ): Promise<EmailAccountSummary[]>;
  /**
   * Issue #1160 audit L5: the account's CURRENT secret reference and version,
   * so a verification computed with a token that was replaced meanwhile is
   * not recorded as the new token's health. `null`: no live credential.
   */
  readEmailAccountSecretRef(
    tx: Bun.SQL,
    tenantId: string,
    accountId: string
  ): Promise<EmailAccountSecretRef | null>;
}

export type ResolveEmailAccountCredentialResult =
  | { ok: true; credential: string; secretRef: EmailAccountSecretRef }
  | { ok: false; reason: EmailSenderUnavailableReason };

export interface ChannelEmailAccountCredentialPort {
  /**
   * `email:senders:verify` ONLY. Decrypts the API token of a Mailketing
   * ACCOUNT (an `esp_account`) so its read-only `GET /credits` and
   * `GET /senders` can be called. Allowed while the account is `pending`,
   * `connected` or `degraded` (verification is how a pending account and its
   * senders become `connected`); refused when revoked, disabled or deleted.
   * Same handling rules as every other decrypt (ADR-0151 M1).
   */
  resolveEmailAccountCredential(
    tx: Bun.SQL,
    input: { tenantId: string; accountId: string }
  ): Promise<ResolveEmailAccountCredentialResult>;
}
