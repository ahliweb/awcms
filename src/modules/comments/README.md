🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](README.id.md)

# comments

Tenant-scoped, **moderation-first** commenting over **published, public**
resources. Admitted by
[ADR-0041](../../../docs/adr/0041-comments-module-admission.md), ported from
awcms-micro Issue #271 as a Wave-1 row of
[`docs/awcms/absorb-awcms-micro-roadmap.md`](../../../docs/awcms/absorb-awcms-micro-roadmap.md).

## The one thing to understand first

This is an **unauthenticated public WRITE surface**. That single fact drives
almost every design decision here, and it is why the security notes below are
not boilerplate. If you change anything in this module, the question to keep
asking is: _what stops an anonymous stranger from using this to store markup,
enumerate unpublished content, or flood the queue?_

## Direction of the arrow

`comments` depends on **Core only** (`tenant_admin`, `identity_access`). It
never imports a content module.

Content modules DECLARE which of their resources may be commented on, via
`ModuleDescriptor.commentableResources` — pure data: reviewed table and column
names plus a declarative `publicationFilter`. `comments` discovers them through
`listModules()`, so a new commentable content type is one declaration in that
module's own `module.ts` and zero changes here.

It is a descriptor list rather than a capability `provides` because many content
modules are expected to want comments, and a second provider would trip
`capability_provider_conflict`.

`src/lib/comments/commentable-resources.ts` is the composition root — the one
place allowed to call `listModules()`. Everything under `domain/` and
`application/` takes descriptors as a parameter, which is also what lets the
engine be driven from a fixture registry in tests.

## Security spine

1. **Publication boundary.** A comment is only ever accepted against, or shown
   on, a resource that satisfies its owning module's `publicationFilter`. A
   draft, private, soft-deleted, or scheduled-but-not-yet-live resource neither
   receives nor exposes comments. The comment surface is **never** an
   authorization source for the resource underneath it.
2. **No stored XSS, by construction.** Bodies are stored as **raw plain text**,
   never HTML. At render time every character is escaped first, and only then
   are bare http(s) URLs autolinked, with the URL escaped in both `href` and
   visible text plus `rel="nofollow ugc noopener noreferrer"`. There is no
   sanitizer allow-list to get wrong and no path by which a stored comment
   reaches a browser as markup.
3. **No oracle.** Public submit responses are uniform: an unresolved resource, a
   disabled module, an anti-abuse block, and an accepted-but-pending comment all
   return `{"status":"received"}`. Author-bound operations return **404, not
   403**, so they cannot confirm another author's comment exists.
4. **Server-side anti-abuse.** Honeypot, HMAC-signed submit-timing floor,
   length and link bounds, per-tenant blocked terms, duplicate fingerprint, and
   per-IP rate limits. All fail closed: with a timing floor configured, a
   missing measurement counts as too fast, so stripping the token is not a
   bypass.
5. **Minimized PII.** Author email is stored only as a sha256 hash plus a masked
   form, never raw. IP and user-agent are tenant-salted hashes. Subscription
   addresses are AES-256-GCM encrypted under their own key; with no key
   configured, an unresolvable sentinel is stored rather than plaintext.
6. **Tenant isolation.** All seven tables carry `ENABLE` **and** `FORCE` RLS.
   `ENABLE` alone is inert while the app connects as table owner.

## Layout

| Path                                         | What lives there                                                     |
| -------------------------------------------- | -------------------------------------------------------------------- |
| `domain/comment-sanitization.ts`             | The escape-then-autolink renderer. The security spine.               |
| `domain/comment-policy.ts`                   | Accept/reject plus initial status, from policy mode and author kind. |
| `domain/comment-status.ts`                   | The moderation state machine and its legal transitions.              |
| `domain/comment-thread.ts`                   | Bounded-depth tree builder, hard cap 4.                              |
| `domain/comment-settings.ts`                 | Shape, defaults, validation. Bounds mirror the sql/066 CHECKs.       |
| `domain/anti-abuse.ts`                       | Honeypot, timing floor, blocked terms, duplicate fingerprint.        |
| `domain/timing-token.ts`                     | HMAC-signed render-time token.                                       |
| `domain/subscriber-crypto.ts`                | AES-256-GCM for notification recipients.                             |
| `domain/commentable-resource-registry.ts`    | Aggregate + validate the contributed descriptors.                    |
| `application/commentable-resource-engine.ts` | Parameterized publication query; URL resolution.                     |
| `application/comment-service.ts`             | Submit, list, edit, report, delete-request.                          |
| `application/comment-moderation.ts`          | Queue and the moderator transitions.                                 |
| `application/comment-retention.ts`           | Anonymization sweep and unconfirmed-subscription purge.              |

## Operations

- `bun run comments:resources:check` — registry gate, part of `bun run check`.
  Pure, no database. It runs BEFORE any SQL is built, which is the point: the
  engine interpolates descriptor-declared identifiers.
- `bun run comments:retention` — scheduled sweep. Anonymizes author identity on
  aged comments **in place** (never deletes: the append-only moderation history
  must keep pointing at a row), appends an `anonymize` moderation event, and
  deletes unconfirmed reply subscriptions. Skips any tenant under an active
  legal hold on `comments.comments`.

## Configuration

Both secrets are optional and both degrade safely, which is why
`security:readiness` reports them as warnings rather than critical findings —
see `.env.example` for the full text.

- `COMMENTS_SUBSCRIBER_ENCRYPTION_KEY` — 32 bytes base64. Unset means
  reply notifications cannot be sent; no plaintext address is ever written.
- `COMMENTS_TIMING_SECRET` — unset means a per-process random key, so tokens do
  not survive a restart and the visitor is asked to resubmit.
- `COMMENTS_RETENTION_DAYS` — default 365.

## Follow-up, deliberately not in this port

- **Reply-notification dispatcher.** The events are published
  (`awcms.comments.reply.created`, `awcms.comments.comment.approved`); the
  email consumer that resolves the encrypted recipient and sends is not written
  yet. Comments work fully without it.
- **Public comment form component.** The API is complete; this base has no
  `src/components/ui/` library yet (an open Wave-0 roadmap row), and a
  theme supplies its own form.
- **Turnstile on the comment form.** `turnstileEnabled` exists in settings and
  is honoured by the schema, but the verification call is not yet wired into the
  submit path. It must run OUTSIDE the database transaction when it is
  (ADR-0006).
