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
