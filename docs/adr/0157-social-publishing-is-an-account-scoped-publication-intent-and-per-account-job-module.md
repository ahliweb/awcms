🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](0157-social-publishing-is-an-account-scoped-publication-intent-and-per-account-job-module.id.md)

# ADR-0157 — `social_publishing` is an account-scoped publication-intent and per-account-job module; providers are plug-ins that cannot widen what an account may do

- **Status:** Accepted
- **Date:** 2026-11-03
- **Decision maker:** ahliweb (owner), accepted 2026-11-11. Acceptance admits the module design; it does not switch anything on: the module stays `experimental` and off by default until the conditions in §6 and the human sign-offs below are met.
- **Resolves:** the module-admission details Issue #1145 requires "in its own PR per `21_module_admission_governance.md`" (tables, permissions, port version, rollout gate). ADR-0148 already accepted capability C3 and its conditions; this ADR adds only what ADR-0148 deliberately left to the implementing issue.
- **Extends:** [ADR-0148](0148-omnichannel-foundation-is-five-gated-capabilities-with-fail-closed-per-account-capability.md) (§1 C3, §2 invariants I1 to I3, I5, I10, I12; §10 Phase D), [ADR-0011](0011-capability-ports-for-cross-module-collaboration.md), [ADR-0006](0006-offline-first-sync-outbox.md), [ADR-0134](0134-descriptor-declared-domain-event-consumers.md), [ADR-0094](0094-a-data-subject-is-answered-per-tenant.md)
- **Related:** Issues #1145 (this slice), #1140 (accounts), #1146 to #1151 (per-provider connectors, each its own issue and its own provider approval), #1139; `docs/awcms/omnichannel-foundation.md` section 2.3

## Context

Verified on `main` at 3 November 2026:

- `SocialPublishingPort` exists in `src/modules/_shared/ports/social-publishing-port.ts`; `blog_content` calls it right after an article is published, inside the publish transaction, and today wires a no-op adapter at both composition roots (`POST /api/v1/blog/posts/{id}/publish`, `scripts/blog-scheduled-publish.ts`). There is no `social_publishing` module.
- `channel_accounts` (Issue #1140) holds a tenant's connected accounts, per-account capability evidence (`publish` is a matrix cell), credentials as encrypted references, and the access rules. It sends nothing.
- `whatsapp_delivery` (Issue #1141) shows the required shape of a channel queue: lease-claimed rows, dispatch outside any transaction, a resolved-at-dispatch account, held versus terminal account failures, no rerouting.
- ADR-0148 accepted C3 with these conditions: a job references a `channel_account` and a granted `publish` capability row and never a token; content (text and a verified media reference) is snapshotted at enqueue; idempotent per `(article, trigger, account)`; an approval state when the tenant requires one; dispatch outside a transaction with `ssrfSafeFetch` and a per-account breaker; replacing the no-op is behind a flag, default off; a revoked or degraded account stops its jobs; an unsupported capability is refused, never downgraded.

The risk is the usual one for publishing to many accounts: a "publish to all" abstraction that reposts what already succeeded when one account fails, carries a credential in a job row, publishes edited content because it re-read the article at send time, or treats "the provider documents it" as "this account may do it".

## Decision

### 1. One module, `social_publishing`, category System, built on `channel_accounts`

A `type: "system"` module (doc 21 decision tree: reusable cross-module infrastructure, not an ERP domain). It owns exactly: **publish rules** (which accounts an event publishes to), a **publication intent** (one logical publication with an immutable content snapshot), one **job per target `channel_account`**, and a per-attempt **ledger**. It reads the account model only through the `channel_account` port. It does not own accounts, credentials, media or article content. Product campaign semantics (calendars, audiences, attribution) stay outside.

Status `experimental`, off by default behind `SOCIAL_PUBLISHING_ENABLED`, no navigation entry until the admin screen lands in its own change (a navigation entry without a page is a permanent 404). Tenant default: `auto_publish_enabled = false` and `approval_required = true`, so enabling the deployment flag alone never publishes anything.

### 2. Data model (forward-only `sql/330` to `sql/331`; the first revision of this ADR also proposed a third migration, withdrawn: see §6)

All tables are tenant-scoped, `ENABLE` and `FORCE` RLS with `USING` and `WITH CHECK`, composite `(tenant_id, id)` foreign keys (RLS does not apply to FK checks), and indexes for every foreign key.

- `awcms_social_publishing_settings`: one row per tenant: `auto_publish_enabled`, `approval_required`.
- `awcms_social_publish_rules`: `(tenant_id, trigger, channel_account_id)` unique, `enabled`. The article path publishes to every enabled rule account for its trigger.
- `awcms_social_publications` (the **intent**): `source_kind` (`article` or `manual`), `source_id`, `trigger`, the **content snapshot** (`title`, `caption`, `link_url`, a media snapshot with the verified public URL, MIME type, size, alt text, credit line and rights status), `content_hash`, `state` (`pending_approval`, `ready`, `cancelled`, `refused`), approval and cancellation stamps, `not_before`. Content columns are immutable (trigger). Unique per `(tenant_id, source_id, trigger)` for an article, so a repeated publish event finds the same intent.
- `awcms_social_publish_jobs`: one per `(intent, channel_account)`: `idempotency_key` (unique per tenant: a hash over tenant, source, trigger and account), `provider` and `account_kind` snapshotted at enqueue, `variant` (the content shape chosen for this provider), `status` (`queued`, `publishing`, `retry_wait`, `published`, `failed`, `cancelled`), `attempt_count`, `hold_count`, `next_attempt_at` (also the claim lease), the provider's post id and URL, a coded failure and a scrubbed message. **No column can hold a token or a secret reference**: the job names the account, and the dispatcher resolves the credential for that account at dispatch. `published` is terminal and its identity is immutable (trigger).
- `awcms_social_publish_attempts`: per-attempt ledger, `UNIQUE (job_id, attempt_no)`, never a body and never a provider payload.

A job whose outcome is UNKNOWN (§6) is `needs_reconciliation`. The intent's aggregate status (`queued`, `partially_published`, `published`, `failed`, `cancelled`, and `needs_reconciliation` when any job is in that state) is **derived** from its jobs when read, never stored, so it cannot drift from the jobs.

Database guarantees beyond uniqueness (refused by the database; the approval rule and the job insert are serialised against each other by a per-publication advisory lock, so a concurrent approval and enqueue cannot both win): a `ready` publication that required approval has an approver, and for a manual publication the approver is not its creator; a job is never added to a publication that was already approved (the approval was for the targets it had; whether a NEW target on a `ready` publication needs a fresh approval is decided by the application from the tenant's CURRENT approval setting, `NEW_TARGET_NEEDS_APPROVAL`); the snapshot and a job's identity never change; `published` and `cancelled` are terminal; `needs_reconciliation` leaves only to `queued` (an operator's confirmed retry) or `cancelled`.

### 3. Provider adapters are plug-ins that cannot widen authority

`SocialPublishAdapter` is an interface with a declared **capability map** per provider: supported content variants (`text`, `image`, `video`, `short`, `story`), a maximum caption length, accepted image MIME types and a maximum image size. A registry maps a provider key to at most one adapter; a provider with no adapter cannot publish (`PROVIDER_ADAPTER_UNAVAILABLE`), which is the state of every real provider after this slice (#1146 to #1151 register theirs). The adapter map is a **ceiling, not a grant**: a job is created only when the account's `publish` capability is `granted` with evidence and current matrix version, the account is `connected`, its connection `active`, **and** the adapter's map supports the content variant. An unsupported variant is refused at enqueue and is never downgraded (an image that cannot go to a text-only provider is refused, not posted as text). The only adapter written in this slice is an in-memory fake used by tests, never registered by application code.

### 4. Enqueue, idempotency, snapshot, partial failure

- The article path (`SocialPublishingPort.onArticlePublished`) and the manual path (`POST /api/v1/social-publishing/publications`) both run in the caller's transaction and make plain writes: no provider call, no network, no secret read.
- Snapshot at enqueue: text, link and a media snapshot resolved through `MediaLibraryPort` (the object must be verified, same tenant, an allowed MIME type, within the size cap, and carry a rights status other than unknown). The job never re-reads the article, so later edits and unpublishing do not change what is sent. An invalid media reference refuses the whole publication (`MEDIA_NOT_ELIGIBLE`) rather than posting text only.
- Idempotency is per `(article, trigger, account)` by a unique key; the manual path additionally requires an `Idempotency-Key`. A repeated event creates nothing new for an account that already has a job and adds a job only for an account newly eligible.
- **Partial failure never replays**: jobs are independent rows. A failed or held job changes nothing about a published sibling; retry (`jobs.retry`) acts on one failed job only; cancel stops only jobs not yet published; `published` is terminal by trigger. The source article is never touched.
- The port's contract is unchanged and `jobsCreated` counts jobs actually created. The port never throws for a business refusal (a throw inside the publish transaction would abort the article's publication); refusals are recorded on the intent (`refused` with a coded reason) and audited.

### 5. Approval, scheduling, authority

- When the tenant requires approval, an intent starts `pending_approval`; nothing is claimable until `publications.approve`. A manual intent cannot be approved by its own creator (segregation: `SELF_APPROVAL_FORBIDDEN`). `not_before` defers dispatch; `publications.schedule` changes it before dispatch.
- Permissions (all seeded by `sql/331` and enforced by a route in the same change): `publications.read`, `publications.publish`, `publications.schedule`, `publications.approve`, `publications.cancel`, `jobs.retry`, `rules.read`, `rules.configure`, `settings.configure`. Using an account requires, in addition, the per-account access of `channel_accounts` (assignment rule and business scope) through the access chokepoint; an account the caller cannot use is one `422 ACCOUNT_NOT_USABLE` with an unknown or another tenant's account (no existence oracle).
- Every mutation is idempotent where it is high-risk, audited with redacted attributes (ids, codes and counts, never a caption or a URL), and refuses a machine credential (the same posture as `channel_accounts`).

### 6. Dispatch

`bun run social-publishing:dispatch` (cron) claims jobs with `FOR UPDATE SKIP LOCKED` and a lease, in a short transaction, then releases the connection and calls the provider **outside any transaction**. Each claim re-resolves the account through the port (a revoked account or connection fails the job terminally, a degraded or expired one holds it, never counting an attempt), enforces a per-account fair share and a per-account daily cap under a per-account advisory lock (so concurrent dispatchers cannot overshoot), and uses a per-account circuit breaker. A tenant that switched the module off is neither enqueued for nor dispatched (the module-enablement row is read in both paths; a failed read is never "enabled"). Provider errors are classified (`published`, `retryable`, `rate_limited`, `needs_reauth`, `rejected`, `unknown`), scrubbed and coded, and the code is a CLOSED vocabulary each adapter declares (`errorCodes`): a code outside it is recorded as the generic code for its outcome, so no provider string or credential reaches a row through a "code". The dispatcher's own verdicts (`PROVIDER_TIMEOUT`, `ADAPTER_ERROR`) are never rewritten into an adapter's vocabulary.

**Unknown outcomes are never retried blindly.** The adapter's HTTP client is `ssrfSafeFetch` bound to the call's abort signal with `maxRedirects: 0` (a provider API does not redirect a publish call, and the shared guard forwards request headers, an `Authorization` bearer among them, to a redirect target). The dispatcher's timeout CANCELS the request; it does not abandon it. But a timeout, or an adapter that threw, after the request was sent means the post may already exist. Each adapter therefore declares whether its provider dedupes on the idempotency key (`supportsIdempotencyKey`): if it does, the job is retried automatically with the same key (the provider publishes once); if it does not, the job becomes `needs_reconciliation` and is never retried by the dispatcher. An operator who has checked the account retries it with an explicit confirmation (`confirmPossiblyPublished`; the retry is audited at `warning` with the previous status and failure code), or cancels it. The retry is an operator act of the application role: the database refuses `awcms_worker` to move a `failed` or `needs_reconciliation` job back to `queued`. The same applies to a crash between "the provider accepted the post" and "the job was finalised": a `publishing` job whose lease expired is a lost answer, and for a provider without a dedupe key the dispatcher moves it to `needs_reconciliation` (`LEASE_EXPIRED_UNKNOWN`) instead of claiming it again; `sql/330` refuses that re-claim as well. For a provider that dedupes, the same key is sent again. A pass asserts `limit x providerTimeoutMs < lease`, so a job waiting its turn in the same pass cannot have an expired lease. When a request made through the adapter's HTTP client ended ambiguously (`request_failed`, `response_too_large`, `too_many_redirects`), an adapter's `retryable` is read as `unknown`.

#### The credential path is NOT in this slice (decision of 3 November 2026, audit finding H1)

The first revision of this ADR proposed a third migration, which widened the `awcms_worker` row policy on `awcms_channel_secrets` (set by `sql/328`, WhatsApp-only) to the access token of a publishing-capable social account. An independent audit showed that this undoes #1233: `whatsapp:dispatch` runs as the same role with the same key ring (`CHANNEL_SECRETS_ENCRYPTION_KEYS`), so a compromised WhatsApp worker could read and decrypt social tokens of every tenant, from the moment the migration was applied and although no adapter existed. **That widening is withdrawn.** This slice does not touch `sql/328`, grants the dispatch job no key ring, and composes it with a credential port that refuses every request (`noPublishCredentialPort`). A dispatcher without an adapter fails closed with `PROVIDER_ADAPTER_UNAVAILABLE` before any credential is asked for, and enqueue refuses the account first. `ChannelPublisherCredentialPort.resolvePublishCredential` exists (capability `channel_account` 1.1.0) but nothing composes it for a worker.

**Condition for the first connector (#1146):** the credential reaches the social dispatcher only under a **separate database role** (for example `awcms_social_dispatch`) with its own column-only read of the channel tables and its own restrictive row policy, and with the key ring granted to that job alone. Its impact on `whatsapp:dispatch` must be stated in that change: the WhatsApp worker keeps the `awcms_worker` role and the `sql/328` policy unchanged, and nothing that role can read widens. That change must also meet two requirements recorded by the audit:

- **M2.** The row policy must follow the account and grant state, not only the capability: an account that is `connected` or `degraded` (not revoked, disabled or pending) and a connection whose grant is `active` or `expired` (not revoked or failed). A revoked account or connection must leave the role's view at once.
- **L10.** An account that borrows its credential from its parent (the child of a container such as a WABA) can never use the parent's token under a policy keyed on the account's own secret; the role's policy and the credential adapter must agree on which reference an account resolves to, or such an account is refused as `CREDENTIAL_UNAVAILABLE` and says so.

The residual risk after that change is the one ADR-0148 section 5 accepts for dispatchers, now stated for a second job under its own role: a compromised `social-publishing:dispatch` can decrypt the publishing-capable tokens of every tenant.

#### Residuals recorded by the independent audits (not fixed in this slice; each is a condition before the first connector or before multi-brand tenants)

- **L4: reads are not scoped per account or business scope.** `GET /publications`, `GET /publications/{id}` and `GET /rules` enforce only `publications.read` and `rules.read`. A holder sees the caption, title and link of a publication that is **not yet published**, and the `accountId` of another brand's or business unit's account in the same tenant. Before a multi-brand tenant uses the module: filter rows by the per-account access of `channel_accounts` (assignment rule and business scope), or hide the content of targets the caller cannot use.
- **L6: `externalPostId` is free text from the adapter.** The failure code is an allow-list because any string can carry a secret or a provider body; `external_post_id` (up to 255 characters) and `external_post_url` (https only) are stored as given and appear in responses, events and audit. Admission condition for every connector: validate the id format per provider (for example `^[0-9_]{1,64}$`) and the URL host per provider, or reject the value and answer `unknown`.
- **L8: media rights, article retraction and media takedown are not re-checked at dispatch.** The snapshot (including `copyright_status`; `fair_use` is accepted) is frozen at enqueue. An article unpublished, a media object taken down or a right revoked afterwards does not stop a queued job. Before the first connector this needs a cancellation hook from `blog_content` and `media_library`, or a re-check at claim.
- **L9: `prepare` runs before `authorize`.** The pattern of the whole repository (`defineTenantRoute`): the JSON body and headers are read and validated before authorization, so a caller without the permission can tell a 400 or 422 from a 403 (a schema oracle) and force a body parse. Accepted as the repository pattern; not fixed per module.
- **M2 and L10** stay design requirements of the connector's separate DB role (above).
- **M-1 (re-audit): an expired lease is never re-sent for a provider without a dedupe key.** The dispatcher moves such a job to `needs_reconciliation` (`LEASE_EXPIRED_UNKNOWN`), `sql/330` refuses the re-claim, and the pass asserts `limit x providerTimeoutMs < lease`. A connector must declare `supportsIdempotencyKey` truthfully: declaring it `true` for a provider that does not dedupe re-opens the double-post window.
- **L-7 (re-audit): a connector answers `unknown`, not `retryable`, after any request that may have been processed.** `ssrfSafeFetch` collapses "could not connect" and "the answer was lost" into `request_failed`; the dispatcher reads a `retryable` as `unknown` when a `request_failed`, `response_too_large` or `too_many_redirects` happened in the call, but that is a backstop, not the contract.

### 7. Ports and versions

`channel_account` goes `1.0.0` to `1.1.0` (additive: `resolvePublisher` and `resolvePublishCredential`; `resolveWhatsappSender` is unchanged). `social_publishing` is registered at `1.0.0` as the port `blog_content` already consumes (optional). The composition roots choose the real adapter **only when `SOCIAL_PUBLISHING_ENABLED` is on**; otherwise the existing no-op remains, so a deployment that configures nothing behaves byte for byte as before.

### 8. Out of scope for this slice

Per-provider connectors and their provider approvals (#1146 to #1151), the admin screen (permissions are recorded in the screen-coverage ledger), caption templates and per-provider formatting beyond a length ceiling, comment and analytics ingestion, realtime progress (ADR-0154), and any reply or DM behaviour. Media upload to a provider is the connector's concern; this slice snapshots a verified reference.

## Options considered

| Criterion       | **A. New module on `channel_accounts` (chosen)**          | B. Extend `blog_content`                                   | C. Per-provider modules                       |
| --------------- | --------------------------------------------------------- | ---------------------------------------------------------- | --------------------------------------------- |
| Security        | One reviewed enqueue and dispatch path; no token in a job | Mixes article authorship with credential-adjacent dispatch | Each module re-derives revocation and breaker |
| Maintainability | Providers are adapters behind one interface               | `blog_content` grows a queue it should not own             | N queues, N approval models                   |
| Compatibility   | Port already exists; no-op stays the default              | Changes a running module's contract                        | Violates ADR-0148 C3 ("one module")           |
| Operations      | One job, one lease, one set of diagnostics                | Shared with publish cadence                                | N jobs                                        |

## Consequences

- **Positive:** a reviewed foundation every connector plugs into; partial failure and replay are impossible by construction; the credential reaches only the dispatcher; unsupported content is refused visibly.
- **Negative / trade-off:** a new module and a new job; the `channel_account` port grows; until the credential path lands with the first connector under its own DB role (§6) no job can be published at all; until a connector registers, enabling the module publishes nothing (by design); the crash window between a provider accepting a post and the job being finalised is bounded by the provider's own idempotency support, not eliminated.
- **Limitations recorded:** no admin screen; no caption templates; one in-memory fake adapter for tests; per-provider media upload, rate-limit headers and content-policy mapping belong to the connectors.
- **Human sign-off still needed:** (maintainer acceptance of this ADR was given on 2026-11-11) for each connector, the provider app approval or audit evidence (a business step); a security review of the credential path and its separate DB role before any connector leaves the flag.

## Alternatives rejected

- **Reading the article at send time:** publishes edited or unpublished content; the snapshot is the contract.
- **One job per publication with N accounts inside it:** a single failure forces a replay of the whole set or a hand-rolled partial state; a row per account makes the partial state the model.
- **Storing the provider token or a reference on the job:** widens the credential's reach to every reader of the queue; the account reference plus dispatch-time resolution keeps it to the dispatcher.
- **Downgrading unsupported content (image to text):** silently changes what the tenant approved.
