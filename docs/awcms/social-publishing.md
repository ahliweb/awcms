🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](social-publishing.id.md)

# Social publishing (`social_publishing`)

> **Status:** implemented foundation, **no provider connector**. Issue [#1145](https://github.com/ahliweb/awcms/issues/1145), [ADR-0157](../adr/0157-social-publishing-is-an-account-scoped-publication-intent-and-per-account-job-module.md) (**Proposed**), capability C3 of [ADR-0148](../adr/0148-omnichannel-foundation-is-five-gated-capabilities-with-fail-closed-per-account-capability.md) and [`omnichannel-foundation.md`](omnichannel-foundation.md) section 2.3. Migrations `sql/330` to `sql/332`. The module is `experimental` and off by default.

## 1. What it is

The module that turns "an article was published" (or "an operator wants this said") into **one publication** with an immutable content snapshot and **one job per target `channel_account`**, and delivers each job through a provider adapter, outside any transaction, safely retried and never replayed.

It is a plug-in host. It ships the interface, the registry, the queue, the dispatcher, the approval and schedule rules and the API. It ships **no provider adapter** and makes no provider call: the connectors for Facebook, Instagram, Threads, TikTok, YouTube and LinkedIn are separate issues (#1146 to #1151), each of which also needs its provider app approval or audit evidence (a business step, not a code step). Until one registers, enabling the module publishes nothing.

## 2. Data

| Table                              | Key facts                                                                                                                                                                                                                                                                                                                 |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `awcms_social_publishing_settings` | One row per tenant. `auto_publish_enabled` default `false`; `approval_required` default `true`                                                                                                                                                                                                                            |
| `awcms_social_publish_rules`       | `(tenant, trigger, account)` unique. `enabled`. A pointer to an account, not a grant. At most 200 per tenant                                                                                                                                                                                                              |
| `awcms_social_publications`        | The intent. `source_kind` (`article`, `manual`), `source_id`, trigger, `state`, the immutable snapshot (`title`, `caption`, `link_url`, `media_snapshot`, `content_hash`), `not_before`, approval and cancel stamps. Unique per (article, trigger)                                                                        |
| `awcms_social_publish_jobs`        | One per (publication, account). `provider`, `account_kind`, `variant`, `idempotency_key` (unique per tenant), `status`, `attempt_count`, `max_attempts`, `hold_count`, `next_attempt_at` (also the claim lease), the provider's post id and URL, a coded failure and a fixed phrase. **No token and no secret reference** |
| `awcms_social_publish_attempts`    | Append-only ledger, unique per (job, attempt number): outcome, fixed code, fixed phrase                                                                                                                                                                                                                                   |

The aggregate status of a publication (`pending_approval`, `queued`, `in_progress`, `partially_published`, `published`, `failed`, `cancelled`, `refused`) is **derived** from its jobs when read.

State machines:

```text
publication.state:  pending_approval -> ready -> cancelled        refused (terminal, zero jobs)
                    pending_approval -> cancelled
job.status:         queued -> publishing -> published (terminal)
                                         -> retry_wait -> publishing ...
                                         -> failed -> queued (manual retry only)
                    queued | retry_wait -> cancelled (terminal)
```

A database trigger enforces: the snapshot and identity never change; `published` and `cancelled` jobs never change; a failed job can only go back to `queued`; the attempt counter never decreases; a job is created only for a live publication and a `connected` account of its own tenant.

## 3. The flow

1. **Article event.** `blog_content` calls `SocialPublishingPort.onArticlePublished` inside its publish transaction. With the deployment flag off, the tenant switch off, or no rule for the trigger, it answers `{ jobsCreated: 0 }` and does nothing. Otherwise it builds the snapshot (excerpt or title as caption, `https://{APP_URL origin}/blog/{tenantCode}/{slug}` as the link, the featured image resolved through `MediaLibraryPort`), then enqueues for every enabled rule account. It runs in a savepoint: any failure rolls back only this module's writes and the article still publishes.
2. **Manual publication.** `POST /api/v1/social-publishing/publications` takes a title, a caption, an optional link, an optional media object and the account ids. The caller must be able to use every account.
3. **Enqueue rules, per account, in order.** The account may publish now (`channel_accounts` port: connected, active connection, `publish` capability granted with evidence under the current matrix); the provider has an adapter; the adapter's capability map can carry the content (variant, caption length including the link, image type and size). Any failure is a returned code for that account. Accounts are evaluated before anything is written, so a request in which every account is refused records nothing.
4. **Approval and schedule.** With approval required the publication waits; the dispatcher claims nothing until `approve`. A manual publication cannot be approved by its creator. `not_before` defers dispatch; `schedule` moves it while nothing has been dispatched.
5. **Dispatch.** `bun run social-publishing:dispatch`, three phases: claim (lease, per-account advisory lock, fair share and daily cap, account re-check), send (credential decrypted for this call only, adapter called with an `ssrfSafeFetch` client, a timeout and a per-account circuit breaker), finalise (compare-and-set on the claimed attempt, ledger, event, audit).

## 4. Failure behaviour

| Situation                                                           | Result                                                                                                        |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Account revoked, disabled, capability withdrawn, connection revoked | Job `failed` (`ACCOUNT_*`), provider never called, nothing rerouted                                           |
| Account degraded, pending, grant expired, secret store unavailable  | Job held (`queued`, `hold_count + 1`, no attempt consumed); `HOLD_EXHAUSTED` after 12 holds                   |
| Provider says retry later, network error, adapter threw             | `retry_wait` with exponential backoff (capped at 4 hours); `RETRIES_EXHAUSTED` when spent                     |
| Rate limited                                                        | Same, and the provider's `retryAfterSeconds` can only lengthen the wait                                       |
| Credentials no longer accepted                                      | `failed` `NEEDS_REAUTH`; never retried by backoff                                                             |
| Provider rejected the content                                       | `failed` with a fixed code; never retried by backoff                                                          |
| Another job of the same publication failed                          | No effect on a published sibling; a manual retry moves only the failed job                                    |
| Worker crashed mid-send                                             | The lease expires, the job is claimed again as a new attempt; the provider is handed the same idempotency key |
| Breaker open for an account                                         | Its jobs are not claimed; other accounts are unaffected                                                       |

## 5. Security notes

- A job never carries a credential. The dispatcher resolves it through `ChannelPublisherCredentialPort` (capability `channel_account` 1.1.0) in a transaction that closes before the provider call; only `scripts/social-publishing-dispatch.ts` composes that adapter and holds `CHANNEL_SECRETS_ENCRYPTION_KEYS`.
- `sql/332` widens the `awcms_worker` row policy on `awcms_channel_secrets` from WhatsApp sender credentials to also include the access token of a live Facebook, Instagram, Threads, TikTok, YouTube or LinkedIn account that holds a **granted** `publish` capability (and of a connection such an account uses). A social account nobody approved for publishing stays hidden. A compromised `social-publishing:dispatch` can still decrypt every tenant's publishing-capable tokens: this is the residual risk ADR-0148 section 5 accepts for dispatchers, now stated for a second job.
- Adapters get `request.http` (`ssrfSafeFetch`) and no raw `fetch`; the credential is in memory for one call and is never logged, stored, evented, audited or placed in an error, and a thrown adapter error's message is never kept. A failure code is a closed vocabulary each adapter declares (`errorCodes`); a code outside it is recorded as the generic code for its outcome, so a provider string or the credential cannot reach a row through a "code".
- Per-account access: creating a publication, a rule, and acting on a publication or job require the caller to be able to use every targeted account (assignment rule and business scope of `channel_accounts`); anything else is a uniform `422 ACCOUNT_NOT_USABLE` or `404`. Reads are gated by the permission only.
- Every mutation is idempotent (`Idempotency-Key`), audited with ids, codes and counts (never a caption, a title or a URL) and refuses a machine credential. Events carry ids, enums and counts.

## 6. Permissions

`publications.read`, `publications.publish`, `publications.schedule`, `publications.approve`, `publications.cancel`, `jobs.retry`, `rules.read`, `rules.configure`, `settings.configure` (module `social_publishing`, seeded by `sql/331`). All are on the `NOT_YET_SCREENED` ledger until the screen lands. A tenant created before this migration needs `bun run identity-access:permissions:backfill`.

## 7. Configuration

`SOCIAL_PUBLISHING_ENABLED` (off by default). It needs `CHANNEL_ACCOUNTS_ENABLED=true` (`config:validate` refuses the combination otherwise) and `CHANNEL_SECRETS_ENCRYPTION_KEYS` for the dispatcher. `APP_URL` must be `https` for an article event to carry a link; otherwise the event is recorded as a refused publication (`LINK_INVALID`).

## 8. Acceptance matrix (issue #1145) and its tests

| Acceptance                                            | Test                                                                                                                      |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| 2 tenants x 3+ accounts, token isolation              | `social-publishing.integration.test.ts` "N accounts of two tenants", "ITS OWN credential"                                 |
| Partial failure and replay                            | "a rejected account does not change a published one", "a published job can never be retried..."                           |
| Revocation                                            | "revoked account", "revoked connection and a withdrawn capability", "degraded account HOLDS"                              |
| MIME and media validation                             | `social-publishing.test.ts` media eligibility; "unsupported content is REFUSED per account"                               |
| SSRF                                                  | "the adapter's HTTP client is ssrfSafeFetch"                                                                              |
| Quota and safe retries                                | "daily cap holds under concurrent dispatchers", "concurrent dispatchers send every job exactly once", "RETRIES_EXHAUSTED" |
| Idempotency per (article, trigger, account)           | "an article event is idempotent per (article, trigger, account)", "concurrent identical article events"                   |
| Approval, schedule                                    | "nothing is claimable before approval", "a schedule defers dispatch"                                                      |
| No duplicate queue, forward-only migration, FORCE RLS | `social-publishing-contract.test.ts`, "FORCE RLS" test                                                                    |
| Port never aborts the publish, flag-off is a no-op    | "off unless the deployment enables it", "an unexpected failure inside the port never aborts..."                           |

## 9. Remaining limitations

- **No provider adapter** (#1146 to #1151): nothing publishes yet. The provider app approvals are business steps outside this repository.
- **No admin screen.** Admin SYSTEM screens are built here ([ADR-0051](../adr/0051-admin-screens-consolidated-in-awcms.md)); the screen contract is UP-08 to UP-16 in [`omnichannel-ui-ux-screen-contracts.md`](omnichannel-ui-ux-screen-contracts.md).
- **No retention sweep** for publications, jobs and attempts (they are parked on the `BOUNDED_BY_DESIGN` list with a stated reason). It needs the owner's decision on how long the evidence of what was published under a tenant's name is kept.
- **No caption templates**, no per-provider formatting beyond refusing content that exceeds a length, type or size ceiling, no video, short or story variants (the vocabulary is closed and reserved).
- The crash window between "the provider accepted the post" and "the job was finalised" is closed only where the provider honours the passed idempotency key.
- Reads (list and detail) are gated by the permission, not by per-account access.
- Per-process circuit breakers: each dispatcher process has its own state.
- **ADR-0157 is Proposed.** The maintainer's acceptance, and a security review of the credential path before any connector leaves the flag, are still needed.
