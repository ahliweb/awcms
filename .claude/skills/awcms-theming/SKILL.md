---
name: awcms-theming
description: Manage/consume the AWCMS theming module — tenant-selectable presentation via trusted build-time theme descriptors (ADR-0034 Phase 3, the first website module ported DIRECTLY into this base). Use when adding/changing `/api/v1/theming/*` endpoints, changing the draft→validate→preview→publish→rollback/retire lifecycle, touching the by-rejection CSS validation security spine, or adding a new theme to the base registry. Per src/modules/theming/README.md and ADR-0034 (awcms-micro ADR-0029).
---

🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](SKILL.id.md)

# AWCMS — Theming (tenant-selectable presentation)

Read `src/modules/theming/README.md` and `src/modules/theming/module.ts` for the
full detail — this skill summarises decisions that have already been made so they
are not re-derived. The `theming` module (`type: "domain"`, `status: "active"`,
version `1.0.0`) is the **first website module implemented DIRECTLY in the awcms
base** (ADR-0034 Phase 3, "templates are used-directly"; adapted from awcms-micro
`theming` / ADR-0029). ADR-0034 revoked the `no-content-website-modules`
prohibition, so content/website modules may indeed live in `src/modules/` —
there is **no** derived repo, `application-registry.ts`, or `extension:check`.
The base registry went from 10 → 11 modules.

Schema in this repo: `sql/033_awcms_theming_config_schema.sql` (three
tenant-scoped tables) and `sql/034_awcms_theming_permissions.sql` (global catalog
permission seed). Always verify with `ls sql/ | grep theming` before quoting a
migration number.

## When to use this skill vs the generic skills

It complements (does not replace) `awcms-new-endpoint`, `awcms-new-migration`,
`awcms-abac-guard`, `awcms-idempotency`, `awcms-audit-log` — those are still used
for how to build an endpoint/migration/guard/idempotency/audit. This skill
supplies the `theming`-specific domain context: the theme (code) vs config (data)
split, the CSS validation security spine, published-version immutability, and the
preview model.

## Two things kept STRICTLY apart (theme = code, config = data)

- **Theme** = the `ThemeDescriptor` that `theme-registry.ts` assembles from
  reviewed in-repo base themes, bundled at BUILD TIME. A trusted source,
  **not** a database row, **not** an uploaded artifact. New themes are added
  DIRECTLY to `theme-registry.ts` (example: `themes/default-theme.ts` = theme
  `aria`) — there is no derived-repo theme seam (removed by ADR-0034 Phase 2).
- **`ThemeConfig`** = the tenant's configuration DATA ON TOP OF a theme: design
  token overrides, slot variant choices, media asset ids, section ordering, nav
  placement. Stored in the DB (`awcms_theming_config_versions` +
  `awcms_theming_tenant_state`, sql/033, RLS FORCE), schema-validated & bounded
  in `domain/theme-config.ts` before being stored.

The ONLY renderer is `src/layouts/PublicThemeLayout.astro` (trusted build-time).
**There is no executable template column anywhere in the schema** — no
tenant-authored Astro/JS/SQL/eval/raw HTML.

## Security spine — `domain/css-value-validation.ts` (by-rejection validation)

Every design-token VALUE is validated by **REJECTION, not sanitisation**
(reject, do not strip → eliminates the entire
`js/incomplete-multi-character-sanitization` class):

- `assertSafeCssPrimitive` — charset-restricted, length-bounded
  (`MAX_CSS_TOKEN_VALUE_LENGTH`), control-char free, rejects
  `url(` / `expression` / `@import` / `javascript:` / `/*` / `;{}<>` /
  backslash / unbalanced parens.
- `validateColorValue` / `validateDimensionValue` (units from
  `DIMENSION_UNIT_ALLOW_LIST`) / `validateNumberValue` / `validateFontStack` —
  strict & linear grammars (no-ReDoS).
- Font families are picked from a **per-theme allow-list**; the emitted CSS stack
  belongs to the descriptor, so no font value is ever tenant-authored.

`serializeThemeTokensCss` is safe by construction (it re-validates every value)
and emits a `:root { --awcms-theme-* }` block served as an **EXTERNAL same-origin
stylesheet** (`/theming/{tenantCode}/tokens.css`,
`src/pages/theming/[tenantCode]/tokens.css.ts`) — so the application's CSP
`style-src 'self'` is NEVER weakened (no per-request inline `<style>`). Do not
regress this into an inline style.

## Lifecycle — draft → validate → preview → publish → rollback/retire

Admin routes in `src/pages/api/v1/theming/*`:

- **draft** (`PUT /api/v1/theming/draft`, `draft.ts`) — one mutable working copy
  per tenant. Guard `theming.config.update`.
- **validate** (`POST /api/v1/theming/validate`, `validate.ts`) — read-only
  dry-run, returns the CSS tokens that WOULD be produced. Guard
  `theming.config.read` (not a mutation).
- **preview** (`POST /api/v1/theming/preview`, `preview.ts` → page
  `src/pages/theming/preview/[token].astro` + `preview-tokens/[token].css.ts`) —
  a short-lived, authorized & **non-indexable** session. The token is stored as a
  **SHA-256 hash** (`domain/preview-token.ts`), `X-Robots-Tag: noindex`,
  `private, no-store`, a URL namespace distinct from the public stylesheet
  (cannot poison the public/CDN cache). Guard `theming.preview.create`.
- **publish** (`POST /api/v1/theming/publish`, `publish.ts`) — INSERT a new
  **immutable** version then make it the live view. Guard
  `theming.version.publish`.
- **rollback** (`POST /api/v1/theming/rollback`, `rollback.ts`) — move the active
  pointer to an earlier published version. Guard `theming.version.restore`.

> **All three MUST enqueue an edge cache purge** (#246). `publish.ts`,
> `rollback.ts`, and `retire.ts` each call
> `enqueueModuleContentPurge(tx, tenantId, THEMING_MODULE_KEY, …)` **inside the
> same transaction** as their change (the ADR-0006 outbox discipline — enqueuing
> outside the transaction can purge a change that is then rolled back). The gate
> `bun run edge-cache:surfaces:check` enforces it: every module that owns a
> declared surface must have a purge call site, so adding a new theming mutation
> route without a purge = red CI. See `awcms-edge-cache`.

- **retire** (`POST /api/v1/theming/retire`, `retire.ts`) — clear the active
  pointer; the site falls back to the default theme. Guard
  `theming.version.archive`.
- **index** (`GET /api/v1/theming`, `index.ts`) — read state, available themes,
  draft, and version history. Guard `theming.config.read`.

## Published-version immutability — THREE layers

`awcms_theming_config_versions` holds one mutable `draft` per tenant PLUS
numbered `published` versions (monotonic per tenant). Published can **never** be
mutated, enforced in **three layers**: (1) the application engine is INSERT-only,
it never UPDATEs an old published row; (2) a `BEFORE UPDATE OR DELETE` trigger in
sql/033 RAISES on any attempt to mutate/delete a `status = 'published'` row;
(3) the active pointer (which theme + which version is live) lives in
`awcms_theming_tenant_state`, so rollback/retire **move the pointer** and never
touch a version row. "One change = one new version".

## Preview retention — a read filter, not a purge job

`awcms_theming_preview_sessions` has NO background purge. Sessions stay safe
because **every read filters `expires_at >= now()`**
(`application/theme-preview-directory.ts`) — an expired session is inert. Do not
assume a cleanup job exists.

> **The original reason has expired.** An earlier version explained the absence of a purge with "the generic `data_lifecycle` engine does not exist in this base" and "there is no `awcms_worker`".
> **Both now exist** — the `data_lifecycle` module is
> registered (ADR-0037, `sql/055`–`056`) with 7 adopter modules, and the
> `awcms_worker` role was created in `sql/022`. The read filter is still a
> legitimate design and does not need to change; what is not legitimate is naming
> a cause that is wrong, because that closes off the option of registering a
> `dataLifecycle` descriptor here if that is later wanted.

## Guard, idempotency, audit

- **ABAC** — every route uses `authorizeInTransaction` inside `withTenant` with
  `{ moduleKey: "theming", activityCode, action }`. Constants live in
  `domain/theme-permissions.ts` (`THEMING_CONFIG_ACTIVITY_CODE = "config"`,
  `THEMING_VERSION_ACTIVITY_CODE = "version"`, `THEMING_PREVIEW_ACTIVITY_CODE =
"preview"`) — reuse the constants, do not re-type the literals (they mirror the
  sql/034 seed exactly). Default-deny; access denied → `403`, never silently
  empty data.
- **Idempotency** — ALL high-risk mutations (publish/rollback/retire) MUST carry
  an `Idempotency-Key` (`findIdempotencyRecord`/`saveIdempotencyRecord`; a
  repeated key with a different payload → `409`). See `awcms-idempotency`.
- **AccessAction** — `archive` was ADDED to the `AccessAction` union and to
  `HIGH_RISK_ACTIONS` (`identity-access/domain/access-control.ts`; retire = high
  risk because it changes the public appearance). `publish`/`restore` were
  already high-risk. `config.update`/`config.read`/`preview.create` are not
  members of `HIGH_RISK_ACTIONS`, but `config.update` & `preview.create` are
  still audited.
- **Audit** — publish/rollback/retire record an audit event (`recordAuditEvent`,
  a synchronous hook; NOT YET a domain event — see follow-up). See
  `awcms-audit-log`.

## Permission catalog

Six `theming.*` permissions (sql/034, GLOBAL catalog `awcms_permissions` with no
tenant_id/RLS, unique on `(module_key, activity_code, action)`, idempotent seed
`ON CONFLICT DO NOTHING`): `config.read`, `config.update`, `version.publish`,
`version.restore` (rollback), `version.archive` (retire), `preview.create`.
Existing tenants do NOT get them retroactively — only tenants created after this
migration runs (seeded to the owner during setup-wizard bootstrap).

## Port adaptations vs awcms-micro (ADR-0034 Phase 3)

- **Asset URL resolution IS wired up** (#251). `src/modules/theming/presentation/theme-media.ts`
  resolves `config.assetRefs` (slotKey -> media object id) through the
  `MediaLibraryPort` — the same capability consumed by `blog_content` and
  `news_portal` — and `theming` declares it in `capabilities.consumes`.
  Note (the `news_portal` module was MERGED into `blog_content` — ADR-0044/#300; its table names were kept).
  The port is injectable (`media`, 4th parameter, defaulting to the real
  adapter), so the omission path can be tested without a DB.

  **The security comes from the port, not from this file.**
  `resolveMediaReferences` only returns ids that EXIST, belong to this tenant,
  and are `verified`/`attached`; unsafe/cross-tenant/deleted ids are simply
  ABSENT from the map — never thrown. So a slot that fails to resolve is
  **dropped**, and that is deliberate: a public theme page must not 500 because
  of one stale asset id. DO NOT add ownership/status checks here — that
  duplicates the port contract in a second place that can drift from it.

  Before #251 this function returned an empty map unconditionally, and its header
  explained that as being because `media_library` did not exist — an explanation
  that stopped being true when ADR-0036 landed. The consequence: a tenant's
  uploaded logo never appeared, and the code asserted that was correct. The
  behaviour is locked down by `tests/theme-media-resolution.test.ts`.

- **`tenantCode`-based public tenant resolution** (ADR-0009), not Host-based —
  the public stylesheet is at `/theming/{tenantCode}/tokens.css`.
- **No worker migration/GRANT** — the tables inherit the `awcms_app` grant from
  `ALTER DEFAULT PRIVILEGES` in sql/019; there is no explicit GRANT.

## Not yet available (documented follow-ups, API-first)

A full admin UI screen (token editor + responsive preview dashboard) —
`navigation` is deliberately not declared. Domain events
(`awcms.theming.version.published/.rolled-back/.retired`) — publish/rollback/
retire are still audited synchronous hooks, `events` is not declared. Media asset
rendering — awaiting the media module being ported. Public-route adoption (wiring
the public home route to `PublicThemeLayout`) — the layout + stylesheet are
ready, the wiring follows. Verify this status in `module.ts`/README before
claiming any of it exists.

## Related skills

`awcms-new-endpoint`, `awcms-new-migration` (RLS FORCE + immutability trigger),
`awcms-abac-guard` (the `theming.*` permissions), `awcms-idempotency` (publish/
rollback/retire), `awcms-audit-log`, `awcms-module-management` (base registry +
build-time composition, ADR-0034), `awcms-new-module` (the pattern for adding a
domain module DIRECTLY to `src/modules/`).
