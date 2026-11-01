🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](README.id.md)

# `channel_accounts`

The **account and credential control plane** of the omnichannel foundation (Issue #1140, [ADR-0148](../../../docs/adr/0148-omnichannel-foundation-is-five-gated-capabilities-with-fail-closed-per-account-capability.md) capability C1; design pack [`docs/awcms/omnichannel-foundation.md`](../../../docs/awcms/omnichannel-foundation.md); field encryption [ADR-0137](../../../docs/adr/0137-payout-account-encryption-at-rest-and-keyed-hashing.md)).

It holds a tenant's **connected external accounts** (a WhatsApp WABA phone number or StarSender device, a Facebook Page, an Instagram or Threads profile, a YouTube channel, a Telegram bot, a Mailketing ESP login and its sender identities), the **provider connections** behind them (OAuth 2.0 grants, API tokens, bot tokens, device keys), **per-account capability evidence**, **secret references**, webhook subscription metadata, health, and who may operate each account.

**It sends nothing and calls no provider.** There is no queue, no dispatcher, no provider HTTP call and no admin screen here. Provider adapters, the OAuth token exchange, sender routing in `whatsapp_delivery` (#1141), publishing (#1145) and the connection manager screen (#1154) are later issues that conform to this account model. A website's social links are not connected accounts.

Status: `experimental` and **off by default** (`CHANNEL_ACCOUNTS_ENABLED`), with no navigation entry until the screen lands (a nav entry without a page is a permanent 404).

## Invariants (ADR-0148 section 2) and where each is enforced

| Invariant                             | Enforced by                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I1 tenant first                       | RLS `ENABLE` + `FORCE` with `USING` and `WITH CHECK` on all eight tables, composite `(tenant_id, id)` foreign keys, RBAC/ABAC default-deny on every route. A brand is a **business scope** `(business_scope_type, business_scope_id)`; no ABAC attribute was added. A uniform `404` for unknown, foreign and unassigned accounts (no IDOR oracle) |
| I1 one external account, one tenant   | Partial unique index on `(provider, external_id) WHERE deleted_at IS NULL`, **across tenants**. A duplicate is `409 ACCOUNT_ALREADY_REGISTERED` for "yours" and "someone else's" alike. A deleted account releases the claim                                                                                                                      |
| I2 capability fail-closed per account | `evaluateCapability` (`domain/provider-matrix.ts`): matrix cell, a stored `granted` row, evidence, current matrix version, account `connected`, connection `active`. An absent row is denied. A thrown error must be treated as a denial                                                                                                          |
| I3 secrets by reference               | `awcms_channel_secrets` (AES-256-GCM through the shared helper, AAD = purpose + tenant + secret id). A `CHECK` accepts only the `v2:` envelope. No view, response, audit row, log or idempotency record carries a value or a reference                                                                                                            |
| I7 LinkedIn member data barred        | Matrix cell `barred` (never grantable, whatever the evidence); the row is not registrable                                                                                                                                                                                                                                                         |
| I9 verified inbound                   | `awcms_channel_webhook_subscriptions`: `CHECK (verification_mode <> 'unauthenticated' OR accepts_content_events = false)`. Callback tokens are stored hashed. No route reads this table yet                                                                                                                                                       |
| I13 additive, forward-only            | New tables in `sql/318`-`320` only; no behaviour changes for a deployment that configures nothing                                                                                                                                                                                                                                                 |

## The provider matrix (a code mirror)

`domain/provider-matrix.ts` is the code mirror of section 3 of the readiness pack (v1). `tests/channel-accounts-provider-matrix.test.ts` parses the documentation table and fails if any cell differs. A cell is `candidate`, `restricted` (usable only with `contract_reference` or `written_authorization` evidence), `not_offered`, `unverified`, `not_applicable` or `barred`. `GET /api/v1/channel-accounts/providers` serves it.

## API (`/api/v1/channel-accounts`, OpenAPI `openapi/modules/channel-accounts.openapi.yaml`)

| Route                                                             | Permission                                 | Notes                                                                                                              |
| ----------------------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| `GET providers`                                                   | `accounts.read`                            | The matrix                                                                                                         |
| `GET/POST accounts`, `GET/PATCH/DELETE accounts/{id}`             | `accounts.read` / `create` / `revoke`      | Keyset list; PATCH renames or `disabled` / re-enable (`pending`); DELETE is a terminal soft delete                 |
| `PUT accounts/{id}/credential`                                    | `credentials.manage`                       | **Write-only.** MFA enrolment required, conditional step-up, `Idempotency-Key`, audited `warning`                  |
| `POST accounts/{id}/disconnect`                                   | `accounts.revoke`                          | `revoked`, own credential hard-deleted, webhooks revoked. `warning`                                                |
| `GET accounts/{id}/health`                                        | `accounts.read`                            | Reported by connectors, never asserted by a person                                                                 |
| `GET accounts/{id}/capabilities`, `PUT .../{capability}`          | `accounts.read` / `capabilities.configure` | Nine capabilities with matrix cell and effective verdict. Refused at write time when the matrix can never allow it |
| `GET/POST accounts/{id}/assignments`, `DELETE .../{assignmentId}` | `accounts.read` / `assignments.assign`     | Owner / operator / viewer; additive to the permission checks                                                       |
| `GET connections`, `POST connections/{id}/revoke`                 | `accounts.read` / `accounts.revoke`        | Revoke clears and deletes every credential and revokes the bound accounts. Terminal (trigger)                      |
| `POST connections/oauth/start`, `GET .../callback`                | `accounts.create`                          | See below                                                                                                          |

`AccessAction` is a closed vocabulary shared by every module, so the pack's working names map onto it: connect to `create`, disconnect to `revoke`, `capabilities.grant` to `capabilities.configure`, `assignments.manage` to `assignments.assign`. The pack's `senders.use` and `whatsapp_delivery.*` permissions are **not** seeded here: nothing enforces them until #1141.

Every mutation except the OAuth start and callback requires `Idempotency-Key` (a keyed-HMAC request hash; the response is stored redacted). Every route refuses a machine credential (`403 INTERACTIVE_SESSION_REQUIRED`) and answers `503 CHANNEL_ACCOUNTS_DISABLED` unless the deployment enables the module.

## Per-account access

Three layers, all default-deny: the tenant-wide permission; the **assignment** gate (an account with assignees is visible and operable only to them at the required kind, plus holders of `assignments.assign`); and **business-scope ABAC** (an account bound to a scope requires the caller to hold it, re-evaluated through the same chokepoint, so a deny policy and the decision log both apply). Connection break-glass belongs to the holder of the connection's scope and to the tenant administrator (`assignments.assign` as decided by the chokepoint, not derived from holding a scope; ADR-0148 amendment, #1215).

## OAuth

`POST oauth/start` creates a single-use `state` (256 random bits, stored only as a SHA-256, bound to tenant **and** person, 10 minutes) and, where the adapter offers PKCE, an S256 challenge whose verifier is held as ciphertext. The redirect URI is the deployment's fixed callback and is **never an input**. It needs a registered `ChannelOAuthAdapter` (`application/oauth-adapter-registry.ts`, one pure function that builds the authorisation URL); none is registered by this issue, so it answers `422 PROVIDER_ADAPTER_UNAVAILABLE`.

`GET oauth/callback` is authorised like any call (it carries the session). It verifies the `state` (exists, unexpired, unconsumed, this tenant, this person, this redirect URI; **every** failure is `400 STATE_INVALID`), consumes it by compare-and-swap, and leaves a **durable hand-off**: a `pending` connection holding the authorisation code as ciphertext. It does not exchange the code, because that is provider I/O and must not run inside a request transaction (ADR-0148 I10). The connector's job finishes the grant with `activateConnectionGrant` (or `failConnectionGrant`).

Refresh is guarded by a **lease** (`acquireRefreshLease`, a compare-and-set on the connection row: of N racers one wins), `completeRefresh` accepts only the holder's lease version, and `failRefresh` backs off exponentially (bounded) or, on a permanent failure, expires the grant and degrades its accounts. A revoked grant is terminal (trigger-enforced), clears and deletes its credentials, and revokes its accounts.

## Secrets

`SecretStorePort` (`application/secret-store.ts`) has one adapter, the application key ring: `CHANNEL_SECRETS_ENCRYPTION_KEYS` (`keyId:base64` pairs, the first key writes, all read, 32 bytes each, no default, no plaintext fallback, outside the database and its backups). A KMS or vault adapter can replace it without changing a caller. The only method that returns plaintext, `resolve`, is for connectors and dispatchers of later issues; `tests/channel-accounts-secret-handling.test.ts` holds that no route imports it. Each resolution is counted per tenant and purpose (`snapshotSecretDecryptCounts`) for the dispatcher's alerting. A restore without the ring fails closed.

**Rotation:** prepend a key, deploy, run `bun run channel-accounts:secrets:rekey` (idempotent, resumable, batched, race-safe; runs as `awcms_app`), verify nothing is left under the old key id, and only then remove it. The job exits 1 without a ring, 2 when a tenant did not finish, 3 when rows cannot be decrypted.

## Retention and data-subject answers

Each table answers both questions in the same change. `subjectData` descriptors are in `module.ts` (stamp-only tables are `severed_with_subject_row`; assignments are exportable and hard-deleted on erasure; the health table is a reasoned `NO_SUBJECT_DATA`). Retention is a reasoned `BOUNDED_BY_DESIGN` entry per table: every table is bounded by authorship, a unique key, or the bounded sweep `sweepExpiredOAuthStates` that runs on the write path of an OAuth start (it deletes expired unreferenced states with their verifier ciphertext and fails abandoned hand-offs). A delegated lifecycle descriptor was rejected because it would have needed an `awcms_worker` read grant on a control-plane table. No worker role holds any privilege on these tables.

## Known limits

- No provider adapter, token exchange, refresh call, health check or webhook receiver exists yet; `recordAccountHealth` and `activateConnectionGrant` are the entry points those issues call.
- No domain events (`channel.account.*`) are published: there is no consumer, and the contracts outline leaves them to the issues that need them.
- No `ChannelAccountPort` is exported yet; `resolveCapability` is the function it will wrap (first consumer: #1141).
- The key ring must contain a different key from every other module's ring (`config:validate` checks the Telegram and push rings).
