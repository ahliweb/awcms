🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](0041-comments-module-admission.id.md)

# ADR-0041 — Admission of `comments` (Official Optional Module): moderation-first comments on published resources through a commentable-resource descriptor, DAG-safe inward

- **Status:** Accepted
- **Date:** 2026-07-25
- **Decision makers:** @ahliweb
- **Adapts:** awcms-micro `src/modules/comments/` + ADR-0032 (issue #271, epic #261 Wave 2; in awcms-micro the migration is numbered 089 — that repo's numbering, not this one's) onto the `awcms` base. Here the schema lands in `sql/066` and the permission seed in `sql/067`.
- **Related:** ADR-0040 (`site_search` — the DIRECT precedent for the descriptor-list seam and the `:tenantCode` adaptation), ADR-0038/0039 (`seo_distribution` — the INWARD contribution precedent), ADR-0037 (`data_lifecycle`, three of this module's tables are registered there), ADR-0013 §1/§6 (a module does not write to another module's tables), ADR-0009 (tenant-scoped public routes based on `tenantCode`), ADR-0006 (external providers outside the transaction), ADR-0035 (the awcms-micro absorption programme), [`docs/awcms/absorb-awcms-micro-roadmap.md`](../awcms/absorb-awcms-micro-roadmap.md) §Wave 1.

## Context

This base has public content (`blog_content`, routes `/blog/{tenantCode}/*`) but **no return path from the reader**. Every public site eventually needs one, and if that need is met ad hoc per content module, each module will grow its own comment table, moderation queue, and anti-abuse rules — exactly the cross-module drift that ADR-0036 (media) and ADR-0038 (SEO) reversed.

What distinguishes comments from `site_search`: **comments are an unauthenticated public WRITE surface**. That shifts the design question from "who owns the index" to "what holds an anonymous write surface back from becoming a stored-XSS vector, an oracle for unpublished content, or a spam channel". The decisions that must bind **before** any code: who owns a comment, which way the dependency flows, through which seam a content module declares its resources commentable, and what its security backbone is.

Grounding facts that already exist and are **not** rewritten by this module:

- `blog_content` already has a single "public + published" predicate, and since ADR-0040 already **declares it as data** through `searchSources`. `comments` consumes the same predicate through a similar seam, rather than modelling it again.
- `tenant_domain` (#219) resolves the tenant from the host for public routes; `site_search` already uses that pattern (`withSiteSearchTenant`).
- `data_lifecycle` (ADR-0037) already provides a generic purge engine + non-bypassable legal hold.
- `domain_event_runtime` already provides a transactional outbox, so reply notifications do not need to call a provider inside the transaction (ADR-0006).

## Decision

We admit **`comments`** as an **Official Optional Module** (a generic product feature across website domains, opt-in per tenant), **moderation-first by default**, and realise its collaboration through a **commentable-resource contribution contract** — not cross-module imports, not direct writes into another module's tables.

The ownership direction is the same as ADR-0040: **the content module is the descriptor PROVIDER; `comments` is the CONSUMER/aggregator.** No module is made to depend on `comments`, and `comments` depends only on Core — the graph stays DAG-safe.

### 1. Admission parameters

| Parameter                | Value                                                                                                                                         |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Name                     | Comments                                                                                                                                      |
| `key`                    | `comments`                                                                                                                                    |
| Category                 | **Official Optional Module** — a generic public-site need across verticals, opt-in per tenant                                                 |
| `type` in code           | `domain` (the same as `blog_content`/`seo_distribution`/`site_search`)                                                                        |
| `isCore`                 | no                                                                                                                                            |
| `status`                 | `active` — the descriptor + runtime code land together                                                                                        |
| Lifecycle `dependencies` | `["tenant_admin", "identity_access"]` **only**                                                                                                |
| Resource contribution    | descriptor-list `ModuleDescriptor.commentableResources` (§3) — **not** a `provides` capability (>1 provider = `capability_provider_conflict`) |
| Compatibility class      | Storage + moderation are pure DB = **offline-lan-safe**; reply notifications need an email provider = **clean degradation when unconfigured** |

### 2. Dependency direction — why the arrow points INWARD

| Module         | Role relative to `comments`                               | Lifecycle `dependencies`              |
| -------------- | --------------------------------------------------------- | ------------------------------------- |
| `blog_content` | **provider** of a commentable resource (`blog_post`)      | unchanged                             |
| `news_portal`  | composes posts, not a standalone resource                 | unchanged                             |
| `email`        | consumer of the reply event (follow-up), not a dependency | unchanged                             |
| `comments`     | **consumer/aggregator** (owns threads + comments)         | `["tenant_admin", "identity_access"]` |

**The locked invariant:** no module names `comments` in its `dependencies` or `consumes`. If the direction were reversed — `comments` importing every content module — the aggregator would drag a dependency into every content module that follows.

### 3. The seam: `commentableResources`, not a capability

`MODULE_CONTRACT_VERSION` goes `2.2.0` → **`2.3.0`** (an additive optional field). Its shape is identical to `searchSources`, and for the same reason: **many** content modules will want to accept comments, and a second provider would trip `capability_provider_conflict`.

The descriptor is **pure data** — reviewed table/column names plus a declarative `publicationFilter`. No function reference crosses the seam. The `comments` engine builds a parameterised publication query: filter **values** are always bound parameters, only **identifiers** are interpolated, and every identifier is re-validated with `assertSafeIdentifier`/`assertSafeTableName` **immediately before** interpolation. The registry gate (`bun run comments:resources:check`) and that second validation are deliberately redundant: the gate proves the committed registry is clean, the second validation proves the string that reaches `tx.unsafe` is clean — no matter how it got there.

### 4. Email through an event, not a dependency (ADR-0006)

A reply notification is published as a domain event into the `domain_event_runtime` outbox (same commit). The payload **never** carries the recipient address — only an opaque id. The email dispatcher resolves the encrypted address at send time, **outside** the DB transaction. As a consequence `comments` has no dependency on `email`, and a deployment without an email provider still works fully for comments themselves.

### 5. The security backbone

This is an unauthenticated public write surface, so the controls are stated explicitly:

1. **The publication boundary.** A comment is only accepted/displayed against a resource that passes the owning module's `publicationFilter`. A draft/private/deleted/scheduled resource never accepts nor exposes comments. **The comment surface is never an authorization source** for the resource beneath it.
2. **Stored-XSS-proof by construction.** The body is stored as **raw plain text**, never HTML. At render time **every** character is escaped first, and only then are bare http(s) URLs autolinked with an equally escaped href and visible text plus `rel="nofollow ugc noopener noreferrer"`. There is no allow-list sanitizer that can be wrong, and there is no path by which a stored comment reaches the browser as markup.
3. **No oracle.** The public submit response is **uniform**: an unresolvable resource, a disabled module, an anti-abuse block, and a comment accepted-but-held all return `{"status":"received"}`. Only a comment that is immediately public reveals its id. Author-bound operations (edit, delete-request) return **404, not 403**, when the caller is not the author.
4. **Server-side anti-abuse.** Honeypot, an HMAC-signed submit-time floor, length/link limits, per-tenant blocked terms, duplicate fingerprints, per-IP rate limits. All **fail-closed**: with the time floor active, a missing token counts as `too_fast`, so deleting the token is not a way around it.
5. **PII minimisation.** The author's email address is never stored raw — only sha256 + a masked form. IP and user-agent are kept only as tenant-salted hashes. Notification subscription addresses are encrypted with AES-256-GCM under a separate key; without the key, what is stored is an unresolvable sentinel, **not** plaintext.
6. **Tenant isolation.** All seven tables `ENABLE` **and** `FORCE` RLS (`ENABLE` without `FORCE` is inert while the app connects as the table owner), plus an explicit `tenant_id` predicate.

### 6. Permissions: zero new actions

Eight permissions (`sql/067`), all using `AccessAction` literals that **already exist**. Marking spam uses `reject`, not a new `spam` action: spam is a subtype of rejection with an identical blast radius, distinguished by an audited reason code. Creating a new action would instead plant a latent-authz trap — an action that is never seeded into any role will deny even the tenant owner, while the code looks correct.

### 7. Adaptations specific to `awcms` (not oversights)

| Item                | awcms-micro                            | Here                                                                                                                                                                                 |
| ------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `urlTemplate`       | `:slug`/`:id` (host-resolved)          | adds **`:tenantCode`** — this base's public content routes are path-tenant-scoped (ADR-0009). A template that asks for it without a code **throws**, it does not write a placeholder |
| Table prefix        | `awcms_micro_`                         | `awcms_`                                                                                                                                                                             |
| Timing token secret | a fallback constant in source          | a random per-process key + a warning (the `AUTH_IP_HASH_SECRET` precedent); a constant in a public repo = a signature that is not a signature                                        |
| Keyset cursor       | materialised `created_at`              | full-precision text `to_char(...)` + a `(created_at, id)` tiebreak — a fix for the Issue #158 bug class                                                                              |
| `published_at`      | NULLed on every non-approve transition | preserved (`coalesce`) — archiving that erases the trace of having been published defeats the purpose of the archive                                                                 |
| `anonymize` event   | never written                          | written by the retention sweep — `sql/066` gives the worker INSERT for it, so the grant has to be honest                                                                             |
| Admin page          | client-fetch SPA                       | SSR + one externally bundled script (CSP forbids inline); the body is rendered as **plain text**, never HTML                                                                         |
| Typeahead/i18n      | gettext catalogue                      | literal labels — this base has no i18n catalogue runtime yet                                                                                                                         |

### 8. Consequences

**Positive.** One owner of comments for the whole base; a content module accepts comments with a single data declaration and no cross-imports; the public write surface has an explicit and tested security backbone; retention/legal-hold ride the generic engine that already exists.

**Negative / accepted costs.** One more MINOR on `MODULE_CONTRACT_VERSION` (and the family manifest pin). One more gate in the `check` chain. Reply notifications have no dispatcher consumer yet — the event is published, its delivery is a documented follow-up. `blog_content` now declares the same publication predicate **twice** (search + comments); nothing in the types unifies them, so that coupling is enforced by a test that has been proven red when deliberately drifted.

**Neutral.** `ARCHIVE_REASON_CODE` occupies one reserved reason code; a moderator's free-form reason must not collide with it.
