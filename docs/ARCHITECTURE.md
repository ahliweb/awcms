🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](ARCHITECTURE.id.md)

# AWCMS Architecture

Status per [ADR-0001](adr/0001-rebuild-on-awcms-foundation-erp-scope.md), repositioned
by [ADR-0034](adr/0034-awcms-family-direct-use-templates-and-derived-pathway-removal.md)
(superseding ADR-0013/0014/0015/0022/0025): AWCMS is a **template of the AWCMS family that
is used DIRECTLY** (the ERP/back-office line).

**The family today is two repos, and only two** ([ADR-0055](adr/0055-development-confined-to-awcms-and-awcms-astro.md)):
this repo as the **system of record** — the whole authorization surface, the API, and the
**SYSTEM** admin screens — and [`ahliweb/awcms-astro`](https://github.com/ahliweb/awcms-astro),
which carries **public pages as its primary function** plus the **USER admin surface when a
site declares one** ([ADR-0070](adr/0070-peran-keluarga-awcms-astro-memikul-publik-dan-admin-user.md)).
Together they replace all three of the old templates; `awcms-mini` and
`awcms-micro` are **ARCHIVES, not continued**.

As a shipped template, the base provides **reusable foundation modules + neutral ERP-readiness contracts** —
ERP domain modules (finance, inventory, procurement, manufacturing, hr-payroll, etc.)
are **added directly in this template's `src/modules/`** when it is used, not in a separate
extension/derived repo (the derived-application pathway was REMOVED — see §Module composition
below). This repo has **22 registered modules**, migrations `sql/001`-`sql/129`, RLS
`FORCE` on every tenant-scoped table, database role separation, and a read+write admin UI
(Issue #166, #171). This document describes what is **in the code today**. For per-module
detail, see each `README.md` under `src/modules/<module>/`.

## Stack

- Runtime: Bun (Bun-only). Astro/Vite binaries are run through `bun --bun`.
- Web: Astro 7, SSR via `@astrojs/node` (an adapter, not a runtime — see the comment in `astro.config.mjs`).
- Database: PostgreSQL, RLS mandatory for every tenant-scoped table.
- Driver: Bun's built-in `Bun.SQL`.

## Modular monolith

```
src/modules/<module>/
  module.ts            # ModuleDescriptor (see _shared/module-contract.ts)
  domain/               # pure types & validation, no I/O
  application/          # service/orchestration, takes a Bun.SQL tx
  api/                  # (optional) shared schemas/handlers; route files stay in src/pages
```

21 modules registered in `src/modules/index.ts` (order = registration order):

- **`logging`** — cross-module audit trail (`awcms_audit_events`) + scheduled purge.
- **`tenant_admin`** — tenant root, office hierarchy, tenant settings, one-shot setup wizard.
- **`profile_identity`** — canonical person/organization profiles, typed identifiers (masking/hash), cross-module entity links.
- **`identity_access`** — login (opaque token sessions), password reset over email
  (enumeration-safe, single-use, revokes every session), self-registration
  with admin approval (OFF by default), tenant user membership, base RBAC/ABAC.
- **`module_management`** (`isCore`) — DB-backed module registry: descriptor sync, per-tenant enable/disable, non-secret settings, permission sync, navigation, job registry, health/readiness.
- **`domain_event_runtime`** — transactional domain-event outbox/dispatcher, versioning, multi-consumer, dead-letter + audited replay.
- **`sync_storage`** — offline-first sync nodes, HMAC-signed anti-replay outbox/inbox, conflict tracking, object upload queue.
- **`workflow_approval`** — versioned workflow-definition engine (draft/publish/retire), node graph (approval/condition/parallel/join/notify), quorum, delegation, escalation.
- **`email`** — provider-neutral email service (Mailketing + `log` adapter), template management, outbox dispatcher, mass announcements.
- **`reporting`** — five management views (tenant activity, access/audit, sync health, module usage, email health) plus the read-model projection mechanism (incremental cursor/event-driven, rebuild, freshness, reconciliation, scheduled export).
- **`theming`** (`type: "domain"`) — the first **website** module living directly in the base (ADR-0034 Phase 3): per-tenant theme configuration (design tokens), draft/preview/publish/retire/rollback lifecycle with immutability, routes `/api/v1/theming/*` + the public stylesheet `/theming/{tenantCode}/tokens.css` (external, `style-src 'self'`). CSS values are validated by-rejection, previews frozen with SHA-256.
- **`blog-content`** (`type: "domain"`) — the first public-content module, ported from mini (PR #214, `sql/035`-`sql/040`, 15 `awcms_blog_*` tables): post/page CRUD+lifecycle (draft→review→scheduled/published→archived, soft-delete/restore/purge), hierarchical categories/tags, full-text search, append-only revisions, presentation/monetisation (template/menu/widget/ads/theme), automatic internal tag-linking, per-tenant settings. Public routes are **path-based** `/blog/{tenantCode}/*` (ADR-0009): index, detail, category/tag archives, search, RSS feed, sitemap. The host-resolved `/news/**` routes that [ADR-0059](adr/0059-host-resolved-public-content-routes.md) added have **already been REMOVED** — [ADR-0071](adr/0071-kosakata-url-publik-dibelah-blog-di-sini-news-di-awcms-astro.md) supersedes it and splits the URL vocabulary: `/blog/**` permanently here, `/news/**` belongs to `ahliweb/awcms-astro`. What went with it: all four route files, the `withHostResolvedBlogTenant` gate, and the `publicRouteMode` switch; what remains is only the `seo_distribution` 301 to `/blog/{tenantCode}/**` for that retired family. **Since [ADR-0044](adr/0044-merge-news-portal-into-blog-content.md) (#300) this module also OWNS everything that used to be `news_portal`**: the homepage-section composer + ad placement with a verified `media_object_id` (replacing the free-form `image_url` path), with widened ad targeting (#301) and the free-URL ad write path closed (#303). `news_portal` is **no longer registered** in `src/modules/index.ts`; the media object registry has belonged to `media_library` since [ADR-0036](adr/0036-media-library-module-admission-ownership-inversion.md).
- **`tenant-domain`** (`type: "domain"`) — ported from micro (#219, `sql/046`-`sql/048`): per-tenant custom domain registration + verification, primary-host, host→tenant lookup function. The host-resolved foundation for SEO (canonical host) & host-based public routes.
- **`visitor-analytics`** (`type: "domain"`) — ported from micro (#220, `sql/049`-`sql/051`): privacy-minimized visit telemetry (`awcms_visit_events`/`awcms_visitor_sessions`), daily rollups, scheduled rollup + purge jobs (which now consult the `data_lifecycle` legal hold).
- **`media-library`** (`type: "domain"`) — an **ownership inversion** ([ADR-0036](adr/0036-media-library-module-admission-ownership-inversion.md), #221, `sql/052`-`sql/054`): one module owns ALL per-tenant media objects (R2 registry + presign/finalize/cancel + magic-byte MIME sniff + SHA-256), providing the `media_library` capability (consumed by `blog-content`, `seo-distribution`). Per-tenant managed-media enforcement (`POST /api/v1/media/enforcement`, idempotent). `news_media` is retired.
- **`data-lifecycle`** (`type: "domain"`) — ported from micro ([ADR-0037](adr/0037-data-lifecycle-module-admission.md), #222, `sql/055`-`sql/056`): generic cross-module retention/archive/purge via the `dataLifecycle` descriptor on `ModuleDescriptor` + a **non-bypassable legal hold** (the `LegalHoldGuardPort` guard is consulted on every purge). Since [ADR-0094](adr/0094-a-data-subject-is-answered-per-tenant.md) (#542 foundation, #557 surface; `sql/125`-`sql/126`) this module has a SECOND surface, separate from retention: **data subject rights**, answered **per tenant** (never through the global `awcms_principals`). The `subjectData` registry covers **every** `awcms_*` table — not only the high-volume ones — and two gates guard it: `subject-data:coverage:check` (does every table answer; debt ledger **0 of 147** tables) and `subject-data:registry:check` (is the answer CORRECT against `sql/`, including whether the `erasure` mode sits within `awcms_app`'s privileges). An export states its own coverage (tables deliberately not answered are named, not omitted); erasure is maker/checker enforced in **four layers** — two permissions, an SoD rule, a CHECK constraint, and one conditional UPDATE. The base now ships **2 SoD rules**: `data_lifecycle.legal_hold_maker_checker` and `data_lifecycle.subject_erasure_maker_checker`.
- **`seo-distribution`** (`type: "domain"`) — ported from micro ([ADR-0038](adr/0038-seo-distribution-module-admission-discovery-scope.md) discovery + [ADR-0039](adr/0039-seo-distribution-redirect-governance.md) redirect governance, #223/#224, `sql/057`-`sql/061`): a centralized SEO metadata renderer (canonical/hreflang/robots/OG/controlled JSON-LD, host derived **server**-side from `tenant_domain`) + unauthenticated public discovery routes (`/robots.txt`, `/sitemap.xml`, `/sitemap-{n}.xml`, `/feed.xml`, `/atom.xml`, `/feed.json`) + the admin config `/api/v1/seo/config` + **redirect governance** (exact-path `awcms_seo_redirects` rules, 404 telemetry, a fail-open `src/middleware.ts` hook, a frozen open-redirect guard). A **consumer/aggregator** of the `seo_facts` capability (provided by `blog_content`) — it imports no content module at all.

- **`form-drafts`** (`type: "system"`) — ported from micro (#230, `sql/062`-`sql/063`): a generic, domain-free store for multi-step form drafts (create/read/update/submit/delete of tenant-scoped JSONB payloads), size-bounded and denylist-validated against secret-shaped field names, with a two-phase expire-then-purge retention job (a `dataLifecycle` descriptor of type `delegated` — the real purge + legal-hold check stay in this module). No domain logic: the module that created a draft owns the meaning of its payload. The awcms-micro wizard COMPONENT library did **not** land with it, and since ADR-0055 §1 it is a BUILD candidate through its own admission ADR, not a leftover in a port queue.
- **`site-search`** (`type: "domain"`) — ported from micro ([ADR-0040](adr/0040-site-search-module-admission.md), #231, `sql/064`-`sql/065`): per-tenant cross-content PostgreSQL full-text search over **already published** website content. It owns the unified index `awcms_site_search_documents` (`tsvector`/GIN + a `pg_trgm` title index for suggest), per-tenant config, an index-run ledger, failed-item diagnostics, and an opt-in minimized query log. A **consumer/aggregator** of the `searchSources` descriptor — a purely-data table/column mapping + publication filter declared by content modules (not a `provides` capability, because multiple providers are exactly what is expected), read generically via `listModules()`. A deterministic & idempotent reconcile/rebuild (`site-search:reconcile`) keeps the index a faithful projection: archive/delete/unpublish disappear from public results with nothing left behind. The public `/search` page + the JSON endpoints `/api/v1/site-search/query` & `/suggest` are tenant+locale scoped; the query text is **always** a bound parameter to `websearch_to_tsquery`, and the `ts_headline` snippet is escaped before any HTML is emitted. Public URLs are built from each descriptor's `urlTemplate` with a server-resolved `:tenantCode` (this base's public content routes are path-tenant-scoped, ADR-0009 — not host-resolved like micro). **DROPPED during the port** (documented): micro's inline typeahead script — this base's CSP forbids inline scripts and its public page is a plain APIRoute with no bundling step, so `/search` ships core no-JS search and `/suggest` stays available to a theme's bundled client. The search index is a projection of public content only and is **never** a source of authorization.

- **`comments`** (`type: "domain"`) — ported from micro ([ADR-0041](adr/0041-comments-module-admission.md), `sql/066`-`sql/067`): **moderation-first** comments on top of **already published & public** resources. It owns threads, depth-limited comments (hard cap 4), append-only moderation history, abuse reports, per-tenant settings, minimized anti-abuse telemetry, and encrypted reply-notification subscriptions. A **consumer/aggregator** of the `commentableResources` descriptor (`MODULE_CONTRACT_VERSION` 2.3.0) — content modules DECLARE which resources may be commented on; `comments` finds them via `listModules()`. Its security backbone: the publication boundary is enforced at the resource→thread border (draft/private/deleted never accept nor expose comments); bodies are stored as **plain text** and escaped at render (no stored HTML → no stored XSS), only http(s) autolinks with `rel="nofollow ugc noopener noreferrer"`; the public submit response is **uniform** so the endpoint cannot be used as a blocked-term or unpublished-content oracle; author PII is minimized (sha256 + mask, never raw). Reply notifications go through the event outbox (payload without addresses), retention **anonymizes** in place (rather than deleting) and honours legal holds. Admin `/admin/comments` + API `/api/v1/comments/*`.

- **`idn-admin-regions`** (`type: "system"`) — started directly here ([ADR-0046](adr/0046-idn-admin-regions-module-admission.md), #312, `sql/080` schema + `sql/081` permissions): **versioned & provenance-tracked** master data for Indonesian administrative regions (province/regency-city/district/village-urban-village), sourced from the community dataset `cahyadsn/wilayah` (MIT), **vendored** under `data/idn-admin-regions/`. Its two tables (`awcms_idn_region_datasets`, `awcms_idn_admin_regions`) are **GLOBAL** — no `tenant_id`, no RLS, like `awcms_permissions`/`awcms_modules` — because the province "Aceh" is the same row for every tenant; both are registered in `GLOBAL_TABLE_FORBIDDEN_PRIVILEGES` (`scripts/security-readiness.ts`) so per-role privileges must be declared explicitly rather than inherited from blanket DML. What is global is the **rows**, not the permissions: every endpoint still passes through session + tenant context + default-deny ABAC. Importing 91,599 rows is a **deployment job** (`bun run idn-regions:import`, dry-run by default, running as `awcms_worker`) — not an HTTP call; dataset version **activation/rollback** is now also an **operator job** (`bun run idn-regions:activate`/`:rollback`, [ADR-0052](adr/0052-idn-region-dataset-lifecycle-is-an-operator-job.md) — its HTTP endpoints were removed and its permissions revoked from the catalogue, `sql/084`). Read-only lookups at `/api/v1/idn-regions/*`. It now **has `navigation`** and an admin screen `/admin/idn-regions` (PR #332): ADR-0048 is superseded by [ADR-0051](adr/0051-admin-screens-consolidated-in-awcms.md), all **SYSTEM** admin screens are built in this repo (narrowed by [ADR-0070](adr/0070-peran-keluarga-awcms-astro-memikul-publik-dan-admin-user.md); `idn_admin_regions` is the pure example — a dataset served to many tenants will never be USER work).

Other capabilities in the family ecosystem (e.g. `newsletter`,
`social-publishing`, `document-infrastructure`, `integration-hub`) **do not exist yet**
in this repo. Since [ADR-0055](adr/0055-development-confined-to-awcms-and-awcms-astro.md)
the word "**port**" no longer applies to anything on that list: `awcms-mini` and
`awcms-micro` are **ARCHIVES**, readable as a specification but not a
port source, and new capabilities are **BUILT here** through their own
admission ADR. Their respective skills (marked "READ-ONLY") and
[`awcms/absorb-awcms-micro-roadmap.md`](awcms/absorb-awcms-micro-roadmap.md)
are therefore read as a **list of needs + target specification**, not a
porting queue.

### Module registry composition & validation (ADR-0034)

The module registry is a **single base registry** (`src/modules/index.ts`),
composed 100% at build/compile time (no runtime discovery/`eval`/file scanning).
ADR-0034 **removed** the derived-application pathway: there is no longer a
`src/modules/application-registry.ts`, `mergeModuleRegistries`, a derived
`900+` migration namespace, a compatibility manifest, or the
`extension:check` command (superseding ADR-0014/0015/0025). What was **kept**
is the base registry validation mechanism — which now validates the base registry
itself, rather than the result of merging it with an application registry:

- `src/modules/index.ts` exports `listBaseModules()`/`listModules()` (21
  modules, fixed order = registration order). It stays **pure data** — only a list,
  never validating/throwing at load.
- `src/modules/module-management/domain/module-composition.ts`
  (`composeModuleRegistry`) is the validation engine used by the gate, not the module
  load path. It rejects: duplicate keys, missing/cyclic dependencies (reusing the
  DAG validator `_shared/module-dependency-graph.ts`), capability provider
  conflict/missing, navigation path conflicts, and invalid job descriptors
  (reusing `job-registry.ts`).
- The gates that enforce it in `bun run check` and CI: `modules:dag:check`,
  `modules:compose:check`, and `modules:composition:inventory:generate`/`:check`
  (the deterministic inventory `docs/awcms/module-composition-inventory.json`).
- **`tests/module-boundary.test.ts` closes the gap none of those three can see.**
  The gates above validate the **DECLARED** graph — from `listModules()`
  alone, with no I/O. Not one of them reads a single `import` line, so a module
  could import anything as long as it did not write it down. Seven such edges existed
  when this gate landed (#251). Now every cross-module import must be
  declared as `dependencies`, as `capabilities.consumes`, or be
  excluded explicitly with a reason a reviewer can argue against.
- **`modules:table-writes:check` closes a SECOND gap: coupling through SQL, not
  through `import`.** Two modules can be entirely free of imports of each other
  and still write the same TABLE — coupling invisible to every gate
  above. `_shared/module-contract.ts` cites the "ADR-0013 §6 no
  shared-table write" rule **four times** as the reason each seam
  (`dataLifecycle`/`searchSources`/`commentableResources`/`reportingProjections`)
  passes METADATA to a central engine instead of reaching into another module's
  schema — but hand-written SQL outside those seams was never checked, and six tables
  were written by more than one module when this gate landed. Ownership is **derived,
  not declared** (the rule is "at most one writer", so the writer itself is the
  proof; a new table need not be registered to be covered). Routes in `src/pages` are
  attributed via `api.routes`, so an `INSERT` in a route owned by a module is not a
  second writer. DYNAMIC writes
  (the `${tableName}` of the `data_lifecycle`/`reporting` engines) are deliberately out of
  scope — that is precisely the mechanism §6 prescribes, and it is already gated by
  their respective registry checks.

Build-time composition (which modules exist in the code) and tenant lifecycle
enable/disable (`module_management`, per-tenant DB state) are **two different
layers** — composition never depends on tenant input.

## Tenant context & RLS

Every tenant-scoped request runs through `withTenant()`
(`src/lib/database/tenant-context.ts`): it passes the work-class gate + circuit
breaker (`src/lib/database/`) in front of the pool — returning `503
DATABASE_BUSY` + `Retry-After` when the breaker is open or the work class is saturated,
instead of a cascading timeout — then opens a transaction, runs
`SET LOCAL app.current_tenant_id = '<tenantId>'`, and calls the handler
function (recording success/failure to the breaker; Postgres class 22/23 input
errors are excluded so they do not trip the breaker; the loser of an idempotency
race is excluded too). Every tenant-scoped table has an RLS policy
comparing `tenant_id` with `current_setting('app.current_tenant_id')`.
RLS is the second layer — queries must still filter `tenant_id`
explicitly. Pool/breaker state is exposed at `GET /api/v1/database/pool/health`.

**A pool rejection is NOT a value — two forms, chosen by the compiler.**
`withTenant()` returns `T | Response`: callers on the request path
pass its `503` through as-is (`if (result instanceof Response) return
result;`), and the ~390 handlers whose callback already returns a `Response`
did not change at all. Everything that is NOT an HTTP handler — workers, scheduled
jobs, SSR frontmatter, tenant resolvers, test fixtures — uses
`withTenantOrThrow()`, which throws a `DatabaseBusyError` (carrying an identical
`503` `response`, so the two forms cannot diverge) and is classified
`retryable` by the job runner. Previously a single generic function `as T`-cast that
rejection into whatever type the caller asked for: `purgeExpiredAuditEvents`
promised `Promise<number>` but returned a `Response`, `runBoundedBatches`
stopped on a `count === 0` that never matched, and a job whose entire purpose was
to back off instead ran 50 passes per tenant against a database that had just
rejected it — then reported success with a total that was the string
`"0[object Response]…"` (because `number + Response` is concatenation).
`db:tenant-context:check` closes the two leftovers the compiler cannot see: a
`withTenant` result that is **discarded** (`await withTenant(...)` as a statement —
its `503` vanishes without a trace) and calls from `.astro`, which
`tsc --noEmit` never reads.

**Deliberate RLS exceptions (an explicit allow-list).** Two global tables
are deliberately without RLS: `awcms_tenants` (the multi-tenant root — endpoints must
use an explicit `WHERE id = <tenantId>`) and `awcms_setup_state` (a first-run
singleton, guaranteed a single row by a CHECK, read/written before any tenant
exists). Every other tenant-scoped table uses RLS `FORCE`.

**RLS FORCE + database role separation (no longer just a plan).**
`sql/017_awcms_enforce_rls_force.sql` closes the "PostgreSQL bypasses RLS
for the table owner" gap with `ALTER TABLE ... FORCE ROW LEVEL SECURITY` on
every tenant-scoped table. That alone is not enough — a superuser/`BYPASSRLS`
still bypasses RLS regardless of `FORCE`. `sql/019_awcms_db_role_separation.sql`
creates the runtime role `awcms_app` (non-superuser, non-owner, `NOLOGIN` until
the deployment activates it) with fail-closed default GUCs
(`app.current_tenant_id` defaults to the all-zero UUID, not a crash) so that RLS
is finally genuinely active. `sql/021_awcms_db_role_grants_narrow.sql` narrows
`awcms_app`'s blanket grants on the RLS-free global tables (DELETE revoked from
`awcms_permissions`/`awcms_schema_migrations`/`awcms_tenants`, etc — only the
verbs actually used by real code paths). `sql/022_awcms_db_worker_setup_roles.sql`
adds the separate roles `awcms_worker` (background jobs) and `awcms_setup`
(one-shot bootstrap) with per-write-path grants, optional/opt-in through
`WORKER_DATABASE_URL`/`SETUP_DATABASE_URL` (falling back to `DATABASE_URL` when
unset — old deployments keep working). See doc 18 §Database role model
for how to activate these roles in a real deployment (`DATABASE_URL` may still
use the migration-owner role for `bun run db:migrate`).

## Auth

Sessions are opaque-token based (not JWT): `POST /api/v1/auth/login` creates
a random token, stores its SHA-256 hash in `awcms_sessions`, and returns the
raw token exactly once. Clients send the token through the
`Authorization: Bearer <token>` header (API) or an httpOnly cookie
(`awcms_session`/`awcms_tenant_id`, for the SSR admin shell). The active tenant must
be sent through the `X-AWCMS-Tenant-ID` header for non-cookie endpoints. Login
is hardened (rate limit, lockout, anti-enumeration dummy hash, IP redaction)
— see `src/modules/identity-access/README.md` §Audit & login hardening.

**Credentials and lockout live in `awcms_principals`, not in the per-tenant
identity.** That table (`sql/112`,
[ADR-0085](adr/0085-one-human-one-credential-many-tenants.md)) is GLOBAL and without
RLS: one row per human, keyed by normalized email, and `awcms_identities`
only gained a nullable `principal_id` — zero moving foreign keys, and
`resolveTenantContext`/`authorizeInTransaction` never learn that principals exist.
The absence of RLS is backed by four enforced controls, one of them the
`bun run identity:principal-access:check` gate, which limits which **call sites**
may name that table and demands that every query be keyed by `id =` or
`email_normalized =`. Since `sql/113`
([ADR-0086](adr/0086-the-lockout-counter-is-global.md), closing #430) the lockout
counter moved there too; `awcms_identities.failed_login_count`/`locked_until`
are history. All five reset paths — successful login, password reset, password
change, SSO callback, MFA enrolment verification — touch the principal counter,
because a global lockout with per-tenant recovery is worse than
what it replaced. Since `sql/114`
([ADR-0087](adr/0087-mfa-moves-to-the-principal.md)) **MFA factors and recovery
codes belong to the human too** (`awcms_principal_mfa_factors`,
`awcms_principal_mfa_recovery_codes` — GLOBAL, without RLS, using the same four
controls; the gate now guards three tables with a separate allow-list per
table). The `sql/024` encryption is unchanged. What did **not** move:
`awcms_mfa_challenges` (one login attempt in one tenant) and
`awcms_tenant_mfa_policies` (a tenant's product decision) — the factor belongs to the
human, the obligation belongs to the tenant. The consequence is stated: **an
administrative MFA reset now reaches outside the acting tenant**, recorded as
`crossTenantReach` on a `critical` audit row and `disabled_by_tenant_id` on
the factor's row — not as a list of tenants, which would become a cross-tenant
membership oracle.

On top of passwords, the auth path now has: **MFA TOTP + recovery codes + session
assurance (aal1/aal2) + step-up** (`sql/024`, routes `/api/v1/auth/mfa/*`,
enforcement driven by DB enrollment state — fail-closed), **tenant-aware
OIDC/SSO with fail-closed account linking + an SSRF guard + break-glass**
(`sql/025`/`026`, routes `/api/v1/auth/sso/*`), and **Cloudflare Turnstile bot
protection that is deployment-profile aware** (`src/lib/security/turnstile.ts`, LAN/offline
exempt). JWTs are verified natively (RS256+ES256) with no dependency.

Wave 2 (the auth/admin delta, `sql/073`–`075`) adds three surfaces that
all sit on top of the paths above without changing them: **password reset
over email** (`/api/v1/auth/password/{forgot,reset}` + `/forgot-password`,
`/reset-password`) — enumeration-safe by construction, single-use enforced
by a `FOR UPDATE` row lock in the DB (not a JS read-modify-write), revoking every
session, and rejecting SSO-only identities on the request **and** redemption paths;
**self-registration with admin approval** (`/register`,
`/api/v1/registration-requests/*`) — OFF by default, its public path never
storing credentials nor creating an account, with approval creating an identity with an
unusable password and then sending a reset link; and the **`/admin/security`** screen
that gives tenant policy (SSO/MFA/break-glass) a UI — its endpoints have existed
since #184/#185, its screen had not, so previously policy could only be changed
through `curl`. Both send email through the `auth_notification` capability port
(the adapter owned by `email`), not a cross-module INSERT.

**Admin shell (Issue #166, #171).** The public auth pages `login`,
`forgot-password`, `reset-password`, `register` (the last three arriving in
Wave 2 — see §Auth) + 13 `src/pages/admin/*.astro` screens (dashboard,
offices, profiles, users, roles, abac-policies, registrations, security,
modules, sidebar-menu, email-templates, comments, analytics) use
`AdminLayout` + the doc 14 design tokens. These screens are
no longer read-only: roles/abac-policies/users/modules/email-templates have
write forms (create/update/enable-disable/assign) calling the same
`authorizeInTransaction`-gated endpoints as the API — the UI gate is only UX,
the endpoint remains the single authority. `src/middleware.ts` guards `/admin/*`
(resolving the session via `resolveSsrContext`, redirecting to `/login` when absent). The CSP
`default-src 'self'` is kept in a single source in the middleware; the pages have no
inline script/style (`build.inlineStylesheets: "never"` + scripts bundled
externally, through `src/lib/ui/admin-form-client.ts` for PATCH/DELETE). Playwright
E2E (`tests/e2e/`, the CI job `e2e-smoke`, env-gated) verifies real
browser flows.

## RBAC/ABAC

`identity-access/domain/access-control.ts` — `evaluateAccess()`: default
deny, deny overrides allow. Permissions are identified as
`module_key.activity_code.action` against the `awcms_permissions` catalogue seeded by
migration. Beyond role permissions, the evaluator has two built-in structural
guards: a **tenant-isolation check** (`resourceAttributes.tenantId`
must match the active tenant) and a **self-approval guard** (an actor cannot
approve/force-decide their own request, used by `workflow_approval`).
Every decision (allow/deny) is recorded to `awcms_abac_decision_logs`
(`application/decision-log.ts`), and every action is flagged high-risk or
not (`isHighRiskAction`) for audit purposes.

`authorizeInTransaction()` (`application/access-guard.ts`) is the single
chokepoint called by every protected route: resolve session -> **check the
module's enabled/disabled status for the tenant** (`resolveModuleEnabled`, before
permissions are looked up — a disabled module is rejected `403 MODULE_DISABLED`
whatever permissions the actor holds, and it is still recorded in the decision log)
-> fetch permissions -> evaluate ABAC -> record the decision log -> return the
context or a ready-made failure `Response`. `module_management` itself is
`isCore` (cannot be disabled), so a tenant is never locked out of
turning it back on.

On top of the built-in guards, the evaluator now consumes three additional
authorization layers that have already been ported:

- **DSL-based dynamic ABAC** (`sql/031`/`032`, `domain/abac-evaluator.ts`,
  routes `/api/v1/access/policies/*` DSL + the legacy flat CRUD `/api/v1/abac/policies`):
  bounded-condition policies (jsonb AST, server-side attribute allow-list,
  ops eq/ne/in/nin/lt/lte/gt/gte/exists), fail-closed deny-overrides precedence,
  a tenant-keyed cache invalidated post-commit. The evaluator loads ONLY
  `is_active AND is_dsl_managed` policies (the legacy flat CRUD is inert by design).
- **Business-scope hierarchy** (`sql/027`/`028`, `domain/business-scope-assignment.ts`):
  a scope-facts parameter to `evaluateAccess`; the base resolver is a fail-closed NO-OP
  until a hierarchy-providing module fills it in.
- **Segregation of Duties (SoD)** (`sql/029`/`030`, `domain/sod-conflict-evaluation.ts`,
  `application/high-risk-sod-guard.ts`): two-point enforcement (assignment
  `sod_conflict` 409 + action-time deny-overrides on high-risk actions); the base
  ships 0 rules (the guard is inert on a pure base; illustrative rules live in fixtures).

The role/user management endpoints (`/api/v1/roles`, `/api/v1/users`) exist
(read Issue #166, write Issue #171).

## Audit trail

`logging/application/audit-log.ts` — `recordAuditEvent()` writes one row
to `awcms_audit_events` (automatic redaction via `_shared/redaction.ts`,
retention `AUDIT_LOG_RETENTION_DAYS` with the scheduled purge job
`bun run logs:audit:purge`). Audit complements, and does not replace, the
structured log (`src/lib/logging/logger.ts`) or domain events: `domain_event_runtime`
now genuinely publishes real events (see §API contract below),
and one of its reference consumers is a cross-module audit projector.

## API contract (modular, Issue #182 / ADR-0026)

The OpenAPI contract is **split per module**. Its source is a set of fragments —
`openapi/awcms-public-api.src.yaml` (root: info/servers/tags/security +
`components.securitySchemes`/`parameters`/`responses` + shared schemas such as
`ApiError`/`ApiMeta`) and `openapi/modules/<module>.openapi.yaml` (one file
per base module, plus `foundation.openapi.yaml` for module-less operations).
Each module points at its fragment through `ModuleDescriptor.api.openApiPath`.

`openapi/awcms-public-api.openapi.yaml` is now **GENERATED** by
`bun run openapi:bundle` (deterministic/idempotent — sorted keys, no
timestamps) at the same old path, so no consumer changed. `bun run
api:docs:generate` produces the Markdown reference `docs/awcms/api-reference.md`
from the bundle + AsyncAPI (synthetic examples).

`bun run api:spec:check` validates: **bundle freshness** (the committed bundle ==
the result of generating from the fragments), every operation has a unique `operationId`, every
operation declares a security requirement (or `security: []` plus a public
allow-list entry that is actually used), the **standard error schema** (every
4xx/5xx response resolves to `ApiError`), path parameters match the template,
and every route file under `src/pages/api/v1/**` has a matching OpenAPI path (and
vice versa). Plus two gates born from real defects (PR #308): the **tag
catalogue** — every operation is tagged, every operation tag is declared in the root catalogue, and
every declared tag is actually used; and **fragment ownership** — every
`api.openApiPath` points at a fragment that exists in `openapi/modules/` (not the
bundle) and every fragment is claimed by exactly one registered module
(`foundation.openapi.yaml` a reviewed exception). Both are bidirectional because
the defect was bidirectional: 55 operations from four modules were missing from the API
reference because their tag was undeclared, while that same catalogue still announced the
tag of the retired `news_portal` module and its fragment was still there without an
owner. `bun run api:docs:check` fails the build when the Markdown reference is
stale. The bundler provides a `buildBundledDocument({ extraFragmentFiles })` seam
to merge additional fragments without editing base fragments; a fragment that
overrides a base path/schema is rejected (`BundleConflictError`). Details:
[`openapi/README.md`](../openapi/README.md),
[`docs/awcms/api-contribution-guide.md`](awcms/api-contribution-guide.md).

`asyncapi/awcms-domain-events.asyncapi.yaml` — **no longer an empty baseline.**
It contains real channels for `domain_event_runtime` (`sample.recorded`,
the reference event), `workflow` (instance started/advanced/approved/rejected/
cancelled, task escalated, delegation created/revoked), and `email` (message
queued/sent/failed/suppressed/cancelled) — published through
`appendDomainEvent` in the same business transaction (ADR-0006, same-commit
outbox write) and delivered by `bun run domain-events:dispatch` with
per-order-key ordering, backoff, dead-letter + audited replay.

## Migration

`scripts/db-migrate.ts` reads `sql/*.sql` sorted by file name
(`NNN_awcms_<area>_<description>.sql`, currently `001`-`034`), computes the
SHA-256 checksum of each file, runs the files not yet recorded in
`awcms_schema_migrations` in one transaction per file (with a cross-process advisory
lock), and refuses to start when the checksum of an already-applied file
changes — editing a migration that has already run (even a comment) must go through a
new migration, not by editing the old file; see the project note
`awcms-applied-migration-immutable`.

## Implementation status & remaining gaps

Already live and verified against the code (not a plan):

- Module Management enable/disable is **enforced** in `authorizeInTransaction`
  (`403 MODULE_DISABLED` before the permission lookup), not merely a UI signal.
- RLS `FORCE` on every tenant-scoped table (`sql/017`) + three-role database
  role separation `awcms_app`/`awcms_worker`/`awcms_setup` (`sql/019`,
  `021`, `022`).
- Real domain event publishing (`domain_event_runtime`) with an AsyncAPI
  that reflects real channels, not an empty baseline.
- HMAC-signed sync/outbox (`sync_storage`) and versioned workflow approval
  (`workflow_approval`) — both active modules, no longer "not there yet".
- The reporting projection read-model (incremental, idempotent rebuild,
  freshness/staleness, reconciliation) on top of the five base reporting views.
- Admin UI read **and write** for offices/profiles/users/roles/
  abac-policies/modules/email-templates (Issue #166, #171).
- **Advanced authorization**: MFA TOTP + session assurance/step-up,
  tenant-aware OIDC/SSO, Turnstile bot protection (`sql/024`–`026`), DSL-based
  dynamic ABAC, business-scope hierarchy, and SoD conflict
  enforcement (`sql/027`–`032`) — see §Auth & §RBAC/ABAC.
- **A modular OpenAPI contract** per module + a deterministic bundler
  (`openapi:bundle`, ADR-0026) — no longer a gap.
- The website module **`theming`** lives directly in the base (`sql/033`–`034`),
  the first website module after ADR-0034.
- **The `awcms-micro` website/content cluster that has been absorbed** (ADR-0035,
  the absorption roadmap): `blog-content` (`sql/035`–`045`, now including the former
  `news-portal` — ADR-0044),
  `tenant-domain` (`sql/046`–`048`), `visitor-analytics` (`sql/049`–`051`),
  `media-library` (`sql/052`–`054`, the ADR-0036 ownership inversion),
  `data-lifecycle` (`sql/055`–`056`, ADR-0037), `seo-distribution`
  (`sql/057`–`061`, ADR-0038/0039), `form-drafts` (`sql/062`–`063`), and
  `site-search` (`sql/064`–`065`, ADR-0040), and `comments` (`sql/066`–`067`,
  ADR-0041) — all active modules.
- **The `awcms-micro` auth/admin delta (Wave 2)** — per-tenant sidebar
  arrangement (`sql/071`–`072`), password reset over email (`sql/073`),
  self-registration with admin approval (`sql/074`–`075`), and the
  `/admin/security` screen. See §Auth.

Gaps that genuinely remain (do not claim them done):

- Capabilities that do not exist yet (`newsletter`, `social-publishing`,
  `document-infrastructure`, `integration-hub`) — see their respective skills
  (READ-ONLY) for the target specification, and
  [`awcms/absorb-awcms-micro-roadmap.md`](awcms/absorb-awcms-micro-roadmap.md)
  as a list of needs. **Not a port queue:**
  [ADR-0055](adr/0055-development-confined-to-awcms-and-awcms-astro.md) §1 closes
  the port path from the archive repos — each enters through **its own
  admission ADR and is BUILT here**, judged against today's needs. After [ADR-0034](adr/0034-awcms-family-direct-use-templates-and-derived-pathway-removal.md)
  domain/website modules are added **directly in this template's `src/modules/`**,
  not in a derived repo.
- The `src/components/ui/` UI component library + design-token parity (the
  Wave-0 line of the absorption roadmap, read as a need) does not exist yet; `form-drafts` ships only
  the **store**, without wizard components.
- The base business-scope hierarchy resolver is still a **fail-closed NO-OP** (awaiting
  an organization-hierarchy providing module); the base SoD ships **0 rules** (real rules
  are illustrative, in fixtures) — both are ready-to-use seams, not bugs.
