---
name: awcms-social-publishing
description: **ADR-0055 (2 August 2026): this is a BUILD-IT-HERE candidate, not a port.** `awcms-mini`/`awcms-micro` are now ARCHIVES — they may be read as a specification, but the "port from mini" path is REVOKED. Working on it means: ADR admission first, then build it in this repo under the ADR-0055 §3 guardrails (ADR mandatory, security review for auth/access/sync, full `bun run check`, OpenAPI/AsyncAPI in sync, RLS FORCE, ABAC default-deny). READ-ONLY / TARGET SPECIFICATION — the social_publishing module DOES NOT EXIST in this repo (it exists in awcms-mini; `ls src/modules` does not contain `social-publishing`, and there is no migration for it in `sql/`). Its dependency is now ONE module, `blog_content` (`news_portal` was merged into it — ADR-0044/#300), and it has already been ported (PR #214), so the foundation blocker is gone — what remains is porting this module itself. The module/table/`sql/NNN` references inside are awcms-mini artifacts, using mini numbering. Use it as the target specification when BUILDING it here (ADR admission first), not as a guide to code you can call — verify `ls src/modules` first. Port context (Issue #643-#647). Use when adding/changing an account connector, publish rule/template, outbox job/attempt, approval, retry/backoff, dispatcher, or provider adapter (Meta/LinkedIn/Telegram) for auto-posting news to social platforms. Summarises the architecture decisions already made in Issue #643 (foundation) so the follow-on adapter issues (#644-#646) and the documentation issue (#647) do not repeat or contradict them.
---

🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](SKILL.id.md)

# AWCMS — Social Publishing (auto-posting outbox foundation)

<!-- sql-refs: awcms-mini — module not yet ported; every `sql/NNN` in this file uses awcms-mini numbering, not this repo's -->

> **STATUS — READ-ONLY: this module has NOT been ported to this repo.**
> `social_publishing` lives in **awcms-mini**, not here: `ls src/modules`
> does NOT contain `social-publishing`, and `sql/` does not contain its migration.
> Its dependency is now **one** module: `blog_content`, which has been ported (PR #214,
> `sql/035`–`sql/045`), so the foundation blocker is gone and the publish hook
> in `blog_content` exists but is **no-op** — turning it on is part
> of this port. Every reference to `src/modules/social-publishing/...`, the
> `awcms_social_*` tables, and `sql/NNN` below are awcms-mini artifacts —
> **do not `import`/`SELECT`/claim they exist** in this repo. The `sql/NNN` numbers
> use awcms-mini numbering and will change when ported (continuing
> from this repo's last migration). Use this skill as the target port
> specification (via ADR admission; `awcms-port-from-mini` is HISTORICAL), not as a map of code you can
> call. Verify `ls src/modules` before claiming anything exists.

The `social_publishing` epic (#643-#647) adds a provider-neutral
auto-posting layer on top of `blog_content` (base module, already `active`) and
`news_portal` (the `news_portal` epic #631-#642/#649, source of verified
R2 images) — only for **full-online** deployments that enable the
`SOCIAL_PUBLISHING_ENABLED`/`SOCIAL_PUBLISHING_PROFILE` flags. Issue #643
(foundation) was finished first; #644 (Meta/Facebook+Instagram), #645
(LinkedIn), #646 (Telegram) each add ONE REAL provider adapter
on top of this foundation; #647 (documentation/SOP) needs all previous
issues to already exist. **The entire epic (#643-#647) is now finished** — see
§647 below for the five documents added by this closing issue.

## When to use this skill vs the generic skills

This skill complements (does not replace) `awcms-new-endpoint`,
`awcms-new-migration`, `awcms-integration` (external outbox/circuit
breaker patterns, ADR-0006), `awcms-idempotency` (the
connect/disconnect/approve/cancel/retry mutations), `awcms-abac-guard`,
`awcms-audit-log`, and `awcms-sensitive-data` (token
reference). This skill supplies the **epic-specific cross-cutting**
context — above all the decision "provider-neutral foundation first, no
real adapter until #644/#645/#646" that every follow-on issue must
preserve.

## Status per issue (do not rebuild what already exists)

| Issue | Scope                                                                                                                           | Status                    |
| ----- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| #643  | Foundation: 6-table schema, outbox/dispatcher, approval, retry/backoff, provider-adapter interface (empty), admin UI, readiness | **Done** — see §643 below |
| #644  | Meta adapter (Facebook Page + Instagram Business)                                                                               | **Done** — see §644 below |
| #645  | LinkedIn adapter (organization page)                                                                                            | **Done** — see §645 below |
| #646  | Telegram adapter (channel, bot token)                                                                                           | **Done** — see §646 below |
| #647  | Cross-provider documentation/SOP, needs #643-#646 all present                                                                   | **Done** — see §647 below |

Dependency order (from each issue's own objective): 643 -> {644, 645,
646 independent of each other, each needing only #643} -> 647
(needs all of them — every prerequisite is met, the epic is complete).

## §643 — Outbox/connector foundation (Done)

### Key decision #1 — full-online-only via a TWO-flag env gate, NOT a reuse of `NEWS_PORTAL_ENABLED`

`SOCIAL_PUBLISHING_ENABLED` (master switch) + `SOCIAL_PUBLISHING_PROFILE`
(must be `"full_online"` when enabled) — exactly the
`AUTH_ONLINE_SECURITY_ENABLED`/`_PROFILE` pattern
(`src/lib/auth/online-security-config.ts`), NOT a reuse of
the `news_portal` epic's `NEWS_PORTAL_ENABLED`/`_PROFILE` (different
feature, different deployment decision — a tenant can run news_portal
full-online without ever wanting social auto-posting). Resolver:
`src/modules/social-publishing/domain/social-publishing-config.ts`'s
`isSocialPublishingDeploymentActive(env)`. Enforced by
`config:validate` (`checkSocialPublishingProfileConfig`,
`scripts/validate-env.ts`) and `security:readiness`
(`checkSocialPublishingProviderReadiness`, critical,
`scripts/security-readiness.ts`).

This is ONLY half of the acceptance criterion "Auto-posting can be
disabled globally and per tenant" — the other half (per-tenant) is
`awcms_social_publishing_settings` (Key decision #2 below).

### Key decision #2 — the per-tenant settings table MAY be tenant-writable (NOT a repeat of the #636 anti-pattern)

`awcms_social_publishing_settings` (`tenant_id` PK,
`auto_publishing_enabled`) is the sixth table, outside the 5 literal "Core entities"
in the body of issue #643. Deliberately **tenant-writable** through an
ABAC-gated endpoint (`GET/PATCH /api/v1/social-publishing/settings`, permission
`rules.configure`) — this is **NOT** a repeat of the Issue #636 anti-pattern
(`.claude/skills/awcms-news-portal/SKILL.md` §636): #636 needed
a signal the tenant MUST NOT be able to defeat itself (R2-only security
enforcement). The per-tenant auto-posting toggle here is on the contrary MEANT
to be changeable by the tenant itself (an ordinary business preference, not a security
control) — so a dedicated table + RLS + an ordinary ABAC endpoint is
enough, the "zero generic write surface" pattern of #636 is NOT needed. Do not
misread it as a security regression if you read this code after
reading §636 — the two are deliberately different because their threat models differ.

### Key decision #3 — `token_reference` is a REFERENCE, not a real token; there is a rejection heuristic

`awcms_social_accounts.token_reference` is an opaque string (e.g.
`"secretsmanager:social/fb-page-42"`, `"env:SOCIAL_TOKEN_X"`) that
points into external secret storage — this repo does **not yet** have a real
secret-manager integration (recorded as residual/follow-up, not
solved by this issue). `social-account-validation.ts`'s
`looksLikeRawSecretToken` rejects (400) values SHAPED like a real token
(3-segment JWT, prefix `EAA`/`ya29.`/`1//`/`ghp_`, Telegram Bot API token
`<bot_id>:<35-char secret>`, long base64/hex blob without a
known reference prefix) — best-effort, NOT a perfect guarantee
(documented explicitly in the function's comment). `token_reference`
is **never** selected back by any query except ONE function,
`fetchSocialAccountTokenReferenceForDispatch` (INTERNAL ONLY, called by the
dispatcher, never from an HTTP route) — the same pattern as
`tenant-domain-directory.ts`'s `verification_token_hash`. Disconnect
clears `token_reference` to `NULL` (not merely flipping the status).

**security-auditor round 1 finding (PR #731, High, CLOSED)**: the initial
check only had 4 patterns (JWT/EAA/ya29./gh[a-z]_) plus one catch-all blob
of 64+ characters that excluded EVERY string containing a colon — a Telegram
Bot API token (shape `123456789:AAExampleFakeTelegramBotToken0000`, ~44
characters) slipped through: too short for the catch-all, and its shape did not match
the other 4 patterns. This is a real gap for the NEXT provider in this epic (#646),
not hypothetical. Fixed with (1) an explicit rejection pattern
`^\d{6,10}:[A-Za-z0-9_-]{30,45}$` before the reference exclusion, AND (2)
`KNOWN_SECRET_REFERENCE_PREFIX_PATTERN` (an allow-list of the prefixes
`secretsmanager`/`env`/`ref`/`vault`/`kms`/`ssm`) replacing "any
string containing a colon is excluded" — the catch-all blob charset was also
widened to include `:` so that this prefix exclusion is genuinely
tested/reachable rather than dead code. **Mandatory for #644/#645/#646**: if
your provider has a token shape that could also slip past the 5 patterns
that exist today, add a new explicit rejection pattern — do not rely on
the generic catch-all blob alone for SHORT tokens.

**Mandatory for #644/#645/#646**: a real adapter MUST NOT store its own
client token/secret in any other column — resolving
`tokenReference` -> real credential is the adapter's own
responsibility (e.g. read an env var named after the reference, or call a real secret
manager), not the responsibility of this foundation.

### Key decision #4 — provider-adapter interface, EMPTY registry, `provider_key` is NOT a fixed enum

`domain/social-provider-adapter.ts` defines `SocialProviderAdapter`
(providerKey, requiredEnvVars, `publish()`, `verifyCredentials()`).
`infrastructure/social-provider-registry.ts` is a singleton Map that is
EMPTY in this issue — there is NOT a single real HTTP call to Meta/
LinkedIn/Telegram anywhere in this module. `provider_key` (a column on
`awcms_social_accounts`/`..._social_publish_jobs`) is deliberately validated ONLY
for FORMAT (`^[a-z][a-z0-9_]{1,49}$`), not a fixed `CHECK` enum
like `awcms_news_portal_ad_placements.placement_key` — so that
#644/#645/#646 can register a new provider key without a new migration.

**Mandatory for #644/#645/#646**: call
`registerSocialProviderAdapter(adapter)` from the adapter's OWN COMPOSITION
ROOT (e.g. a new file/script/module-init, NOT
from inside `social-publishing/application`/`domain`) — the same pattern as
`setLogSink`/`setAuditExportHook`'s "registration is a composition-
root concern". Use a `providerKey` consistent with the name
implied by your own issue body (e.g. `facebook_page`,
`instagram_business`, `linkedin_organization`, `telegram_channel`) —
there is no binding official list, but keep it consistent across those three
issues themselves.

### Key decision #5 — outbox: job CREATION inside the transaction, provider CALL outside it (ADR-0006)

`application/create-social-publish-jobs.ts`'s
`createSocialPublishJobsForArticle` ONLY INSERTs job rows
(a plain DB write, without any external call at all) — called INSIDE
the same transaction as the `blog_content` post transition to `published`
(via `SocialPublishingPort`, see Key decision #6). This is CORRECT under
the outbox pattern (writing the event/outbox row atomically with the business event
that triggers it) — not an ADR-0006 violation, because ADR-0006 forbids
PROVIDER calls (not outbox row writes) inside a transaction.
The REAL provider call only happens in
`application/social-publish-dispatch.ts`'s `dispatchSocialPublishQueue`
(invoked by `bun run social-publishing:dispatch`,
`scripts/social-publish-dispatch.ts`), 3-phase CLAIM/CALL/FINALIZE exactly like
`sync-storage/application/object-dispatch.ts`.

**Mandatory for #644/#645/#646**: NEVER call `adapter.publish()`
from inside code that also writes to `awcms_blog_posts` or runs
inside any transaction — only the dispatcher may call it,
and it MUST be wrapped in `withTimeout` + a per-provider circuit breaker
(`getProviderCircuitBreaker(`social-publishing:${providerKey}`)`), already
provided generically in `social-publish-dispatch.ts` — a new adapter does NOT
need to add its own circuit breaker.

### Key decision #6 — two cross-module ports: `SocialPublishingPort` (consumed by blog_content) and `NewsMediaPort` (consumed by social_publishing)

The same pattern as Issue #681 (`_shared/ports/`, `news_media`/`public_content`):
`_shared/ports/social-publishing-port.ts` (NEW, this issue) is a
capability that `blog_content` CONSUMES from `social_publishing`
(`onArticlePublished`, called from `pages/api/v1/blog/posts/[id]/
publish.ts` and `blog-content/application/blog-scheduled-publish.ts` via
the optional `socialPublishingPort` parameter, wired in
`scripts/blog-scheduled-publish.ts`). `social_publishing` itself
CONSUMES `news_portal`'s `news_media` capability (to resolve verified R2
image URLs) — it does NOT import `news-portal/application/
news-media-port-adapter.ts` directly from inside
`social-publishing/application` (that is precisely the anti-pattern
#681 fixed); the factory
`social-publishing-port-adapter.ts`'s `createSocialPublishingPortAdapter(mediaPort)`
takes `NewsMediaPort` as a PARAMETER, and only the composition root
(route/script) imports both concrete adapters and wires them together.

**Special note**: `social-publishing-port-adapter.ts` ALSO imports
`blog-content/application/public-route-settings.ts`'s
`fetchEffectivePublicRouteSettings` directly (for
`publicBasePath`) — this is NOT the same boundary violation:
`tests/unit/module-boundary.test.ts` (Issue #681) ONLY governs the
`blog_content`<->`news_portal` pair, there is no equivalent boundary between
`social_publishing` and `blog_content` today. This direction is far
lower risk (one read-only getter function, not a re-import of another module's
whole domain) — documented deliberately, not an oversight.

### Key decision #7 — canonical URL from the verified tenant domain, NOT `url.origin`

Every other canonical URL construction in this repo (`/news/[slug].ts`,
`sitemap-news.xml.ts`) uses `url.origin` straight from the REQUEST — not
available here because job creation can be triggered from a scheduled worker
with no incoming request at all. `application/article-canonical-url.ts`'s
`resolvePrimaryVerifiedDomainHostname` queries `awcms_tenant_domains`
DIRECTLY (raw SQL, no TS import) (`is_primary = true AND status
= 'active'`) — the SAME pattern `blog-content/application/public-news-
tenant-resolution.ts` already uses for the same table, so it is not a
new boundary violation. If the tenant does not yet have a verified primary
domain, job creation SKIPS with a documented reason
(`no_verified_domain`) — it NEVER guesses or falls back to a wrong URL.

### Key decision #8 — job idempotency: a DB unique index, not application discipline alone

`awcms_social_publish_jobs_idempotency_key` (UNIQUE
`(tenant_id, idempotency_key)`) + `INSERT ... ON CONFLICT DO NOTHING` —
`idempotency_key` is computed deterministically from
`(tenantId, articleId, socialAccountId, providerKey, action)` via
`domain/social-publish-idempotency.ts`'s
`buildSocialPublishIdempotencyKey`. This is separate from `_shared/
idempotency.ts`'s generic HTTP `Idempotency-Key` table (used by the
connect/disconnect/approve/cancel/retry endpoints) — job creation is triggered by an
internal event, not an HTTP client request, so it needs its own idempotency
mechanism at DB row level.

### Key decision #9 — `PATCH /accounts/{id}` (auto-publish toggle) is gated by `rules.configure`, NOT a new `accounts.*` permission

DELIBERATE (security-auditor finding M2, PR #731 review round 1): a role that
has `rules.configure` but does NOT have `accounts.connect`/`.disconnect`
can still change `autoPublishEnabled` on an account it did not
connect itself. This reuses the 10 fixed permissions issue #643 itself
already proposed (see the migration 050 header) — rather than
adding an 11th permission (`accounts.configure`, say) just for one
boolean field. The blast radius is limited to "may turn auto-publish on/off for an
ALREADY connected account", never touching
credentials/tokens (those stay behind `accounts.connect`/`.disconnect`).
Recorded here SO THAT it reads as a conscious tradeoff, not an
oversight, if it is reviewed again later — see also the header comment on
`pages/api/v1/social-publishing/accounts/[id].ts`'s `PATCH` handler.

### Retry/backoff — `evaluateSocialPublishRetry`/`evaluateSocialPublishRateLimitRetry`

The same formula as `sync-storage/domain/object-queue.ts`'s
`evaluateObjectRetry` (`2^attemptCount` minutes, capped at
`SOCIAL_PUBLISH_MAX_RETRY_DELAY_MINUTES=240`), NOT reused directly
(the constants differ: a job has a per-row `max_attempts`, not a fixed module
constant). Rate-limit retry takes the provider's
`retryAfterSeconds` into account, and is never shorter than the exponential
floor (preventing a provider from forcing a tight retry loop).

### Job status after dispatch

- `published`: success, `externalPostId`/`externalPostUrl` filled in.
- retryable failure & budget remaining: back to `pending`/`approved`
  (depending on the `requires_approval` snapshot) with a `next_attempt_at`
  backoff — NEVER back to `requires_approval` (approval does not
  need to be repeated).
- retry budget exhausted: `failed` (terminal, can NO LONGER be retried manually —
  `retrySocialPublishJob` rejects `attempt_count >= max_attempts`).
- `rate_limited`: backoff from `retryAfterSeconds`, can still exhaust the
  budget -> `failed`, terminal as well.
- `needs_reauth`: NO auto-retry, AND that job's `awcms_social_accounts`
  row is flipped to `needs_reauth` as well
  (`markSocialAccountNeedsReauth`) — reconnect via `POST .../accounts`
  (upsert) is the ONLY reauthorization path, there is no separate
  "reauthorize" endpoint.
- A provider with no registered adapter (`getSocialProviderAdapter` returns
  `undefined`): `failed` terminal IMMEDIATELY (errorCode
  `provider_not_registered`, `retryable: false`) — it never enters the retry
  cycle at all (adding an adapter will never make an automatic retry
  succeed until someone retries manually).

### Files created/changed (quick reference)

- `sql/053_awcms_social_publishing_schema.sql` (6 tables + 10
  seeded permissions).
- `src/modules/identity-access/domain/access-control.ts` (`connect`/
  `disconnect` added to `AccessAction` + `HIGH_RISK_ACTIONS`).
- `src/modules/social-publishing/domain/`: `social-publishing-config.ts`,
  `social-provider-adapter.ts`, `social-publish-retry.ts`,
  `social-publish-idempotency.ts`, `social-account-validation.ts`,
  `social-publish-rule-validation.ts`,
  `social-publish-template-validation.ts`.
- `src/modules/social-publishing/application/`:
  `article-canonical-url.ts`, `social-account-directory.ts`,
  `social-publish-rule-directory.ts`,
  `social-publish-template-directory.ts`,
  `social-publishing-settings-directory.ts`,
  `create-social-publish-jobs.ts`, `social-publish-job-directory.ts`,
  `social-publish-dispatch.ts`, `social-publishing-port-adapter.ts`.
- `src/modules/social-publishing/infrastructure/social-provider-registry.ts`.
- `src/modules/social-publishing/module.ts`; registered in
  `src/modules/index.ts`.
- `src/modules/_shared/ports/social-publishing-port.ts` (new);
  `src/modules/blog-content/module.ts` (`capabilities.consumes` +
  `social_publishing`, optional).
- `src/modules/blog-content/application/blog-scheduled-publish.ts`
  (optional `socialPublishingPort` parameter).
- `src/pages/api/v1/blog/posts/[id]/publish.ts` (composition root,
  calls `socialPublishingPort.onArticlePublished`).
- `scripts/blog-scheduled-publish.ts` (composition root, wires the port).
- `src/pages/api/v1/social-publishing/{accounts,rules,templates,jobs,settings}/**`.
- `scripts/social-publish-dispatch.ts`
  (`bun run social-publishing:dispatch`).
- `src/pages/admin/social-publishing/{accounts,rules,jobs}.astro`.
- `openapi/modules/social-publishing.openapi.yaml`.
- `asyncapi/awcms-domain-events.asyncapi.yaml` (15 new
  channels/operations, `awcms.social-publishing.*`).
- `scripts/validate-env.ts` (`checkSocialPublishingProfileConfig`),
  `scripts/security-readiness.ts`
  (`checkSocialPublishingProviderReadiness`), `src/lib/config/registry.ts`,
  `.env.example`, `18_configuration_env_reference.md`.
- `i18n/en.po`, `i18n/id.po`, `i18n/messages.pot` (69 new keys,
  `admin.social_publishing.*`/`admin.layout.nav_social_publishing_*`).
- Tests: `tests/unit/social-publishing-config.test.ts`,
  `tests/unit/social-publish-retry.test.ts`,
  `tests/unit/social-publish-idempotency.test.ts`,
  `tests/unit/social-account-validation.test.ts`,
  `tests/unit/social-publish-template-validation.test.ts`,
  `tests/modules/social-publishing-module.test.ts`,
  `tests/integration/social-publishing.integration.test.ts`; updated:
  `tests/foundation.test.ts` (migration list 050).
- Changeset: `.changeset/social-publishing-outbox-foundation-issue-643.md`.

### Not yet done / out of scope for this issue (for #644/#645/#646/#647)

- The real Meta/Instagram (#644), LinkedIn (#645), Telegram
  (#646) provider adapters — zero external HTTP calls today.
- A real secret-manager integration for resolving `token_reference` ->
  credential — today it is purely convention/heuristic, not code that
  actually calls secret storage.
- A real "manual editor action" endpoint/UI for the
  `manual_editor_action` trigger (fully modelled in `awcms_social_publish_rules.trigger_event`,
  but there is no "Post to X now" button in the article editor yet) — a
  follow-on issue that adds that UI must still use the existing
  `createSocialPublishJobsForArticle`/`SocialPublishingPort`,
  not a new path.
- Auto-requeue of `needs_reauth` jobs as soon as the account reconnects — today a job
  already in `needs_reauth` must be retried manually via `POST
.../jobs/{id}/retry` after the account reconnects, not automatically.
- A dedicated admin UI for `awcms_social_publish_templates` as a
  separate page — merged into the rules page (`/admin/social-
publishing/rules`), not its own page (the same "one config page is
  enough" pattern as several other modules in this repo).
- Full keyset pagination for `GET /api/v1/social-publishing/jobs` —
  today a simple bounded `LIMIT` (max 200), documented as a
  follow-up if job volume grows large.

## §644 — Meta adapter: Facebook Page + Instagram Business (Done)

The first REAL provider adapter in this epic. Registration is UNCONDITIONAL
(always invoked when `social-provider-registry.ts` is imported — see the
Key decisions below), independent of `META_PROVIDER_ENABLED` (which
only gates the adapter's BEHAVIOUR when it is called, not whether it is
registered).

### Key decision #644-1 — TWO separate provider keys, one account row = one publish target

`meta_facebook_page` (Facebook Page, link post to `/{page-id}/feed`) and
`meta_instagram` (Instagram Business, 2-call media container -> publish
to `/{ig-user-id}/media` then `.../media_publish`) are TWO separate
adapters, each with its own `providerKey`. There is NO single
`awcms_social_accounts` row representing a combined "Meta connection" —
the tenant connects ONE row per publish target (one for the Page, another
for IG if both are wanted), `providerAccountId` for
`meta_facebook_page` is the Facebook Page ID, and for `meta_instagram`
it is the Instagram Business Account ID. **Deliberately NO new
migration** was added for the "account.metadata" fields the issue body mentions
(`facebook_page_id`, `facebook_page_name`, `instagram_business_account_id`,
`instagram_username`, `permissions_json`, `token_expires_at`,
`last_verified_at`) — ALL of those fields already have a 1:1 counterpart in the
generic #643 columns (`provider_account_id`/`_name` for the first two fields of each
providerKey, `scopes_json` for `permissions_json`, `expires_at`/
`last_verified_at` for the last two). Do not add new metadata
columns for this unless you genuinely find a need that
CANNOT be mapped onto the existing #643 schema.

`provider_account_type` for BOTH of these provider keys is always `"page"` —
see `SocialProviderAdapter.supportedAccountTypes` below for
why (IG Business is still published through a Page access token, there is
no standalone IG account type in the real Meta API).

### Key decision #644-2 — `SocialProviderAdapter.supportedAccountTypes` (a NEW, optional, additive field) is enforced at THREE points, not just one

The `domain/social-provider-adapter.ts` interface (foundation #643) had no
way for a caller to know which account types an adapter
supports. An optional field `supportedAccountTypes?:
readonly SocialAccountType[]` was added — `undefined` means "no
type restriction" (not "no type is supported").

**Reviewer round 1 finding (BLOCKING, PR #644 fixed before merge)**:
the first version ONLY checked this field in the verify endpoint (opt-in,
diagnostic) — the real connect -> dispatch -> publish path that actually
posts to Meta NEVER checked it. An operator could connect
`providerKey: "meta_facebook_page"` with `providerAccountType:
"profile"` and it would SUCCEED; the dispatcher would still call
`adapter.publish()`. That contradicts the issue's acceptance
criterion outright ("Instagram publishing validates account eligibility ...
before job execution") and its out-of-scope list (no personal
profile/personal Instagram posting).

**Fixed at TWO layers, not one**:

1. `application/social-publish-dispatch.ts` — AFTER
   `fetchSocialAccountTokenReferenceForDispatch` (which now also
   returns `providerAccountType`) and BEFORE `adapter.publish()`
   is called, check `adapter.supportedAccountTypes` — the job fails terminally with
   `unsupported_account_type`, `retryable: false` (an account type never
   changes by itself, it requires a manual reconnect). This is the only point that
   genuinely closes the acceptance-criterion gap ABOVE, because THIS is what
   EVERY real job passes through, not just the ones that were ever verified.
2. `pages/api/v1/social-publishing/accounts/index.ts`'s `POST` (connect) —
   a second defense-in-depth layer, rejecting with `422 SOCIAL_ACCOUNT_UNSUPPORTED_TYPE`
   at the earliest point (immediate feedback to the operator, rather than waiting for a job
   to fail later).

This field is ALSO read by `scripts/security-readiness.ts`'s
`checkMetaSocialPublishingAccountReadiness` (readiness, not runtime
enforcement). **If #645 also adds the same field** (very likely,
LinkedIn has similar account-type restrictions) — the field itself is purely
ADDITIVE, but you **must enforce it in the dispatcher TOO**, not only in the
verify/connect endpoints — that is the real lesson of this round 1 finding.

### Key decision #644-3 — `token_reference` resolution is LOCAL per adapter, and the `env:VAR_NAME` scheme is the ONLY one implemented

`infrastructure/meta/meta-token-reference-resolver.ts`'s
`resolveMetaTokenReference` ONLY supports the `env:VAR_NAME` scheme (reading
`process.env[VAR_NAME]`) — other schemes that pass the FORMAT validation in
`looksLikeRawSecretToken` (`secretsmanager:`, `vault:`, `kms:`, `ssm:`)
are accepted as a legitimate REFERENCE shape but CANNOT be resolved by this
deployment (returns `null`, fail closed -> `needs_reauth`, not a
throw). This is DELIBERATELY not promoted into a shared file even though the logic is
generic — Key decision #3 of §643 says explicitly that token resolution is
EACH adapter's own responsibility. **Mandatory for #645/#646**: if
you need similar resolution, copy this pattern (a module-local function),
DO NOT import this function from the Meta module — that would make
`social_publishing` depend on a specific provider's implementation.

The SAME function is used for `META_APP_SECRET_REFERENCE` (needed
to build the `{appId}|{appSecret}` app access token when calling
`debug_token`).

### Key decision #644-4 — `POST .../accounts/{id}/verify` was built in PR #644 then REPLACED by the canonical #646 design (a parallel collision, resolved by the orchestrator)

PR #644 (Meta) and PR #646 (Telegram) BOTH built
`POST /api/v1/social-publishing/accounts/{id}/verify` independently
and in parallel — each passed its own review, but once #646
merged to `main` first, the orchestrator ruled the #646 design
CANONICAL (a dedicated `accounts.verify` permission — not a reuse of
`accounts.connect`; `Idempotency-Key` mandatory; an informational `200` that
NEVER forces a state transition on failure — not a `409`
`needs_reauth` as in #644's initial design) and #644's own implementation
(`application/social-account-verification.ts`,
`fetchSocialAccountTokenReferenceForVerification`,
`recordSocialAccountVerificationSuccess`, the initial `verify.ts` route)
was **DELETED ENTIRELY** when #644 merged the `origin/main` that already carried
#646. See §646 below for the canonical design that actually runs.

**Lesson for #645 (LinkedIn, still running in parallel)**: DO NOT
rebuild your own verify endpoint — this route is NOW generic/
shared, and already handles any provider via `getSocialProviderAdapter`.
What #645 needs to touch is ONLY: the `verifyCredentials()` implementation in
LinkedIn's own adapter (called generically by the existing route),
and the LinkedIn-specific environment/readiness check — not the HTTP route.

One thing that REMAINS relevant from #644's initial design and is still kept
in the canonical version: `verifyCredentials`'s docstring (#643) already says
explicitly that it is called from a "readiness gate or a manual verify connection
admin action", and the canonical endpoint still calls the provider strictly
OUTSIDE the DB transaction (3-phase fetch/call/persist) — so #644's initial
design discipline ITSELF was not what was wrong, only its response shape/
permission/idempotency details lost out to #646.

### Key decision #644-5 — injectable Graph API client, mirroring the `mailketing-provider.ts` pattern

`infrastructure/meta/meta-graph-client.ts`'s `createMetaGraphClient`
takes optional `fetchImpl`/`baseUrl` (defaulting to the global `fetch` +
`https://graph.facebook.com`) — EXACTLY the pattern
`email/infrastructure/mailketing-provider.ts`'s `MailketingProviderConfig`
already uses (not a new pattern). Both adapters (`meta-facebook-page-adapter.ts`,
`meta-instagram-adapter.ts`) take an optional `graphClientFactory` in
their own constructor (`createMetaFacebookPageAdapter(options)`) —
the tests replace that factory with a fake implementing
`MetaGraphClient.call()`, and NEVER make a real `fetch` call.
**Mandatory for #645/#646**: use the SAME pattern (a client/provider object
injectable via your own adapter's constructor option) — do not
call `fetch`/an HTTP library directly from inside `publish()`/
`verifyCredentials()` without a layer that can be swapped out in tests.

### Key decision #644-6 — error normalization NEVER passes through Meta's original text/fbtrace_id

`domain/meta-error-normalization.ts`'s `normalizeMetaGraphApiError`
maps Meta's `error.code`/`error.type` onto a FIXED catalogue of safe messages
(`meta_oauth_exception_190`, `meta_permission_error_10`,
`meta_rate_limited_32`, and so on) — Meta's original
`error.message`/`fbtrace_id` NEVER reaches any `errorMessage`/log/response, even though
that text is usually safe (the issue's security notes explicitly ask to "not log
user/page identifiers beyond what is needed"). **Mandatory for
#645/#646**: if your platform also returns free-form error
messages, DO NOT pass them through verbatim — build your own fixed message
catalogue like this one.

### Key decision #644-7 — R2 image re-validation at the point of use (defense-in-depth, not a re-implementation of #636 enforcement)

`domain/meta-publish-content.ts`'s `isAcceptableProviderMediaUrl`
compares `new URL(url).host` EXACTLY against
`new URL(env.NEWS_MEDIA_R2_PUBLIC_BASE_URL).host` — NOT a
substring/prefix check (the lesson of Issue #635: a trailing-dot FQDN can
bypass a prefix check). This is purely defense-in-depth: a job's `content.imageUrl`
is ALREADY guaranteed verified by `create-social-publish-jobs.ts`
(foundation #643) via `NewsMediaPort.resolveMediaReferences` — this adapter
NEVER receives an image URL from any other source (a custom editor
caption is only TEXT, not a URL). This re-check is only a last-point
safety net before the external call, not a new enforcement
mechanism — do not misread it as a repeat of the Issue #636 tenant-state
pattern (that one is about WHO may write a security signal; this is about
re-validating an already-trusted value before it leaves the system).

### Key decision #644-8 — idempotency: the adapter's responsibility stops at forwarding `idempotencyKey`, the REAL dedup stays in the dispatcher

The Meta Graph API has NO real idempotency-key parameter for
`/feed`/`/media`/`/media_publish` — this adapter does NOT implement
its own dedup. Recorded explicitly in the tests
(`tests/unit/meta-instagram-adapter.test.ts`'s "idempotency" describe
block): calling `publish()` twice with the same `idempotencyKey`
still produces two independent Graph API calls — the REAL duplicate
prevention is the job status transition (`pending`/`approved` ->
`publishing` -> `published`, never re-claimed) that ALREADY exists
in `social-publish-dispatch.ts` (foundation #643, tested in
`tests/integration/social-publishing.integration.test.ts` and
`tests/unit/social-publish-idempotency.test.ts`). **Mandatory for
#645/#646**: do not pretend to implement adapter-level
idempotency if your platform does not have that mechanism either — document
this residual honestly, as here.

### Connection flow (no new OAuth route)

The generic #643 connect/disconnect endpoints (`POST/POST .../accounts`,
`.../accounts/{id}/disconnect`) are used AS-IS for Meta — there is no
new OAuth endpoint/redirect in this issue. The operator completes the
Meta OAuth flow outside the application (or through some other operational process that
produces a long-lived Page Access Token), then fills in the manual
connect form with `providerAccountId`/`Name`/`tokenReference`.
`META_OAUTH_REDIRECT_URI` is documented purely for registering the
app review/Meta dashboard — it is NOT an endpoint that actually exists in
this repo. `POST .../accounts/{id}/verify` (NEW, a provider-neutral
endpoint that only actually does something for Meta today)
calls `debug_token` live to check validity/scope/
expiry.

### Files created/changed (quick reference, FINAL state after the collision with #646)

- `src/modules/social-publishing/domain/`: `meta-provider-config.ts`,
  `meta-publish-content.ts`, `meta-error-normalization.ts`;
  `social-provider-adapter.ts` (+optional `supportedAccountTypes`,
  +a `providerAccountId` param on `verifyCredentials` — that LAST
  change came from #646, not #644, see §646).
- `src/modules/social-publishing/infrastructure/meta/`:
  `meta-graph-client.ts`, `meta-token-reference-resolver.ts`,
  `meta-credential-verification.ts` (`verifyMetaCredentials` now
  ALSO calls `GET /{providerAccountId}?fields=id` using the token being
  checked, confirming the token can genuinely reach the specific
  target — not merely that it is valid in general), `meta-facebook-page-adapter.ts`,
  `meta-instagram-adapter.ts`.
- `src/modules/social-publishing/infrastructure/social-provider-registry.ts`
  (an additive registration block at the end of the file — does NOT clash with #646,
  which uses a different registration pattern, see §646 Decision #x).
- `src/modules/social-publishing/application/social-account-directory.ts`
  (+`providerAccountType` in `fetchSocialAccountTokenReferenceForDispatch`
  — used by `social-publish-dispatch.ts`'s new enforcement, Key
  decision #644-2).
- `src/modules/social-publishing/application/social-publish-dispatch.ts`
  (+`supportedAccountTypes` enforcement before `adapter.publish()` —
  Key decision #644-2, the BLOCKING reviewer round 1 finding).
- `src/pages/api/v1/social-publishing/accounts/index.ts`'s `POST`
  (+`supportedAccountTypes` enforcement at connect time, the second
  defense-in-depth layer, `422 SOCIAL_ACCOUNT_UNSUPPORTED_TYPE`).
- **DELETED ENTIRELY** (lost to the canonical #646 design, see
  Key decision #644-4): `application/social-account-verification.ts`,
  the initial #644 `verify.ts` route,
  `tests/integration/social-publishing-meta-adapter.integration.test.ts`
  (entirely about the verify route that was replaced).
- `src/pages/admin/social-publishing/accounts.astro` — the #644 "Verify
  connection" button was DELETED too, replaced by the #646 version of the
  button/script (permission `accounts.verify`, `Idempotency-Key` mandatory).
- `scripts/validate-env.ts` (`checkMetaSocialPublishingProviderConfig`),
  `scripts/security-readiness.ts`
  (`checkMetaSocialPublishingAccountReadiness`),
  `src/lib/config/registry.ts`, `.env.example`,
  `18_configuration_env_reference.md`.
- `src/lib/i18n/error-messages.ts` (+`SOCIAL_ACCOUNT_UNSUPPORTED_TYPE`
  only — #644's initial `SOCIAL_ACCOUNT_NEEDS_REAUTH`/`PROVIDER_NOT_REGISTERED`
  were removed again along with its initial verify route, no longer
  used anywhere).
- `openapi/modules/social-publishing.openapi.yaml` (the CANONICAL #646
  `.../verify`, not #644's initial version; `+422` on `POST .../accounts`
  for connect-time enforcement), `asyncapi/...` (+`account.verified`
  from #644, +`account.verification-failed` from #646), `module.ts`
  (+2 events, description updated to mention both adapters).
- `i18n/en.po`, `i18n/id.po`, `i18n/messages.pot` — the final merged result of
  the #644+#646 strings (#646's UI/message version wins for identical
  keys).
- Tests: `tests/unit/meta-provider-config.test.ts`,
  `tests/unit/meta-publish-content.test.ts`,
  `tests/unit/meta-error-normalization.test.ts`,
  `tests/unit/meta-token-reference-resolver.test.ts`,
  `tests/unit/meta-facebook-page-adapter.test.ts` (+a `verifyCredentials`
  test with the new `providerAccountId` param),
  `tests/unit/meta-instagram-adapter.test.ts` (+a new `verifyCredentials`
  describe block); updated:
  `tests/modules/social-publishing-module.test.ts` (17 events, not
  16 — §646 also adds `account.verification-failed`),
  `tests/integration/social-publishing.integration.test.ts` (+2 tests for
  Key decision #644-2: the dispatcher rejects an unsupported type BEFORE
  publish() is called; connect rejects with `422` for an unsupported providerKey/
  providerAccountType combination — plus ONE incidental fix
  to the existing #646 test: `resetSocialProviderRegistryForTests()`
  was never restored after its own test, leaking an EMPTY registry
  into ALL subsequent tests in the same file because `bun test`
  runs all test files in one shared process — it is now
  wrapped in a `try/finally` that re-registers all three adapters).
- Changeset: `.changeset/social-publishing-meta-adapter-issue-644.md`.
- NO new migration from #644 itself — see Key decision
  #644-1 (#646 adds migration 055 for the `accounts.verify` permission,
  independent of this decision).

### Not yet done / out of scope for this issue (for #645/#646/#647)

- A real OAuth authorization-code exchange route for Meta — accounts are
  connected manually through the generic #643 form today.
- A real secret-manager integration — `env:VAR_NAME` remains the only
  `token_reference`/`META_APP_SECRET_REFERENCE` scheme that can actually
  be resolved.
- Stories/Reels, WhatsApp auto posting, social metrics synchronisation,
  social comment moderation — explicitly out of scope in #644's issue body.
- Auto-requeue of `needs_reauth` jobs after reconnect — still inherited from
  #643, unchanged.

## §645 — LinkedIn organization page adapter (Done)

Provider `provider_key: "linkedin_organization"` — the first REAL adapter in
this module (`src/modules/social-publishing/infrastructure/
linkedin-provider-adapter.ts`). `providerAccountId` is assumed to ALREADY be a
full URN (`urn:li:organization:{id}`), matching the `organization_urn` field name
in the issue body — this adapter never parses or builds a URN itself.

### Round 1 reviewer + security-auditor findings (PR #737) — read before touching secret-resolution/redaction code here again

Four findings, all fixed before merge:

1. **Critical** — `resolveLinkedInSecretReference` (`linkedin-provider-config.ts`)
   re-validated the RESOLVED value against `looksLikeRawSecretToken`
   (not just the reference BEFORE resolution). This bug is FATAL, not
   merely redundant: a real LinkedIn access token (150-1000+ opaque characters)
   is EXACTLY the shape of a 64+ character high-entropy blob that the heuristic is
   designed to reject — the old version rejected EVERY resolution of a real token
   as `"unresolvable"`, making `publish()`/`verifyCredentials()`
   NEVER able to succeed for a genuinely configured account.
   The test suite itself did not catch it because the `TEST_TOKEN` fixture
   is deliberately short (~35 chars), below the 64-character threshold. Fixed:
   remove the second check on the resolved value — the heuristic ONLY
   runs on the raw (caller-supplied) reference string, the same pattern as the
   Meta adapter (`resolveMetaTokenReference`, sibling PR #644) which only
   checks the `env:` shape + that the resolved value is non-empty. Regression tests:
   `tests/unit/linkedin-provider-config.test.ts`'s two realistic token
   tests (>64 chars, one of them >200 chars) — DO NOT let a
   short token fixture be the only "resolution succeeds" case that is
   tested.
2. **Critical** — three call sites in `linkedin-provider-adapter.ts`
   called `redact(truncate(message, 500), token)` — the order is BACKWARDS.
   `redact()` only matches a COMPLETE occurrence of the token via
   `.split(token)`; if the raw token is cut exactly at the 500-character
   point, ONLY a token fragment remains (not equal to the full
   token), so `.split()` fails to match and that fragment (demonstrated:
   the first dozen-odd characters of the real token) is stored AS-IS into
   `awcms_social_publish_jobs.last_error_message`/
   `..._social_publish_attempts.error_message` — both admin-readable.
   Fixed: flip the order to `truncate(redact(message, token), 500)`
   at all three sites (organizationAcls http_error, post-creation http_error,
   exception catch). The regression test MUST position the token so it
   GENUINELY straddles the 500-character boundary (not a short body that never
   touches the cut point) — see
   `tests/unit/linkedin-provider-adapter.test.ts`'s test "never leaks a
   partial token fragment when the token straddles the truncation
   boundary", which computes the margin explicitly and verifies
   (`guaranteedLeakLengthUnderOldBug >= FRAGMENT_CHECK_LENGTH`) that its
   fixture would GENUINELY fail against the old order before
   claiming the fix is correct.
3. **Medium** — `LINKEDIN_CLIENT_SECRET_REFERENCE` was claimed (changeset, doc
   18, the `registry.ts` description) to be validated by `looksLikeRawSecretToken`,
   while `findMissingOrInvalidLinkedInConfig` only checked presence and
   never actually called that heuristic for this var. Fixed
   by MAKING THE CLAIM TRUE (adding a direct shape check
   in `findMissingOrInvalidLinkedInConfig`, reusing `looksLikeRawSecretToken`
   on its reference string, WITHOUT going through `resolveLinkedInSecretReference`
   because this var is never actually resolved by any code) —
   rather than weakening the documentation, because the check is cheap and catches a
   real operator mistake (pasting the real client secret into this var).
4. **Low** — the `providerKey` description added by this issue was cut off
   mid-sentence in the generated OpenAPI bundle/`api-reference.md`
   (stopping exactly at "...(Issue"). Root cause: `# ` (a space then a hash)
   inside an unquoted YAML PLAIN SCALAR starts a YAML COMMENT —
   the `yaml` package's parser is spec-correct here, this is not a bundler bug.
   `"(Issue #645, ..."` has a space before `#645`; the SAFE pattern already
   used on the SAME line is `"(#644/#645/#646)"` (the hash attached directly
   to the opening parenthesis, with no space). Fixed by following that
   safe pattern: `"(#645, LinkedIn organization pages; ...)"`. **A note
   for the whole repo**: the pattern " #NNN" (space + hash + digits) anywhere
   inside an unquoted YAML PLAIN SCALAR string risks silently
   truncating — not yet audited across the other files in `openapi/`/`asyncapi/`,
   recorded as a new finding to watch out for, not fixed outside
   this issue's scope.

### CONFLICT RISK with #644/#646 (worked on in parallel)

Three agents worked on #644 (Meta), #645 (this LinkedIn one), #646 (Telegram)
SIMULTANEOUSLY in separate worktrees. Shared touch points:

- `social-provider-registry.ts` — touched ONLY additively: there is no
  `registerSocialProviderAdapter` call INSIDE this file (it stays
  empty per the #643 design), and it is not restructured.
- `scripts/social-publish-dispatch.ts` and `scripts/security-readiness.ts`
  — each gets ONE import + ONE line calling this provider's own
  registration function (`registerLinkedInProviderAdapterIfEnabled`)
  inside `main()`. #644/#646 are expected to add the SAME pattern (import +
  a call to THEIR own registration function) — not to change another
  provider's lines. See the comment at each script's call site
  for this convention.
- `src/lib/config/registry.ts`, `.env.example`, doc 18, `scripts/
validate-env.ts`'s `runEnvValidation`, `scripts/security-readiness.ts`'s
  `runSecurityReadinessChecks` — each provider adds its OWN
  entries/lines, without touching another provider's lines.
- This `SKILL.md` itself (status table + a new section per provider) and
  the generated `docs/awcms/repo-inventory.md`/i18n — the standard merge-
  conflict pattern of this epic (see
  [[news-portal-social-publishing-epic-progress]]): resolve by
  MERGING both sides, do not pick one.

There is no new migration for this issue (see the design rationale below) —
removing one more conflict point than originally estimated.

### Why there is NO new migration

The "Account metadata" fields in the issue body (`organization_urn`,
`organization_name`, `member_role`, `permissions_json`, `token_expires_at`,
`last_verified_at`) map ENTIRELY onto the generic columns that already exist on
`awcms_social_accounts` (Issue #643) WITHOUT new columns:

- `organization_urn` -> `provider_account_id` (already exists).
- `organization_name` -> `provider_account_name` (already exists).
- `token_expires_at` -> `expires_at` (already exists).
- `last_verified_at` -> already exists, no new field touches it.
- `member_role` and `permissions_json` are **DELIBERATELY NOT PERSISTED** —
  a member's LinkedIn organization role can change or be revoked on
  LinkedIn's side without notifying this application; storing a stale snapshot could
  give a false sense of safety. This adapter checks the role LIVE (calling
  `organizationAcls`, mocked in tests) on EVERY publish attempt
  (`publish()`) — not only once at connect time — enforcing this issue's
  "require supported permission and organization role" requirement
  literally. `verifyCredentials()` also performs a scope check
  (from `scopesJson`, a parameter that ALREADY exists in the interface) and a
  token validity check (a live call to `/v2/userinfo`, LinkedIn's OpenID
  Connect endpoint), separate from the role check (which needs the organization
  URN — a parameter that does NOT exist in the `verifyCredentials` signature,
  so it becomes `publish()`'s responsibility, not `verifyCredentials()`'s).

### Why there is NO interactive OAuth authorize/callback flow

Unlike `google-oauth-client.ts` (a real redirect flow, with a
`/callback` route), this adapter does NOT build a LinkedIn OAuth redirect. Two
reasons: (1) `token_reference` must never be a raw token
(`looksLikeRawSecretToken` rejects it) — a real OAuth callback would
receive the real token from LinkedIn, and this repo does not yet have a real
secret-manager integration to turn it into a safe reference; (2) the
foundation connect flow (`POST /api/v1/social-publishing/accounts`) is already generic
and manual/operator-driven for ALL providers — LinkedIn is not
an exception. `LINKEDIN_CLIENT_ID`/`LINKEDIN_CLIENT_SECRET_REFERENCE`/
`LINKEDIN_OAUTH_REDIRECT_URI` are still REAL and mandatory configuration
(validated by `config:validate`/`security:readiness`) — they describe
the LinkedIn App the operator registers manually in the LinkedIn Developer
portal (a LinkedIn app-review requirement), not something used for a real redirect in
this code. Full details in `linkedin-provider-config.ts`'s header comment.

### Reuse `looksLikeRawSecretToken` — NO new heuristic

Per this issue's security instructions: `resolveLinkedInSecretReference`
(`linkedin-provider-config.ts`) calls `looksLikeRawSecretToken` FROM
`social-account-validation.ts` verbatim (rather than duplicating its
heuristic) to validate BOTH `LINKEDIN_CLIENT_SECRET_REFERENCE`
and every account `token_reference` before resolution. Resolution itself
only understands the `env:VAR_NAME` convention (the only one that can actually
be resolved without a real secret-manager integration) — other prefixes
(`secretsmanager:`/`vault:`/etc.) pass the shape check but are reported
`"unresolvable"`, honest about this repo's limitation.

### API version header + Rest.li protocol

Every HTTP call to LinkedIn (`checkOrganizationRole`,
`uploadOrganizationImage`, post creation, `verifyCredentials`) sends
`LinkedIn-Version` (from `LINKEDIN_API_VERSION`, format "YYYYMM", validated by
`isValidLinkedInApiVersion`) and `X-Restli-Protocol-Version: 2.0.0`
(a fixed constant, not config — this is the Rest.li wire protocol version, a different
concept from the API version).

### Images — LinkedIn's real Images API, gated by an R2 trust check

`content.imageUrl` (already guaranteed to come from a verified R2 object via
`create-social-publish-jobs.ts`'s `NewsMediaPort.resolveMediaReferences`)
is checked AGAIN (defense-in-depth, `isTrustedR2MediaUrl`, comparing
against `NEWS_MEDIA_R2_PUBLIC_BASE_URL` — a deliberate and narrow
cross-module import, the same pattern as Key decision #6's "Special note"
above) before the adapter runs LinkedIn's real image upload flow
(`initializeUpload` -> fetch bytes -> `PUT`) and posts it as
`content.media`. An untrusted/missing image, or ANY failure
during upload, degrades gracefully to a link-share post
(`content.article`, `source: canonicalUrl`) — the image is non-essential
and must never block a legitimate publish.

### Idempotency & redaction

`idempotencyKey` (from `job.id`, already guaranteed idempotent at DB level by
Key decision #8) is forwarded as an `X-Idempotency-Key` header to
LinkedIn (best-effort — LinkedIn does not document an official
idempotency mechanism for the Posts API as far as is known; the REAL idempotency
guarantee still comes from #643's own outbox mechanism: a job already `published`
is never dispatched again). Every error message that might
include the token is redacted via literal substring replacement (`redact()`,
not a shape heuristic) using the bearer token that is ALREADY known
exactly within that call's scope — more reliable than a heuristic
because the secret value is known for certain, not guessed.

### No new "verify connection" admin endpoint

`verify_linkedin_connection` (one of the 3 "Supported initial
actions" in the issue body) is fully implemented as the
`verifyCredentials()` function (tested directly via unit tests), BUT is NOT exposed
through a new HTTP endpoint — this issue's acceptance criteria never asked for
a tenant admin to be able to TRIGGER verification manually (only connect/disconnect
were explicitly requested, and those are already served by the generic endpoints that exist since
#643). It removes one extra registration point (the SSR request path) that
would otherwise require wiring adapter registration into the SSR server process too,
on top of the 2 existing scripts — recorded as a deliberate scope
decision, not an oversight, should a follow-on issue need this endpoint.

### Files created/changed

- `src/modules/social-publishing/domain/linkedin-provider-config.ts`
  (new).
- `src/modules/social-publishing/infrastructure/linkedin-provider-adapter.ts`
  (new) — `createLinkedInProviderAdapter`,
  `registerLinkedInProviderAdapterIfEnabled`, `isTrustedR2MediaUrl`.
- `scripts/social-publish-dispatch.ts`,
  `scripts/security-readiness.ts` (registration + `checkLinkedInProviderReadiness`),
  `scripts/validate-env.ts` (`checkLinkedInProviderConfig`).
- `src/lib/config/registry.ts`, `.env.example`, doc 18 (6 new
  `LINKEDIN_*` vars).
- `openapi/modules/social-publishing.openapi.yaml` (a
  `linkedin_organization` example in the account schema, not a new endpoint — this
  issue introduces no new HTTP endpoint).
- No new migration, no AsyncAPI change (no new domain
  event — the generic outbox events from #643 already cover publish/fail/
  retry/reauth for any provider including LinkedIn).
- Tests: `tests/unit/linkedin-provider-config.test.ts`,
  `tests/unit/linkedin-provider-adapter.test.ts`.
- Changeset: `.changeset/social-publishing-linkedin-adapter-issue-645.md`.

## §646 — Telegram channel adapter (Done)

The first REAL provider adapter in this epic. `provider_key`
`telegram_channel`. Registration via
`infrastructure/telegram-provider-registration.ts` (side-effect import,
composition root — it does NOT change the contents of `social-provider-registry.ts` at
all, it only calls the already-exported
`registerSocialProviderAdapter`).

### Key decision #1 — the `verifyCredentials` interface was widened with `providerAccountId`

The #643 interface (`domain/social-provider-adapter.ts`) was originally
`verifyCredentials(tokenReference, scopesJson, env?)` — not enough for
Telegram (and most likely for Meta/LinkedIn as well): a bot token can be
VALID yet have no access to the SPECIFIC CHANNEL being verified.
Widened to `verifyCredentials(tokenReference, providerAccountId,
scopesJson, env?)` — a safe/non-breaking change because there was NOT a
single real caller before this issue (foundation #643 deliberately had zero real
adapters). `SocialProviderCredentialCheck` also gained an optional field
`details?: Record<string, unknown>` (provider-specific display info,
e.g. Telegram's `botUsername`/`permissions`) — additive, not breaking.
**Attention for #644/#645**: if you started from a snapshot
before this PR merged, rebase and adjust your own `verifyCredentials`
signature to this new shape.

### Key decision #2 — a NEW `POST /accounts/{id}/verify` endpoint, provider-neutral, not Telegram-specific

Foundation #643 itself already anticipated this in the
`verifyCredentials` comment ("a manual 'verify connection' admin action") but
there was no HTTP endpoint for it. Added here
(`pages/api/v1/social-publishing/accounts/[id]/verify.ts`) as a
GENERIC capability — it calls the `adapter.verifyCredentials(...)` of
whichever provider is registered, not a Telegram-specific route. A new
permission `social_publishing.accounts.verify` (migration 054) — reusing the
`verify` action that ALREADY EXISTS in the `AccessAction` union (`identity-access/domain/
access-control.ts`, from `tenant_domain.domains.verify` migration 032),
NOT a new action. It is not in `HIGH_RISK_ACTIONS` (the same reason as
`domains.verify`: it only changes `lastVerifiedAt`/`scopes_json`, never
`tokenReference`) BUT `Idempotency-Key` is still mandatory (a real outbound
call to the provider, the same risk class as `accounts.connect`/`.disconnect`).

This endpoint is 3-phase (CLAIM-like), mirroring the dispatcher pattern in
`social-publish-dispatch.ts` exactly: (1) transaction — authorize + idempotency
check + fetch account/credentials; (2) OUTSIDE the transaction — the real
provider call (`adapter.verifyCredentials`); (3) transaction — record the result

- store the idempotency record. **This pattern must be preserved** when
  adding another endpoint that calls a provider (ADR-0006) — do not
  fold phase 2 into any `withTenant`.

A FAILED verification is still `200 { valid: false, reason }` — not an HTTP error,
and it does NOT change `connectionStatus`/`autoPublishEnabled` (informational,
so the admin can fix the channel permission and try again). Only a REAL
publish attempt via the dispatcher can trigger `needs_reauth` (the existing,
separate #643 mechanism).

**Verification is NOT hard-gated** into the existing connect/enable auto-publish
endpoints (`POST /accounts`, `PATCH /accounts/{id}`) — that would
change the behaviour of ALL providers (not just Telegram) and risk
breaking existing #643 tests (connect-then-enable-immediately without
verify). Instead, "verifies bot can post to channel before
enabling auto posting" is enforced as a READINESS SIGNAL
(`checkTelegramProviderReadiness`, §4 below) — the operator must verify
manually before go-live, rather than a runtime gate that blocks the API.

### Key decision #3 — parse-mode sanitization: plain text by default, single-pass escaping

`domain/telegram-message-formatting.ts`. By default `TELEGRAM_DEFAULT_PARSE_MODE`
is unset → `parse_mode` is NEVER sent at all → Telegram
treats the ENTIRE text as literal, with zero chance of any formatting
being interpreted (a user-authored title/excerpt may contain double
asterisks `**`, underscores `_..._`, or Markdown link notation with square
brackets then parentheses — all of it stays literal). If the operator explicitly
sets `MarkdownV2`/`HTML` (legacy `Markdown` is DELIBERATELY unsupported), every
interpolated field (title, excerpt, canonical URL) is escaped via
`escapeTelegramMarkdownV2`/`escapeTelegramHtml` — **a single regex
pass over the original string**, NOT several sequential `.replace()` calls. This
matters: the MarkdownV2 escaper puts the backslash character itself into
the escaped character class (not just `_*[]()~\`>#+-=|{}.!`) —
otherwise a real backslash in the input could "lock onto" the
backslash we have just inserted so that the following character escapes
being escaped (exactly the `mdescape-backslash-bug-recurs` bug pattern that has already
appeared 3 times in another repo — see the related personal memory). It NEVER
builds Markdown-style inline links from user data — the canonical URL is
always a plain escaped text line, left for Telegram to auto-link-detect
by itself; that removes the entire "constructed unexpected
inline link" surface named in the issue's security notes.

Hashtags from article tags (`buildTelegramHashtags`) are implemented and
tested standalone BUT **not actually used yet** — the outbox job snapshot
(`awcms_social_publish_jobs`, migration 053) has no tag-name column
at all; adding one would mean changing the generic cross-provider
snapshot, outside the atomic scope of this adapter issue. `publish()` calls
`buildTelegramMessageText(content, [], parseMode)` — the hashtag array is always
empty today, documented as a follow-up.

### Key decision #4 — bot-token-in-URL: ONE place, `response.url` is never read

The Telegram Bot API puts the token in the URL PATH (`.../bot<TOKEN>/<method>`) —
Telegram itself offers no alternative transport. Mitigations in
`infrastructure/telegram-provider-adapter.ts`:

- The tokenised URL only ever exists in one local scope (`callTelegramApi`),
  used for ONE `fetch()` call, never logged or returned.
- `response.url` (a built-in `fetch()` property reflecting the final URL
  including the token) is NEVER read in this file — a real trap that
  easily slips past ordinary code review.
- Parameters are sent as a JSON POST body, not a query string.
- An error from `error.message` produced by `fetch()`/timeout is NEVER
  interpolated raw into the return value — only the `description`/`error_code`
  obtained by PARSING Telegram's own JSON response (safe, Telegram never
  echoes the token in an error body) is used for the error/audit message.

### Key decision #5 — a new readiness check: `checkTelegramProviderReadiness`

`scripts/security-readiness.ts`, critical, a no-op when
`TELEGRAM_PROVIDER_ENABLED` is not `"true"` — **independent** of
`SOCIAL_PUBLISHING_ENABLED`/`checkSocialPublishingProviderReadiness`
(a deployment can be full-online for Meta/LinkedIn without ever turning on
Telegram). When enabled, it fails if there is a `connected`
`telegram_channel` account with `autoPublishEnabled=true` whose `lastVerifiedAt IS
NULL` — an operational signal for "Adapter verifies bot can post to
channel before enabling auto posting" (see Decision #2 above for why
this is not a hard runtime gate). `checkTelegramProviderConfig`
(`scripts/validate-env.ts`) validates
`TELEGRAM_BOT_TOKEN_SECRET_REFERENCE` (reusing `looksLikeRawSecretToken` —
**DO NOT build a new heuristic**, see the 3-round history of PR #731),
`TELEGRAM_DEFAULT_PARSE_MODE`, `TELEGRAM_REQUEST_TIMEOUT_MS`.

### Required Telegram bot/channel permissions

The bot must be added as an **administrator** of the target channel with the
"Post Messages" permission (`can_post_messages`). `verifyCredentials` calls
`getMe` (bot identity) then `getChatMember` (the bot's status in the target
channel) — failing with reason `missing_channel_permission` if the status
is not `administrator`/`creator`, or `missing_post_permission` if it is an
administrator but `can_post_messages: false`.

### Files created/changed (quick reference)

- `sql/055_awcms_social_publishing_verify_permission.sql` (one
  `accounts.verify` permission).
- `src/modules/social-publishing/domain/social-provider-adapter.ts`
  (`verifyCredentials` +`providerAccountId`, `SocialProviderCredentialCheck` +`details`).
- `src/modules/social-publishing/domain/telegram-config.ts`,
  `telegram-message-formatting.ts` (new).
- `src/modules/social-publishing/infrastructure/telegram-provider-adapter.ts`,
  `telegram-provider-registration.ts` (new).
- `src/modules/social-publishing/application/social-account-directory.ts`
  (`fetchSocialAccountCredentialsForVerification`,
  `recordSocialAccountVerification`).
- `src/pages/api/v1/social-publishing/accounts/[id]/verify.ts` (new).
- `src/modules/social-publishing/module.ts` (`accounts.verify` permission +
  2 new event publishes).
- `scripts/social-publish-dispatch.ts`, `scripts/security-readiness.ts`
  (side-effect import for adapter registration).
- `scripts/validate-env.ts` (`checkTelegramProviderConfig`),
  `scripts/security-readiness.ts` (`checkTelegramProviderReadiness`),
  `src/lib/config/registry.ts`, `.env.example`,
  `18_configuration_env_reference.md`.
- `openapi/modules/social-publishing.openapi.yaml` (`POST
.../accounts/{id}/verify` + `SocialAccountVerifyResult`).
- `asyncapi/awcms-domain-events.asyncapi.yaml`
  (`account.verified`/`account.verification-failed`).
- `src/pages/admin/social-publishing/accounts.astro` (Verify button +
  `lastVerifiedAt` display).
- `i18n/en.po`, `i18n/id.po`, `i18n/messages.pot` (new keys
  `admin.social_publishing.accounts.{field_last_verified,not_verified,
verify_button,verify_success,verify_failed_prefix}`).
- Tests: `tests/unit/telegram-message-formatting.test.ts`,
  `tests/unit/telegram-config.test.ts`,
  `tests/unit/telegram-provider-adapter.test.ts` (a Bun.serve() fake
  `api.telegram.org` — NEVER a real network call); updated
  `tests/integration/social-publishing.integration.test.ts` (the "account
  verify (Issue #646)" block, with a registered fake adapter, NEVER exercising
  the real Telegram HTTP path at this level).
- Changeset: `.changeset/social-publishing-telegram-adapter-issue-646.md`.

### Not yet done / out of scope for this issue (for #647 or follow-up)

- Hashtags from article tags — the function exists (`buildTelegramHashtags`), it is not
  actually used yet (the job snapshot has no tag column).
- `sendPhoto`/R2 image preview — the issue itself explicitly allows
  "initial scope can use safe link post through sendMessage".
- A real secret-manager integration (`resolveTelegramBotToken` only
  supports the `env:VAR_NAME` indirection) — the same residual from #643.
- Auto-requeue/hard-gating verification before enabling auto-publish — deliberately
  a readiness signal, not a runtime gate (see Decision #2).

## §647 — Documentation/SOP (Done)

A pure documentation issue — no new code/migration/endpoint. PR #756
(merged 2026-07-13) adds five new documents under
`docs/awcms/news-portal/` plus an index update in
`docs/awcms/README.md`, closing the `social_publishing` epic (#643-#647)
entirely with architecture, operations, provider-limitation,
and security documentation that was previously scattered across code comments and this skill.

### The five documents added

- **`social-sharing.md`** — documents the **manual social sharing**
  feature (Issue #642, the READER's share buttons, with no credentials or
  external API call) and explicitly distinguishes it from
  **social publishing / auto-posting** — the §1 comparison table stops
  a reader from thinking they are the same system (their modules, credentials, and
  persistence are entirely different).
- **`social-publishing-architecture.md`** — the architecture of the auto-posting system
  itself: the two-flag gate `SOCIAL_PUBLISHING_ENABLED`/
  `SOCIAL_PUBLISHING_PROFILE` (§1), the 6-table data model (§2), and the
  outbox/dispatcher/approval/retry flow — an architecture summary that complements
  (does not replace) the key decisions #643-#646 already detailed
  in this skill.
- **`social-publishing-sop.md`** — an **operator/editorial** guide (not a
  code guide): prerequisites before enabling auto-posting, a per-provider
  setup checklist (Meta/LinkedIn/Telegram) including the OAuth steps
  outside the application, and the permissions each role needs.
- **`social-provider-limitations.md`** — the REAL, actually
  implemented limitations per provider (not plans/aspirations): supported/rejected
  account types, post kinds, the absence of a native idempotency key in the Graph
  API, error message mapping, and which `token_reference` schemes can actually
  be resolved (`env:VAR_NAME` only).
- **`social-publishing-security-checklist.md`** — a security and
  incident-response checklist: token storage (a reference, not the real token), the scope
  of queries allowed to return `token_reference`, and the assertion that
  every example value in the document is a deliberately fake placeholder (e.g.
  `"env:META_APP_SECRET_EXAMPLE"`) — never paste real
  credentials into documentation/tickets/logs.

### Files created/changed (quick reference)

- `docs/awcms/news-portal/social-sharing.md` (new).
- `docs/awcms/news-portal/social-publishing-architecture.md` (new).
- `docs/awcms/news-portal/social-publishing-sop.md` (new).
- `docs/awcms/news-portal/social-provider-limitations.md` (new).
- `docs/awcms/news-portal/social-publishing-security-checklist.md`
  (new).
- `docs/awcms/README.md` (index, links to the five documents above).

The `social_publishing` epic (#643-#647) is now **entirely done** —
see §Status per issue above.
