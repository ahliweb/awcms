---
name: awcms-social-publishing
description: The social_publishing module EXISTS in this repo (Issue #1145, ADR-0157; migrations `sql/330`-`sql/331`) as the account-scoped foundation behind the existing `SocialPublishingPort`: one publication with an immutable content snapshot, ONE JOB PER TARGET `channel_account`, approval, schedule, a `SocialPublishAdapter` interface with a per-provider capability map, and a dispatcher that calls providers outside any transaction. NO real provider adapter ships (connectors are #1146-#1151, each with its own provider approval). Use when adding or changing a provider connector, a publication or job state, the enqueue or dispatch path, the credential path, an endpoint under `/api/v1/social-publishing`, or when wiring the composition roots. States the invariants a connector must not break (a job holds no token, unsupported content is refused not downgraded, `published` is terminal, nothing is rerouted). The awcms-mini epic (#643-#647) is an ARCHIVE specification, not a map of this code.
---

🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](SKILL.id.md)

# AWCMS — Social Publishing (account-scoped publications and jobs)

> **STATUS — implemented foundation, no connector.** `src/modules/social-publishing/`
> exists, is `experimental` and is OFF by default (`SOCIAL_PUBLISHING_ENABLED`).
> It ships with **no provider adapter**: until a connector (#1146 to #1151)
> registers one, enabling the module publishes nothing. The admin screen is not
> built (the nine permissions are on the `NOT_YET_SCREENED` ledger). Read
> [`ADR-0157`](../../../docs/adr/0157-social-publishing-is-an-account-scoped-publication-intent-and-per-account-job-module.md),
> [`docs/awcms/social-publishing.md`](../../../docs/awcms/social-publishing.md) and
> [`src/modules/social-publishing/README.md`](../../../src/modules/social-publishing/README.md)
> first; this skill is the short list of what NOT to break.

## The shape

- **Publication** (`awcms_social_publications`): one logical publication with an
  IMMUTABLE content snapshot (title, caption, link, media snapshot from
  `media_library`, content hash), `state` (`pending_approval`, `ready`,
  `cancelled`, `refused`). The aggregate status is DERIVED from the jobs, never
  stored (`domain/social-publish-retry.ts#deriveAggregateStatus`).
- **Job** (`awcms_social_publish_jobs`): one per (publication, `channel_account`).
  It names the account and holds NO token and NO secret reference.
- **Rules** (`awcms_social_publish_rules`): which accounts an article event
  publishes to. A pointer, never a grant.
- **Ledger** (`awcms_social_publish_attempts`): outcome, a fixed code, a fixed
  phrase. Never a caption, a provider body or a credential.

## Invariants (each is enforced by a test; do not weaken one)

1. **A job never carries a credential, and the worker role must not read one.**
   In this slice the dispatch script is composed with `noPublishCredentialPort`
   (it refuses everything) and holds no key ring: `awcms_worker` shares its role
   and key ring with `whatsapp:dispatch`, so letting it read social tokens would
   let a compromised WhatsApp worker decrypt them (audit H1; `sql/328` stays
   WhatsApp-only). The real `ChannelPublisherCredentialPort` is composed by the
   first connector under a SEPARATE DB role, in memory, in a transaction that
   closes BEFORE the provider call. `tests/whatsapp-sender-routing.test.ts` pins
   the importers of the credential adapter to the WhatsApp script alone.
2. **Fail closed per account.** `ChannelPublisherPort.resolvePublisher` is asked at
   enqueue AND at dispatch: revoked or disabled fails the job, degraded or an
   expired grant HOLDS it (no attempt consumed, bounded), and nothing is ever
   rerouted to another account or provider (ADR-0148 I5).
3. **The capability map is a ceiling, never a grant.** An adapter's
   `SocialPublishCapabilities` can only REFUSE content (`VARIANT_UNSUPPORTED`,
   `MEDIA_TYPE_UNSUPPORTED`, `MEDIA_TOO_LARGE`, `CONTENT_TOO_LONG`). An image is
   never posted as text; a caption is never truncated to fit a provider.
4. **`published` is terminal** (trigger in `sql/330`). A sibling's failure, a
   retry of another job, a replayed pass or a cancel cannot send or rewrite it.
5. **No network in a transaction.** Claim, send and finalise are three phases;
   adapters receive `request.http`, which IS `ssrfSafeFetch`, and no raw `fetch`.
6. **Idempotent by key.** One publication per (article, trigger), one job per
   (publication, account), plus `buildSocialPublishIdempotencyKey`. A repeated
   article event creates nothing for an account that already has a job.
7. **The port never aborts the article.** `onArticlePublished` runs in a
   savepoint and returns `{ jobsCreated: 0 }` on any failure.

## Adding a provider connector (#1146 to #1151)

1. Admit it on its own issue: the provider app approval or audit evidence is a
   BUSINESS step, and the `publish` cell of the provider matrix
   (`channel-accounts/domain/provider-matrix.ts`) must already allow it.
2. Implement `SocialPublishAdapter` (`domain/social-publish-adapter.ts`): a
   `provider` key as in the matrix, a truthful `capabilities` map, and a
   closed `errorCodes` vocabulary (a code outside it is never written to a row),
   and a `publish()` that returns an OUTCOME (`published`, `retryable`, `rate_limited`,
   `needs_reauth`, `rejected`) instead of throwing for an ordinary provider
   answer. Use `request.http` only; pass `request.idempotencyKey` to the provider
   where it has one; never log, return or store `request.credential`.
3. Register it from `scripts/social-publishing-dispatch.ts#registerSocialAdapters`
   AND from the process that serves the API, so enqueue sees the same registry.
4. If the provider's token purpose is not `provider_access_token`, `api_token` or
   `device_key`, the role cannot see
   the secret: that needs its own reviewed migration (a Telegram connector does).
5. Declare `supportsIdempotencyKey` truthfully and return `unknown` (never
   `retryable`) when the request may have been processed: without a dedupe key
   the job then waits for an operator instead of publishing twice. `request.http`
   follows NO redirect and is cancelled by `request.signal`.
6. Test against `tests/support/fake-social-publish-adapter.ts` for the contract
   and add the provider's own tests; the fake is never imported from `src/`.

## Files

| Concern                  | Where                                                                                                           |
| ------------------------ | --------------------------------------------------------------------------------------------------------------- |
| Descriptor, permissions  | `src/modules/social-publishing/module.ts`, `sql/331`                                                            |
| Schema, triggers, RLS    | `sql/330`                                                                                                       |
| Content and support rule | `src/modules/social-publishing/domain/social-publish-content.ts`                                                |
| Enqueue                  | `src/modules/social-publishing/application/publication-enqueue.ts`                                              |
| Dispatch                 | `src/modules/social-publishing/application/social-publish-dispatch.ts`, `scripts/social-publishing-dispatch.ts` |
| Article path             | `src/modules/social-publishing/application/social-publishing-port-adapter.ts`                                   |
| Routes                   | `src/pages/api/v1/social-publishing/`, `openapi/modules/social-publishing.openapi.yaml`                         |
| Events                   | `asyncapi/awcms-domain-events.asyncapi.yaml` (four `awcms.social_publishing.*`)                                 |
| Tests                    | `tests/social-publishing*.test.ts`, `tests/integration/social-publishing.integration.test.ts`                   |

## Archive note

The earlier `social_publishing` epic (#643 to #647) lives in `awcms-mini`, an
ARCHIVE: its own account table and `token_reference` strings
(`awcms-mini:src/modules/social-publishing/application/social-account-directory.ts`),
its Meta, LinkedIn and Telegram adapters
(`awcms-mini:src/modules/social-publishing/infrastructure/`) and its caption
templates were NOT carried over (ADR-0055: nothing is ported from there). Read it
as a specification of what a connector will have to handle, never as code to
copy: here an account is a `channel_accounts` row and a credential is a
`channel_accounts` secret.
