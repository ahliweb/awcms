🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](README.id.md)

# `social_publishing`

Account-scoped social publishing (Issue #1145, [ADR-0157](../../../docs/adr/0157-social-publishing-is-an-account-scoped-publication-intent-and-per-account-job-module.md), [ADR-0148](../../../docs/adr/0148-omnichannel-foundation-is-five-gated-capabilities-with-fail-closed-per-account-capability.md) capability C3; design in [`docs/awcms/social-publishing.md`](../../../docs/awcms/social-publishing.md)) behind the `SocialPublishingPort` that `blog_content` already calls when an article is published.

Status: `experimental`, **off by default** (`SOCIAL_PUBLISHING_ENABLED`), no navigation entry until the admin screen lands. **It ships with no provider adapter**: the connectors are #1146 to #1151, each with its own provider approval. Until one registers, enabling the module publishes nothing (a provider with no adapter is refused at enqueue and fails a job at dispatch).

## What it owns

| Table                              | Holds                                                                                                                                                                                                              |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `awcms_social_publishing_settings` | Two tenant switches: `auto_publish_enabled` (default `false`) and `approval_required` (default `true`)                                                                                                             |
| `awcms_social_publish_rules`       | Which `channel_account`s an article event publishes to (unique per trigger and account; disabled, never deleted)                                                                                                   |
| `awcms_social_publications`        | One publication with an IMMUTABLE content snapshot (title, caption, link, media snapshot, content hash), its approval and cancel lifecycle, `not_before`                                                           |
| `awcms_social_publish_jobs`        | One job per (publication, account): provider and variant snapshot, status (`needs_reconciliation` when the outcome is unknown), attempts, holds, the provider's post id and URL. **No token, no secret reference** |
| `awcms_social_publish_attempts`    | Append-only ledger: an outcome, a fixed code, a fixed phrase                                                                                                                                                       |

It reads the account model only through the `channel_account` port (`ChannelPublisherPort`, `ChannelPublisherCredentialPort`, capability version 1.1.0) and verifies media through `MediaLibraryPort`. It owns no account, credential, media or article content.

## Flow

1. **Enqueue** (`application/publication-enqueue.ts`), in the caller's transaction, plain writes only. Per account, in order: may the account publish now (revoked, disabled, degraded, no granted `publish` capability with evidence: refused), does the provider have an adapter, can its capability map carry the content. A refusal is a returned code, never a downgrade, and every account refused leaves nothing recorded.
2. **Approve / schedule** (routes). Nothing is claimable before approval; a creator cannot approve their own manual publication; `not_before` defers.
3. **Dispatch** (`bun run social-publishing:dispatch`): claim with a lease and a per-account advisory lock (fair share and daily cap), re-resolve the account, ask the credential port for the credential in a transaction that closes before the call (this slice composes the port that refuses every request), call the adapter with an `ssrfSafeFetch` client and a per-account breaker, finalise with a compare-and-set.

## Invariants and where each is enforced

| Invariant                                                     | Enforced by                                                                                                                                              |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tenant first                                                  | RLS `ENABLE` + `FORCE` with `USING` and `WITH CHECK` on all five tables, composite `(tenant_id, id)` foreign keys, RBAC/ABAC default-deny on every route |
| A job holds no credential                                     | No column can (`tests/integration/social-publishing.integration.test.ts` asserts it on `information_schema`); the dispatcher resolves it per call        |
| Content is a snapshot                                         | Trigger `awcms_social_publications_snapshot_guard`; the job never re-reads the article                                                                   |
| `published` is terminal; partial failure never replays        | Trigger `awcms_social_publish_jobs_guard`; retry and cancel act on unsent jobs only                                                                      |
| Idempotent per (article, trigger, account)                    | Unique indexes and `buildSocialPublishIdempotencyKey`                                                                                                    |
| Unsupported content is refused, not downgraded                | `checkAdapterSupport`; the adapter map is a ceiling, never a grant                                                                                       |
| No network inside a transaction; SSRF-safe                    | Three-phase dispatcher; adapters get `request.http` (`ssrfSafeFetch`) and no raw `fetch`                                                                 |
| A revoked account stops its jobs; nothing is rerouted         | `resolvePublisher` at enqueue and at claim; terminal vs hold in `classifyAccountReason`                                                                  |
| The article's publish transaction never fails because of this | `onArticlePublished` runs in a savepoint and answers `{ jobsCreated: 0 }`                                                                                |

## API (`/api/v1/social-publishing`, OpenAPI `openapi/modules/social-publishing.openapi.yaml`)

| Route                                         | Permission                                 |
| --------------------------------------------- | ------------------------------------------ |
| `GET publications`, `GET publications/{id}`   | `publications.read`                        |
| `POST publications`                           | `publications.publish` (+ per-account use) |
| `POST publications/{id}/approve`              | `publications.approve`                     |
| `POST publications/{id}/cancel`               | `publications.cancel`                      |
| `POST publications/{id}/schedule`             | `publications.schedule`                    |
| `POST jobs/{id}/retry`                        | `jobs.retry`                               |
| `GET rules`, `POST rules`, `PATCH rules/{id}` | `rules.read` / `rules.configure`           |
| `GET settings`, `PATCH settings`              | `rules.read` / `settings.configure`        |
| `GET providers`                               | `publications.read`                        |

Every mutation requires `Idempotency-Key` and refuses a machine credential; every route answers `503 SOCIAL_PUBLISHING_DISABLED` unless the deployment enables the module. Using an account additionally needs the per-account access of `channel_accounts` (assignment rule and business scope).

## Composition roots

`POST /api/v1/blog/posts/{id}/publish` and `scripts/blog-scheduled-publish.ts` choose the port through `resolveSocialPublishingPort`: the real adapter only when `SOCIAL_PUBLISHING_ENABLED` is on, otherwise `blog_content`'s no-op, so a deployment that configures nothing is unchanged. Only `scripts/social-publishing-dispatch.ts` composes the credential adapter and holds `CHANNEL_SECRETS_ENCRYPTION_KEYS`.

## Known limits

- No provider adapter, no admin screen, no caption templates (see the remaining limitations in `docs/awcms/social-publishing.md`).
- **Retention (Issue #1145 admission, `sql/357`).** `bun run social-publishing:retention:purge` (daily, as `awcms_worker`) deletes a whole publication (attempts, jobs, publication) only when every job is terminal and it is older than the window: **default 730 days, bounded 365 to 3650, a proposed default the owner may change** (`domain/social-publishing-lifecycle.ts`). A waiting or `needs_reconciliation` job and a `pending_approval` publication are never removed; a legal hold on any of the three descriptors stops it; restrictive row policies refuse the worker a DELETE of anything younger than 365 days or not terminal.
- The crash window between "the provider accepted the post" and "the job was finalised" is closed automatically only as far as the provider honours the passed idempotency key. A `publishing` job whose lease expired is `needs_reconciliation` (`LEASE_EXPIRED_UNKNOWN`) for any other provider and is never re-sent by the dispatcher.
- **It cannot publish yet, on purpose (audit finding H1).** The `awcms_worker` role cannot read a social token (`sql/328` is unchanged) and the dispatch job holds no key ring: it is composed with `noPublishCredentialPort`, which refuses every request. The **separate DB role** exists since `sql/358`: `awcms_social_dispatch`, column-only reads of the four channel tables, no table privilege, and a restrictive policy that admits only the access token of a social connection (`active`/`expired`) used directly by a `connected`/`degraded` account with a `granted` `publish` capability (M2); an account borrowing a parent's credential is refused as `CREDENTIAL_UNAVAILABLE` (L10). It ships `NOLOGIN` and nothing connects as it yet: the first connector (#1146) activates it with a job-scoped connection string and key ring, after the human review of the credential path. `whatsapp:dispatch` is unaffected.
- **Open decision (recorded, fail-closed):** this change deliberately does NOT add the connection-string variable, the key-ring grant or the composition of `resolvePublishCredential` to `social-publishing:dispatch`. With no adapter there is nothing to send, and granting the key ring before the credential-path review would recreate the exposure H1 withdrew. The connector change does all three together.
- An unknown outcome (a timeout, a throw after the request was sent) is retried automatically only for an adapter that declares `supportsIdempotencyKey`; otherwise the job is `needs_reconciliation` and waits for an operator (`POST jobs/{id}/retry` with `confirmPossiblyPublished`, or cancel). The adapter HTTP client follows no redirects and is cancelled by the call's signal.
- **L6 closed:** every adapter declares an anchored `externalPostIdPattern` and its `postUrlHosts` (the registry refuses one that does not); a post id that does not match, or the identifier alphabet of `sql/359`, makes the outcome UNKNOWN (`INVALID_POST_ID`) and is never stored; a URL on an undeclared host is dropped.
- Audit residuals recorded, not fixed here (full text in ADR-0157 section 6): **L4** reads are not scoped per account or business scope (a `publications.read` holder sees unpublished captions and other brands' `accountId`s); **L8** media rights, article retraction and media takedown are not re-checked at dispatch (the snapshot is frozen at enqueue); **L9** `prepare` runs before `authorize`, the repository-wide route pattern, so an unauthorised caller can tell a 400 or 422 from a 403; **M-1/L-7** a connector declares `supportsIdempotencyKey` truthfully and answers `unknown`, not `retryable`, after any request that may have been processed.
