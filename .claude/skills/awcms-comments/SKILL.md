---
name: awcms-comments
description: The comments module HAS ALREADY been ported into this repo (from awcms-micro Issue #271 / ADR-0032, here ADR-0041; migrations `sql/066` schema + `sql/067` permissions, Wave-1 of `docs/awcms/absorb-awcms-micro-roadmap.md`). Moderation-first per-tenant comments on PUBLISHED & public resources — `type: domain`, deps `[tenant_admin, identity_access, module_management, profile_identity, domain_event_runtime]` (the last three added in #251 — they were already imported without being declared), 7 `awcms_comments_*` tables with ENABLE+FORCE RLS, the `commentableResources` contribution seam (`MODULE_CONTRACT_VERSION` 2.3.0), 10 `/api/v1/comments/*` routes (6 of them PUBLIC and unauthenticated), the `/admin/comments` admin screen, the `bun run comments:retention` job, and the `bun run comments:resources:check` gate. Use when adding a resource type that may be commented on, changing policy/moderation/anti-abuse, or working on follow-ups (the reply-notification dispatcher, the public form component, Turnstile enforcement). WARNING: this is a public unauthenticated WRITE surface — read §Security spine before touching anything.
---

🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](SKILL.id.md)

# AWCMS — Comments (moderation-first)

Follow `src/modules/comments/README.md` and
[ADR-0041](../../../docs/adr/0041-comments-module-admission.md). This module
**exists and can be called** in this repo.

## The first thing you must understand

This is a **public, unauthenticated WRITE surface**. Six of the ten routes
have no session at all, and that is **deliberate** (an article reader who leaves
a comment genuinely has no account). What holds it back is not authentication, so
before changing anything on the public path, ask: _what stops an anonymous
stranger from using this to store markup, enumerate unpublished content,
or flood the queue?_

Those six public operations are listed explicitly in `ALLOWED_PUBLIC_OPERATIONS`
(`scripts/api-spec-check.ts`) together with their justification. **Adding a seventh
public operation will turn `api:spec:check` red** until you write the justification there —
that is a deliberate review gate, not an annoyance.

## Direction of the arrow: DO NOT invert it

`comments` depends on **Core only**. It **never** imports a content
module.

Content modules **DECLARE** which resources may be commented on via
`ModuleDescriptor.commentableResources` — pure data (the reviewed table/column names

- a declarative `publicationFilter`). `comments` discovers them via
  `listModules()`.

**Adding a new resource type = one declaration in that module's own `module.ts`,
zero changes in `src/modules/comments/`.** If you find yourself needing to
edit `comments` to support a new content type, stop — you are most
likely inverting the arrow.

Do not use a `provides` capability: multiple providers are expected here, and the
second one would trip `capability_provider_conflict`.

`src/modules/comments/presentation/commentable-resources.ts` is the composition root — the only
place allowed to call `listModules()`. Everything in `domain/` and
`application/` receives descriptors as **parameters**.

## Security spine (do not regress)

1. **Publication boundary.** Comments are only accepted/displayed against a resource
   that passes the `publicationFilter` of its owning module. The comment surface
   is **never** an authorization source for the resource underneath it.
2. **Store plain text, escape at render.** A body is **never** stored
   as HTML. Do not be tempted to add "just a little allowed markup" — the moment
   there is a sanitizer allow-list, the stored-XSS bug class is open again. Autolink
   http(s) only, with href and visible text both escaped.
3. **No oracle.** The public submit response is **uniform**. If you add an error
   code that distinguishes "blocked by a blocked-term" from "accepted, awaiting
   moderation", you have just built a blocked-term enumerator. Author-bound
   operations return **404, not 403**.
4. **Fail-closed anti-abuse.** With the time floor active, a missing measurement
   counts as `too_fast`. Flipping that into "allow when there is no token" makes
   the entire time floor bypassable by deleting one field.
5. **PII minimised.** The author's email is only sha256 + mask. IP/user-agent are only
   a tenant-salted hash. **Never** add a column that stores the raw
   address.
6. **RLS.** All seven tables are `ENABLE` **and** `FORCE`. A new table must have both.

## Traps already found (do not repeat them)

- **Keyset cursor.** Both list paths use a full-precision TEXT cursor
  (`to_char(... 'YYYY-MM-DD"T"HH24:MI:SS.US"+00:00"')`) + a `(created_at, id)`
  tiebreak. `timestamptz` has microsecond precision, JS `Date` milliseconds,
  the driver FLOORs — a `Date`-based cursor skips every row that shares the same
  millisecond. Do not "simplify" it back to `Date`.
- **`published_at` is never cleared.** It is only set on approve
  (`coalesce`). awcms-micro NULLed it on every non-approve transition, which
  erases the trace that an archived comment was ever published.
- **Worker grants.** Adding `GRANT ... TO awcms_worker` in a comments migration
  **must** be followed by an identical entry in `WORKER_ROLE_GRANTS`
  (`scripts/security-readiness.ts`). There is a test that reads the migration text and
  compares them — it has been proven red. The worker **must not** have
  DELETE/INSERT on `awcms_comments_comments`: retention anonymises in
  place, and the append-only moderation history must keep pointing at real rows.
- **The twin `blog_content` descriptors.** `searchSources` and
  `commentableResources` declare **exactly the same** `publicationFilter`.
  There is a test that enforces it (proven red when drifted).
  If you change one, change both.
- **Navigation `labelKey` is now RENDERED.** The admin sidebar is built from
  `listModules()` via `module-management/domain/sidebar-menu.ts`; there is no
  static list left to keep in sync. `admin.layout.nav_comments` is resolved
  via `SIDEBAR_LABELS`. `group: "content"` was dropped from the descriptor because
  `DEFAULT_MODULE_TYPE` places `comments` in `engagement` and that map
  wins — a value that never takes effect is worse than no value.

## Commands

```bash
bun run comments:resources:check   # registry gate (part of `bun run check`), pure, no DB
bun run comments:retention         # anonymize sweep + purge of unconfirmed subscriptions
```

## Not there yet (do not claim it is)

- **The reply-notification dispatcher.** The events are published
  (`awcms.comments.reply.created`, `awcms.comments.comment.approved`); the email
  consumer that resolves the encrypted recipient and sends **has not been
  written**.
- **The public comment form component.** The API is complete; the `src/components/ui/`
  library does not exist yet (a Wave-0 roadmap line that is still open).
- **Turnstile enforcement.** `turnstileEnabled` is stored in settings but is
  **not** called on the submit path yet. When it is wired up, its verification must happen
  OUTSIDE the DB transaction (ADR-0006).

## Related skills

`awcms-new-endpoint`, `awcms-abac-guard`, `awcms-idempotency`,
`awcms-audit-log`, `awcms-sensitive-data` (hash/mask an identifier),
`awcms-new-migration` (worker grants + RLS FORCE), `awcms-data-lifecycle`
(this module's three retention descriptors), `awcms-site-search` (the precedent for the
same descriptor seam), `awcms-blog-content` (the first descriptor provider).
