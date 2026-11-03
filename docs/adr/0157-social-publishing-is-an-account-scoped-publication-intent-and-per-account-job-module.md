🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](0157-social-publishing-is-an-account-scoped-publication-intent-and-per-account-job-module.id.md)

# ADR-0157 — `social_publishing` is an account-scoped publication-intent and per-account-job module; providers are plug-ins that cannot widen what an account may do

- **Status:** Proposed
- **Date:** 2026-11-03
- **Decision maker:** ahliweb (owner). Not yet reviewed; until accepted, nothing in this ADR is a maintainer decision and the module stays `experimental` and off by default.
- **Resolves (when accepted):** the module-admission details Issue #1145 requires "in its own PR per `21_module_admission_governance.md`" (tables, permissions, port version, rollout gate). ADR-0148 already accepted capability C3 and its conditions; this ADR adds only what ADR-0148 deliberately left to the implementing issue.
- **Amends:** the worker-role secret visibility of `sql/328` (Issue #1233), **only** as stated in §6 below (migration `sql/332`). Every other rule of ADR-0148 stands.
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

### 2. Data model (forward-only `sql/330` to `sql/331`)

All tables are tenant-scoped, `ENABLE` and `FORCE` RLS with `USING` and `WITH CHECK`, composite `(tenant_id, id)` foreign keys (RLS does not apply to FK checks), and indexes for every foreign key.

- `awcms_social_publishing_settings`: one row per tenant: `auto_publish_enabled`, `approval_required`.
- `awcms_social_publish_rules`: `(tenant_id, trigger, channel_account_id)` unique, `enabled`. The article path publishes to every enabled rule account for its trigger.
- `awcms_social_publications` (the **intent**): `source_kind` (`article` or `manual`), `source_id`, `trigger`, the **content snapshot** (`title`, `caption`, `link_url`, a media snapshot with the verified public URL, MIME type, size, alt text, credit line and rights status), `content_hash`, `state` (`pending_approval`, `ready`, `cancelled`, `refused`), approval and cancellation stamps, `not_before`. Content columns are immutable (trigger). Unique per `(tenant_id, source_id, trigger)` for an article, so a repeated publish event finds the same intent.
- `awcms_social_publish_jobs`: one per `(intent, channel_account)`: `idempotency_key` (unique per tenant: a hash over tenant, source, trigger and account), `provider` and `account_kind` snapshotted at enqueue, `variant` (the content shape chosen for this provider), `status` (`queued`, `publishing`, `retry_wait`, `published`, `failed`, `cancelled`), `attempt_count`, `hold_count`, `next_attempt_at` (also the claim lease), the provider's post id and URL, a coded failure and a scrubbed message. **No column can hold a token or a secret reference**: the job names the account, and the dispatcher resolves the credential for that account at dispatch. `published` is terminal and its identity is immutable (trigger).
- `awcms_social_publish_attempts`: per-attempt ledger, `UNIQUE (job_id, attempt_no)`, never a body and never a provider payload.

The intent's aggregate status (`queued`, `partially_published`, `published`, `failed`, `cancelled`) is **derived** from its jobs when read, never stored, so it cannot drift from the jobs.

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

`bun run social-publishing:dispatch` (cron) claims jobs with `FOR UPDATE SKIP LOCKED` and a lease, in a short transaction, then releases the connection and calls the provider **outside any transaction**. Each claim re-resolves the account through the port (a revoked account or connection fails the job terminally, a degraded or expired one holds it, never counting an attempt), enforces a per-account fair share and a per-account daily cap under a per-account advisory lock (so concurrent dispatchers cannot overshoot), and uses a per-account circuit breaker. The credential is decrypted by the dispatcher-only credential port inside the call that needs it, in memory, and is handed to the adapter with an HTTP client that is `ssrfSafeFetch` by construction: an adapter receives no raw `fetch`. Provider errors are classified (`published`, `retryable`, `rate_limited`, `needs_reauth`, `rejected`), scrubbed and coded, and the code is a CLOSED vocabulary each adapter declares (`errorCodes`): a code outside it is recorded as the generic code for its outcome, so no provider string or credential reaches a row through a "code"; a crash after the provider accepted a post is protected by passing the job's idempotency key to the provider where it has one, and the remaining window is stated, not hidden.

#### Worker secret visibility (`sql/332`): the one place this ADR widens something

`sql/328` limited the rows the `awcms_worker` role can SEE in `awcms_channel_secrets` to a WhatsApp sender's credential, so that a compromised `whatsapp:dispatch` could not read social tokens. The social dispatcher runs as the same role and cannot decrypt what it cannot read. `sql/332` replaces the restrictive policy, keeping both WhatsApp branches and adding two: the access token of a live Facebook, Instagram, Threads, TikTok, YouTube or LinkedIn account (and of a connection such an account uses) **only while that account holds a `publish` capability in state `granted`**. No new grant is needed (the policy reads columns the worker already holds under `sql/322`), the purpose list stays, and Telegram is excluded (its `bot_token` purpose needs its own reviewed change). The residual risk is the one ADR-0148 section 5 accepts for dispatchers, stated for a second job: a compromised `social-publishing:dispatch` can decrypt the publishing-capable tokens of every tenant. `security:readiness` still pins the policy. This is the part of the module a security review must read first.

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
- **Negative / trade-off:** a new module and a new job; the `channel_account` port grows; the worker role can see the tokens of publishing-capable social accounts (§6, `sql/332`); until a connector registers, enabling the module publishes nothing (by design); the crash window between a provider accepting a post and the job being finalised is bounded by the provider's own idempotency support, not eliminated.
- **Limitations recorded:** no admin screen; no caption templates; one in-memory fake adapter for tests; per-provider media upload, rate-limit headers and content-policy mapping belong to the connectors.
- **Human sign-off still needed:** maintainer acceptance of this ADR; for each connector, the provider app approval or audit evidence (a business step); a security review of the credential path before any connector leaves the flag.

## Alternatives rejected

- **Reading the article at send time:** publishes edited or unpublished content; the snapshot is the contract.
- **One job per publication with N accounts inside it:** a single failure forces a replay of the whole set or a hand-rolled partial state; a row per account makes the partial state the model.
- **Storing the provider token or a reference on the job:** widens the credential's reach to every reader of the queue; the account reference plus dispatch-time resolution keeps it to the dispatcher.
- **Downgrading unsupported content (image to text):** silently changes what the tenant approved.
