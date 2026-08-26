🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](PROJECT_STATE.id.md)

# AWCMS — Project State & Continuation

> **What this document is for.** A summary of the **durable project state** + how to
> continue the work — designed as a **versioned continuation point** (an alternative to
> private session/worktree notes that never get committed). Read this **first** when
> starting/continuing a large piece of work. It **complements**, it does not replace:
>
> - [`ARCHITECTURE.md`](ARCHITECTURE.md) — what is **in the code** (technical, per subsystem).
> - [`AGENTS.md`](../AGENTS.md) — the **working contract** (mandatory rules, guardrails, task flow).
> - `docs/adr/` — architectural **decisions** (why).
>
> The source of truth for state remains **the code + `sql/` + `bun run check`**. If this
> document differs from the code, the code is right — update this document.

## 1. Current governance model (MUST be understood)

**The AWCMS family being developed today is TWO repos, and only two**
([ADR-0055](adr/0055-development-confined-to-awcms-and-awcms-astro.md)): `ahliweb/awcms`
(this repo) as the **system of record** — the whole authorization surface, the API, and the
**SYSTEM** admin screens — and [`ahliweb/awcms-astro`](https://github.com/ahliweb/awcms-astro)
which carries **public pages as its primary function** plus the **USER admin surface when a
site declares it** ([ADR-0070](adr/0070-peran-keluarga-awcms-astro-memikul-publik-dan-admin-user.md)).
Together, the pair is the **general-purpose replacement** for the three old templates.

**`awcms-mini` and `awcms-micro` are ARCHIVES** — not continued, not a standard, not a port
source (ADR-0055 §1, superseding [ADR-0047](adr/0047-mini-micro-frozen-foundation-built-here.md)).
The "three parallel templates" position established by
[ADR-0034](adr/0034-awcms-family-direct-use-templates-and-derived-pathway-removal.md)
(superseding ADR-0013/0014/0015/0022/0025) is therefore **no longer in force**; what does
remain in force from it is the revocation of the derived-repo pathway. `awcms` = the
**ERP/back-office** line template.

Refined by [ADR-0035](adr/0035-awcms-online-first-erp-saas-superset-repositioning.md)
(`awcms` positioning): the `awcms` operating mode = **hybrid online + offline with an
online-first priority** (online is the main path; offline/LAN is the resilience mode),
**ready for integrated ERP + SaaS**, and `awcms` becomes the family **superset**: the
website/e-commerce cluster, the UI/UX, and the auth hardening of `awcms-micro` **have been
absorbed as far as they landed**, and the rest is built here through its own admission ADR
(ADR-0055 §1). The map in
[`awcms/absorb-awcms-micro-roadmap.md`](awcms/absorb-awcms-micro-roadmap.md) is therefore read
as a **list of requirements**, not a port queue — consistent with the ARCHIVE status above.
The used-directly/no-derived-repo governance model (ADR-0034 §2/§3) is **unchanged**.

- Domain modules — **ERP, website/e-commerce, and content** — are **added directly under
  `src/modules/`** of this template when it is used, then registered in `src/modules/index.ts`.
- **The derived-application pathway is REMOVED**: there is no longer a `src/modules/application-registry.ts`,
  an `extension:check` command, a `900+` migration namespace, or a derived compatibility manifest.
  Valid `ModuleType` = `base | system | domain | integration` (there is no `derived`).
- Documents/skills that still name "derived repo / derived" as an active pathway are
  **stale** — treat them as historical notes (many are already marked DEPRECATED).

**Change of 31 July 2026 — two ADRs that change how the work is done, not just what the code contains:**

- ~~ADR-0047~~ (`awcms-mini`/`awcms-micro` frozen as a reference that could STILL be ported
  out of) — **superseded by [ADR-0055](adr/0055-development-confined-to-awcms-and-awcms-astro.md)
  on 2 August 2026**: development now happens only in `ahliweb/awcms` +
  `ahliweb/awcms-astro`, and mini/micro are **archives** (not a port source). The guardrails
  of ADR-0047 §3 REMAIN; only the §4 obligation (record the divergence as it lands) is
  revoked — the ADR itself is now that record. The original context is kept below:
  `awcms-mini` and `awcms-micro` are frozen as a reference (they may be read & ported
  _out of_, they accept no changes). The consequence is that the **mini-first rule is
  suspended** — during the freeze, foundation features are **pioneered directly in this
  repo**. This is **not** a loosening: ADR §3 re-lists every guardrail the mini-first path
  used to carry, explicitly (an ADR is mandatory for standards changes, an extra security
  review for `auth`/`access`/`sync`, the full `bun run check`, OpenAPI/AsyncAPI in sync,
  RLS `FORCE`, ABAC default-deny). ADR §4: **every foundation feature that lands during the
  freeze MUST be recorded as a divergence** in `awcms-family-compatibility.yaml` **as it
  lands**, not afterwards.
- ~~ADR-0048~~ (frontend role split: platform/internal-operator screens are built in
  `awcms-astro`) — **superseded by [ADR-0051](adr/0051-admin-screens-consolidated-in-awcms.md)
  on 1 August 2026**, see the next item. The role of `awcms-astro` as experience
  layer + BFF (ADR-0045) does not change with it.

**Change of 1 August 2026 — every SYSTEM admin screen is built here:**

- [ADR-0051](adr/0051-admin-screens-consolidated-in-awcms.md): **every admin screen —
  tenant as well as owner/internal/platform — is built in this repo**, under one
  `/admin/*` shell. Since [ADR-0070](adr/0070-peran-keluarga-awcms-astro-memikul-publik-dan-admin-user.md)
  the word "every" is narrowed to **every SYSTEM admin screen**: the boundary is WHAT IS
  BEING MANAGED, not who uses it, so a **USER** admin surface may live in
  `awcms-astro` when the site declares it (`owner` is refused by the gate there). The three
  replacement gates of ADR-0051 were NOT loosened. The reasoning that changes the substance:
  **moving a screen was never a security control.** `sql/081` seeds
  `idn_admin_regions.dataset.configure`/`.restore` into the global ABAC catalogue and
  `POST /api/v1/setup/initialize` grants the whole catalogue to the `owner` role of every new
  tenant — so an ordinary tenant owner ALREADY holds the authority to change the dataset
  served to every tenant, exactly the risk ADR-0048 wanted to prevent, because
  ABAC evaluates permissions, not frontend provenance. The replacement gate is normative:
  a cross-tenant action **must** have a platform-scoped gate and **must not** enter the
  catalogue that is seeded to tenant roles.
- [ADR-0052](adr/0052-idn-region-dataset-lifecycle-is-an-operator-job.md) closes that open
  finding in the code: region dataset activation/rollback becomes an **operator job**
  (`bun run idn-regions:activate` / `:rollback`, dry-run by default), its HTTP endpoints are
  removed, and both permissions are revoked from the catalogue (`sql/084`). Gating it with
  machine credentials was REJECTED: machine credentials are read-only (ADR-0049), so widening
  them would instead make a leaked build token able to swap the global dataset. The cost
  accepted & stated: the audit row is lost, because `awcms_audit_events` is tenant-scoped
  while the action is global.

## 2. Inventory at a glance

<!-- project-state-inventory:mulai -->

<!-- Generated by `bun run project-state:inventory:generate`. DO NOT hand-edit; the gate is `bun run project-state:inventory:check`. -->

| Aspect                            | Value (generated)                                                                      | Source of truth                                                                         |
| --------------------------------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Version                           | **9.1.2**                                                                              | `package.json`                                                                          |
| Pending changesets (by bump type) | _run the command in the right-hand column_                                             | `grep -h '^"awcms":' .changeset/*.md \| sort \| uniq -c`                                |
| Commits since the last release    | _run the command in the right-hand column_                                             | `git rev-list --count v9.1.2..HEAD`                                                     |
| Base modules                      | **24** (see the list in ARCHITECTURE.md)                                               | `src/modules/index.ts`                                                                  |
| Migrations                        | **148** (`sql/001`–`148`)                                                              | `ls sql/`                                                                               |
| ADR                               | **0000**–**0114** (`0000` = template; highest ADR status: **Accepted**)                | `ls docs/adr/`                                                                          |
| Admin screens                     | **49** `.astro` files in `src/pages/admin/`; **0 of 24** modules without `navigation:` | `find src/pages/admin -name '*.astro'`, `grep -L 'navigation:' src/modules/*/module.ts` |
| `.astro` files                    | **62** (35.126 lines) — on typechecking see §6                                         | `find src -name '*.astro'`                                                              |
| Gates                             | **59** in the `bun run check` chain                                                    | `scripts.check` in `package.json`, split on `&&`                                        |
| Contracts                         | Modular per-module OpenAPI + AsyncAPI; `MODULE_CONTRACT_VERSION` **4.1.0**             | `openapi/`, `asyncapi/`, `_shared/module-contract.ts`                                   |

<!-- project-state-inventory:selesai -->

> **The numbers in this table have gone stale before with nothing turning red.** Before
> PR #339 the row read "20 files / 7 of 21 modules" while `main` already held 22 files and
> only 6 modules without `navigation`, and the ADR row stopped at `0052` even though `0055`
> had already landed. No gate checked this table — the "Source of truth" column
> now holds the command that **produces** the number, so verifying it takes one
> paste, not one manual count.
>
> **And it went stale again within a single day, on a row PR #339 did not touch.** The
> Version row read "53 pending changesets" while `.changeset/` held **68**.
> The gap is not cosmetic: one of them is of type `major`, so the next release
> is **`v7.0.0`**, not `6.5.0` — a wrong number here misleads
> release planning, not just the reader. The "Source of truth" column of that row now
> holds the command that counts them per bump type.
>
> **And stale for the THIRD time, on the same row, nine days later.**
> The second-round assessment (4 August 2026) found **100** changesets, not 68 —
> and three other rows were stale with it: ADR stopped at `0060` even though `0067` existed,
> `MODULE_CONTRACT_VERSION` was written as `2.4.0` while its source said `2.5.0`. This pattern
> will not stop by writing down a newer number; it stops only
> when this table is **generated**. Until that happens: **never quote
> this table as fact — run the command in the right-hand column.** For numbers that
> genuinely are already generated, use
> [`awcms/repo-inventory.md`](awcms/repo-inventory.md). The third round
> (5 August 2026) found a **fourth** episode on the same row —
> changesets 100→101, commits 108→113 — plus an ADR row stopping at `0067`
> even though `0068` was already `Accepted`; the instruction above applies without exception.
>
> **Closing note (5 August 2026): the fourth episode was the last.** That fourth
> staleness (changesets 100→101, commits 108→113, the ADR row) is the reason this
> table is finally **generated**: `bun run project-state:inventory:generate`
> writes the block between the markers, and `bun run project-state:inventory:check` in
> the `check` chain turns CI red when it is stale. The FAST rows — the changeset count per
> bump type and the commit count since the release — had **their numbers removed**, not
> generated: a number that moves with every commit inside a versioned document will
> always be stale, and gating it would force every PR to regenerate this
> document. Their value cell now tells you to run the command in the right-hand column, which
> is kept (this is the "removed from the table" branch of the proposal in the blockquote
> above). The three historical blockquotes above are deliberately kept exactly as they were.

> **Release:** `v6.0.0` (2026-07-21) is the **first real release** that ran
> `.github/workflows/release.yml` end-to-end (validate → build+SBOM×2 → sign/attest/publish,
> image `ghcr.io/ahliweb/awcms:6.0.0` + GitHub Release). MAJOR because of the breaking ADR-0034
> (derived pathway removed, `MODULE_CONTRACT_VERSION` 1.3.0→2.0.0). The tag procedure is in
> [`docs/awcms/09_roadmap_repository_commit.md`](awcms/09_roadmap_repository_commit.md) /
> the `awcms-release` skill (the `vX.Y.Z` tag is created **manually** via `git tag -a` — there is no
> `changeset:tag` script). **Approval gate:** the `release` environment now has a required
> reviewer (`ahliweb`, configured & verified via the 2026-07-21 rehearsal) — the publish
> job pauses at "Waiting for review" before sign/attest/publish (see
> [`release-process.md`](awcms/release-process.md) §Environment approval).

Modules (21, in `src/modules/index.ts` order): `logging`, `tenant-admin`,
`profile-identity`, `identity-access`, `module-management`, `domain-event-runtime`,
`sync-storage`, `workflow-approval`, `email`, `reporting`, `theming`,
**`media-library`**, `blog-content`, **`tenant-domain`**, **`visitor-analytics`**,
**`data-lifecycle`**, **`seo-distribution`**, **`form-drafts`**, **`site-search`**,
**`comments`**, `idn-admin-regions`.
(The eight in bold = the awcms-micro absorption wave, 2026-07-24/25 — see §3/§4.
`news-portal` **no longer exists**: merged into `blog-content` by
[ADR-0044](adr/0044-merge-news-portal-into-blog-content.md), #300.
`idn-admin-regions` (#312, ADR-0046) is **not** a port — it is the first module
pioneered directly here after the ADR-0047 freeze.)

> Note: [`awcms/repo-inventory.md`](awcms/repo-inventory.md) is now
> **generated** (`bun run repo:inventory:generate`, its `:check` gate in the
> `check` chain) — the module/migration/RLS-table/test/route numbers there are derived from
> the repo, so it may be used as a source of numbers. The §2 table above now
> follows the same pattern (`bun run project-state:inventory:generate`, the
> `project-state:inventory:check` gate in the `check` chain): the rows between the markers
> are derived from the repo, and the two fast rows deliberately carry no number — run
> the command in the "Source of truth" column.

## 3. What is already done (do not rebuild it)

- **24 modules** registered with `FORCE` RLS, DB role separation
  (`awcms_app`/`awcms_worker`/`awcms_setup`), admin SSR read+write (Issue #166/#171).
- **Advanced auth**: MFA TOTP + session-assurance/step-up (`sql/024`), tenant-aware
  OIDC/SSO + SSRF guard + break-glass (`sql/025`/`026`), profile-aware Turnstile bot
  protection (LAN/offline exempt). See [`awcms/mfa-totp-step-up.md`](awcms/mfa-totp-step-up.md),
  [`awcms/oidc-sso.md`](awcms/oidc-sso.md), [`awcms/turnstile-bot-protection.md`](awcms/turnstile-bot-protection.md).
- **Authorization**: dynamic DSL-based ABAC (`sql/031`/`032`), business-scope hierarchy
  (`sql/027`/`028`), SoD conflict enforcement (`sql/029`/`030`).
- **`theming`** — the first website module in base (`sql/033`/`034`, ADR-0034 Phase 3).
- **`blog-content`** — the public content module, ported from mini (PR #214,
  `sql/035`–`sql/045`, 19 FORCE RLS tables). Path-based public route
  `/blog/{tenantCode}` (ADR-0009). Since [ADR-0044](adr/0044-merge-news-portal-into-blog-content.md)
  (#300) this module **absorbs the whole of `news-portal`** (homepage-section composer +
  ad placement with verified media); the media registry still belongs to `media_library`
  (ADR-0036). DROPPED during the port (needs other modules that do not exist yet): the
  host-resolved `/news/**` route, full-online-R2 preset activation (`module_management` preset subsystem).
  See the `awcms-blog-content` skill §DELTA PORT.
- **UI/UX overhaul** (PR #215) — login + 8 admin screens + the public blog: mobile-first,
  CSS-only animation, a11y AA, automatic tenant picker on `/login` (hidden when there is 1 tenant).
  Presentation-only; the single-owner CSP guarantee of "zero third-party origin" is preserved.
- **Admin shell parity with awcms-micro** (PR #229) — `.admin-shell` + sticky topbar,
  tenant badge, two-level sidebar (section → owning module → link) + version footer,
  breadcrumb, KPI/detail/module-usage dashboard, and a **light/dark theme toggle that
  actually works**. The `:root[data-theme="dark"]` tokens already existed with
  nothing setting the attribute; the toggle needs a head script that runs before paint,
  so `script-src` is now **always** emitted containing `'self'` + the **SHA-256 of that one
  inline script** (a hash, NOT `'unsafe-inline'` — only one exact byte sequence is
  allowed). `tests/theme-init-script.test.ts` goes red when the script body and the hash drift apart;
  without that gate a hash mismatch fails silently (script blocked, no error/log).
  DROPPED because the supporting capability does not exist yet: LanguageSwitcher (there is no i18n
  catalogue yet), SyncIndicator, the profile link (`/admin/profile` does not exist yet), per-tenant
  sidebar arrangement. The micro JS drawer was **rejected**: the CSS-only checkbox drawer of awcms needs no
  script at all — which is better under this CSP.
- **Modular OpenAPI contracts** per module + a deterministic bundler (ADR-0026), **family
  compatibility manifest + CI conformance** (ADR-0032).
- **awcms-micro absorption — Wave 0/1 (2026-07-24/25, PR #218–#231, `sql/046`–`sql/065`).**
  Seven new modules were absorbed one-atomic-PR-per-module through the delta → coder →
  reviewer + security-auditor → real-Postgres-validation pipeline:
  - **`tenant-domain`** (#219, `sql/046`–`048`) — host→tenant routing + verified domain
    lookup (the host-resolved foundation for SEO/public routes).
  - **`visitor-analytics`** (#220, `sql/049`–`051`) — visit telemetry + rollup +
    scheduled purge.
  - **`media-library`** (#221, ADR-0036, `sql/052`–`054`) — **inversion of media ownership**:
    one module owns every per-tenant media object; the `media_library` port; `news_media`
    is retired.
  - **`data-lifecycle`** (#222, ADR-0037, `sql/055`–`056`) — generic retention/archive/purge +
    **non-bypassable legal-hold** (guard + 1 maker-checker SoD rule in base).
  - **`seo-distribution`** (#223 discovery + #224 redirect governance, ADR-0038/0039,
    `sql/057`–`061`) — a centralised SEO metadata renderer (canonical/hreflang/robots/OG/JSON-LD,
    host derived server-side) + public discovery routes (`robots.txt`/sitemap/feed) + **redirect
    governance** (exact-path rules, 404 telemetry, a fail-open `src/middleware.ts` hook,
    a frozen open-redirect guard). Consumes the `seo_facts` capability (provided by `blog_content`).
  - **`form-drafts`** (#230, `sql/062`–`063`) — a generic server-side draft store for
    multi-step forms (opaque JSONB payload, rejection of secret-looking keys, two-phase purge).
  - **`site-search`** (#231, ADR-0040, `sql/064`–`065`) — a **cross-content** PostgreSQL FTS
    index per tenant over published public content + host-resolved public
    query/suggest + a `/search` page + admin index/settings/diagnostics. A new contribution
    seam `ModuleDescriptor.searchSources` (`MODULE_CONTRACT_VERSION` 2.2.0): a content module
    DECLARES its sources, the aggregator discovers them through `listModules()` — no module
    depends on `site_search`.
  - **`comments`** ([ADR-0041](adr/0041-comments-module-admission.md), `sql/066`–`067`) —
    **moderation-first** comments on top of PUBLISHED & public resources: threads,
    depth-limited comments, append-only moderation history, reports, per-tenant settings,
    minimised anti-abuse telemetry, encrypted reply-notification subscriptions, an admin
    moderation queue `/admin/comments`. A `commentableResources` contribution seam
    (`MODULE_CONTRACT_VERSION` 2.3.0), **zero new `AccessAction`s**. The security
    backbone: the publication boundary sits at the resource→thread border, store-plain-text +
    escape-on-render (no stored XSS), uniform public responses (no oracle),
    author PII hashed/masked. Verified against a real Postgres: 67 clean migrations,
    FORCE RLS on 7 tables, worker grants exactly matching the matrix.

- **Auto-activating Varnish edge cache** ([ADR-0042](adr/0042-varnish-edge-cache-auto-activation.md),
  #234/#237, `sql/068`) — the `src/lib/edge-cache/` subsystem, the `infra/varnish/` VCL, the
  transactional purge queue `awcms_edge_cache_purges` (FORCE RLS), the `bun run edge-cache:purge`
  worker, the `bun run edge-cache:surfaces:check` gate, the `awcms-edge-cache` skill, the
  [`awcms/edge-cache-architecture.md`](awcms/edge-cache-architecture.md) document. **The `off`
  default = a total no-op.** Three independent default-deny layers; a pressure signal only
  changes _how long_, never _what_ may be cached. Purge emission is wired into the write paths of
  `blog_content` and `theming` (publish/rollback/retire, #246). `media_library`
  deliberately is NOT — it owns no declared surface, so a ban for its key would
  match nothing while the queue reports success. The `edge-cache:surfaces:check` gate
  demands a purge call-site from every module that OWNS a surface, so the obligation
  appears by itself the moment one of them declares a surface.
  **ACTIVE in staging since 2026-07-26** (`EDGE_CACHE_MODE=on`, Varnish 7.5 in
  front of Traefik, the purge worker running every minute) — and it was that activation that
  uncovered THREE bugs which had passed review and `bun run check`: a ban expression
  with a literal space (rejected by Varnish, still answered 200), the `BAN` method that
  Bun sends as a `GET`, and the `sql/068` RLS policy which used the
  `awcms.tenant_id` GUC so that **blog publishing failed with a 500** when the cache was on
  (fixed by `sql/070`). All three reported success while not working. Details
  - and the new gate in [`awcms/edge-cache-architecture.md`](awcms/edge-cache-architecture.md)
    §Lessons.
- **Tenant subdomain DNS reconciliation** (#236, `sql/069`) — desired-state
  `ensureServingRecord` (drift → `PUT`, never a second `POST`), `reconcileServingRecords`,
  `bun run tenant-domain:dns:sync` running as SELECT-only `awcms_worker`. Without
  `TENANT_DOMAIN_SERVING_TARGET` the job is a no-op — there is no default, because guessing means
  a platform-wide outage.
- **`idn-admin-regions`** ([ADR-0046](adr/0046-idn-admin-regions-module-admission.md), #312,
  `sql/080` schema + `sql/081` permissions) — versioned, provenance-carrying, rollback-able
  master data of Indonesian administrative regions; the `cahyadsn/wilayah` (MIT) dataset is vendored
  under `data/idn-admin-regions/`. **Its two tables are GLOBAL** (no `tenant_id`, no RLS —
  listed in `GLOBAL_TABLE_FORBIDDEN_PRIVILEGES`), authorization stays per-tenant
  default-deny. Import = a dry-run-by-default deployment job (`bun run idn-regions:import`,
  `awcms_worker`); activation/rollback = an audited admin action carrying an idempotency key. The
  first module **pioneered directly here** (not a port) under ADR-0047. Deliberately
  **without `navigation`**, and the reason has now changed: no longer "the screen belongs to
  `awcms-astro`" (ADR-0048, superseded) but because ADR-0052 moved
  activation/rollback into an operator job — what remains for the tenant is only two read
  permissions.
- **Read-only machine credentials + session introspection** ([ADR-0049](adr/0049-machine-credentials-and-session-introspection.md),
  `sql/082` schema + `sql/083` permissions) — a SECOND bearer that is not a human session, bound
  to a single service account. Details in §4 and in `src/modules/identity-access/README.md`.
- **Admin screen wave (1–2 August 2026, PR #321–#330).** An audit of the admin surface
  found **13 of 21 modules with not a single screen** — 125 route files usable only
  through `curl`. [ADR-0051](adr/0051-admin-screens-consolidated-in-awcms.md)
  decided all of them are built here; nine atomic PRs landed in sequence:
  `/admin/audit-trail` (#324, `logging`), `/admin/form-drafts` (#325),
  `/admin/site-search` (#322), `/admin/theming` (#327), `/admin/seo` (#329),
  `/admin/data-lifecycle` (#330), plus the zero-node sync dashboard fix (#323) and
  ADR-0052/`sql/084` (#328). **Zero migrations** for the screens themselves — their
  authorization surface already existed, only the screen was missing.
  The pattern used is uniform and worth copying for the next screen: read through the module's
  own application functions inside **one** `withTenantOrThrow` (sequential awaits — parallel
  queries on a single transaction connection leak it), write through a guarded endpoint with a
  fresh `Idempotency-Key` per click, the permission gate on the page is **UX-only** (the endpoint
  remains the authority), the `navigation` entry lands in the SAME PR (an entry without a page =
  a permanent 404 in the menu, gated both ways by `tests/admin-navigation-registry.test.ts`),
  and one `tests/admin-<module>-page-contract.test.ts` that binds every page key to
  what the route enforces AND what the descriptor declares — the antidote to the latent-authz bug
  this repo has already shipped twice. `/admin/data-lifecycle` adds one specific lesson:
  `legal_hold.create` and `.release` are gated **separately**, because SoD makes
  holding both a `critical` conflict — a single combined gate that looks tidier
  is wrong for every real operator.
- **Second admin screen wave (2 August 2026, PR #335–#338).** The four modules the
  first wave left behind got their screens: `/admin/reporting` (#335, the whole
  projection/export engine of Issue #753 + the `email-health` view that was never rendered),
  `/admin/approvals` (#336, inbox + recovery + delegation), `/admin/domain-events`
  (#337, consumer/delivery/outbox) and `/admin/sync` (#338, node/conflict/object
  queue). **Zero migrations** again — their authorization surface already existed.
  Three things the next screen must copy:
  - **Bound constants are hoisted into `domain/`, then imported BOTH ways** (the route that
    validates them and the form that renders them as `min`/`max`/`maxlength`).
    `MAX_REASON_LENGTH` had been rewritten as a bare `500` in **five**
    `workflow-approval` files and two in `domain-event-runtime`; five copies of a number
    agree until one of them is edited, and a sixth copy in the markup means the browser
    accepts what the server rejects with a 400 the operator cannot act on.
  - **One read function shared by the page AND the endpoint.** `/admin/sync` adds
    `fetchSyncConflicts` to `sync-directory.ts` and repoints
    `GET /api/v1/sync/conflicts` at it. The trap: that function returns `null`
    for empty resolution columns (the shape the page wants) while the
    endpoint had always OMITTED the key (`?? undefined`), so the route maps it
    back — a `null` where the client expects an absent key is a contract change, not a
    refactor.
  - **A surface that is not for the browser gets no control.** `/admin/sync` deliberately
    does not touch `push`/`pull`/`objects`/`status`: those are HMAC-signed NODE protocols, not
    an administrator session, and a button for them would be a control no browser
    could use — its failure would read as a bug, not as a category error.

- **Two really deployed environments** — production `awcms.ahlikoding.com`, staging
  `awcms-staging.ahlikoding.com` (Coolify, the same host, separate DB & secrets). Staging is
  fully migrated (69 as of 2026-07-26; the repo now holds 90 migrations — this number moves,
  verify it with `ls sql/`) and runs as a separate least-privilege role. Details,
  including the "the Coolify user is a superuser so RLS is inert" trap, are in
  [`awcms/environments.md`](awcms/environments.md).

## 4. Backlog / next steps

- **ORIGIN ROUND — 26 August 2026: the cutover map was right about where to send
  a reader and wrong about WHO would send them, and no gate in this repo could
  see it because the answer lived in another repo.**

  **A merged ADR is false.** ADR-0113 §Consequences said, in both languages,
  _"`awcms-astro` needs no change for this… the redirect is resolved in this repo
  before its routes are reached."_ `awcms_seo_redirects` is applied at **exactly
  one call site** — `resolvePublicRedirectForRequest`, from
  `src/middleware.ts:341` — which runs HERE. The 62 rubrik rules target
  `/kategori/**`, which is served by `ahliweb/awcms-astro`: `output: "static"`,
  **no middleware file at all**, no `redirects:` key, and a production entrypoint
  `server/penyaji.mjs` containing zero occurrences of `301` or `Location`.
  `grep -rn seputarborneo` over its whole `src/` and `docs/` returns nothing.

  Not argued — run. All 67 committed entries were replayed against that repo's
  real built server: **404 on every one, zero `Location` headers.**

  Two decisions follow, recorded as **ADR-0114**. The **edge** (Coolify/Varnish)
  owns the legacy 301s, because it is the only layer that can collapse
  `http→https` + `www→apex` + `legacy→new` into the ONE hop PRD §9.2 demands —
  an application only sees a request after the edge has already acted on scheme
  and host, so any rule it writes is at best hop two. And article resolution is
  **id-keyed**, not exact-path: `/news/{id}_{Title}.html` matches on its leading
  digits against `legacy_source_id`.

  **The shipped article template matches 0 of 25,029 URLs, and fails worse than
  a 404.** Every legacy title contains a space, so every legacy URL segment
  carries `_` — which `SLUG_PATTERN` at `legacy-import-record.ts:117` forbids,
  while `normalizeRedirectPath` preserves case, decodes nothing, and matches by
  equality. **No slug that can pass the validator can ever equal the indexed
  segment**; the two slugs are disjoint by construction. Confirmed externally:
  2,297 of 2,297 archived `/news/*.html` URLs use the underscore form. And an
  unmatched `/news/**` does not 404 — it falls through to
  `resolveRetiredNewsRedirect` and 301s into `/blog/{code}/{id}_{Raw_Slug}.html`,
  which is `CUTOVER_VERDICT_REASON.target_missing` in its own words: _"a 301 into
  a 404, which is worse than the 404 it replaces"._ The inference error is worth
  naming: **"the id is the leading digits" is true of the LEGACY router and says
  nothing about awcms, whose rule keys are exact strings.**

  **Shape 4 has never existed.** `^cari_berita/([^/]*)\.html$` is `.htaccess`
  line 7 and the two-segment catch-all is line 6, and shape 4's language is a
  strict SUBSET of the catch-all's — so it has never been reached, in any commit
  that ever touched the file, and both docker vhosts carry the same pair in the
  same order. It is rule ORDER, not the `[L]` flag: by line 7 the URL is already
  `/rubriks/?news=cari_berita&kt=…`. Brute-forced over 3,375 candidate paths (0
  matches, with a self-test that DID find a counterexample when shape 4 was
  artificially widened), confirmed live (`/cari_berita/sampit.html` and
  `/rubriks/?news=cari_berita&kt=sampit` differ on one line, `og:url`), and
  confirmed against 5,174 archived URLs of which zero are `/cari_berita/*.html`.
  So ADR-0113's shape-4 decision decided an empty set, and #711's open item
  _"`cari_berita` rules — needs the live sitemap"_ is dissolved twice over. The
  residual matters: `/cari_berita/X.html` still serves 200 **as a shape-3 URL**
  and must never become a `/cari?q=` redirect, which would send readers somewhere
  the legacy site never sent them.

  **Two gates would have reported green over all of it.**
  `blog:legacy:cutover:verify` exits **0 on every usage error** — `usage()` at
  `scripts/blog-legacy-cutover-verify.ts:82-93` omits `process.exitCode = 1`,
  reproduced for no args, each missing required flag, and `--limit=abc`, so
  `bun run blog:legacy:cutover:verify --sitemap=$F && deploy` deploys when the
  flag is misspelled. And `classifyCutoverOutcome`
  (`cutover-verification.ts:137`) handles only `targetLive === false`;
  `targetLive === null` falls through to `return "ok"`, and the script's
  `postSlugFromPath` returns `null` for anything that is not
  `/blog/{tenantCode}/{slug}` — which is **every one** of ADR-0113's 62
  `/kategori/*` targets. Combined, the gate would have printed _"All N legacy
  URL(s) resolve in one hop to a page this deployment serves"_ while the origin
  404'd all 67. **A gate that is green while its answer is wrong is the failure
  mode**, and this is the clearest instance the repo has produced.

  **The importer silently drops every lead photograph.** `featured_media_id`
  exists (`sql/035:46`) and is served to `awcms-astro`, but
  `LegacyPostImportInput` has 12 fields and none is media, and the INSERT names
  16 columns without it. **25,029 of 25,029 articles have a featured image** in
  `foto_berita`, and `--images` scans body HTML only, so it will never mention
  them: the real media task is ~25,031 uploads / 4.1 GB, not the 2 that body
  scanning finds. Three smaller defects sit beside it — `--images` collection
  sits BELOW the category gate (`blog-legacy-import.ts:443-458`), so a run
  without `--term-map` reports zero images, the same ordering bug already fixed
  one function up at `:435`; there is a `seenLegacyIds` set and no `seenSlugs`,
  and the real archive has 84 collision groups across 171 rows, so a real run
  dies on a 23505 mid-batch; and the docstring claiming _"EVERY row of a real
  CKEditor archive was residue"_ is measured at **4 of 25,029 (0.02%)**.

  **`IMPORT_CHUNK_SIZE = 200` is tied to `MAX_IMPORT_ITEMS` by a COMMENT ONLY** —
  no import, no test. This repo's recurring class, stated again: **a comment is
  not a call.**

  **Three record corrections.** The archive is **25,029**, not 23,906 (live is at
  id ≥ 25,474); ADR-0114 carries the single correction and merged changesets are
  deliberately not rewritten. The committed rubrik map has one real gap —
  `/Mitra-Borneo/Pemkab%20Lamandau.html` returns 200 with a real listing and is
  not among the 67, because the homepage emits it without `.html` and the capture
  keyed on the suffix. And **Wayback CDX holds 5,174 distinct URLs** for the
  domain (verified untruncated: two pages, 2,975 + 2,200), which is ~8.86% of the
  corpus — real external evidence that decays and cannot be reconstructed, so it
  is worth committing WITH that caveat, and it is not a substitute for the
  indexed set.

  **What this round leaves as work:** ADR-0114's generated id→path artefact and
  the edge wiring; the two `cutover:verify` defects; the featured-image handoff
  and the three importer defects; the `IMPORT_CHUNK_SIZE` coupling; the map's
  Lamandau gap; and capturing the CDX corpus. This entry is the record; none of
  it is code yet.

  The transferable shape, and it is a genuinely new one: **every previous round
  here asked "is this symbol called?" — this one found a decision whose target
  was served by a different ORIGIN entirely.** ADR-0113 was correct about what to
  redirect to and wrong about who would do the redirecting, and no gate in this
  repo could see that, because the answer was a build configuration in another
  repository. The check is not only "is it called" but **"is the caller even in
  the request path"**.

- **SEAM ROUND — 26 August 2026: three gates read only the English half, and a
  fourth gate had no caller at all.**

  The follow-up #728's audit demanded. The class was never "generated blocks in
  mirrors" — it is **every gate that reads the English file and stops**, and the
  two halves are always each correct about their own side.

  **76 mirror files were making claims about code that nothing read.**
  `skills:check` exists precisely because a wrong skill is worse than a stale
  doc — an agent FOLLOWS a skill — and it globbed `SKILL.md` and
  `src/modules/*/README.md`. So 55 `SKILL.id.md` and 21 module `README.id.md`
  could name a `bun run` target that does not exist, or a path that was renamed,
  with every gate green. Both corpora are widened, and three real corruptions
  now name the exact mirror.

  **The first draft of that broke the ENGLISH files, and that is the part worth
  keeping.** `checkCitedPaths` used its first argument as BOTH the report label
  AND the key for `ASPIRATIONAL_SKILLS`/`subjectModuleKey`. Passing a decorated
  label defeated both exemptions and turned a green gate into 19 false failures
  on files that were fine. Identity and label are separate parameters now, and a
  test asserts the exemption survives a supplied label. **A label is not an
  identity**, and conflating them is invisible until the exemption it silently
  disables is the thing under test.

  **The ADR index mirror was missing ADR-0100 outright** — 113 rows in English,
  112 in the mirror. `check-docs.mjs` explained its own blindness: _"Its
  Indonesian mirror is held to it by `i18n-source-hash`, not by a second copy of
  this gate."_ That hash answers "has the English changed since translation?",
  not "does the mirror list every ADR?".

  **Coverage is asserted; LINKING is not**, and the distinction was load-bearing
  rather than pedantic. The mirror links the English file for 98 of its rows and
  the `.id.md` copy for the rest, though a mirror exists for all of them.
  Demanding one form would have turned a real coverage gate into a 98-row
  reformatting demand — and that noise is how a gate gets switched off. The
  mirror may link either copy and may not omit an ADR; the English index must
  still link English, or a row could quietly point at the translation and pass.

  **And one gate had no caller.** `memory:docs:check` is not a gate with a blind
  spot — the target existed, was in NEITHER `scripts.check` nor any workflow,
  and had therefore never run once. It was failing. Its own header documents a
  CI-safe skip _"so this gate catches drift on a device that has memory rather
  than forcing CI to have one"_ — a design note that only makes sense for
  something meant to be wired in. Now it is, both halves verified: a corrupted
  snapshot exits 1, an empty `HOME` skips and exits 0. The chain is 58 → **59**.

  The transferable shape: **look for the gate that reads one of a pair.** Three
  of these four were found by asking, of every `:check` in the chain, "is there
  a second file holding the same claim?" — not by any of them failing.

- **MIRROR ROUND — 26 August 2026: a block that says "do not hand-edit" had
  nothing generating it, and the gate that should have noticed was asking a
  different question on purpose.**

  `scripts/README.md` and `docs/PROJECT_STATE.md` §2 are generated and gated.
  Their Indonesian mirrors carried the SAME block, banner included, maintained
  by hand, covered by nothing — and both had drifted: 107/48 against a real
  121/54, and an ADR range ending `0111` against `0113`, 48/61/57 against
  49/62/58, and `MODULE_CONTRACT_VERSION` **4.0.0** against **4.1.0**.

  A contract version, stated wrong, in the document whose whole job is to be an
  accurate continuation point.

  **Why no gate could see it is the interesting half, and it is not oversight.**
  `check:docs:translation` compares a sha256 of the ENGLISH source against a
  marker in the mirror. That answers "has the English changed since this was
  translated?" — exactly the right question for PROSE, which only goes stale
  when its source changes. DERIVED content goes stale when the REPO changes,
  with both files untouched, and no hash of either file can see that.

  Worse: re-stamping after any unrelated English edit silently re-blesses it. I
  nearly shipped it twice for that reason — syncing `scripts/README.id.md` by
  hand in #726 and re-stamping marked the pair current while
  `PROJECT_STATE.id.md` was still wrong.

  **The fix is a label table, not a second renderer.** Both generators now
  render every locale from ONE collection pass, so the two documents can differ
  in wording and cannot differ in fact. Two renderers can disagree, and two
  copies disagreeing is the entire defect. The translated surface turns out to
  be tiny: ten row labels, three column headers, two prose strings and the one
  source-of-truth cell that is prose rather than a bare command.

  Mutation-proven in BOTH directions — corrupting a mirror value reddens the
  gate, and making a renderer ignore its locale (emitting English into the
  Indonesian file, the NEW way to be wrong this design introduces) reddens the
  test written for it.

  **The audit #727 asked for found something bigger than #727.** The class is
  not "generated blocks in mirrors"; it is "every gate that reads only the
  English half". Verified by reading each gate:

  - `checkAdrIndexCoverage` reads `docs/adr/README.md` only.
  - `skills:check` globs `SKILL.md` and `src/modules/*/README.md` — **55
    `SKILL.id.md` and 21 module `README.id.md`** are checked by nothing, so a
    mirror can name a `bun run` target that does not exist. That is precisely
    the hazard already recorded as "a stale skill flips direction".
  - `graph:artifacts:check` hardcodes `docs/awcms/knowledge-graph.md`.
  - `memory:docs:check` exists, is CI-safe by construction, and is in NEITHER
    `scripts.check` nor any workflow — **a gate that has never run once.** It
    fails today.

  The last one is its own category and worth naming separately: not a gate with
  a blind spot, a gate with no caller.

- **CALL-SITE ROUND — 26 August 2026: ADR-0113's normalisation was wrong three
  days after it merged, because it named a function nothing calls — and the
  corrected map is now committed.**

  The DECISION in ADR-0113 is unchanged. Its mechanics were wrong, and the way
  they were wrong has now happened three times in this repo.

  **`seo_title()` is dead code.** The ADR said the shape-2/3 map keys on
  `seo_title(jenis_rubrik)`. That function is **defined nine times** across the
  legacy PHP tree and **called ZERO times** — and the nine copies do not even
  agree: `index.php` replaces spaces with `_` while the other eight use `-`.
  `rubriks/index.php` binds the URL segments RAW, after a `trim()`, straight
  into `WHERE jenis_rubrik = ? AND kategori = ?`.

  So a legacy rubrik URL segment is the COLUMN VALUE, not a slug of it — and the
  `MITRA BORNEO` / `MITRA-BORNEO` collapse warning, which the previous round
  called "one thing the data shows that no amount of planning could have", was
  wrong as well. As raw segments they are different paths that never collapse,
  and neither is linked from anywhere, so neither needs a rule.

  **The pattern, third occurrence.** `replaceMenuItems` was a function name
  written from memory that did not exist. `awcms_blog_pages.legacy_source_*`
  were columns asserted to exist by a test over a migration's source text, with
  no reader. Now a function quoted in prose and never called. All three read
  exactly like working code to anyone who does not go looking for the call site.
  **Grep for the CALL, not the definition.**

  **What the URLs actually are.** Nothing in the legacy tree generates a rubrik
  link from a column value; every one is a hand-typed literal. That makes the
  set **enumerable and COMPLETE rather than a sample** — a crawler could only
  reach what was linked. There are 67, now committed with provenance at
  `data/seputarborneo-legacy/`.

  Two properties decide the work, and neither was visible from the plan:

  - **Casing is load-bearing HERE and was not on the legacy site.** MariaDB's
    `utf8mb4_unicode_ci` made `rubrik/Hukum.html` and `rubrik/hukum.html` the
    same page (5,183 articles each). This repo matches by EQUALITY and preserves
    case, so both spellings need their own rule. Five rubriks were linked in
    both.
  - **32 of the 67 resolved to ZERO articles** — dead nav/footer links for
    years, serving HTTP 200 with an empty listing rather than a 404, so they are
    likely indexed as thin pages. Eight are leftovers from the template this
    site was built from and name places in SOUTH SUMATRA.
    `rubrik/Olah Raga.html` is dead because the column value is `OLAHRAGA` with
    no space, and a case-insensitive collation does not close a whitespace
    difference.

  62 rules over 10 destination categories. Because the decision drops `kt`,
  every URL of either shape lands on its parent rubrik's archive, so the map is
  a function of the first segment alone.

  **The map is committed because it CANNOT be re-derived.** Building it needed
  the legacy PHP working copy and the populated MariaDB volume, both of which
  exist on one workstation and ship nowhere. This is the VOLUME ROUND's lesson
  running forward instead of backward: that round found an artefact that was
  presumed missing and was not, and the answer to "it exists today" is to
  capture it, not to note that it exists.

  The tests assert what the write path would DO with each entry — every source
  path and target through `normalizeRedirectPath`, `validateRedirectTarget` and
  `isValidSlug` — rather than that the file parses. Its cautionary sibling
  `tests/legacy-redirect-map.test.ts` asserted that a migration's SOURCE TEXT
  contained `ALTER TABLE awcms_blog_pages`, which proved a column existed and
  could not notice nothing read it; those columns were dropped in `sql/147`.
  `findMapProblems` is itself tested against three corrupted entries, because a
  validator nobody has seen fail is a validator nobody has tested.

- **CAPTURE ROUND — 25 August 2026: the public 404 telemetry write had no rate
  limit, and the document that called its cardinality bounded was justifying a
  partitioning decision with it.**

  The audit started from the two open issues rather than from a scan. #599 was
  expected to take `awcms_seo_redirects` from near-empty to **25,029** rules per
  tenant (this entry said 23,906 — see ADR-0114 for the count correction) with
  ADR-0113 adding ~60 more, on a path that runs for every reader and every
  crawler — so that path was the thing worth measuring. **ADR-0114 has since
  removed that load entirely**: the SeputarBorneo 301s execute at the edge, so
  this table does not grow by 25,029 rows. The measurement below stands on its
  own for any tenant that does author rules at that scale.

  **The resolve half is sound**, and worth recording so nobody re-audits it:
  `MAX_REDIRECT_HOPS = 5` bounds the chain walker, and
  `awcms_seo_redirects_resolve_idx` is a partial index on exactly
  `(tenant_id, normalized_source_path) WHERE deleted_at IS NULL AND state =
'active'`. 25,029 rules is a B-tree point lookup, not a scan.

  **The capture half was not.** `recordPublicNotFound` fires after ANY public
  request that resolves to a tenant and 404s — unauthenticated, its own
  transaction, one `INSERT … ON CONFLICT` per request. Its aggregation key is
  `(tenant_id, normalized_path, referrer_domain, locale, domain_host)`, and the
  caller controls two of the five: the path is whatever they request, and
  `referrer_domain` is the hostname of whatever `Referer` they send, with no
  allow-list. `/a1 … /aN` is N rows, each multipliable again by varying
  `Referer`.

  **What made it look handled is the interesting part.** Two documents called it
  bounded:

  - `not-found-directory.ts` — "bounded cardinality + bounded retention";
  - `module.ts` — "cardinality is bounded by distinct 404 paths, not by traffic",
    which is the stated justification for `partition.eligible: false`.

  The upsert collapses REPEATS of one key and does nothing about distinct keys,
  and there is no fixed set of "404 paths" — the set is whatever anyone
  requests, so distinct keys are produced BY traffic, exactly what the rationale
  denies. **A false claim in a rationale is worse than a false claim in a
  comment, because a rationale is load-bearing for a decision** — here, not
  partitioning. The decision survives; the reason it survives is now the true
  one, and it says outright that raising the rate limit substantially means
  re-examining it.

  Worth noting the `sql/060` DDL comment is CORRECT as written: it says "a bot
  probing the **same** 404 a million times is one row". The claim only became
  false where it was paraphrased into the application layer and the registry.

  **The sibling already had the answer.** `POST /api/v1/analytics/collect` is
  the same kind of endpoint — public, anonymous, one row per request — and has
  carried a per-IP `checkSharedRateLimit` backstop since it shipped, for a
  threat its own comment states in terms that transfer word for word. This path
  had none. It now uses the same limiter at the same 120/60 s default, keyed on
  **IP only, never the tenant**, so the beacon's no-oracle contract is kept and
  a refusal reveals nothing about whether a tenant exists. Nothing is refused to
  the visitor — the 404 is already produced — and the skip is silent, because
  logging per refused write hands the same flood a second amplifier.

  **A per-tenant distinct-row cap was considered and NOT taken.** It bounds
  storage harder, and it introduces a failure mode that does not exist today: an
  attacker who fills it makes real 404s invisible. The rate limit plus the
  already-declared age-based purge (30d default, 7d floor) bounds the steady
  state without buying that.

  The proof is a differential rather than an assertion, because the function is
  fail-open by contract and "it did not throw" is true whether it refused early
  or tried and failed: with `DATABASE_URL` unset the DB step logs
  `seo_distribution.not_found.capture_failed`, so within budget logs it once and
  over budget logs nothing at all.

- **BOUND-AND-BATCH ROUND — 25 August 2026: the one uncapped batch in the API
  sat next to the one N+1 the last sweep could not see.**

  **The scanner was looking for backticks.** The BOUND ROUND below scanned
  `src/**/*.ts` for a tagged-template `await` inside a loop body and found 34
  loops. `GET /api/v1/blog/menus` contains
  `for (const menu of menus) { … await fetchMenuItems(tx, …) }` — a plain
  function call, so it was never a candidate. Re-run against the set of
  functions that _transitively_ issue SQL rather than against SQL syntax, the
  same scan surfaces 45 sites. **Matching the syntax rather than the query hid
  every N+1 routed through a helper**, which in a repo with an application layer
  is most of them.

  The endpoint cost 1 + N queries, N up to the 100 `listMenus` returns, all
  serial by necessity — one Postgres connection serves one query at a time, so
  the `Promise.all` the code explicitly warns against would hang rather than
  parallelise. Now one `menu_id = ANY(…)` grouped in memory.

  **And the write it reads from had no count bound at all.** Checked against all
  18 routes that accept a body array: every other one declares a cap
  (`MAX_IMPORT_ITEMS = 200`, `MAX_IDS`, `MAX_NODE_ACTIVATIONS = 128`,
  `/sync/push`'s new one), and menu `items` was the only exception. The 128 KB
  body tier allowed roughly 1,250 items per menu, so 100 menus × 1,250 was a
  125,000-row response. `MAX_MENU_ITEMS = 200` now sits in the one validator
  both routes already reach the database through.

  **The bound could not be a bare `LIMIT`, and this is the transferable part.**
  `syncMenuItems` is a FULL REPLACE. A client that reads a menu, edits it and
  saves it back sends what it was shown — so a read that quietly stopped at the
  cap would make that round trip DELETE everything past it. Adding the obvious
  `LIMIT` would have converted an unbounded read into silent data loss. The
  read returns `{ items, truncated }`, reads cap + 1 rows to know which it is,
  and both endpoints surface `itemsTruncated`.

  Two smaller things fell out. `sort_order` is not unique and the read ordered
  by it alone, which was survivable while the read was unbounded and is not once
  a bound can cut the list — an undefined order makes an arbitrary 200 of 250.
  And the count is checked BEFORE the per-item pass, because after it an
  oversized array of invalid entries would still be walked in full and emit
  several errors per entry; asserting the error COUNT, not just `valid: false`,
  is what separates the two orderings in the test.

  `GET /api/v1/blog/menus` is consumed by `ahliweb/awcms-astro`, and the frozen
  consumer contract still passes WITHOUT regeneration — the change is additive
  for a reader, and that repo reads menus at build time and never writes them.
  Its `Menu` type does not carry `itemsTruncated`, so a tenant whose menu
  exceeds 200 items would render 200 there with no warning. That is a cross-repo
  question, not a regression introduced here.

- **DECISION ROUND — 25 August 2026: #711's remaining blocker was a decision,
  and it has been taken (ADR-0113).**

  Shapes 2 and 3 both 301 to `/kategori/{jenis_rubrik}` with `kt` dropped. The
  reasoning is in the ADR; three things it settles are worth repeating here.
  **Two claims in this entry as first written have since been retracted** — the
  `seo_title()` normalisation (CALL-SITE ROUND above) and the shape-4 decision,
  which decides a URL family that has never existed (ORIGIN ROUND above).

  - **Flattening was chosen because a wide answer beats a wrong one.** The
    alternative that also needed no new routes — `jenis_rubrik` as category,
    `kategori` as tag — drops the AND, so `/hukum/pidana.html` would land on
    `pidana` articles from every rubrik. That is a wrong page. Flattening lands
    the reader on a broader list, which is a different kind of imperfect.
  - **Term provenance DISSOLVED instead of being built.** #711's third DoD item
    offered a choice between adding `legacy_source_id` to `awcms_blog_terms` and
    hand-writing a `--term-map`. Under this decision shapes 2/3 are exact-path →
    exact-path rules that never look up a term row, so neither is needed. That
    matters because `sql/147` has just deleted the `awcms_blog_pages`
    provenance pair added on the same reasoning and never wired to a reader:
    answering a requirement by building a second dead column would have repeated
    it exactly.
  - **A trailing slash is not stored**: `/kategori/hukum/` normalises to
    `/kategori/hukum`, checked against the code rather than assumed. (The second
    constraint recorded here, percent-encoding a query target, existed only to
    serve the retracted shape-4 rule and now has no caller.)

  What is left on #711 is data work. The **ten** destination categories must
  exist in the tenant BEFORE the map is used, or every rule 301s into a 404 —
  ADR-0111's failure one step over. This entry said "47-or-fewer"; 47 was an
  upper bound on `jenis_rubrik` under MariaDB's case-insensitive collation
  (a JS map keyed by exact name sees 48/45), never a count of destinations.

- **VOLUME ROUND — 25 August 2026: #711's first blocker does not exist, and the
  0-byte file everyone read as the evidence is inert.**

  Two entries below say the rubrik shapes are blocked because "the rubrik list
  needs data the working copy does not have (`seputa58_sbb.sql` is 0 bytes)".
  The file IS 0 bytes. It is also **not where the data lives**, and has not been
  since the first time that container started.

  `docker-compose.yml` mounts it only as an initdb seed
  (`/docker-entrypoint-initdb.d/`), while the datadir is a named volume. On this
  machine `seputarborneocom_db_data` holds **411 MB** with a populated
  `seputa58_sbb`. An initdb script runs ONLY against an empty datadir, so the
  empty file has been inert ever since — which is exactly why nobody noticed it
  was empty: nothing ever depended on it.

  **And there is no rubrik table because there was never meant to be one.**
  `include/rubrik.php` answers `/rubriks/?news=X&kt=Y` with
  `SELECT ... FROM berita_red_tayang WHERE jenis_rubrik = ? AND kategori = ?` —
  `jenis_rubrik` and `kategori` are COLUMNS on `berita_red`. Measured against a
  throwaway copy of the volume: **25,029 articles, 47 distinct `jenis_rubrik`,
  46 distinct `kategori`, 102 distinct pairs.** The list was a `SELECT DISTINCT`
  away for as long as the issue has said it was missing.

  **One thing the data shows that no amount of planning could have.** Both
  `MITRA BORNEO` (11,767 articles) and `MITRA-BORNEO` (133) exist. Shape 3's URL
  segments are `seo_title()` output — punctuation stripped, spaces to `-` — so
  the two collapse to the SAME slug while a plain `DISTINCT` reports two
  rubriks. A map built from the distinct list without normalising through the
  same `seo_title()` mis-keys the LARGEST rubrik in the archive. That is the
  shape-3 warning one level down: enumerating the shapes is not enough if the
  values inside them are not normalised the way the legacy code normalised them.

  **The second blocker stands and is the real one.** Where `/rubrik/x.html`
  should 301 to is a cross-repo contract question (ADR-0045/0070: the news
  archive is rendered by `ahliweb/awcms-astro`). Having the list does not answer
  it, and guessing the destination vocabulary produces exactly the
  mass-wrong-301 outcome the issue exists to prevent. So no map was built —
  #711 is now blocked on ONE thing, and it is a decision rather than a missing
  artefact.

  The transferable part: **"the artefact is missing" is a claim about a
  filesystem, and a filesystem is not the only place an artefact can be.** The
  0-byte dump was checked, correctly, and the conclusion drawn from it was
  wrong because the check stopped at the file the compose entry named first.

- **BLANK ROUND — 25 August 2026: the integration suite has ZERO failing tests,
  and the nine I twice reported as pre-existing were my own environment.**

  Stated plainly because it was stated wrongly twice, once in a merged PR body
  (#716: _"the integration suite shows 9 failures both with and without this
  branch"_). True as written — they did fail both ways, so the no-regression
  comparison held — but it reads as repo breakage and there was none. With the
  environment set correctly the suite is **567 pass, 0 fail**.

  Seven of the nine came from `export A=... B=$A` in my own shell: **`$A` is
  expanded before `A` is assigned**, so `SETUP_DATABASE_URL`/
  `WORKER_DATABASE_URL` were set to the EMPTY STRING rather than to the URL.
  The other two came from local `APP_URL=http://localhost:4321` — `site-origin`
  takes the scheme from `APP_URL`, and two tests assert host-absolute `https://`
  URLs. Neither is a defect in anything but the way I invoked it.

  **The empty-string half WAS a real defect, in the code.**
  `getNamedDatabaseClient` resolved
  `process.env[name] ?? process.env.DATABASE_URL`, and `??` falls back only on
  null/undefined — so a blank value is "configured", shadows the fallback, and
  produces

  > `WORKER_DATABASE_URL (or DATABASE_URL as a fallback) is required to connect
to the database.`

  with `DATABASE_URL` set and correct. **An error that names the fallback it has
  just refused to use** — close to the worst possible message, because it sends
  the reader to check the variable that is already right. The per-kind URLs are
  documented as OPT-IN (unset means fall back), and blank is exactly what an
  operator produces trying to express that: a compose key with nothing after it,
  a PaaS row saved empty (this deployment uses Coolify), or the shell form
  above. `readConfiguredUrl` now treats blank and whitespace-only as unset.

  The transferable part is not the `??`. It is that **a failure I had already
  written into my own memory as a known trap still cost me two rounds of wrong
  reporting**, because the error message was assertive and pointed somewhere
  plausible. An error that confidently names the wrong cause is worse than a
  vague one; it recruits the reader into confirming it.

- **NAME ROUND — 25 August 2026: the third N+1 write path is closed, and the
  reason it looked hard was a defect in MY OWN triage rather than in the code.**

  The BOUND ROUND below deferred one site with a stated reason. Both halves of
  that reason were wrong, and the way they were wrong is the point.

  **It was called `replaceMenuItems`. No such function exists.** The real one is
  `syncMenuItems`. The name was written from memory rather than read from the
  signature, and it propagated into a GitHub issue, a merged PR body, a merged
  changeset and BOTH copies of this document before anything caught it —
  because nothing checks a function name that appears only in prose. This is the
  rule already recorded as "cite the FILE, not a note about the file", and this
  time the note was my own from ten minutes earlier.

  **And "its callers depend on the order of its `RETURNING`" is false.** It has
  two callers, and `blog/menus/[id].ts` fills the SAME response field from
  `syncMenuItems` (roots-then-children) or from `fetchMenuItems`
  (`ORDER BY sort_order`) depending only on whether the request supplied
  `items`. The endpoint already answers in two different orders, so no client
  can be depending on either. The claim was never verified; it was inferred from
  the presence of a `RETURNING` clause.

  What was left once both were checked: **nothing needing a decision.**

  - The self-FK is `NOT DEFERRABLE`, and a `NOT DEFERRABLE` foreign key is
    checked by an AFTER ROW trigger firing at the end of the STATEMENT, not
    after each row. Verified against a real Postgres with the child listed
    FIRST — the arrangement that must fail if checking were per-row. So one
    multi-row INSERT is safe whatever the order within it.
  - `RETURNING` was not needed at all. `MenuItemInput` carries all seven
    columns, `tenantId`/`menuId` are parameters, the table has no user triggers,
    and no `DEFAULT` applies to a column that is always given a value — so the
    clause read back exactly what had just been sent.

  Now two statements. The roots-before-children order is kept, but its docstring
  no longer claims to be load-bearing: it is retained because it is what the
  function RETURNS, and changing that would be a silent API change riding along
  with a performance fix.

  **One test in the first draft asserted something false, and it passed.** A
  case named "a child listed BEFORE its parent still lands" claimed the old code
  "could not have done this at all". It could: `syncMenuItems` filters roots and
  children itself, so the caller's order never reaches the INSERT and the case
  passed under the per-item loop too. Green, and proving nothing it said it
  proved. Rewritten to assert what it actually covers — that input order changes
  neither what lands nor what returns — and the header now says outright that
  the FK property is NOT reproducible through this function, so no future reader
  mistakes the case for evidence of it.

  Both real properties are mutation-proven: dropping a field from the batch so
  the stored row diverges from the input reddens "what it RETURNS is what the
  table holds" (the check that makes building the answer from input safe at
  all), and restoring the per-item loop reddens the budget.

- **BOUND ROUND — 25 August 2026: one API endpoint accepted an unbounded batch,
  and a function that calls itself a twin of a fixed one kept the defect.**

  A scan of `src/**/*.ts` for a tagged-template `await` inside a loop body found
  **34 loops**. Most are bounded — by a code registry, by a declared cap
  (`MAX_NODE_ACTIVATIONS = 128`, `MAX_SIDEBAR_ROWS`), or by a job's batch size —
  and several were already batched or were scanner false positives. Two were
  not, and they are different kinds of finding.

  **`POST /api/v1/sync/push` had no count bound at all.** The validator checked
  every event in the `events` array and never the array's length; the only limit
  was `readTextBody(request, "large")` at 5 MB. A minimal event serialises to a
  couple of hundred bytes, so one authenticated request could carry on the order
  of **30,000 events** — each accepted one costing a compare-and-set on the
  aggregate version plus an inbox INSERT, each conflicted one a conflict INSERT,
  all sequential, all inside a single transaction that holds a connection and
  keeps every aggregate row it has advanced locked until commit. The cost is not
  the round trips; it is how long everything else waits behind them.

  Meanwhile `/sync/pull` has clamped reads to 500 since it shipped. **The two
  halves of one protocol had asymmetric bounds, and the unbounded half was the
  one that writes.** `MAX_SYNC_PUSH_EVENTS` is now defined AS
  `MAX_SYNC_PULL_EVENTS` rather than as a second `500`, and `pull.ts` imports
  the same constant — the reason for the number is the relationship, and two
  independent literals that agree today are how the asymmetry returns the next
  time one is tuned. The test asserts the relationship, not the value.

  REFUSED, never truncated (the #180 posture): a node treats an accepted batch
  as accepted in full and would advance its cursor past events that never
  landed. Reported as ONE error, not one per event — an error body carrying a
  field error for each of 30,000 events is its own denial of service.

  **The gate that made this honest.** Adding `maxItems: 500` to the OpenAPI
  schema reddened `openapi-bundle.test.ts`, which freezes every pre-migration
  path. The allow-list it wanted the entry in is called
  `INTENTIONALLY_EVOLVED_PATHS` and its two existing entries both read
  "backward-compatible". This one is not: it is document-additive but a genuine
  NARROWING for a caller, and the entry says so. A frozen-contract test earns
  its keep exactly here — not by blocking the change, but by refusing to let it
  be filed under the wrong description.

  **And the second finding, which is about how sibling defects survive.**
  `syncPostInstitutionAssignments` issued one INSERT per institution. Its own
  docstring says it is "exactly like `syncPostTermAssignments`" — and it was, in
  contract and not in cost. The term path was flattened to two statements in the
  PERFORMANCE ROUND when `blog:legacy:import` made a 23,906-article archive its
  caller; this path, which the SAME importer drives through the SAME post
  payload, kept the loop. It now uses the same `DELETE` + `INSERT ... unnest`.

  Worth keeping: **a sibling that advertises itself as a sibling is the easiest
  kind of defect to miss**, because whoever fixed the first one had already read
  the second and remembers agreeing with it. The docstring that should have led
  a reader there is the very thing that made it feel already handled.

  Its budget is a SEPARATE file from the term one, deliberately: two budgets in
  one file go green the moment either regresses and the other absorbs it. And
  the mutation proof shows why the fixture must exceed the budget — restoring
  the loop reddens the ten-institution case and leaves the one-institution case
  passing, because `1 + 1 = 2` either way.

  The third instance, `syncMenuItems`, was deferred here and is closed by the
  NAME ROUND above. **Two things this entry originally said about it were
  wrong**, and both are corrected there: it was named `replaceMenuItems`, a
  function that does not exist, and its callers were said to depend on the order
  of its `RETURNING`.

  **The sweep is now closed out in #715, and two more of its claims were
  wrong.** "The backfill jobs iterate TENANTS at the outer level, so their cost
  is a product" — true, and not a defect: `withTenantOrThrow` opens a
  transaction with the tenant GUC set, so batching across tenants would mean
  bypassing RLS, and BOTH jobs say so in their own comments
  (`entitlement-backfill-job.ts:94`: _"a single cross-tenant SELECT would return
  nothing at all rather than everything"_). A second finding filed there — that
  the entitlement backfill over-reports its grant count and leaves a tenant's
  grants non-atomic — was also overstated and is corrected in the issue: the
  plan already skips `already_held`, and the job is idempotent and re-runnable,
  so the count is accurate outside a race and partial state converges on the
  next run.

  Of 34 sites, **four were worth acting on**. Three are above; the fourth is
  `business-scope-expiry-job`, whose two passes each issued one INSERT per
  expired item under a cap of **500** — more than twice the blog sweeps' bound.
  Its exception pass now uses `recordAuditEvents`, the batch form of the writer
  its own loop was calling, with the rows unchanged. Everything else is bounded
  by a registry, deliberate with a written rationale, or needs a rewrite rather
  than a batch (`module-usage-report` is 21 DIFFERENT queries via a `switch`, so
  a `UNION ALL`, not a batch).

  One thing that pass exposed which is not about performance: **the SoD expiry
  test asserted the status flip and nothing else.** Moving that write to a batch
  writer would have left every assertion in the file green even if the batch had
  dropped its audit rows entirely. Recurring shape — a test that covers the
  state transition and not the record OF the transition is exactly the test that
  cannot notice a writer being swapped underneath it.

- **DIRECTION ROUND — 25 August 2026: the enforcement gate asked its question
  one way round, and the missing direction is the one with the dead endpoint
  behind it.** Recorded as open by the REGISTER ROUND below; closed here.

  `access:permissions:enforcement:check` has asked, since ADR-0057 §F, whether
  every permission a descriptor DECLARES has an `authorizeInTransaction` guard.
  It builds a set of every guard the source text constructs and then never reads
  that set back. The reverse question — does every guard NAME a permission some
  descriptor declares? — costs one more loop and catches the strictly worse
  failure.

  **Why it is worse.** `authorizeInTransaction` answers from
  `grantedPermissionKeys`, built by joining the actor's active role grants to
  `awcms_permissions`. A key no descriptor declares has no catalogue row to join
  to, so no role can hold it, so `evaluateAccess` returns `default_deny` — for
  the tenant owner, for the platform tenant, for every actor in every
  deployment, permanently. The endpoint is not weakly guarded; it is DEAD, and
  it answers 403 in a shape indistinguishable from a legitimate refusal. This
  repo has shipped that twice: `POST /api/v1/identity/business-scope/assignments`
  refused every input in every deployment (#180 F2), and
  `blog_content.pages.publish` meant no page could be published by any code path
  while public search filtered on `status = 'published'` and therefore always
  returned nothing (ADR-0057). Both were found by hand, months later, by
  someone building a screen.

  **The gap was live, and the gate's own scanner is what proved it.** Asked
  backwards, the repo produced exactly one violation:
  `seo_distribution.redirect.purge`. That route guards on
  `action: (lifecycleAction === "purge" ? "delete" : "update")`, and
  `readActionValues` collected every string literal in the expression —
  including the one the ternary tests AGAINST. The scanner invented a permission
  the route never demands, and it sat in the enforced set unremarked for as long
  as nothing read that set back.

  Worth keeping, because it is the reason a one-directional gate is not merely
  half a gate: **a false positive that is harmless in one direction is a
  failure in the other.** An invented ENFORCED key matches nothing and is
  ignored by the forward loop. The same key, read as "a permission this repo
  demands", is a reported defect. Any gate that accumulates a set for one
  purpose has to be re-audited before that set is read for a second.

  Both halves fixed. Comparison operands are dropped before literals are
  collected — only the operand, never the whole condition, because the comments
  routes write `decision === "approve" ? "approve" : "reject"` where `approve` is
  both tested for and yielded. Removed WHOLE, quotes included: blanking to `""`
  re-pairs the surrounding quotes so the GAPS between real literals (`" ? "`,
  `" : "`) start matching as literals. This fix's own first draft did that and
  invented four permissions per route, which is why it is pinned by a test
  rather than left to the shape of a regex.

  The staleness rule changed with it. "Stale if the permission is not declared"
  makes an exception excusing an UNDECLARED guard impossible to write —
  recording one would immediately report it stale. An exception is now stale
  only when it excuses nothing.

  Ships with the exception list still EMPTY in both directions: 244/244 declared
  permissions have a guard, and every guard names a declared permission.
  Mutation-proven twice at the gate (revert the scanner fix → the phantom is
  reported; typo an activity code → both its actions are reported) and once per
  new test.

  Also closed here, the other item the REGISTER ROUND left open: **the push
  fan-out was `R + (R x S)` queries.** `enqueuePushToRecipients` did one
  subscription lookup per recipient and then one `INSERT` per device, inside a
  single transaction on one connection — 1,500 round trips for 500 users with
  two devices each. Nothing in production ever paid it: the only caller,
  `POST /api/v1/push/test`, passes one recipient. That is the reason to fix it
  rather than leave it — the cost is not a property of the function as used but
  of its contract ("every recipient"), waiting for the first caller that
  broadcasts, and it would arrive as an incident rather than a review comment.
  Now one batched lookup and one `INSERT ... jsonb_to_recordset`. The cheap
  cases did not get more expensive: zero recipients still costs zero queries,
  and every-recipient-skipped — the COMMON case, since most users never enable
  push — costs one. Behaviour is unchanged deliberately including the odd part
  (duplicate ids still produce duplicate notifications); changing it would be a
  silent behaviour change riding along with a performance fix. Budget-pinned
  against a fixture of 4 recipients and 9 devices, which is 13 queries under the
  old shape, and the tests read the rows back out because a
  `jsonb_to_recordset` rewrite satisfies a counter while corrupting what lands.

  **Still open after this round** (both were named in the REGISTER ROUND and
  neither is closed by it): an API route naming a permission no module declares
  is NOW caught, but a route naming one that IS declared while enforcing it on
  the wrong resource is not, and cannot be by a syntactic scan — the per-screen
  contract tests are the layer for that, and they exist only for admin screens.
  #599 and #711 remain blocked on external artefacts, not on code.

- **REGISTER ROUND — 25 August 2026: two registers describe the same
  permissions, nothing compared them, and an entire authorization surface had
  no screen because of it.**

  `awcms_permissions` is what `authorizeInTransaction` reads. The module
  descriptors are a SECOND register of the same facts, and they are the one
  every static gate trusts: `access:permissions:enforcement:check` asks "does
  each DECLARED permission have an enforcer?",
  `admin:screen-coverage:check` asks "does each DECLARED permission have a
  screen?". Both iterate what modules declare. **Nothing compared the two
  registers, in either direction.**

  **Three permissions lived in only one of them.**
  `identity_access.abac_policies.{read,configure,analyze}`, seeded straight into
  `sql/032`, declared nowhere — on the reasoning written into that migration,
  _"rather than via a module descriptor `permissions` array which this module
  does not use"_, true when written and false afterwards. The endpoints worked,
  so nothing looked broken. What broke is that the three became **invisible to
  every gate that would have interrogated them**: exempt from the repository's
  checks by omission rather than by decision, with no register saying so.

  **What that concealed.** The DSL policy surface those three guard —
  `/api/v1/access/policies/*`, the ONLY surface producing policies the evaluator
  consumes (`policy-cache.ts` filters `is_dsl_managed`) — has had **no admin
  screen at all**, for its whole life. ADR-0033 anticipated one. The gate that
  exists to say precisely that could not: it was never given the question.

  Meanwhile the one policy screen that DOES exist, `/admin/abac-policies`,
  authors flat rows that are never evaluated. That inertness is deliberate and
  correct — a flat row cannot be scoped or conditioned, so a flat `deny` would
  deny EVERY request in the tenant with no in-band recovery — but the screen only
  ever said the table is empty by default, which reads as "nothing here yet"
  rather than "nothing here takes effect". It now says so.

  **Six description drifts came out with them, and they were live.** Every
  permission-seed migration ends `ON CONFLICT DO NOTHING`, so a description is
  written ONCE and a later descriptor edit never reaches the catalogue.
  `comparePermissions` calls that `mismatched_description` and the module health
  signal counts it as a failure — so `blog_content`, `identity_access`,
  `tenant_admin` and `idn_admin_regions` had all been reporting
  `permission_catalog_synced = fail` on every migrated deployment. **Measured
  against a real database, then re-measured green after `sql/148`.** Five
  corrected in the catalogue; the sixth in the DESCRIPTOR, because there the
  catalogue had the better sentence. The rule was "make both registers say the
  better sentence", not "make the catalogue obey the code".

  **The gate is a TEST, not a `scripts/*-check.ts`, and that was the design
  decision.** The obvious pure gate parses `sql/*.sql`: two INSERT column
  shapes, plus five migrations that DELETE catalogue rows in at least two
  predicate shapes (`(activity_code = … AND action = …) OR …`, and
  `activity_code IN (…)` with no action), applied cumulatively in migration
  order. A regex that silently mis-parses one produces a gate that is
  confidently wrong — the failure this repo has recorded more than once. The
  migrated database has already applied all of it exactly, so
  `permission-catalogue-parity.integration.test.ts` READS the answer instead of
  re-deriving it, and reuses `comparePermissions` so CI and the health endpoint
  cannot drift apart about the same two registers. Mutation-proven.

  **`/admin/access-policies`** gives the surface its screen: the evaluated
  policy list with an **In force** column, and a decision simulator. Also
  `isDslManaged` on the record and in the API response — this list returns flat
  and DSL rows alike, so without it neither a client nor a screen could tell a
  stored policy from one in force. "Stored" and "in force" are different facts
  about an access rule and the more consequential one was the one nobody could
  see.

  `abac_policies.configure` is `DELIBERATELY_UNSCREENED`, on the
  `workflow.definition.*` precedent: authoring a condition DSL needs a real
  editor, and a JSON textarea that accepts a malformed policy until the API
  rejects it is a worse affordance than none. Sharper here than for workflows —
  a malformed workflow graph is a bad diagram, a malformed access policy is an
  authorization rule.

  **A wrong turn worth recording, because it survived two rounds of reasoning.**
  The first version of this finding was "the ABAC screen gates on
  `access_control.*` while the routes it drives gate on `abac_policies.*`" — a
  fake affordance. It was wrong: that screen posts to `/api/v1/abac/policies`,
  which IS guarded by `access_control.*`. Two surfaces exist over one table,
  their names are one word apart, and the wrong one was read as the only one.
  `tests/admin-access-policies-page-contract.test.ts` now pins the near-miss
  from the other side: the new screen must NOT name `access_control.*`.

  **Still open:** the health signal reports orphans without failing on them —
  deliberate, since an orphan is a governance gap rather than a runtime fault —
  and `access:permissions:enforcement:check` remains declared→enforced only. The
  parity test makes the second direction unnecessary for the CATALOGUE, but a
  route naming a permission no module declares is still only caught for
  `src/pages/admin/**`, not for API routes.

- **#599 IS SPLIT — 25 August 2026. The SHAPE ROUND's recommendation was
  carried out, and this records the outcome so the recommendation is not read
  again as still-pending.**

  The SHAPE ROUND below closed with: "split #599 rather than keep one issue
  blocked on its slowest artifact. Shape 1 plus the three static rules is a
  cutover-ready map today." **That last sentence is now known to be false** —
  the shape-1 template matches 0 of 25,029 URLs and the map's carrier was the
  wrong layer; see the ORIGIN ROUND above and ADR-0114. The split itself was
  still right. Done:

  - **#599, retitled** — "Cutover 301 SeputarBorneo: jalankan peta artikel +
    tiga aturan halaman statis (kodenya sudah ada; sisanya artefak)". Its
    ORIGINAL three complaints — no legacy id column, no bulk redirect import, no
    way to store CKEditor bodies — are all BUILT (`sql/138`,
    `blog:legacy:redirects:import`, `legacy-html-conversion.ts`), which is why
    the old title had become misleading. What remains is running them: the
    article map, three exact-path rules typed into `awcms_seo_redirects`, and
    the pre-cutover crawl against a live sitemap URL.
  - **#711, new** — the rubrik shapes (2 and 3) and the search shape (4). Filed
    with two blockers; the VOLUME ROUND above found the FIRST one does not
    exist (the rubrik list is 102 pairs in a populated Docker volume, not
    missing data), leaving one: the TARGET route is
    rendered by `ahliweb/awcms-astro` (ADR-0045/ADR-0070) — a cross-repo
    contract question before it is an import question. Terms also have no
    provenance column, so there is nothing a `--path-template` could express.
    **Under ADR-0114 `--path-template` is not the mechanism for any of this** —
    it writes into a table these requests never reach.

  **What the split is actually protecting.** Shape 3 is a bare two-segment
  catch-all, so it is the family a map built from the LISTED shapes would drop
  in the largest number, silently. Keeping it in the same issue as the
  supposedly cutover-ready half is what would let the cutover ship believing it
  was complete. Separately, `cari_berita/*.html` must NOT 301 onto content at
  all — an arbitrary query has no single correct destination. **That instruction
  stands and its subject does not:** shape 4 has never fired, because the
  two-segment catch-all on the line above it already claims every path it could
  match, so `/cari_berita/X.html` is served as a SHAPE-3 URL and is already
  covered by ADR-0113's rule 1.

- **SWEEP ROUND — 25 August 2026: the scheduled sweeps cost a constant PER
  POST, and the index the previous round left as a measurement task turns out
  not to want changing. Both halves of that are results.**

  The PERFORMANCE ROUND below left three things named rather than fixed. Two of
  them are now closed.

  **The sweep was worse than the note said.** It named "`blog-scheduled-publish`
  calls the per-post `fetchPostTermIds` inside its sweep loop". Per due post the
  sweep also read the managed-media enforcement flag ONCE PER CHECKLIST
  EVALUATION — and it evaluates twice — resolved that post's media per
  evaluation, wrote its own `UPDATE`, enqueued its own edge-cache purge and
  wrote its own audit row. Measured against the previous implementation:

  | Sweep (12 due posts)     | Before | After |
  | ------------------------ | ------ | ----- |
  | publish, enforcement off | 40     | 6     |
  | publish, enforcement on  | 52     | 7     |
  | unpublish                | 27     | 4     |

  The slope is the finding: `4 + 3N`, `4 + 4N` and `3 + 2N` against a flat 6, 7
  and 4. At the batch bound of 200 that is 604, 804 and 403 round trips — per
  tenant, on the ONE reserved `maintenance` connection the job holds, in a job
  that visits every active tenant in sequence.

  **Nothing in it was per-post except the verdict.** Managed-media enforcement
  is a property of the TENANT; media resolution is keyed by media object id,
  which is tenant-wide. Resolving the union of a batch's references in one
  `id = ANY(...)` returns byte-identical rows to resolving each post's own.
  The evaluation itself stays strictly per post.

  **The TOCTOU re-check got SMALLER, not weaker** — the part most at risk of
  being lost to a later tidy-up. The sweep re-evaluates immediately before it
  writes because the referenced media objects are not locked by the batch's
  `FOR UPDATE`. Batching keeps that window at one round trip and stops it
  growing with how far into the batch a post sits. Reusing the first pass's
  verdicts would have removed the mitigation while looking like cleanup, so the
  second pass is still a second pass, at two queries for the batch rather than
  two per post.

  **The mitigation had NOTHING holding it, which is why it was easy to nearly
  lose.** A budget would be HAPPIER if the second pass were deleted — the number
  drops — and a correctness test over a stable fixture cannot tell the two
  passes apart, because both see the same media. It was a comment.
  `scheduled-publish-toctou.integration.test.ts` now drives a `MediaLibraryPort`
  stub that resolves the featured media on the FIRST call and stops on the
  second — the detachment, made deterministic — and requires the post to stay
  `scheduled`; the control case, media that never goes away, must publish, so a
  test passing because the checklist never passed cannot hide. **The port is
  what made this testable at all**: the media state is behind a seam, so the
  race does not have to be raced.

  **`recordAuditEvents` is the reusable half**, and its shape is the part worth
  carrying forward. N rows in one statement built from a single `jsonb`
  parameter, NOT the `INSERT ... SELECT unnest(...)` idiom this repo uses
  elsewhere: `unnest` takes one array per column, this table has eight nullable
  columns plus a `jsonb` one, and Bun's array binding cannot carry a NULL — it
  writes the literal string `null` without throwing. That is eight chances to be
  silently wrong, against one parameter where JSON `null` maps to SQL NULL and
  `attributes` stays a real nested object. `jsonb_to_recordset` is the idiom for
  a batch insert of rows with nullable or `jsonb` columns.

  **A source-text test failed while the behaviour was intact, which is its own
  lesson.** `tests/two-sided-attribution.test.ts` guards the two ADR-0091
  attribution columns by looking for `${input.actorTenantId ?? null}` in
  `audit-log.ts`. The batch writer assembles the same value into a jsonb row
  object instead, so the assertion broke on a spelling. It is kept — cheap, no
  database, catches a dropped field fastest — but is no longer the only witness:
  `tests/integration/audit-log-writer.integration.test.ts` reads both columns
  back OUT OF THE TABLE, with the whole FK chain (partner → engagement → grant)
  seeded, because a row cannot claim a grant that does not exist.

  **The index question, measured against 24,000 posts — and the hypothesis does
  not survive.** The note read: "`awcms_blog_post_terms_tenant_idx` is a single
  low-cardinality column. The category archive filters `term_id` under RLS's
  `tenant_id` predicate; `(term_id)` serves it and a composite
  `(tenant_id, term_id)` would serve both, making the single-column index
  redundant."

  - For a WIDE category the archive uses neither: it drives from
    `awcms_blog_posts_tenant_status_published_idx` newest-first and probes the
    `(post_id, term_id)` UNIQUE index. 0.09 ms, 67 buffers.
  - For a NARROW category the planner flips to a term-driven plan using
    `(term_id)` — so `(term_id)` is NOT redundant. 27 buffers.
  - A `(tenant_id, term_id)` composite serves the narrow plan identically (25
    buffers) and is wider per entry. Replacing BOTH single-column indexes with
    it would leave `awcms_blog_terms` parent deletes scanning the join table —
    exactly the residual `db:fk-index:check` documents about `(tenant_id, X)`
    composites. And `tenant_id` cannot simply be dropped: no query in the repo
    filters this table by `tenant_id` alone, but the FK-index gate requires it
    to be index-reachable.
  - Bulk insert of 5,000 assignments: 110 ms with three indexes, 115 ms with
    two. Within noise — there is no measured write win to claim.

    **Conclusion: no change.** The value here is the refutation and the numbers,
    not a migration.

  **A measurement trap worth recording, because it produced a confident wrong
  answer for twenty minutes.** Written with the term id as a subquery —
  `pt.term_id = (SELECT id FROM awcms_blog_terms WHERE slug = …)` — the narrow
  category costs **24.7 ms and 48,832 buffers**, scanning all 24,000 posts to
  return 8 rows, because an InitPlan is not constant-folded and the planner
  falls back to generic selectivity (it estimated 12,003 rows either way). The
  real code binds `termId` as a PARAMETER, Postgres builds a custom plan, and
  the same query costs 27 buffers. **A benchmark that does not bind its
  parameters the way the caller does measures a plan the caller never gets.**

  **Still open from the round below, unchanged:** the nine lower-amplification
  write paths, each bounded by what ONE request submits.
  `enqueuePushToRecipients` is the one worth naming — a query per recipient plus
  an `INSERT` per subscription — but its only caller today is the self-service
  `POST /api/v1/push/test`, with one recipient. It becomes a real fan-out the
  moment a broadcast caller exists.

- **PERFORMANCE ROUND — 24 August 2026: the query budgets all measure READS.
  Every N+1 in the repo is on a WRITE path or in a job — the half nothing
  counts.**

  Method: a scan of every `src/` file for a query issued inside a loop, then
  cross-referenced against what the four budget suites actually cover
  (`query-budget`, `query-budget-admin`, `middleware-query-budget`, and the
  sitemap builder). All four measure reads. That is not an oversight so much as
  where the attention went: a read path is hit constantly, so its cost is felt;
  a write path is hit once per save, so a per-item query inside it looks like
  nothing.

  It stops looking like nothing the moment a bulk importer becomes the caller.

  **FIXED — `syncPostTermAssignments` issued one `INSERT` per term.** A handful
  of statements when an editor saves an article; roughly 24k `DELETE`s and 48k
  `INSERT`s when `blog:legacy:import` files a 23,906-article archive, which
  #708 made a real caller. Now one `DELETE` + one `INSERT ... unnest`, the shape
  `comment-retention.ts` and `announcement-directory.ts` already use. NOT
  deduplicated on the way in: `awcms_blog_post_terms_unique` refused a repeated
  pair before and still does, and swallowing it here would turn a loud
  constraint error into a silent difference between what was asked for and what
  was stored.

  Pinned by `tests/integration/post-term-assignment-budget.integration.test.ts`
  — **the first query budget on a write path**. The budget is EXACT (2), not a
  ceiling: the property is that the number does not move with the number of
  terms, and a `toBeLessThanOrEqual` would pass a per-term regression as long as
  the fixture stayed small. The fixture assigns 12, so the old shape cannot pass
  by accident. Correctness is asserted beside every count, because a budget on
  its own is satisfied by a function that writes nothing.

  **NOT fixed, recorded so they are not re-derived:**

  - **Nine more write paths insert one row per item in a loop** — menu items,
    ad placements, institutions, email templates, the ABAC policy writer,
    invitations, sidebar config, push enqueue, `sync/push`. Each is bounded by
    what ONE request submits, so each is a small constant rather than a scaling
    risk. Worth batching where the set is user-controlled; not urgent.
  - **`blog-scheduled-publish` calls the per-post `fetchPostTermIds` inside its
    sweep loop.** Bounded by how many posts are due in one sweep — which at a
    cutover is not small. `fetchPostTermIdsForPosts` is the batched twin and
    already exists.
  - **`awcms_blog_post_terms_tenant_idx` is a single low-cardinality column.**
    The category archive — the surface #708 makes real — filters `term_id`
    under RLS's `tenant_id` predicate; `(term_id)` serves it and a composite
    `(tenant_id, term_id)` would serve both, making the single-column index
    redundant. Needs `EXPLAIN` against real data to justify the write cost, so
    it is a measurement task, not a change.

  **What the scan did NOT find, which is the useful half of a clean result:** no
  unbounded public read, and no N+1 in the public list path. The read side of
  this very relationship was fixed deliberately — `fetchPostTermIdsForPosts`
  carries the comment "three round trips per page, not fifty-one". The write
  side simply had nobody counting.

- **SHAPE ROUND — 24 August 2026: the legacy `.htaccess` #599 was waiting for
  exists on the development machine, and it contradicts the plan built without
  it. Five URL shapes, not two; one of them was never listed; and the static-page
  half of `sql/138` is a column pair nothing writes and nothing reads.**

  The CUTOVER ROUND below closed with "what remains on #599 is not code —
  running the jobs needs the legacy `.htaccess` and a sitemap export, which
  exist in neither repo". The first half of that is no longer true. The file is
  at `/home/data/dev_php/seputarborneo.com/.htaccess`, a working copy of the
  legacy site sitting beside this repo, and reading it moves #599 without
  moving a line of application code.

  **Five rewrite shapes.** Articles `^news/([^/]*)\.html$`; rubrik
  `^rubrik/([^/]*)\.html$`; **`^([^/]*)/([^/]*)\.html$`**, a bare two-segment
  catch-all mapping to `/rubriks/?news=$1&kt=$2`; search
  `^cari_berita/([^/]*)\.html$`; and static pages `^([^/]*)\.html$`. Only the
  first is covered. The third appears in no version of this issue's plan — and
  being a catch-all, it is the family a map built from the listed shapes would
  have dropped in the largest number, silently, which is the exact outcome the
  "enumerate every shape" note existed to prevent. **This round counted the
  shapes and did not read their ORDER**, which is how it missed that the
  catch-all it had just found sits ABOVE `cari_berita` and has always shadowed
  it — there are four live shapes, not five. See the ORIGIN ROUND above.

  **"Covering them is a second run, not a code change" is wrong for three of the
  five.** `blog:legacy:redirects:import` rejects a `--path-template` that does
  not contain `{legacyId}` and derives its map from
  `awcms_blog_posts.legacy_source_id`. Rubrik listings and static pages are not
  articles, so no template can express them; there is nothing to run. Terms have
  no provenance column at all.

  **`awcms_blog_pages.legacy_source_system`/`legacy_source_id` have no writer
  and no reader.** `blog:legacy:import` imports posts only, and
  `listLegacyRedirectMappings` selects `FROM awcms_blog_posts`. The pair has
  been dead since `sql/138` landed. What made it read as covered is the shape to
  carry forward: `tests/legacy-redirect-map.test.ts:54-61`, "pages get the same
  treatment as posts", asserts that the MIGRATION FILE'S TEXT contains
  `ALTER TABLE awcms_blog_pages` and the dedup index name. A test over a
  migration's source proves a column exists; it cannot notice the column is
  never used. Its own comment names the stakes — _"giving only posts provenance
  would make half the 301 map underivable"_ — and that half was then never
  wired. Same family as the registry gates that check SHAPE rather than MEANING.

  **The dead column is not the fix anyway.** `data/index.php:195-212` switches
  on a closed set of three: `/tentang_kami.html`, `/pedoman_media_cyber.html`,
  `/disclimer.html` (the legacy typo is part of the URL). Three exact-path
  rules, which `awcms_seo_redirects` has supported since `sql/060` — admin data
  entry, not an importer and not a backfill. The column pair should be wired or
  dropped; leaving it is what produced the appearance of coverage. **Dropped in
  `sql/147`** — nothing had ever written it, so every row's value was NULL and
  there was no data to lose; the test that asserted the migration's TEXT is
  replaced by one that searches for a READER.

  The one covered shape is confirmed right: `berita/index.php:9` reads
  `(int) $_GET['news']`, so the id is the leading digits and the slug is
  decorative — `/news/{legacyId}_{slug}.html` is the correct template.
  **Correct about the LEGACY router, and carried across as though it were also
  true here, which it is not.** This repo's rule keys are exact strings, and the
  template matches 0 of 25,029 URLs; ADR-0114 makes article resolution id-keyed
  for exactly this reason. See the ORIGIN ROUND above.

  **What is still blocked is narrower than "the artifacts", and narrower again
  since the VOLUME ROUND.** This paragraph originally said the rubrik shapes
  need a rubrik list "which needs data the working copy does not have (its dump,
  `seputa58_sbb.sql`, is 0 bytes)". The dump is 0 bytes and it is INERT — the
  data is in the `seputarborneocom_db_data` volume, and the list is 102
  `(jenis_rubrik, kategori)` pairs. What remains is a target route rendered by
  `ahliweb/awcms-astro`, not here (ADR-0045/ADR-0070) — a cross-repo contract
  question before it is an import question. The pre-cutover crawl is unchanged:
  `blog:legacy:cutover:verify` is built and needs the live sitemap URL, at page
  level because it refuses an index. **There is no legacy sitemap and there
  never was one** — not in the tree, not in git history; the live site 404s
  `/robots.txt` and every conventional sitemap path while serving 200 itself.
  `--sitemap` takes a LOCAL FILE, so a synthesised corpus unblocks it with no
  code change. Search-result URLs should NOT 301 onto content; an arbitrary
  query has no single correct destination — and shape 4 never fired anyway.

  Recommended: split #599 rather than keep one issue blocked on its slowest
  artifact. Shape 1 plus the three static rules is a cutover-ready map today.
  **Done on 25 August 2026 — see the entry at the top of this section.** The
  "cutover-ready" half of that sentence did not survive: shape 1's template
  matches nothing (ORIGIN ROUND).

- **LEDGER ROUND — 24 August 2026: 121 endpoints refuse a tenant user WITHOUT
  RECORDING that they did.**

  The BOUNDARY ROUND below closed the caller who is nobody. This measures the
  caller who is SOMEBODY WITH NO GRANT — a shape every tenant has, and the one
  no static gate can reason about. A session holding ZERO permissions, driven at
  every gated body endpoint:

  | Answer                                             | Count |
  | -------------------------------------------------- | ----- |
  | `403 ACCESS_DENIED` — authorization first, correct | 84    |
  | `400 VALIDATION_ERROR` — the endpoint's schema     | 61    |
  | `400 IDEMPOTENCY_REQUIRED`                         | 54    |
  | `404` — an existence lookup ran first              | 3     |
  | `422` / `401`                                      | 3     |

  **The finding is the MISSING ROWS, not the status codes.** ADR-0063 made
  `authorizeInTransaction` the one place a decision is taken AND the one place it
  is recorded. A route refusing before it reaches there refuses invisibly — no
  `awcms_access_decision_log` row. "Which endpoints answer something other than
  403" is the same question as "which refusals leave no trace", and the answer
  was **121**.

  **A ledger that may only shrink, enforced BOTH ways**
  (`tests/e2e/api-authorization-first.e2e.ts` +
  `support/authorization-first-ledger.ts`): an unlisted endpoint answering
  anything but `403` is red (the debt cannot grow), and a LISTED endpoint
  answering `403` is also red (it was fixed; the row must go). Without the second
  direction a ledger fills with stale rows and becomes wallpaper. Both
  mutation-proven — the 121 entries were GENERATED by the first direction
  failing, and one stale row turned the second red. Same shape as
  `api:tenant-route:check`.

  **One route fixed as the worked example:**
  `POST /api/v1/media/news-images/upload-sessions` used to tell a caller with no
  grant whether R2 is configured (`502`) and its exact MIME allow-list and size
  ceiling (`400`), recording nothing. It now HOLDS both refusals until
  authorization answers. The body is still read outside the transaction —
  `await request.json()` waits on the CLIENT — and the held value is a
  discriminated union rather than two correlated nullables, so the code reads
  `held.value` instead of asserting `input!`.

  **Three entries are STRUCTURAL and listed anyway.** `blog/posts/:id` and
  `blog/pages/:id` read the row first because the ownership GRANT BASIS is
  computed from it; `partners/:id/status` and `access/machine-credentials`
  compute a stricter permission FROM the body. "There is a reason for it" and
  "it is fine" are different claims and only the first is true.

  **Two traps, both recorded.** The sweep LOGGED ITSELF OUT by hitting
  `POST /api/v1/auth/logout`, after which every request answered `401` — a
  self-inflicted false negative that reads exactly like a passing gate; it now
  skips session-destroying endpoints and asserts its session is live before
  believing any refusal. And several "findings" dissolved on inspection:
  `push/subscriptions` is self-service with a DOCUMENTED anti-oracle `404`, and
  the `502` is a local env-config check, not an outbound call. Status codes
  alone were misleading in both directions.

- **BOUNDARY ROUND — 24 August 2026: 77 API endpoints handed their validation
  schema to ANY bearer token, and left no decision-log row while doing it.**

  Found by RUNNING the API, not reading it:

  ```
  POST /api/v1/blog/institutions   Authorization: Bearer nonsense
  → 400 VALIDATION_ERROR + every field name, enum value and length limit
  ```

  No account, no session — any string at all. **77 session-gated endpoints
  answered that way**, measured against a running server.

  **The disclosure is the smallest part.** `authorizeInTransaction` is what
  writes the decision log, so a request short-circuiting before it was never
  recorded: enumerating the API left NO TRACE. The cause is ordering —
  `defineTenantRoute` checked a token was PRESENT, then ran `prepare`, which
  parses and validates the body.

  **Every static gate was green that day**, and they could not have been
  otherwise: ordering between a `prepare` hook and a chokepoint call is not a
  text property. A textual "validation before authorization" scan reported 297
  of 305 route blocks — wrong enough to be useless, and nearly reported before
  being checked against a server.

  **Closed with ONE boundary in `src/middleware.ts`**, not 77 route edits: no
  API body is parsed until the caller's credential resolves. 63 of the 77 were
  hand-written handlers with no shared shape, so the per-route fix would have
  had no mechanism behind it. It also turns "which endpoints are reachable
  without a session" — implicit until now, knowable only by reading 246
  handlers — into `SESSION_FREE_BODY_ENDPOINTS`, 26 entries each with a reason.

  **Authentication only.** Authorization stays at the ADR-0063 chokepoint and is
  NOT duplicated. The session is looked up twice on a write, deliberately:
  handing the route a principal resolved in a different transaction would split
  the decision from the read it guards. Reads carry no body and never reach it.

  **The authorization half:** `defineTenantRoute` now HOLDS a `prepare` refusal
  until authorization has answered, so a caller lacking the permission gets
  `403` plus a decision-log row instead of `400` plus a schema. Authorizing
  before parsing would have been wrong — `await request.json()` waits on the
  CLIENT, and parsing inside `withTenant` holds a reserved connection for as
  long as a caller chooses to take. Two routes compute their guard FROM the body
  and cannot defer; both are named in the code.

  Mutation-proven: boundary disabled and rebuilt → **185 assertion failures**
  across 92 endpoints. Recorded as **C18** in the standards document.

  **Still open, unchanged from the WAVE ROUND:** which individual WRITE controls
  a partially-permissioned user should see.

- **WAVE ROUND — 24 August 2026: the two admin sweeps were ACCIDENTALLY IMMUNE,
  and the harness had to be fixed before they could be told the truth.**

  This closes the harness problem the SESSION ROUND below left open, and then
  fixes what that problem had been hiding.

  **The ordering.** `playwright.config.ts` now runs `setup` → `read` → `write`
  (`tests/e2e/support/e2e-waves.ts`). Read-wave specs see the tenant as the
  bootstrap left it; writers run after. Within each wave everything is still
  parallel — the cost is one barrier, and the suite still finishes in ~19s.
  Reads run FIRST rather than last deliberately: running them last would depend
  on every mutator reverting cleanly, and a mutator that fails halfway leaves
  residue by definition.

  **The classification is checked, not trusted.** A list of filenames is
  normally the wrong answer here — a gate that checks its own matrix rather than
  what exists is this repo's recurring failure. So it is held from both ends:
  `tests/e2e-wave-classification.test.ts` requires every `*.e2e.ts` on disk to
  be in exactly one wave (an unclassified spec would not run at all), and read
  membership is enforced AT RUN TIME — read-wave specs import `test` from
  `tests/e2e/support/e2e-read-wave.ts`, which fails any test issuing a mutating
  `/api/` request. Mutation-proven: one added `fetch(…, {method:"POST"})` turns
  that spec red and names the request.

  **What the ordering unlocked, and this is the part worth reading.**
  `admin-screens-render.e2e.ts` asserted `200` — and **a denied screen also
  returns `200`**, because denial renders here and never redirects. The sweep
  would have stayed green if a screen started refusing the owner: a module
  switched off, a grant dropped from the bootstrap, a tenant-wide `deny`
  authored. It now asserts the screen rendered its CONTENTS — no denial hook
  anywhere in the page. Mutation-proven: disabling `reporting` fails on
  `/admin` AND `/admin/reporting` together. Under the old assertion that
  scenario was green, which is exactly why it could not be tightened while a
  mutator might run concurrently.

  **The read-only sweep landed unchanged.** `admin-read-only-access.e2e.ts`
  drives a user granted every tenant-scoped `read` and nothing else — the grant
  from the permission catalogue, the expectation from each page's own
  `authorize` block, so the two halves come from different sources.
  `/admin/tenants` and `/admin/partner-registry` must refuse it. **This is the
  only runtime check on ADR-0053 anywhere in the repo.** Mutation-proven:
  granting that role the two platform reads makes both screens serve their
  contents and the spec reports cross-tenant disclosure.

  **A wrong first attempt, recorded because it was a real finding.** The
  ADR-0053 assertion was first written into the OWNER sweep — "these two screens
  refuse the owner" — and it FAILED against an environment where the seeded
  tenant IS the platform tenant, whose owner legitimately holds those
  permissions. What the owner is owed there depends on which tenant was seeded,
  which the sweep cannot know independently, so those two screens are exempt
  from the contents-vs-refusal question there and held to `200` + shell. For the
  read-only user it is unconditional: a `scope = 'tenant'` grant can never
  include a platform permission, whichever tenant they belong to.

  **Found while working: the browser-test skill described a DIFFERENT REPO.**
  `.claude/skills/awcms-browser-test/SKILL.md` claimed specs for
  `/admin/analytics` and `/admin/security`, an `admin-responsive-nav.e2e.ts`, an
  `admin-a11y-smoke.e2e.ts`, and a `@axe-core/playwright` devDependency. None
  exists here — all inherited from `awcms-mini` when the skill was ported. It
  also described the CI job as running in TWO PHASES with
  `--grep-invert "@full-online-gate"`; `ci.yml` has one phase and neither
  security spec exists. The Status section now lists the 16 specs that are
  actually present, and a new mandatory convention covers wave classification.

  **Still open, and named rather than assumed closed:** which individual WRITE
  controls a partially-permissioned user should see. Those expectations differ
  per screen — there is no selector all 76 delegated controls share — so it is
  per-screen work, not one mechanical rule.

- **SESSION ROUND — 23 August 2026: TWO different intermittent e2e failures,
  and the CI one was SHARED TENANT STATE. Two diagnoses before it were wrong.**

  **The CI flake:** `admin-users.e2e.ts` asserts that re-assigning the role the
  owner already holds is rejected `409`. It intermittently got `200` — the
  assign SUCCEEDED. The dropdown lists every role in the tenant, and
  `admin-roles.e2e.ts` creates one concurrently, so the default selection was
  sometimes a role the owner did not hold. Fixed by selecting `owner`
  explicitly. Shared state, not a race, and nothing wrong with the page.

  **Wrong turn 1 — a hydration race.** Delegated listeners bind on `document`
  inside a deferred module, so a click before that is silently swallowed. That
  window is REAL and is now observable via `ADMIN_DELEGATION_READY_ATTRIBUTE`,
  but it caused none of this.

  **Wrong turn 2 — argon2 contention.** Also real, also a DIFFERENT failure:

  Every authenticated spec drove the real `/login` form itself. With
  `fullyParallel: true` that meant up to five simultaneous `Bun.password.verify`
  calls — argon2id on Bun's defaults, memory- and CPU-hard BY DESIGN — while the
  same server rendered admin pages. The suite was bimodal: usually ~15s green,
  occasionally FOUR MINUTES with six or seven failures, every one a 30s
  `waitForURL` timeout AT THE LOGIN STEP, in specs unrelated to each other.

  **CI runs 2 workers, not 5, and never showed those login timeouts.** It was a
  local phenomenon, and calling it the CI flake's cause was the second mistake.
  The session fix below is kept because it is a genuine improvement, not because
  it fixed the flake — it did not.

  CI hid the real flake behind `retries: 1`, so it surfaced as one "flaky" line
  rather than a problem. **A suite that goes green on the second try teaches
  people to re-run instead of investigate** — and it cost three diagnoses here.

  **The pattern under all of it: specs mutate shared tenant state that other
  specs read.** Roles created by one spec change another's dropdown; the module
  toggle disables `reporting`, which `/admin` authorizes on. That is the real
  harness problem. **CLOSED by the WAVE ROUND above (24 August 2026).**

  `tests/e2e/auth.setup.ts` logs the owner in once and saves `storageState`;
  thirteen logins became four. Six consecutive runs at ~18s, zero variance.

  Nothing about argon2's cost is wrong — that cost IS the control. Paying it
  eleven times to test things that are not authentication was the mistake.

  Held back from this round: a READ-ONLY sweep. It works, but
  `admin-modules-toggle.e2e.ts` deliberately DISABLES the `reporting` module and
  `/admin` authorizes on `reporting.dashboard.read` — so a read sweep overlapping
  that toggle sees the dashboard deny, correctly. Alone it passed 4/4; in the
  suite it failed about one run in three, always on `/admin`. **Read sweeps must
  not run concurrently with specs that mutate tenant-wide state**, and that is a
  harness change worth doing deliberately. The two sweeps already on `main` are
  ACCIDENTALLY immune, not correct: the render sweep asserts only `200` and a
  denied screen still returns `200`; the deny sweep expects denial, which a
  disabled module also produces. **Both DONE in the WAVE ROUND above — the
  sweep now asserts contents, and the read-only spec landed unchanged.**

- **DENY ROUND — 23 August 2026: nothing had ever watched an admin screen
  refuse a user holding no permissions, and four screens could not be checked
  at all.**

  The per-screen contract tests are source greps: they prove a page MENTIONS a
  permission key, not that a control is hidden from someone lacking it. The
  render smoke test loads every screen as the seeded OWNER, who holds
  everything. So the deny path — the half of authorization that matters — had
  never been executed.

  `loadAdminScreen` never redirects, so a denied screen RENDERS, by convention
  an element with `id="<screen>-denied"`. Forty-three followed it.
  **`site-profile`, `blog-settings`, `sidebar-menu` and `comments` rendered a
  correct denial message with no id on it.** Nothing was broken for a user; what
  was broken was VERIFIABILITY — no checker could tell those four from a screen
  showing its contents to someone with no permission. **A denial nobody can
  assert on is a denial nobody will notice losing.**

  `tests/e2e/admin-deny-path.e2e.ts` now logs in as a user whose role holds ZERO
  permissions and requires, for all 46 static gated screens, status `200` (a
  denial is a rendered page; a 404 would mean the screen THREW) and that
  screen's own denial hook. The id is read FROM EACH PAGE, not derived from its
  URL — several screens use a name that is not their route.

  **A stale build nearly produced a false report.** The first run named those
  four as leaking; the server was serving a bundle built before the hooks were
  added. Re-running against a fresh build is the only reason it was not
  reported as a defect. Rebuild before believing an e2e finding.

  **Still uncovered, deliberately:** a PARTIALLY-permissioned user seeing the
  right subset of controls. Expected results differ per screen, so it is
  per-screen knowledge rather than one mechanical rule — its own round.

- **RENDER ROUND — 23 August 2026: 41 of 48 admin screens were never loaded by
  anything, and the symptom of a broken one is a 404 — not a 500.**

  `/admin/seo` had never rendered, and the reason nobody noticed is simply that
  **nothing requested it**. Seven screens were exercised by the CRUD e2e specs;
  the other 41 were never loaded in CI, by any gate, in any form.
  `admin:screen-coverage:check` looks adjacent and answers a different question
  — whether a screen CLAIMS a permission.

  `tests/e2e/admin-screens-render.e2e.ts` enumerates `src/pages/admin/**.astro`
  at RUN TIME and loads every screen as the seeded owner. The list is
  discovered, never written down: a hardcoded one is the failure this repo keeps
  finding — a gate checking its own matrix rather than what exists. Adding a
  screen without covering it is now impossible.

  **The correction that came out of verifying it:** reintroducing the
  `/admin/seo` fault and watching a real server answer showed it returns **404**,
  not 500. The `ReferenceError` goes to the server log; the browser is told the
  page does not exist. ADR-0112 and everything repeating it said 500; all of it
  is corrected, and that ADR carries an amendment.

  That changes how this class is hunted, which is why it is here rather than
  only in the ADR: **asking "which admin screens 5xx?" finds nothing and
  concludes the fleet is healthy.** A screen that throws on every render is
  indistinguishable, by status alone, from a route that was never built. The
  test therefore asserts `200` exactly, not "not 5xx" — the weaker assertion
  would have passed straight over the defect it exists for.

- **FRONTMATTER ROUND — 23 August 2026: `/admin/seo` had been answering 500 on
  every request and had never rendered once. Standards finding C4 is CLOSED
  (ADR-0112), and it was the last open row in that document.**

  The page computed `showRedirectActions` as the THIRD statement of its
  frontmatter, from three `const`s declared 130 lines further down in the same
  scope — a temporal dead zone, so the compiled component threw
  `ReferenceError: Cannot access 'canUpdateRedirect' before initialization`
  before rendering anything. It passed review, `bun run check`, the build and
  CI, and the production chunk preserved the ordering.

  **An always-404 operator screen is the failure this repo is least able to
  notice**: nothing polls `/admin/seo`, and its module descriptor lists it in
  the sidebar, so it reads as shipped.

  `astro check` genuinely cannot run here — `@astrojs/check@0.9.10` refuses on
  TypeScript 7, verified by installing and RUNNING it — so 61 files and ~34,760
  lines were checked by nothing, with ADR-0068 §C recording the mitigation as
  "reviewers read `.astro` diffs by eye". **That is the mitigation this defect
  walked through.** An instruction to read carefully is not a control; it fails
  silently and leaves no evidence that it failed.

  ADR-0112 goes around the block instead of waiting for it:
  `check:astro-frontmatter:check` extracts each frontmatter to a sibling `.ts`
  and runs this repo's own `tsc` — the technique `check:astro-scripts:check`
  already used for `<script>` blocks. Four shims make an extracted block
  compile and each gives something up; together they took the raw output from
  920 diagnostics to the 6 that were real.

  The `astro-files-not-type-checked` divergence is NARROWED, not deleted: it
  now covers component `Props` at their call sites and nothing else.

- **CUTOVER ROUND — 23 August 2026: #599's redirect map was complete, correct,
  and could never have fired. The precedence is fixed (ADR-0111) and the
  verifier that would have caught it now exists.**

  Scope items 1–3 of #599 were already built — `sql/138` stores provenance,
  `blog:legacy:import` writes it and converts CKEditor HTML to Portable Text
  with per-row rejections, `blog:legacy:redirects:import` derives one exact rule
  per published article with chain and locale-prefix checks. What was left was
  item 4, the pre-cutover crawl validation, and building it surfaced why the
  first three were not enough.

  **`resolvePublicRedirect` consulted the retired-`/news` family rewrite BEFORE
  tenant-authored rules.** That rewrite claims every `/news/**` path, and the
  archive's URLs are `/news/{id_ber}_{slug}.html`, so not one of the 23,906
  rules the importer writes could ever be read — and the answer they never got
  to give was replaced by a 301 to `/blog/{tenantCode}/{id_ber}_{slug}.html`,
  which no post has. Every legacy URL would have redirected into a 404: the
  exact outcome that issue's Definition of Done exists to forbid, produced by
  the code written to satisfy it, with a redirect table that read as correct.

  Nothing caught it because the precedence existed only as the order of two
  `await`s inside a `try` block — unreachable without a database, so nobody
  wrote the cheap test — and the two strategies belong to different concerns,
  so neither module's suite had reason to look at the other. Both stayed green
  while each was right about its own half. **The lesson generalises past
  redirects: a rule that lives only in statement order is a rule with no test,
  and the modules on either side of it will each keep passing.**

  ADR-0111 settles it as MOST SPECIFIC WINS, and moves the decision into
  `domain/redirect-precedence.ts` as a pure function so it is testable at all.
  `tests/redirect-precedence.test.ts` asserts against the service SOURCE that
  the function is called and that no early `return retired` has crept back
  above it; all three of those fail when the old order is restored.

  `blog:legacy:cutover:verify` (item 4) starts from the legacy site's own
  sitemap rather than from what was imported, which is the only way to see a URL
  that produces no rule at all. It writes nothing, drives the real resolution
  path rather than reimplementing it, and **refuses a sitemap INDEX** instead of
  flattening it — checking an index's children as pages would report success
  having read no page URL.

  **What remains on #599 is not code.** The three jobs and the verifier are
  built and gated; running them needs the legacy `.htaccess` and a sitemap
  export, which exist in neither repo. The next step is operational: obtain
  those, run `blog:legacy:import --images=` to get the upload set, then
  `--media-map=`, then the redirect import, then the verifier — and the verifier
  must come back clean before cutover, not after.

- **BEACON ROUND — 23 August 2026: #597 item 9 is BUILT, and the decision it was
  blocked on turned out to be smaller than "analytics: yes or no".**

  That item's blocker was a privacy ADR in `ahliweb/awcms-astro` — the repo
  owner's decision, not a task. It was made, and the fact that unlocked it was
  read out of this repo's own collector rather than guessed: **a cross-origin
  `fetch` without `credentials` neither sends nor stores cookies.** So the
  consumer already held the switch, with no change needed here.

  Its ADR-0044 takes **Option B**: a site may call the beacon, only when it
  declares it, and always without credentials. The `awcms_visitor_key` cookie
  this endpoint sets is therefore discarded by the browser, and **every page
  view arrives as a first visit** — page-view counts are real for that consumer,
  unique-visitor counts are not. Nothing here should be changed on the premise
  that a repeat visitor is recognisable, and the `SameSite=None` work in #637 is
  not wasted: it serves consumers that make the other choice.

  **On this side the change is again one contract move**, and it makes the
  reader-browser class three paths wide.

  **The consequence worth carrying forward: the three do NOT share one rule.**
  The two `site-search` paths must carry no custom header, because nothing
  answers a preflight for them — deliberately. The beacon MUST carry
  `content-type: application/json`, because `security.checkOrigin` refuses a
  cross-origin POST whose content type is form-like, and the `OPTIONS` handler
  added in #637 exists for the preflight that follows. `navigator.sendBeacon`
  cannot be used there at all: it sends `text/plain`, one of the refused types.

  Making the three consistent — in either direction, and it is the tidying
  somebody will eventually propose — kills one of them in a reader's browser and
  in no log here. It is written into `CONSUMED_PATHS`' docblock and the gate's
  own comment for that reason.

  **With this, #597 is finished across all nine items and #607 across all
  three.** What remains open in the family is #599, and it is blocked on two
  artefacts that exist in neither repo — the legacy `.htaccess` and a live
  sitemap URL — rather than on code.

- **CONSUMER ROUND — 23 August 2026: the two reader-facing items that were left
  are BUILT, in `ahliweb/awcms-astro`. There is no `awcms` work left on #597 or
  #607, and the only `awcms` change in this round is a contract move.**

  With ADR-0107/0109/0110 written the same day, both remaining items became
  ordinary work in the neighbour repo. What landed there:

  - **The reader's search box** (#607, #597 item 3) — `/cari/` and `/en/cari/`,
    with ranked results, highlighted snippets, facet chips for content type /
    channel / topic / institution / region, a cursor-paged "load more", and
    autocomplete. Its ADR-0043 there.
  - **The byline** (#597 item 4) — rendered on the article page, in the JSON-LD
    `author` (a `Person` when there is one), and on the article's Atom entry. Its
    ADR-0042 there.

  **On this side the only change is `scripts/api-consumer-contract.ts`:**
  `/api/v1/site-search/query` and `/suggest` move from COMMITTED to CONSUMED,
  which is the direction the cross-repo Definition of Done requires — freeze
  here first, call there second. The byline needed no move at all: `authorByline`
  rides on `/api/v1/blog/posts`, which was already consumed.

  **Three things worth carrying forward, because each is a class rather than an
  incident.**

  **1. "CONSUMED" no longer means "a build calls it".** Seven of the nine paths
  are called by `astro build` from a machine holding a read-only credential; the
  two search paths are called by the READER's BROWSER. That difference is
  invisible from here — both are `GET`s, and the gate over there extracts string
  literals from `src/` without knowing who executes them — and it changes what
  breaking one costs. A shape change on a build-called path reddens a build
  somebody is watching. A shape change on these two fails **silently in a
  stranger's browser**, on a site published weeks ago that will not be rebuilt on
  account of it. Written into that file's docblock rather than left to be
  noticed.

  **2. The absence of an `OPTIONS` handler is a CONTRACT now, not an omission.**
  The box calls both paths with no custom headers, which keeps them simple
  requests. A header added on EITHER side — an `accept`, a correlation id, a
  tenant hint — turns them into preflighted requests with nothing to answer the
  preflight. That failure happens in the reader's browser and appears in no log
  here. The same holds for `Access-Control-Allow-Credentials`, whose absence is
  what makes `credentials: "include"` unreadable by construction.

  **3. The gate over there could not see the defect that mattered, and running it
  found it in one minute.** The content-type facet returns `resource_type` as
  stored — `blog_post`, `blog_page` — because it is this repo's module-registry
  identifier and carries no editor-written label, unlike a term facet. The first
  browser run rendered those as chips, in both languages: a machine key on
  screen. Nothing could have gone red — the value was present, the type correct,
  the page published. It is the `run-it-don't-read-it` class again, and the fix
  over there is that a facet value with no readable label renders no chip at all.

  **What this leaves open on #597, and it is not work:** item 9, the analytics
  beacon, whose backend was verified in #637/#638 and which is blocked on a
  privacy ADR in `awcms-astro` — the repo owner's decision. #599 is likewise
  blocked on two artefacts that are not in either repo (the legacy `.htaccess`
  and the live sitemap URL), not on code.

- **DECISION ROUND — 23 August 2026: the three items of #597 that were blocked on
  a WRITTEN DECISION rather than on work.** **DONE — ADR-0107, ADR-0109,
  ADR-0110.** After that issue's items 1/2/5/6/7 shipped, its own status table
  split the remainder into "needs a new `awcms` surface" and "needs a decision
  first". The second group is now empty, and in each case the interesting part
  was not the feature.

  - **Item 3, the reader's search box ([ADR-0107](adr/0107-a-readers-browser-may-search-and-the-origin-names-the-tenant.md)).**
    The CORS half was the smaller problem. `withSiteSearchTenant` resolves the
    tenant from the HOST, so a reader on a statically built site calling this CMS
    falls through the documented chain (`PUBLIC_DEFAULT_TENANT_ID` ->
    `PUBLIC_DEFAULT_TENANT_CODE` -> `awcms_setup_state`) and lands on the
    deployment's DEFAULT tenant — one tenant's site displaying another's articles
    as its own results, with a 200 and nothing reporting a problem. A
    cross-origin request now resolves its tenant from the `Origin` and from
    nothing else, which closes it by CONSTRUCTION: a header-only fix would have
    left that content in the body for `curl`, a crawler or a proxy.
  - **Item 4, the byline ([ADR-0109](adr/0109-a-byline-is-opted-into-and-it-is-not-your-account-name.md)).**
    Publishing `awcms_profiles.display_name` was one line and no migration, and
    is refused: it makes every internal account name public the moment an article
    publishes. `sql/146` adds an opt-in `public_byline_name` where NULL — every
    existing row — keeps the organisation attribution, so no article changes.
  - **Item 8, video embeds ([ADR-0110](adr/0110-a-video-embed-origin-is-an-operators-decision.md)).**
    The renderer has been correct since #639 and every iframe it emitted was
    BLOCKED, because the CSP allow-lists no third-party origin.
    `BLOG_VIDEO_EMBED_ENABLED` adds exactly one origin to `frame-src`. Deriving
    it from tenant data was refused: a CSP header is deployment-wide, so one
    tenant would open the origin for every tenant sharing the deployment.

  **What remains of #597 and #607 is `ahliweb/awcms-astro` work**, plus item 9,
  which is blocked on a privacy ADR in that repo — the repo owner's decision,
  not a task. There is NO `awcms`-side work left on either issue.

- **FOUND WHILE WORKING, 23 August 2026 (while designing the byline of #597 item
  4): an executed ERASURE left the person's name, legal name and login address in
  the database.** **DONE (23 August 2026) —
  [ADR-0108](adr/0108-what-an-export-withholds-and-what-an-erasure-destroys-are-different-questions.md).**

  `SubjectDataDescriptor` had ONE column list — `redactedColumns`, documented as
  what a portability export must never carry — and the erasure executor used that
  same list as the set of columns to overwrite. For the nine tables where both
  answers coincide (`password_hash`, `token_hash`) that works perfectly, which is
  why nothing looked wrong.

  For the tables that hold the person's own identity the two answers are
  OPPOSITE. `awcms_profiles.display_name`/`legal_name` must be EXPORTED — a
  subject-access request is largely about them — and DESTROYED, so declaring them
  would have withheld the subject's own name from their own export. Their owners
  correctly declared nothing, and the erasure correctly wrote nothing. The same
  for `awcms_identities.login_identifier`, `awcms_registration_requests` (which
  named no column at all), `awcms_invitations`, `awcms_comments_comments` and
  `awcms_visitor_sessions.login_identifier_snapshot` — whose rationale literally
  says "erasure has to reach in and clear it".

  **In every case the descriptor's prose describes the correct behaviour and the
  mechanism could not express it.** Verified against real Postgres, not read:
  after a completed erasure, `SELECT login_identifier` still returned
  `subject@example.test`.

  Three consequences made it worse than a list of missing columns. **~90
  descriptors answer `severed_with_subject_row`** on the premise that anonymising
  `awcms_identities` makes their stamps resolve to nobody — a stamp pointing at a
  row that still carries the login address resolves to somebody. A column no
  sentinel fits was silently skipped into a `skippedColumns` list nothing asserts
  on (`ip_address`, `geo`). And an erasure could ABORT: a subject with two rows
  under a unique index rewrote both to the same `[erased]` and hit a 23505
  mid-transaction, with the request already claimed.

  The fix is two declarations for two questions, and the GATE rather than the
  twelve edits: `subject-data:registry:check` now refuses an `anonymize` that
  names nothing, a column name the table does not have, and a
  `severed_with_subject_row` whose anchor anonymises nothing. Uniqueness is
  derived from `pg_index`, never declared. Already-completed erasures are NOT
  fixed retroactively — re-running is an operator decision with its own audit
  trail.

- **FOUND WHILE WORKING, 22 August 2026 (while closing D7): `POST
/api/v1/tenant/domains/{id}/verify` VERIFIES NOTHING.** **DONE (22 August 2026) —
  [ADR-0106](adr/0106-domain-verification-proves-control-of-the-zone.md).** It read the
  row, checked `verification_method IS NOT NULL`, and set `status = 'active'`. No DNS
  lookup, no HTTP file fetch, no token comparison anywhere on the route path. An `active`
  domain feeds `resolvePublicTenantByHost`, the redirect allow-list and the canonical
  host, so a tenant admin holding `domains.create` + `.update` + `.verify` could add a
  hostname, PATCH `verificationMethod: "manual"`, call verify, and have this deployment
  answer for that hostname as that tenant.

  **Making the comparison real was only half the fix.** The API also accepted the record
  NAME and VALUE from the caller, and a check against a caller-chosen name and a
  caller-chosen value proves nothing — both can point at a record that already exists in
  a zone nobody controls. Both halves are now server-minted
  (`_awcms-verify.<host>`, 32 random bytes per row) and supplying either is REFUSED with
  a 400 naming the field, not ignored.

  **`manual` is removed rather than demoted to an operator attestation**, which is where
  this item's own guess pointed. A platform-scoped permission may only be exercised by
  the platform tenant (ADR-0053) and RLS means it cannot see another tenant's row, so
  preserving that path would have meant building a cross-tenant surface — the most
  dangerous kind this codebase has, and the MFA admin reset is deliberately alone in it.
  `file` is out because it means fetching a caller-chosen URL; `dns_cname` because it
  needs a platform target that does not exist. `sql/046`'s CHECK is untouched.

  The lookup runs OUTSIDE every transaction (ADR-0006) between two tenant transactions;
  the second re-authorises (ADR-0063) and carries the proven value into its `WHERE`
  clause. **Absent is not unavailable** — NXDOMAIN is a fact about the claimed domain,
  SERVFAIL about our resolver, and only the second feeds the breaker or leaves the status
  alone. A miss records `failed`, which keeps that state reachable. Pre-ADR rows are
  minted a challenge lazily on first verify rather than by a DML migration against a
  FORCE RLS table. Rate limited per PRINCIPAL, not per tenant — the first attempt keyed
  it on the tenant header and `tests/auth-source-rate-limit.test.ts` refused it,
  correctly (Issue #447).

- **FOUND WHILE WORKING, 22 August 2026: `docs:i18n:stamp` can silence
  `check:docs:translation` on a mirror that is now WRONG.** **DONE (22 August 2026).**
  The stamp script re-hashes every English source into its mirror's `i18n-source-hash`
  marker, and it did so unconditionally — so "edit the English, run the stamp" turned the
  translation gate green while the Indonesian mirror still said the old thing. Hit for
  real: `project-state:inventory:generate` moved §2's migration count 141 -> 142 and the
  stamp then declared the mirror current while it still read **141**. It was caught by
  `tests/doc-inventory-counts.test.ts`, which happens to check `sql/NNN` ranges across
  docs — a backstop that exists for a different reason and covers one field.

  Re-writing the marker is a CLAIM about the translation, so it is now made only when
  something says the translation was actually looked at: the mirror is modified (or
  untracked) in this working tree, or the source changed only in WHITESPACE since `HEAD`
  — the reflow case the tool was built for, where no translator needs to do anything.
  Otherwise it refuses, names the file and exits 1; `--force-restamp` is the deliberate
  override for a reword the translation survives. A missing `HEAD` version does not
  silently allow it. Verified against all three cases.

- **RECOMMENDATION ROUND — 17 August 2026, whole-repo audit across ten dimensions.**
  **38 recommendations from 48 verified findings.** Method: ten independent finders
  (functional gaps, algorithmic cost, DB query shape, request-path performance,
  authorization, input handling, auth/session/crypto, job reliability, reusable-function
  discipline, operability), each followed by an adversarial verifier instructed to
  REFUTE, that re-opened every cited file. 51 findings went in; **3 were refuted, 1 was
  already tracked, 24 survived CONFIRMED and 25 survived PARTIAL** (real but narrowed —
  they are recorded here in their narrowed form).

  **Read this limitation first: no live database was used.** No `EXPLAIN`, no job
  executed, no cross-tenant request issued. Every index claim below is derived from DDL
  plus btree prefix rules, not a measured plan. Items are ordered by
  (severity × reachability) / effort within each group.

  ### Do first — best payoff-to-effort across all four groups
  1. **A1** — one line in each of two predicates; converts a permanently-live
     cross-organisation grant into a fail-closed one.
  2. **A2** — one read + one refusal in the one place twelve handlers share; closes a
     session-minting loop into a suspended tenant.
  3. **A3** — a regex; removes an arbitrary-process-env read primitive _before_ SSO is
     switched on.
  4. **D1** — two lines in `ops/run-job.sh`; stops archives and exports being written
     into a container deleted seconds later while the DB records them as present.
  5. **C1** — one migration; removes a tenant-wide scan + sort from `/admin/blog`,
     `/admin/pages` and `GET /api/v1/blog/posts`.

  Immediately after: **A4** (`readJsonBody` on `dry-run.ts` alone — the only pre-auth
  route) and **D2** (the shared comment stripper, because it is what lets the next
  defect of this class ship green).

  ### A. Security
  1. **A1 — a redeemed delegated-access grant never expires.** **DONE (22 August 2026)** — the gate, the dated role grant, and the sweep.
     _(found independently by two dimensions, from the job side and the chokepoint side)_
     `identity-access/application/auth-context.ts:63-70` and `:101-108`;
     `delegated-access-store.ts:283`; `access-policy-writer.ts:65`; `grant-source.ts:113`;
     `sql/117:105,165`. `expireDelegatedAccessGrants` has **zero callers** — no job
     descriptor, no script, no `package.json` target — both request-time resolvers filter
     on `revoked_at IS NULL` only, and the role grant written at redemption omits
     `effective_to`, which `activeRoleGrants` reads as in force forever. A partner
     engagement scoped "until 30 September" confers its role indefinitely, and the 31-day
     `CHECK` in `sql/117` is inert. ADR-0090 promises "revocation **and expiry**
     deactivate the membership in the same transaction"; the expiry half has no executor.
     `sql/117:165` even ships a `(tenant_id, expires_at)` index built for that sweep.
     **Change:** add `AND g.expires_at > now()` to both predicates (expiry then falls
     through the existing `isDelegatedPartnerRefused` null-is-refuse branch — no new code
     path); pass the grant's `expiresAt` as `effective_to`; then add the job so sessions
     are actually revoked.

     **What landed, and the two places the plan was not followed.** The predicate is now
     in `resolveDelegatedGrantState` (the renamed resolver, which answers expiry and
     partner status off ONE row), and redemption stamps `effective_to` **paired with an
     explicit `effective_from`** — `sql/102` compares the two columns and `effective_from`
     DEFAULTs to `now()`, so supplying only the end date would compare this process's
     clock against PostgreSQL's and could refuse a legitimate redemption. Expiry does NOT
     fall through the `partner_suspended` branch as planned: that would have written a
     decision-log row asserting a suspension that never happened, so it gets its own
     branch above it (`403 DELEGATED_GRANT_EXPIRED`, `matchedPolicy:
"delegated_grant_expired"`). The ATTRIBUTION resolver (`resolveDelegatedGrantId`) is
     deliberately left unfiltered — its only readers are `awcms_abac_decision_logs` and
     `awcms_audit_events` (verified), so a stale id can widen no decision and it is what
     makes the refusal name the engagement.

     **The sweep landed too, and the privilege question it was waiting on has an
     answer.** `bun run identity-access:delegated-access:expiry` (hourly, bounded,
     `maintenance`) revokes the grant with reason `expired` and NO actor, deactivates the
     delegated tenant user, and revokes its sessions. Option (a) was taken: `sql/142` is a
     narrow `SECURITY DEFINER` function on the `sql/048`/`sql/119`/`sql/124` precedent —
     memberless NOLOGIN owner, policies scoped to that role alone, and a boundary that is
     the STATEMENTS rather than a column list (it takes a tenant id and a batch size and
     nothing else, so no caller-supplied value is ever written). `awcms_worker` holds
     `EXECUTE` and still no `UPDATE` on `awcms_tenant_users`/`awcms_sessions`; `awcms_app`
     deliberately holds no `EXECUTE` at all, because the request path has its own
     revocation and a privilege for a caller that does not exist is a privilege for
     nothing. Proven against a real database, including the two refusals.

     **One thing worth carrying forward.** The first mutation-proof written for the sweep's
     tests was FALSE: dropping `AND principal_kind = 'delegated'` from the membership
     UPDATE changes no test result, because the `id` predicate already protects an ordinary
     member — the two are independent guards over the same row, and only losing BOTH
     exposes anybody. The claim was corrected in the test's own header rather than quietly
     dropped, because a false mutation-proof reads as coverage.

  2. **A2 — ADR-0073 suspension does not reach the self-service or client-credential
     route factories.** **DONE (22 August 2026).** Both factories now refuse before the
     handler runs, and the plan's third clause landed too: `api:tenant-route:check` fails
     any file under `src/pages/api`/`src/pages/admin` that calls `isTenantServiceStopped`
     itself. Verified against a real database that `PATCH /api/v1/auth/profile` answered
     **200** for a suspended tenant beforehand and `403 TENANT_SUSPENDED` after.

     One departure from "resolve the status once inside both factories": omitting the
     declaration REFUSES, and a route that must stay reachable states
     `allowedWhileTenantSuspended: "<reason>"`. Four do, under one rule — a suspended
     tenant may still SEE its own security state and may still do things that only ever
     REMOVE its own access (list sessions, end one, end all, unregister a push device). A
     suspension that stops a customer ending a stolen session is protecting the attacker.
     `_shared/tenant-route.ts:247-301` and `:342-379`;
     `auth/profile.ts:125`; `session-handoff/{issue,redeem}.ts`; `auth/password/change.ts:118`.
     The check lives only in `authorizeInTransaction` and `ssr-session.ts`, and neither
     factory calls it, so a suspended tenant's live session can still write profiles,
     rewrite its credential, and mint **new** sessions indefinitely — the foothold
     outlives the TTL suspension was meant to drain. `push/subscriptions/index.ts:154`
     checks by hand; its sibling `DELETE` does not, which is the asymmetry proving the
     omission is accidental. **Change:** resolve `awcms_tenants.status` once inside both
     factories; delete the hand-rolled copy; extend `api:tenant-route:check` to assert it.

  3. **A3 — a tenant SSO admin can name ANY env var as the OIDC client secret and POST
     it to a host they choose.** **DONE (22 August 2026).** `tenant-sso.ts:180-184`;
     `tenant-sso-policy.ts:229-239,333-348`; `generic-oidc-client.ts:268-277`.
     `client_secret_env_var` is validated only as a non-empty string, then read as
     `env[...]` and sent to a discovery endpoint derived from the admin-supplied
     `issuer_url`, before any ID-token validation. `DATABASE_URL` and
     `AUTH_MFA_SECRET_ENCRYPTION_KEY` are reachable. Not live (`AUTH_SSO_ENABLED` off),
     but it is a tenant-admin → deployment-compromise primitive the day SSO is enabled.
     **Change:** require `^AWCMS_SSO_CLIENT_SECRET_[A-Z0-9_]{1,48}$` in both validators
     and re-assert it before touching `env`.

     **Landed with one deliberate difference: the prefix is `AUTH_SSO_CLIENT_SECRET_`,
     not `AWCMS_SSO_CLIENT_SECRET_`.** Every SSO variable in this repo is `AUTH_SSO_*`
     (`.env.example`, `18_configuration_env_reference.md`), and a namespace nobody would
     guess from the neighbouring names is one an operator sets up wrong once and then
     works around. Note what the chosen prefix does NOT match:
     `AUTH_SSO_CREDENTIAL_ENCRYPTION_KEY` — the key that decrypts every OTHER provider's
     stored secret — is one underscore-separated word away, and is excluded.

     A NAMESPACE rather than a deny-list, and the reasoning generalises: a deny-list of
     dangerous variable names has to be kept in step with every secret this deployment or
     a future one happens to hold, and fails open for the one added last week.

     Checked in three places; the third is the load-bearing one. Both admin validators
     refuse at write time (create AND update — a create-only check is one an admin walks
     around by patching afterwards), and `resolveProviderClientSecret` re-asserts
     immediately before it touches `env`. Validators only see values arriving now; the
     reader reads rows written in the past by writers that predate the rule.

  4. **A4 — pre-auth unbounded body buffering; 23 routes skip `readJsonBody`.** **DONE (22
     August 2026)** — 25, not 23.
     `data-lifecycle/dry-run.ts:32-44`; `security/request-body-limit.ts:127-132`.
     `resolveAuthInputs` checks only the _presence_ of a tenant header and token, then
     `await request.json()` runs. `checkContentLengthCeiling` returns true when the header
     is absent, so a chunked body with no `Content-Length` is buffered without bound
     before any DB or session work. Availability only — but unauthenticated.
     **Change:** convert the 23 files (`dry-run.ts` first, the only pre-auth one), then
     gate bare `request.json()/.text()/.formData()` under `src/pages/api/`.

     **Landed, with three notes.** The count was **25**, not 23. `readFormBody` had to be
     written — two routes read `formData()`, and there was no bounded equivalent; it parses
     capped text as `URLSearchParams` and states plainly that it is NOT a multipart parser.
     And `readJsonBody` now distinguishes EMPTY from MALFORMED: it answered `null` for
     both, so converting a route that returned "Request body must be valid JSON" would have
     silently turned that 400 into a field-validation 400 with a different sentence, or into
     a silent accept where an empty body is legitimate. Every converted route keeps the
     response it had.

     `bun run api:body-limit:check` is the gate; its exemption list starts EMPTY and may
     only shrink. The test drives real streaming `Request` objects that declare no length —
     the shape the middleware cannot see — and asserts the read STOPS EARLY by counting the
     bytes the producer emitted. A ceiling applied after buffering is not a ceiling, and
     only an executed test tells them apart: moving the check below the loop turns three
     cases red.

  5. **A5 — password reset changes the credential in EVERY tenant but revokes sessions in
     only one.** `password-reset.ts:259,267`; `session-revocation.ts:26-31`.
     `setPrincipalCredentialForIdentity` is global by design (ADR-0086);
     `revokeAllSessionsForIdentity` carries `WHERE tenant_id = …`. A user whose tenant-B
     cookie was stolen and who recovers from tenant A changes the password everywhere and
     revokes nothing in B. "Sign me out everywhere" has the same boundary, and two doc
     comments assert the guarantee the code no longer provides. **Change:** add
     `credential_epoch` to `awcms_principals`, bump it in the statement that replaces the
     hash, stamp it on sessions, reject stale-epoch sessions. Until then, correct the
     false comments.

     DONE (22 August 2026), `sql/145`. The recommendation is implemented as written, plus
     two things it did not say.

     First, WHY an epoch and not a wider revoke, written into the migration so the next
     person does not re-litigate it: the revocation cannot be widened from inside the
     request (one tenant GUC per transaction — the UPDATE would silently match zero rows
     everywhere else, the same bug with more code), and escaping RLS would mean a
     SECURITY DEFINER function that may revoke any session in any tenant, reachable from a
     request path. The epoch inverts it: the credential change writes ONE row it already
     owns, and no writer ever crosses a boundary. The integration suite asserts exactly
     that — after a reset in A, tenant B's row still has `revoked_at IS NULL` and is
     refused anyway, which is what distinguishes this fix from one that quietly gained
     cross-tenant write power.

     Second, the bump lives INSIDE `setPrincipalCredential` rather than at the two call
     sites, and there is a new gate. Eight files decide whether a session is live, and a
     session row gives no hint that a global credential exists to be behind — so the next
     author writes the three predicates they can see and the fourth is invisible. That is
     ADR-0079's shape exactly. `sessionCredentialCurrent` is the one definition and
     `identity:session-readers:check` (gate 57) fails the build for a recorded live-session
     reader missing it, for an `INSERT` that does not stamp the epoch, and for a new file
     naming `awcms_sessions` that is on neither list. Proven by mutation in all three
     directions before it was trusted.

     `promotePrincipalCredential` deliberately does NOT bump: it writes a hash the identity
     already had, so nothing about the credential changed, and bumping there would sign a
     person out of their other tenants on an ordinary login.

  6. **A6 — blog feed/sitemap escape with `escapeHtml` instead of `escapeXmlText`.**
     **DONE (22 August 2026).**
     `blog/[tenantCode]/feed.xml.ts:6,88,92,102`; `sitemap-blog.xml.ts:6,104,116`.
     One C0 control character in a post title (`validateTitleField` checks length only)
     makes the whole channel non-well-formed XML and every reader rejects it. ADR-0038
     named `escapeXmlText`; it was applied to the `seo_distribution` serializers, which
     are 404 in production, and not to these routes, which are 200.

     Both routes now use `escapeXmlText` (16 call sites). The route's own docblock is why
     the wrong function looked right — "escaped through the same `escapeHtml` used for HTML
     (XML and HTML share the same five entity escapes)" — true, and not the whole
     difference. It is CORRECTED rather than deleted: a false comment beside correct code
     is the next author's instruction.

  7. **A7 — sync-storage uses node-supplied strings verbatim as a server filesystem path
     and as an object-store key.** `sync-storage/domain/object-queue.ts:40-58,91`;
     `object-storage-uploader.ts:110-129`. `localPath` gets no root confinement and the
     cron dispatcher does `Bun.file(input.localPath)` on the **server**, returning the
     distinguishing error text to the node via `last_error` — an arbitrary-path oracle.
     `objectKey` gets no tenant prefix, so one node can overwrite another tenant's object.
     Requires a compromised legitimate node (`AWCMS_SYNC_ENABLED` + `R2_ENABLED` + the
     deployment HMAC secret), which is why it is not higher.

     DONE (22 August 2026). `localPath` is confined to `OBJECT_SYNC_LOCAL_ROOT_PATH`
     (default `./var/object-sync`) at the enqueue boundary AND again next to the syscall —
     the first so a refusal never becomes a durable row, the second because rows queued
     before this change are still in the table. The destination key is now
     `<tenantId>/<objectKey>`, applied at PUT time rather than stored, so there is no
     migration and the key a node reads back is still the one it sent.

     Three things the recommendation did not name. (a) The ORACLE was the larger half:
     `Local file not found: ${path}` versus a read error distinguishes existence for any
     path on the host, and every refusal now reports one sentence with the reason going to
     the server log instead. (b) `objectKey` needed a shape too — S3 has no server-side
     path semantics, so `../` is not traversal AT the provider, but `/` is a delimiter for
     listing, lifecycle rules and every console that renders a bucket as a tree. (c) The
     confinement refuses `..` TEXTUALLY, before resolving: a resolve-then-`startsWith`
     check accepts a path that escapes and returns (`../object-sync/x`), which is not an
     exploit today and is one refactor from being one.

     A required env var was considered and rejected: this ships into deployments that
     already have queued rows and a working node protocol, and a config gate that stops the
     app on upgrade is a larger event than a finding that needs a compromised node with the
     deployment HMAC secret to reach.

  8. **A8 — public site-search rate-limit config is neither validated nor NaN-guarded.**
     **ALREADY FIXED when checked, 22 August 2026 — this entry was stale on the day it was
     written.**
     `site-search/query.ts:34-37`; `suggest.ts:27-32`. A typo yields `NaN`, and both
     `count > NaN` and `now - windowStart >= NaN` are false — **the limiter is off** on an
     anonymous full-text endpoint while the `rate_limited` metric stays at zero and
     confirms it as "no abuse". An empty value yields `0` and 429s every visitor.

     Both settings already go through `parsePositiveIntSetting`
     (`src/lib/security/env-thresholds.ts`), which returns the fallback for an
     empty/undefined value AND for anything non-finite, non-integer or ≤ 0, warning once.
     `suggest.ts` even carries the comment "See `query.ts` — same defect, same fix". It was
     closed by #601 alongside #593.

     **Left visible rather than deleted.** An audit item describing a defect that is not
     there sends the next reader looking for it — the same failure shape as a stale skill
     banner, which this repository has a memory about. Verified by reading both call sites
     and the helper, not by trusting the comment.

  ### B. Performance (request path + delivery)
  9. **B1 — every `can()` affordance probe re-runs the FULL authorization pipeline.**
     **DONE (22 August 2026).**
     `lib/auth/admin-screen.ts:241-252`. One `/admin/blog` render issues 11
     `authorizeInTransaction` calls ≈ 66 sequential round trips on one reserved
     `interactive` connection (max 8 process-wide), ~50 of them re-reading byte-identical
     rows, plus 11 decision-log inserts per page view. 112 `can()` calls across 38
     screens; no budget measures the chokepoint. **Change:** memoize per transaction
     (WeakMap keyed on `tx`) or add a `canInTransaction` probe modelled on
     `evaluateFieldAccessInTransaction`, which already reuses context and writes no log.

     **Measured, and the estimate was low: 89 queries, not ~66.** 11 calls, 89 queries,
     47 ms on one reserved `interactive` connection. After: **29 queries, 23 ms**. The
     eleven decision-log rows are still eleven — inputs are memoised, never a decision.

     Neither of the two suggested shapes exactly. A `canInTransaction` modelled on
     `evaluateFieldAccessInTransaction` would skip the STRUCTURAL gates (tenant suspension,
     entitlement, delegated-write, partner/grant state, SoD), so an affordance would appear
     that the real chokepoint then refuses — the fake-affordance defect this repo condemns
     elsewhere. A `WeakMap` keyed on `tx` INSIDE the guard would change what a caller sees
     after IT has written: a route that grants a role and then re-authorizes would read the
     grant set from before its own write, silently and only sometimes.

     So the memo is an OPT-IN the caller supplies. `loadAdminScreen` creates one per render
     — a read path by construction, where the eleven decisions describe one moment — and
     every other caller is untouched. The test EXECUTES that argument rather than asserting
     it: grant a permission mid-transaction, re-authorize WITHOUT a cache, and the answer
     changes.

  10. **B2 — `isLegacyTenantRouteEnabled` reads `awcms_blog_settings` and discards it.**
      **DONE (22 August 2026).**
      `public-route-settings.ts:68-87`; called from all 7 `/blog/[tenantCode]/*` routes.
      One wholly wasted round trip on every anonymous page view — 100% of them on a
      default deployment, where the edge cache is off.
  11. **B3 — `/blog/*` routes never publish `locals.edgeCacheTenantId`.** The routes
      **DONE (22 August 2026).**
      already resolved the tenant and drop the id, so middleware repeats the
      `awcms_tenants` lookup on every cache MISS. One call per route; the working
      precedent is `seo-distribution/presentation/discovery-route.ts:145`.

      **B2 was worse than written: two of the seven paid TWICE.** `feed.xml.ts` and
      `sitemap-blog.xml.ts` call `isLegacyTenantRouteEnabled` and then call
      `fetchBlogSettings` themselves, so `awcms_blog_settings` was read, discarded, and
      read again. The gate is now ONE query and the merged reader still reads both,
      because it uses both — pinned separately so the saving cannot come from dropping a
      field somebody depends on.

      **B3's placement is the whole of it.** `publish-tenant.ts` states the rule — resolve,
      gate, produce, publish LAST — because a 404 is a cacheable status: publishing before
      the missing-resource branch annotates a "no such post" 404 differently from an
      "unknown tenant" one and answers, from a single request, the question the generic-404
      shape exists to withhold. The test asserts ORDER against the last `notFound` and the
      one serving response, and a mutation moving the call above the gate turns it red.

      **B4 moved a shape check with it, which was the near-miss.** The circuit-open guard
      keyed on `tenantName` — no longer in that block's return — so leaving it would have
      tested for a field that is never there and silently skipped EVERY assignment below:
      the sync indicator, the disabled-module set, the sidebar arrangement.

  12. **B4 — `AdminLayout` opens a third transaction whose first read is a column nobody
      **DONE (22 August 2026).**
      fetched.** `AdminLayout.astro:184-206`. `tenant_name` is fetched separately from the
      same row `readTenantDisplayDefaults` already selects.
  13. **B5 — ~6 middleware round trips per public request before the page's first query.**
      **DONE (22 August 2026)** — measured first, then reduced.
      `middleware.ts:305`; `redirect-resolution-service.ts:170-212`. Paid even by tenants
      with zero redirect rules. `standar-performa-dan-keamanan.md:195` claims the
      ≤3-query hot-read ceiling is "measured", but **both budget suites call directory
      functions directly and never drive middleware**, so the excess is structurally
      invisible to the gate that claims to enforce it.

      **The measurement was the harder half, and it is what the finding was really
      about.** `countQueries` can only be handed a `tx`, so it can only see code the
      test has already placed inside a transaction — a directory function. Everything
      the request pays first was not merely unmeasured but unmeasurable by that tool.
      `countPoolQueries` wraps the POOL and the transaction opened on it, and
      `tests/integration/middleware-query-budget.integration.test.ts` now pins the
      real numbers against a real PostgreSQL: **5 statements** for a passthrough,
      **7** for a request that redirects, **0** for a path the redirect vocabulary
      does not cover. Exact, not ceilings — a ceiling with slack cannot tell an
      improvement from a regression into the slack. And explicitly a FLOOR: `BEGIN`
      and `COMMIT` are two more round trips that `sql.begin` issues itself and no
      Proxy can see. A budget that quietly under-counts is how "measured" came to
      mean something other than measured in the first place.

      **The reduction is one read, not a short-circuit.** `resolveTenantAllowedHosts`
      and `resolveTenantPrimaryHost` read the same table under the same
      active/not-deleted filter, differing only by `is_primary`, and the redirect path
      called them one after the other — so `resolveTenantDomainSet` answers both from
      one round trip (6 → 5, and 8 → 7). Proven by running the new budget against the
      PRE-fix code and watching it report 6 and 8. The short-circuit the file's own
      perf note considered ("does this tenant have any live rule?") is still NOT
      applied, for the reason that note gives: the passthrough branch needs the
      server-derived host to attribute a 404, and the legacy-blog auto-redirect fires
      from settings rather than a rule row.

      **The standard now states its scope.** The ≤ 3 ceiling was always a ROUTE budget;
      the table did not say so, and "measured" is a word a reader takes as a bound on
      the REQUEST. The middleware budget is a separate row rather than folded into the
      same number, because the two are paid by different code and one sum would hide
      which half moved.

      **Found while working: two comments asserted a live code path was dead.** Both
      `redirect-resolution-service.ts` and `redirect-middleware.ts` said the middleware
      passes `locale = null` "all the way through", so locale-scoped redirect rules
      could never match. True under ADR-0039; **false since ADR-0098's locale routing
      landed** and the middleware started passing the served locale for a prefixed
      URL. Corrected in both places. Same shape as the stale-skill hazard this repo
      keeps a memory about: a claim that ages into the opposite of the truth, in a
      file nobody had reason to re-read.

  14. **B6 — in-process rate-limit `buckets` Map has no eviction.** **DONE (22 August
      2026).**
      `security/rate-limit.ts:57`. One permanent entry per distinct client IP; Redis is
      off by default so this is the live path. A slow leak, not an acute risk — but the
      failure mode is an OOM of the process holding every other cache.

      **Two mechanisms, because a sweep alone is not a bound.** An amortised sweep (at
      most once a minute, and on the way past the cap) drops every entry whose window has
      elapsed — `checkRateLimit` already treats an elapsed window as a fresh start, so
      such an entry holds no information. That bounds the map to "distinct clients seen
      within one window", which is the correct working set and, under a distributed
      flood, is itself attacker-controlled. So there is also a hard cap of 50,000, and
      when it is reached the victims are chosen to be the least harmful ones available:
      the entries CLOSEST TO EXPIRING, evicted in one batch down to 45,000 so the sort
      that picks them runs once per 10% of growth rather than once per request.

      **The recommendation did not say where `windowMs` comes from, and that is the
      whole design.** The bucket now stores it. Eviction happens OUTSIDE any call for
      that key, so a sweep has to know when an entry it was not asked about stopped
      counting, and the map is shared by callers with different windows (login is
      minutes, site-search is seconds) — taking the window from whichever caller happens
      to trigger the sweep would expire the other family's counters early. Early
      expiry is the one failure a memory fix must not introduce: forgetting a LIVE
      counter hands its owner a fresh allowance, so that is what
      `tests/rate-limit-bucket-eviction.test.ts` asserts alongside the size.

  ### C. Algorithm / query cost
  15. **C1 — no index supports the blog list ordering.** **DONE (22 August 2026).** `blog-post-directory.ts:398,436`;
      `sql/035:95-119,174-193`. Four list queries order by `updated_at DESC` (one keyset by
      `created_at DESC, id DESC`); none of the seven indexes leads with either column, so
      each `/admin/blog`, `/admin/pages` and `GET /api/v1/blog/posts` is a tenant-wide scan
      - top-N sort, plus a second full scan for `count(*)`. `db:fk-index:check` cannot see
        it — `updated_at` is not a foreign key. Cost is O(tenant posts), not O(page size).

      **MEASURED, which this round could not do.** `sql/145` adds three indexes; against
      24,000 seeded posts on PostgreSQL 18 the `/admin/blog` list went from a Seq Scan of
      24,000 rows plus a top-N heapsort (7.4 ms) to an Index Scan reading **50** (0.057
      ms), the keyset first page from 5.1 ms to 0.110 ms, and a keyset page resumed at row
      10,000 reads 50 rows in 0.060 ms. The milliseconds are this machine's; `24,000 → 50`
      is the finding.

      **One claim in this entry is wrong and is left visible rather than edited away:**
      "plus a second full scan for `count(*)`". The count beside the list already plans as
      an Index Only Scan on `awcms_blog_posts_tenant_deleted_idx` (1.8 ms, unchanged by
      `sql/145`). It reads every index entry, which is why it does not get faster — but it
      is not a heap scan, and no index added here helps it. A cheap count is a different
      decision (an estimate, or a maintained counter) with its own trade-off.

      Posts get PARTIAL indexes on `deleted_at IS NULL`, which those queries write as a
      literal. Pages do NOT: `listBlogPages` decides deleted-vs-live with a `CASE` over a
      bound parameter, so a partial index is provable under a custom plan and not under a
      generic one — an index the planner can only sometimes prove applicable is an index
      that sometimes is not there.

      Held by a PLAN assertion, not a timing threshold
      (`tests/integration/blog-list-ordering-plan.integration.test.ts`): named index, no
      `Seq Scan`, no sort node, ≤50 rows read. Its last case drops the index inside a
      rolled-back transaction and asserts the scan returns — without that, every other
      assertion also passes on a table too small to tell the plans apart.

  16. **C2 — `purgeVisitorAnalyticsData` is the only unbounded retention purge in the
      repo.** `retention-purge.ts:91-117`. Four statements with no batch limit, each using
      `RETURNING id` only to take a JS-side `.length`. Every sibling caps at 5000 and loops.

      DONE (22 August 2026). All four statements are
      `WHERE <pk> IN (SELECT … ORDER BY … LIMIT n)` and the function returns `hasMore`. The
      scheduled job loops with a FRESH transaction per pass — looping inside one would hold
      every lock and dead tuple for the duration, which is the thing the batching exists to
      avoid — and names any tenant that hits the pass cap. The on-demand endpoint does ONE
      bounded pass and returns `hasMore`, because the size of the work is unknown when the
      caller presses the button.

      A CORRECTION found by mutation, not by reading: the code comment claimed the ORDER BY
      gave monotonic progress. It does not — a DELETE removes what it took, so termination
      holds regardless. What it buys is OLDEST-FIRST, which matches the index the predicate
      already uses and means an interrupted purge has removed the data furthest past
      retention rather than an arbitrary slice. Removing the ORDER BY left every test green
      until a test was written for the property that is actually true.

      `awcms_visitor_daily_rollups` is bounded on `ctid` rather than a surrogate id: it is
      keyed `(tenant_id, date, area)` and has no id column. `ctid` is not stable across an
      UPDATE, which is exactly why it is only ever used inside the one statement that
      selected it.

  17. **C3 — sync push does read-modify-write on `current_version` with no row lock.**
      `sync/push.ts:132-137`. Two concurrent batches both read 5, both pass the conflict
      check, both write the literal `6`: two conflicting events accepted, zero conflict
      rows, one increment lost. Harmless downstream today only because `awcms_sync_inbox`
      has no consumer — it is a defect in the conflict foundation itself.

      DONE (22 August 2026). The write is a compare-and-set
      (`… DO UPDATE … WHERE current_version = ${expected}`), extracted to
      `advanceAggregateVersion` so it has one name and one test. A CAS that matches
      nothing IS `version_mismatch` — the verdict the pure evaluator would reach on a
      fresh read, so a node sees an outcome it already understands.

      Two things beyond the recommendation. The inbox row is now written AFTER the version
      advances; it used to be first, so a losing batch left an accepted event behind for an
      increment it never made. And `SELECT … FOR UPDATE` — the obvious fix — was rejected
      as WEAKER: it locks rows that EXIST, so two batches creating the same aggregate would
      both proceed, and it holds every aggregate in the batch for the whole transaction
      rather than one row for one statement.

      The race is tested for real and DETERMINISTICALLY: two transactions with handshakes
      in both directions. Awaiting only the winner is not enough — `withTenantOrThrow`
      returns before its first statement runs, so the loser could read the post-write value
      and fail for the wrong reason, which it did one run in five before the second
      handshake was added.

  18. **C4 — reporting projection cursor advances past rows inserted earlier but committed
      later.** `projection-incremental-worker.ts:195-223`. No upper bound, no lag window.
      Because `now()` is transaction-start, a long transaction's row can commit after the
      cursor has moved past its timestamp — never selected again. **ADR-0077 rejected
      exactly this shape for sync-pull**; this engine kept it, and ADR-0072 declares the
      incremental value authoritative, so nothing reconciles it.

      DONE (22 August 2026). The scan stops at `now() - REPORTING_PROJECTION_LAG_SECONDS`
      (default 60), and the guarantee is STATED rather than implied: a row is counted if
      the transaction that wrote it committed within the lag of starting. A writer holding
      a transaction open longer is still missed — bounded and named, not eliminated. `0`
      restores the old behaviour.

      `pg_stat_activity`'s `min(xact_start)` would be exactly right and is unusable: a
      non-superuser without `pg_read_all_stats` reads NULL for other users, so the bound
      would silently become `now()` — no bound at all, wearing the shape of one. A wrong
      answer that looks like the right mechanism is worse than a plainly approximate one.

      `now()` is SQL's, not the app's. Comparing a database timestamp against a JS clock
      would make the bound depend on app/DB clock skew, and skew in the wrong direction is
      silently no bound at all.

  19. **C5 — subject-data export: 49 unbounded reads in one interactive transaction, two
      over unindexed actor columns.** `subject-data-executor.ts:200-217`. No LIMIT, no
      cursor, all rows buffered; `awcms_audit_events.actor_tenant_user_id` and the
      `awcms_domain_events` twin have no index and are **not FK columns, so
      `db:fk-index:check` structurally cannot see them**. The route's own comment claims
      "a bounded set of rows".

      DONE (22 August 2026), `sql/145`. Three partial indexes, and MEASURED on 60,000 rows:
      the actor read went from a Seq Scan touching 858 buffers (2.5 ms) to an Index Scan
      touching 33 (0.039 ms). The near-miss is worth recording — `awcms_audit_events` DOES
      have `awcms_audit_events_actor_tenant_idx`, on `actor_tenant_id`: the delegated
      actor's TENANT, a different column one character apart in reading.

      The reads are row-capped at 10,000 with the cap REPORTED (`truncated` per table,
      `truncatedTables` in the response beside the existing `unanswered` coverage
      statement, and INCOMPLETE in the `critical` audit event's message). A cap on a
      subject-access export is only acceptable because it is flagged: an export that
      quietly returned the first N rows would answer a legal obligation with a number
      dressed as an answer, which is worse than the unbounded read it replaced. No cursor,
      deliberately — a "complete answer" assembled across pages has a boundary at every
      request where a partial answer can be mistaken for the whole one.

      One mutation taught something worth keeping: deleting the LIMIT entirely turned
      NOTHING red, because with 12 rows and a cap of 10 the flag and the slice come out
      identical and only the COST differs. That is the finding's own shape, so the suite
      now carries an explicit assertion that the statement really contains the LIMIT.

  20. **C6 — `/admin/roles` is an N+1 plus an O(roles × catalogue) payload.** **DONE (22
      August 2026).**
      `roles.astro:88-94`. `listRolePermissions` awaited once per role (up to 100,
      sequential); the ~230-row catalogue rendered as `<option>` once per role.

      **The N+1 half:** `listRolePermissionsForRoles` answers the whole set in one
      `role_id = ANY(...)` round trip and returns an entry for EVERY requested id, empty
      array included — a caller that had to tell "no grants" from "not in the result"
      would be back to asking per role. The single-role reader was DELETED rather than
      left unused: a zero-caller export is how the next screen quietly reintroduces the
      N+1 (see D12/D15/D16 for the same shape as a live finding).

      **The payload half moved a decision to the client, so it is worth being explicit
      about what did not move.** The catalogue is now emitted once inside a `<template>`
      — inert content, not rendered and not submitted — and the client clones it into a
      role's picker on the first open, minus what that panel already lists as granted.
      The granted ids come from the panel's own revoke buttons, because a second copy
      could only disagree with the list already on screen. The SERVER still decides
      whether a picker exists at all (`availableCount > 0`, counted against the
      catalogue rather than by subtraction — a role can hold a permission the catalogue
      omits), and the endpoint's `configure` guard remains the only authority on the
      grant itself. The picker is empty without JavaScript; that is not a regression,
      the form has always submitted through `sendJson`.

      **One thing to carry forward: this consumed nearly all of the client asset
      budget.** `build:asset-budget:check` allows 192,000 B for the app bundle; the
      picker filler costs ~540 B and leaves **161 B** of headroom. The trade is good in
      itself (a few hundred bytes of cached JS against ~23,000 `<option>`s in every
      render of the page) but the NEXT screen that adds a client script will fail that
      gate, and it will fail it for reasons unrelated to whatever that screen did.
      Raising the ceiling is a decision, not a formality — it is not taken here.

  21. **C7 — `prepareCandidates` re-escapes every tag name inside the sort comparator.**
      **DONE (22 August 2026).**
      `internal-tag-linking.ts:155-158`. Measured 1090 calls/sort vs 100 for
      decorate-sort-undecorate. On by default on every public article render; absolute
      saving is small (~0.14 ms), which is why it is last.

      Decorate-sort-undecorate, with the escaped name carried on the row the dedupe loop
      and the caller both already need — so the cheaper version is also the shorter one.
      No behavioural test can separate the two implementations: escaping is monotone
      over a prefix, so raw-longer and escaped-longer can only disagree for candidates
      that never compete at the same text position. What is asserted instead is that the
      comparator contains no `escapeHtml(` call, plus the two properties the sort exists
      to provide (longest-escaped-first for overlapping terms; `minTermLength` still
      measured on the RAW name, so escaping cannot smuggle a filtered-out tag back in).

  ### D. Functional improvements & maintainability
  22. **D1 — scheduled jobs run in a container with no volume and a lossy env
      allow-list.** **DONE (22 August 2026).** `ops/run-job.sh:88,92`. `docker run --rm` with **no `-v`**: lifecycle
      archives and report exports are written into a container deleted seconds later while
      `awcms_data_lifecycle_archive_manifests` and `awcms_report_export_runs` record them
      as present — the README's restore procedure cannot be executed and scheduled exports
      404 on download. Separately the hand-maintained `printenv | grep -E` drops ~10
      variables scheduled jobs actually read (the `^CLOUDFLARE_` alternative is anchored
      and misses `TENANT_DOMAIN_CLOUDFLARE_*`), and the job still exits 0. Latent only
      because `.env.example`'s values happen to equal the code defaults.

      **The env half was WORSE than this entry says: 81 of 171, not ~10.** Measured with
      `collectEnvReads()` — the same source `config:env:coverage:check` uses. Both
      artefact-root paths (`DATA_LIFECYCLE_ARCHIVE_ROOT_PATH`,
      `REPORTING_EXPORT_ROOT_PATH`) were among them, which makes the two halves of this
      finding one defect rather than two: the volume was missing AND the variable that
      could have pointed the write somewhere else never arrived.

      A host directory is now mounted over the container's `var/` — one mount covers both
      roots because both default to `./var/...` relative to `WORKDIR`, and a test pins that
      container path to the image's ACTUAL `WORKDIR` so a Dockerfile move cannot land
      quietly. Env is selected by exact NAME from `ops/awcms-jobs.env-allowlist`, GENERATED
      by `bun run jobs:env-allowlist:generate` and held by a new gate in `bun run check`.
      Exact-name matching is not incidental: a prefix pattern also copies
      `DATABASE_URL_LOOKALIKE`, and no source assertion distinguishes the two — so the
      runner's own `awk` expression is EXECUTED over a fixture environment in the test.

      Two refusals rather than a fallback, because both silent alternatives produce a job
      that runs and reports success: an unreadable allow-list, and copying zero variables.
      A `*_ROOT_PATH` pointed outside the mount is named in the log — the same defect
      wearing a configuration, with a symptom identical to success.

  23. **D2 — four copies of a naive `stripComments` swallow real code; five gates scan
      less than they claim.** **DONE (22 August 2026)** — eight copies, not four.
      `table-write-ownership-check.ts:68`;
      `access-chokepoint-check.ts:111`; `env-contract-coverage-check.ts:145`;
      `identity-principal-access-check.ts:177`; `work-class-registry-generate.ts:101`. The
      block-comment regex runs over the whole file first, so any docblock containing a
      route glob like `` `/api/v1/partner/**` `` deletes everything to the next `*/`.
      **Mutation-proven:** a planted `INSERT INTO` at `identity-access/module.ts:41` is
      invisible to `modules:table-writes:check`; 59 files lose real code versus the oracle.
      No gate signal differs _today_ — this is a latent fail-open that grows with every new
      docblock. The correct string-aware version already exists at
      `i18n-catalog-check.ts:263`. **Change:** extract it to `scripts/lib/source-text.ts`
      and delete the five copies.

      **Landed, and the blast radius was bigger than this entry says.** Eight files carried
      a copy, not four. The sharpest single fact is not the file count:
      `src/modules/blog-content/module.ts` loses **7,260 characters and 57 lines** to the
      naive stripper, INCLUDING its entire `jobs:` and `capabilities:` declarations — so a
      gate reading that descriptor through it was looking at a module with no jobs and
      reporting OK. Across `src/`, 29 files lose more than 200 characters.

      All eight affected gates were run before and after: same answers, and
      `work-class-registry.generated.json` regenerates byte-identical — the "no signal
      differs today" claim VERIFIED rather than repeated.

      `work-class-registry-generate.ts`'s `codeOnly` is folded in as well. It was NOT the
      swallowing variety (no whole-file regex) but it was blind the other way: a block
      comment whose middle lines do not begin with `*`, or a trailing `/* … */` after code,
      survived it and could be read as a call.

      `stripComments` stays RE-EXPORTED from the three scripts that 21 test files already
      import it from — editing 21 import lines inside a change about something else is how
      a diff stops being reviewable. The test keeps the naive version as an ORACLE: one
      that only exercised the good stripper would assert that it works, which is easy and
      uninformative.

  24. **D3 — `LOG_LEVEL=warn` passes `config:validate` and is silently ignored; `warning`,
      the value the logger implements, is rejected.** **DONE (22 August 2026).** `validate-env.ts:51-56`;
      `logger.ts:12,21-26`. There is no value that both passes the validated contract and
      works, so the firehose keeps shipping while the operator believes it is quieted.

      Fixed on BOTH sides and additively: the validator accepts `warning` (and keeps
      `warn`), and the logger canonicalises `warn` → `warning` with a one-time notice
      naming the canonical spelling. Rejecting `warn` outright would have been tidier and
      would have turned a silent no-op into a FAILED `config:validate` on a deployment that
      is running right now, to punish a spelling. An unrecognised value still falls back to
      `info` — the safe direction, because the alternative is a deployment that logs nothing
      because somebody typed `infoo`.

  25. **D4 — two analytics jobs branch on `result instanceof Response` after
      `withTenantOrThrow` — dead code hiding a real abort.** `visitor-analytics-rollup.ts:97-106`.
      `tenantsSkipped` is permanently 0, the `partial` warning can never fire, and
      backpressure abandons every remaining tenant instead of skipping one. The rollup
      targets _yesterday_ only, so an aborted run leaves a permanent hole.

      RESOLVED (PR for D4/D5/D6). The dead branch is a `catch` that re-throws anything that
      is not a `DatabaseBusyError` — narrow on purpose, because laundering a broken query
      into `tenantsSkipped` would reintroduce the exact class of bug the finding is about.
      Skipped tenants are NAMED rather than counted: `--date=` is the remedy and an
      operator needs the ids. The audit said "two analytics jobs" and it was right about
      both: `visitor-analytics-purge.ts:92` carries the identical dead branch and is fixed
      the same way.

      The purge is the more serious of the two. It is what ENFORCES retention, so an
      abandoned run means every tenant after the first keeps holding visitor data past its
      window — silently, while the summary reports success and its `(WARNING: … database
busy)` clause, gated on the permanently-zero counter, could never print.

  26. **D5 — `site-search:reconcile` exits 0 and prints `failures=0` when a whole source
      fails.** `site-search-reconcile.ts:57-83`. The engine's `break` happens before
      `results.push`, so a failed source contributes zero to `failureCount`. Public search
      stops updating while every operator signal says success.

      RESOLVED (same PR). The engine now reports `failedSources` and `unattemptedSources`,
      kept SEPARATE from `failureCount` — collapsing a dead source into a per-document
      counter is precisely how "0" came to mean "one whole source stopped". The script
      checks `status`, prints both lists and exits 1.

      Two corrections to the recommendation. (a) The `break` is CORRECT and stays: a source
      failing on a database error leaves the transaction aborted, so continuing would
      produce a cascade of `25P02`s and `finalizeRun` itself would fail. (b) The
      false-success is only reachable when the source throws a **JS** error (an identifier
      assertion in `buildExtractionQuery`, which runs before any SQL) — a DATABASE error
      poisons the transaction, takes `finalizeRun` down with it, and rejects out of the
      call, which was always loud. It was also, until this PR, loud in the wrong way: it
      abandoned every remaining tenant. The script now catches per tenant and continues,
      the same shape as D4.

  27. **D6 — email circuit breaker is fed by per-message rejections, and an open breaker is
      recorded as a real attempt.** `mailketing-provider.ts:91-107`. An invalid-recipient
      rejection — a fact about the row — records a breaker failure, contrary to the file's
      own header and to the rule `push-delivery` states explicitly. Once open, the
      dispatcher writes a `failure` row and burns `retry_count` for messages that never
      reached the provider: **the delivery ledger records contacts that did not happen.**

      RESOLVED (same PR). `EmailDeliveryResult` gains `skipped`, which is neither an attempt
      to record nor a retry to spend: such a message returns to `queued` untouched, counted
      as `deferred` and printed in the summary line. A number the summary does not print is
      a number nobody reads, so splitting `deferred` out without printing it would have made
      the pass quieter than before rather than clearer.

      The breaker accounting is now the split `push-delivery/domain/fcm-error-mapping.ts`
      already documents: 429 and 5xx are statements about the SERVICE, every other 4xx is
      about the message. That removes a third case the audit did not name — the
      `!response.ok` branch was tripping the breaker on ordinary 4xx too. Concretely: the
      threshold is 5 consecutive failures, so SIX invalid addresses in one batch used to
      stop email for the whole deployment, password-reset messages included. A genuinely bad
      API token is `email:provider:health`'s job, and unlike the breaker it can tell an
      operator WHICH problem it is.

  28. **D7 — `tenant_domain`'s declared `defaultVerificationMethod: "manual"` has no runtime
      reader.** **DONE (22 August 2026) — resolved by DELETING it, not by wiring it.**
      `tenant-domain/module.ts:163`. The validator defaults to `null` and
      verification answers `missing_verification_method` — the `pending_verification` state
      §4 item 6 already observes in production, without naming this cause.

      **The obvious repair would have removed a control, so it was not made.**
      Applying the default at creation is what the finding's framing suggests, and it is
      wrong here: `verifyTenantDomain` performs NO verification of any kind. It checks
      that `verification_method` is non-NULL and sets `status = 'active'` — no DNS lookup
      exists anywhere on the route path (the Cloudflare adapter is selected by
      `TENANT_DOMAIN_DNS_PROVIDER` and is called by nothing). So a NULL
      `verification_method` is currently the only step between "a tenant created a
      hostname row" and "that hostname is active", and an active domain feeds
      host→tenant resolution, the redirect allow-list and the canonical host.

      The whole `settings` block is gone, with the reasoning in its place, and the test
      that used to assert the default now asserts its absence PLUS the behaviour that
      must not change (creation still leaves the column NULL).

      **FOUND WHILE WORKING, and it is the real item: `verify` verifies nothing.** The
      friction above is one `PATCH` away from being removed by any tenant with
      `domains.update` — set `verificationMethod: "manual"`, call verify, and the
      hostname is active. Whether that matters depends on DNS nobody here controls, which
      is exactly why it needs an argued decision rather than a quiet fix inside a
      settings cleanup. Recorded as a NEW item below rather than closed here.

  29. **D8 — `media_library.enforcement.*` is filed as a screening DECISION naming a screen
      that does not implement it.** **DONE (22 August 2026).**
      `admin-screen-coverage-check.ts:91,93`. A relocation
      that never happened is recorded as judgement, so the shrink-only ledger does not
      count it.

      Verified before moving: `/admin/security` carries the MFA enforcement level and
      nothing about media at all. Both keys moved from `DELIBERATELY_UNSCREENED` to
      `NOT_YET_SCREENED`, so the count went from "15 deliberate, 34 awaiting a screen" to
      "13 deliberate, 36 awaiting a screen" — the ledger is supposed to be the honest
      number for how much is unbuilt, and two surfaces were being kept off it by a
      sentence. The reasoning about WHERE the switch belongs survives as a note on the
      ledger line; it was never wrong, it was just not yet true.

      `DELIBERATELY_UNSCREENED` is now exported, so a test can assert the two lists never
      share a key. A version of that test which tolerated the missing export would have
      passed by doing nothing — the same shape as the finding it guards.

  30. **D9 — `ship-logs.sh` names its output file at attach time and never rotates.**
      **DONE (22 August 2026).**
      `ops/ship-logs.sh:53-57`. `$(date)` is expanded once when the tailer is spawned and
      the fd lives until the next deploy, so today's lines land in a file dated by the last
      deploy and the 30-day `-mtime` sweep can never touch the open file.

      The redirect is now a `while read` loop that re-derives the date and reopens with
      `>>` per line — `printf -v day "%(...)T"`, a bash builtin, so there is no `date`
      fork per line on a log this script exists to keep all of. `TZ=UTC` inside the
      payload because `%(...)T` formats in LOCAL time while the filenames were always
      UTC.

      **The property is testable without waiting for midnight, and the test executes
      it.** Delete the file underneath a running writer: a single long-lived descriptor
      keeps writing into the unlinked inode and the path never returns; a per-line `>>`
      recreates it on the next line. `tests/ops-log-shipping-and-readiness.test.ts` runs
      that against the payload EXTRACTED FROM THE SCRIPT (not a copy), and carries a
      CONTROL case driving the old redirect shape through the same procedure to show the
      file staying gone — without it the suite would only prove the new writer works, not
      that it differs.

  31. **D10 — nothing in the deploy or LB path consults the readiness endpoint that already
      exists.** **DONE (22 August 2026)** — with a deliberate split, not a swap.
      `health.ts:8-14`; `infra/varnish/default.vcl:26-34`. Coolify, the Docker
      HEALTHCHECK and the Varnish probe all use the deliberately dependency-free liveness
      endpoint, so a release with an unreachable database is marked successful and cut
      over. `/api/v1/database/pool/health` reports `databaseReachable` +
      `circuitBreakerState`, is equally unauthenticated, and is wired to nothing.

      **The obvious fix is wrong and was not taken.** Pointing those three probes at
      readiness would restart or de-route containers during a database outage, and
      restarting an app does not repair a database — it turns one incident into two.
      All three RESTART or REROUTE, so liveness is the correct question for them, and
      that reasoning is now written at each site so the next reader does not "fix" it.

      **What readiness was missing was a reader on the path that pages a person.**
      `ops/synthetic-check.sh` now probes it every 10 minutes from OUTSIDE — the file
      whose own header says its job is the question the container healthcheck answers
      from inside, where "every defect this project has actually shipped was invisible".
      It asserts `databaseReachable` and that the breaker is not `open`, because the
      endpoint answers 200 while reporting the database is gone: a probe that only
      checked the status code would be the liveness check again under a longer URL.

      **What is NOT closed, and cannot be from here.** Coolify's Health Check Path is
      configuration in Coolify, not in this repo. The runbook now states the split, gives
      the readiness assertion as a numbered deploy step, and says explicitly not to point
      Coolify at it — but nothing in this repository can enforce that, and calling it
      enforced would be the same class of claim as the ≤3-query "measured" in B5.

  32. **D11 — six job scripts call `withTenantOrThrow` with no `workClass`, so they run as
      `interactive`.** **DONE (22 August 2026) — and it was SEVEN, not six.**
      Nightly purges attribute their pool pressure to the bucket that
      serves live users. Both `work-class-registry.ts:11-17` and
      `database-capacity-runbook.md:268-282` assert jobs never reach
      `acquireWorkClassSlot` — that is now false, and `site-search-reconcile.ts:69` passes
      `maintenance` where the registry says `background_sync`, so the drift runs both ways.

      The full set, checked rather than counted from the finding: `visitor-analytics-purge`,
      `visitor-analytics-rollup`, `blog-ads-drop-readiness`, `blog-ads-ingest`,
      `comments-retention` (3 calls), `edge-cache-purge` (3 calls) and
      `tenant-domain-dns-sync` — plus `site-search-reconcile` contradicting the map. Each
      now passes the class the registry declares for it. The drift was resolved TOWARD
      THE REGISTRY (`background_sync` for site-search): the registry entry carries an
      argued rationale and the script's literal carried none, and if `maintenance` is
      right the place to change it is the rationale.

      **The fix that matters is the gate, because otherwise it re-drifts.**
      `db:work-class:generate` now REFUSES to run when a job script does not open its
      transactions as its declared class — in both directions, a missing option and a
      contradicting one. It COUNTS rather than checking presence: a script with three
      calls and one literal reads as declared to any presence check while two of its
      transactions still run as `interactive`, and two of these scripts have exactly that
      shape. Proven by reverting one option and watching the gate name the file and the
      count.

      **The gate reads ONE file, the script, and says so.** Several registry rationales
      claim "every call inside <module> already passes it explicitly"; those calls live
      under `src/`, the script has no `withTenant*(` of its own, and nothing verifies
      them. Silence there is "not covered", not "correct".

      **Both false claims are corrected.** `work-class-registry.ts` said jobs "do not
      call `withTenant`/`acquireWorkClassSlot` at all today" and the capacity runbook's
      "Known limitation" said the same. Both were true when written and stayed after they
      stopped being true — jobs go through `withTenantOrThrow`, which IS
      `acquireWorkClassSlot`. The runbook section is renamed from a limitation to a
      description of how the two mechanisms divide: work class decides which bounded
      queue a job's transactions wait in, the job-runner advisory lock decides how many
      of the job there are.

  33. **D12 — three near-identical JSON fetch cores in `src/lib/ui/`, plus dead `postJson`
      carrying a false comment.** **DONE (22 August 2026).** `admin-form-client.ts:77-173`.
      They had **already drifted**: `sendJson` supported `extraHeaders`
      (Idempotency-Key), bodyless requests and `DELETE`; `sendJsonWithFieldErrors`
      supported none until Issue #596 added the first by hand — which is why `/admin/seo`
      reported "invalid" without saying which field. `postJson` had zero callers while
      claiming to serve "existing create-form call sites".

      The three are now projections of one `sendJsonRequest`, and they stay three public
      functions on purpose: `sendJson`'s narrow `{ ok, errorCode }` is what stops thirty-odd
      screens painting internal detail onto the page (Issue #540), so widening it for
      everyone to serve two callers would remove that property from all of them. `postJson`
      is deleted. A third disagreement the finding did not name: the field-errors copy
      merged `extraHeaders` OVER `Content-Type`, so a caller could have replaced it — the
      kept order is the one both docblocks claimed.

      Four other `src/lib/ui` files fetch with same-origin credentials and are deliberately
      NOT folded in: two are GET reads, `language-switcher-client.ts` POSTs anonymously to a
      public endpoint and decides by `response.ok` plus a cookie, and
      `push-subscription-client.ts` surfaces the server's own `error.message` — the exact
      thing the narrow shape exists to withhold.

      **It recovered NO client bytes, and the claim that it would was wrong.** Both files
      were already shared chunks shipped once each, so "three copies of the bytes" was
      never true — three copies of the SOURCE shipped once. The 425 B "saving" measured
      while working came from a `dist/` the build had not cleaned, and it sent this whole
      batch down the wrong road: D12/D13/D14 were sequenced BEFORE ADR-0106 to buy budget
      headroom that did not exist, and the ADR-0106 branch turned out to be inside the
      ceiling all along (191,733 B on a clean build). `bun run build` now runs
      `rm -rf dist` first, because `client-asset-budget.ts`'s own docblock had already
      recorded being misled this way twice and warning about it a third time would not
      have worked either.

  34. **D13 — `KEYSET_CURSOR_CREATED_AT_SQL` has 3 users and 20 hand-inlined copies.**
      **DONE (22 August 2026).** `_shared/keyset-pagination.ts:56-59`. The constant
      hardcoded a bare `created_at` while its own docblock told callers to "wrap it in a
      table alias" — not something a string can do, so every joined query wrote its own.

      Now `keysetCursorCreatedAtSql(alias?)` over a shared
      `utcMicrosecondTextSql(column, offsetSuffix)`. **There were twenty-ONE copies, not
      twenty**: three more render the same expression for `occurred_at` and `last_seen_at`,
      which the audit's `created_at` search could not see, and `idn_admin_regions` renders
      it with a `Z` suffix for a DTO rather than a cursor. All are gone.

      The finding called this prospective and it is: every copy was byte-correct. That is
      not the same as safe — `AT TIME ZONE 'UTC'` and `US` are both silent when wrong, and
      `US`→`MS` resurrects #158 past page one only. A test now refuses any
      `to_char(… AT TIME ZONE 'UTC'` outside the owning module, matching the RENDERING
      rather than the correct format string, because an edit that gets one character wrong
      is the case it exists to catch. It was verified to FAIL on a real defect. The column
      reference is asserted to be an identifier, since callers hand the result to
      `tx.unsafe`.

  35. **D14 — finish the `scripts/lib/` extraction that has already started.**
      **DONE (22 August 2026).** Three shared modules, and each replaced a duplication that
      had already produced a difference nobody chose.

      `lib/markdown-table.ts` — `extractBlock`/`replaceBlock` were byte-identical copies;
      `parseInventoryRows` was not. One had learned about `\|` escapes because its own table
      holds a shell pipeline; the other split on a bare `|` and would have torn that cell.
      The escape-aware version is a strict superset, so it costs the other caller nothing.

      `lib/migrations.ts` — **six** copies of the loader (the audit found five; `sql-grants.ts`
      had a sixth), and the non-empty assertion existed in exactly one. Every caller asks
      "which tables exist, and which have RLS forced" — a question an empty list answers
      with a confident, wrong "none". It now resolves `sql/` from the repository root, which
      only `sql-grants.ts`'s copy did, so no gate depends on where it was run from.

      `lib/table-rls-states.ts` — `deriveTableRlsStates` was exported from a documentation
      GENERATOR and imported by two gates. A gate that fails because a generator was
      refactored teaches a reader that the gate is fragile rather than that the code is
      wrong.

      Both `catch { return; }` walkers in `edge-cache-surfaces-check.ts` now use the shared
      walk, which throws on an unreadable root — for that gate, a missed purge call site is
      a stale cross-tenant page.

  36. **D15 — workflow `notify` nodes silently do nothing, and both composition roots
      justify it with a false claim.** **DONE (22 August 2026) — the comments, which is
      what the finding said the live defect was.**
      `workflow-notification-port-adapter.ts:18` has zero
      importers; two routes say the `email` module "has not been ported yet" — it is live
      and owns the adapter. Unreachable today (`startWorkflowInstance` has no caller), so
      the live defect is the two misleading comments.

      The adapter and the comments were each other's alibi: the routes explained the
      missing wiring with a module that exists, and the adapter's header said "only a
      composition root may import this file", which reads as though one does. Both are
      corrected, and the adapter now states that nothing imports it.

      **The port is deliberately still NOT injected.** Confirmed while working that
      nothing can reach the path — `startWorkflowInstance` has no caller and no route
      creates an instance (`instances/[id].ts` is GET, plus a cancel) — so injecting it
      would add a second declared-and-never-run thing, and would put an announcement
      enqueue inside the decision transaction with no way to exercise its failure. The
      trigger is named instead: inject it in the change that gives instance creation a
      caller, where a `notify` node can actually be tested end to end. A test pins the
      absence so that change has to remove the pin deliberately.

  37. **D16 — the media orphan lifecycle state is unreachable.** **DONE (22 August 2026)
      — code deleted, schema kept.** `media-object-directory.ts:592`.
      `markNewsMediaObjectOrphaned` was the repo's only writer of `status='orphaned'`
      and had zero callers, so the stale-orphan sweep, its partial index and
      `NEWS_MEDIA_R2_ORPHAN_GRACE_DAYS` gated a permanently empty set — and every run
      printed `staleOrphaned(total=0,deleted=0,deferred=0)`, which reads exactly like a
      clean bucket. A leftover of the pre-ADR-0036 model: `sql/087` deleted the
      attach/detach relation, so no reference count exists to derive "orphaned" from.

      Gone: the writer, `markStaleOrphanedNewsMediaObjectDeleted`, the
      `cleanupStaleOrphaned` path (whose docblock reasoned carefully about a race that
      could not occur), the `staleOrphaned` category and the job's three counters.

      **One correction to the finding, and it matters:
      `NEWS_MEDIA_R2_ORPHAN_GRACE_DAYS` is NOT dead** and was not deleted. `orphanInR2` —
      an R2 object with no DB row at all — genuinely uses it to decide when physical
      deletion is safe. Removing it with the rest would have taken out a live control.

      Kept per the decision: the `'orphaned'` CHECK value, `orphaned_at`, the partial
      index, and BOTH status filters (admin screen and API). Those are reads over a column
      that can still hold the value, and dropping one would leave two surfaces disagreeing
      about the same column. `isNewsMediaObjectSafeForPublicReference` still refuses the
      status, so a row that reached it by hand stays out of public references.

  38. **D17 — homepage sections and ad placements have no eligibility-aware read surface.**
      **DONE (22 August 2026) — the narrow half, which is the whole of what was missing.**
      The three rendering helpers having zero callers is a **signed deferral** (ADR-0071
      moved public news rendering to `awcms-astro`) and stays deferred.

      The genuine gap is closed: `AdPlacementItem` now carries `mediaPublicUrl`,
      `mediaAltText` and `mediaPubliclyReferenceable`, all three required. The last is the
      point — it is the SERVER's verdict rather than a status to interpret, because
      `isNewsMediaObjectSafeForPublicReference` turns on which lifecycle states count as
      verified and a consumer reimplementing it gets that wrong in the PERMISSIVE
      direction, which publishes an unverified image. `false` also covers a soft-deleted
      object, so a consumer checking only this field cannot render one either.

      Resolved in the same query on every path: a `LEFT JOIN` with the media predicate in
      the `ON` clause, so a placement whose object was soft-deleted still appears in the
      admin list instead of vanishing from the one screen that could repair it, and a
      data-modifying CTE on create/update so a freshly created ad is not reported as
      unreferenceable. No N+1 and no second endpoint. `/admin/blog-ads` now says whether
      the attached image will actually be shown.

  ### Deliberately NOT recommended (recorded so the question is not reopened blind)
  - **Making `/api/v1/health` dependency-aware.** It does no DB call by design and three
    documents say so. A DB-dependent liveness probe turns a Postgres blip into a restart
    loop and makes Varnish mark its only backend sick. The correct change is D10 — point
    the _deploy gate and LB probe_ at the readiness endpoint that already exists.
  - **Building the public homepage-section / ad renderer here.** ADR-0071 moved public news
    rendering to `awcms-astro`, and `ad-placement-directory.ts:309-312` records the
    deferral in the source. Writing it here would re-create the surface the ADR removed.
    Only the narrow media-URL gap in D17 is worth closing.
  - **A full 17-walker directory-traversal consolidation.** `scripts/lib/repo-files.ts`
    exists and six scripts are migrated; the alleged trigger is not reachable via
    `bun run` (verified: `cd src && bun run edge-cache:surfaces:check` passes, and the
    direct invocation fails loudly rather than silently). Replace the two `catch { return; }`
    walkers (folded into D14) and stop.

  ### What this round did NOT examine

  No live database (no `EXPLAIN`, no job run, no cross-tenant request). The `tests/` tree
  was not audited for its own coverage or duplication — several findings hinge on "no test
  would see this" without that being verified. `sql/` bodies were read only where targeted
  (007, 009, 011, 035, 041, 050, 087, 090, 117); lock behaviour of 001–128 was not reviewed.
  `theming`, `site-search`, `comments`, `push-delivery` and `visitor-analytics` internals
  were examined only at descriptor + zero-caller level. Not line-read:
  `security/turnstile.ts`, the IP blocklists in `ssrf-guard.ts`, self-registration and
  invitation-acceptance, and the OIDC JWT/JWKS internals. The 42 admin `.astro` screens
  were not measured for cumulative per-render query counts — B1/B4 are anchored on
  `/admin/blog` and the layout only, and a per-screen pass is a plausible next audit.
  Excluded as already tracked: `SYNC_HMAC_ALLOW_LEGACY` (GHSA-c972-3q5p-g3h4), MFA/SSO/
  Turnstile off in production, the `edge-cache:purge` crontab absence, and the
  Varnish/s-maxage/asset-budget items below.

- **SETTLED 22 August 2026 — the six pre-model git tags stay, exempted.** The maintainer
  chose option 1 below. Nothing changes in the repository: the six names remain in
  `LEGACY_UNPREFIXED_TAGS`, `bun run version:check` keeps holding every tag cut since
  `v5.1.0` to the model, and the Releases page keeps showing `3.0.0` beside `v3.0.0`. The
  reasoning that decided it is `release-process.md` §Rollback's: a consumer who pulled a
  published tag loses the ability to diagnose what they have when it disappears, and that
  cost is paid by somebody who is not in this conversation. Recorded here so the question
  is not reopened blind.

  The original entry, kept for its argument:

- **OPEN DECISION (SUPERSEDED) — 17 August 2026: the six pre-model git tags.** `bun run version:check`
  (gate 52) now holds the `vX.Y.Z` model at every commit, and it exempts six tags by exact
  name: `2.9.9`, `2.12.0`, `3.0.0`, `3.1.0`, `4.3.1`, `4.5.0`. All six predate the rebuild
  (ADR-0024); `3.0.0` sits on commit `b23d3308` beside `v3.0.0`, one release under two
  names. Every tag cut since `v5.1.0` (16 July 2026) already conforms — 15 of 15.

  **Left in place deliberately, pending a decision that is the maintainer's.** Deleting a
  published tag is outward-facing and irreversible: `release-process.md` §Rollback already
  argues against removing published tags on the grounds that consumers who pulled them
  lose the ability to diagnose what they have, and these six are visible on the GitHub
  Releases page as Pre-release entries of the legacy codebase.

  The two options, both defensible:
  1. **Keep them, exempted** (current state). Cost: the Releases page keeps showing two
     spellings, and a reader comparing `3.0.0` with `v3.0.0` cannot tell they are one
     release without reading ADR-0024.
  2. **Delete the six** (`git push origin :refs/tags/<name>`), keeping the `v`-prefixed
     `v3.0.0` that already covers the duplicate. `2.9.9`, `2.12.0`, `3.1.0`, `4.3.1` and
     `4.5.0` have no `v` twin, so deleting those removes the release from the tag
     namespace entirely — which is why this is not a cleanup to do silently. Afterwards
     `LEGACY_UNPREFIXED_TAGS` shrinks to whatever remains, and the gate keeps working.

  **Not recommended: rewriting them into `v`-prefixed tags.** Re-tagging the same commits
  under new names would present five releases as if they had always followed a model
  introduced a year later, and the image digests and attestations published against the
  old names would keep pointing at bytes those names no longer designate.

- **RECOMMENDATION ROUND — 15 August 2026, derived from the repo + the v9.1.2 production
  that is CURRENTLY RUNNING.** Every finding below has evidence that was run, not
  read. Anything unverified is marked SUSPECTED.

  ### P0 — causing silent loss RIGHT NOW
  1. **31 of the 32 job targets NEVER run in production.** `crontab -l` on
     `dinkes-prod` holds exactly one: `email:dispatch` every 5 minutes. This is NOT
     a repeat of the "the production image cannot run jobs" note — the
     `run-job.sh` mitigation exists and works; what is missing is **the schedule**.

     Consequences that can be named, not abstract ones: `blog:publish:scheduled` (scheduled
     posts never publish), `domain-events:dispatch` (the outbox is never
     drained → integrations die silently), `push:dispatch` (the whole
     push_delivery module is inert), `reporting:projections:refresh` (stale reports),
     `site-search:reconcile` (the index drifts), `workflow:escalations:dispatch`
     (approval escalations never run), `tenant-domain:dns:sync`, and
     **the whole retention family** (`logs:audit:purge`, `analytics:purge`,
     `comments:retention`, `data-lifecycle:archive-purge`, `*:queue:purge`) —
     which means the ADR-0094 retention claim is enforced by nothing.

     The correct fix is already named by this document: a `jobs` stage in
     `Dockerfile.production` published by `release.yml`, then one timer per
     job following the `recommendedSchedule` in its descriptor. Until that exists, at minimum
     register cron entries for the six highest-impact jobs above.

  2. **`identity-access:business-scope:expiry` and
     `identity-access:subscription-lifecycle` are among those that do not run —
     so ACCESS LIVES LONGER THAN ITS VALIDITY.** This is the security half of
     finding 1 and deserves to be raised on its own: an expiry that is never executed
     does not look like a failure, it looks like legitimate access.

  3. **ZERO scheduled backups.** Coolify's `scheduled_database_backups` is empty; every
     backup that exists was taken by hand (the most recent: `awcms-pre-128-20260814`,
     verified with `pg_restore -l`, 1,549 objects). This host ALREADY has the pattern
     for `hermes`: a daily backup + push to maxio + weekly verification. Copy
     that pattern for `awcms`, including a **restore test**, because a backup that has
     never been restored is a guess, not a spare.

  ### P1 — defects whose OUTPUT is already wrong in production
  4. **The application's `url.origin` uses the `http` scheme on an `https` site, and that
     LEAKS into the output.** Verified: `curl https://…/blog/ahliweb/feed.xml`
     returns `<link>http://awcms.ahlikoding.com/…</link>` for every entry.

     > **CORRECTION (15 Aug 2026) — the evidence was wrong, and so was the number.** This round
     > originally concluded that the HTML canonical was "accidentally right (`https`) because
     > it is built from another path — so this is also evidence that the absolute-URL origin in
     > this repo is TWOFOLD". **That evidence is invalid.** `canonical` and `og:url` on
     > the same page are both built from ONE variable
     > (`options.canonicalUrl`, `blog-content/domain/public-page-rendering.ts`
     > lines 118 and 177), and both are `http` when they leave the origin. What
     > makes the canonical look right is **Cloudflare Automatic HTTPS
     > Rewrites**, which patches the `href`/`src` attributes of HTML passing through —
     > while `og:url` uses the `content` attribute, which it does not touch. So
     > that pair is not evidence of two sources; it is one source that is wrong in
     > both places, covered up on one tag by an intermediary we do not
     > control.
     >
     > The conclusion itself turned out to be **too small, not too big**.
     > A full inventory found **THREE** origin sources, not two:
     >
     > - **A — `url.origin`**: 6 files under `src/pages/blog/[tenantCode]/**`
     >   (canonical, `og:url`, JSON-LD `@id`, social share links, the feed, and
     >   the blog sitemap). Its scheme is `http` in production and its host is the
     >   REQUEST host, not the tenant host.
     > - **B — the literal `https://${primaryHost}`**: the whole of `seo_distribution`
     >   (robots, the root sitemap, the root feed, legacy redirects). Its scheme is right and
     >   its host comes from the database.
     > - **C — `process.env.APP_URL`** (fallback `http://localhost:4321`):
     >   the OIDC `redirect_uri`, password reset links, invitation links, and
     >   registration approval links — that is, the surface that is most expensive when
     >   wrong, because it is sent by email and clicked later.
     >
     > Plus two origin declarations that are DEAD but mislead the next
     > reader: `astro.config.mjs` `site: "http://localhost:4321"` and
     > the same `servers[0].url` in `openapi/awcms-public-api.src.yaml`. And
     > `renderResourceSeoHead` — the canonical/`og:url` renderer that was meant
     > to be THE CENTRE — has **zero callers**: the correct path was written, never
     > wired up, and it is the wrong path that serves production.

     The cause: the Node adapter derives the protocol from its own listener, and
     there is NOT ONE place in this repo that reads `X-Forwarded-Proto`.
     It is also the root of the defect class that ate v9.1.1 (`checkOrigin` rejecting
     every genuine form POST). The fix: ONE site-origin source (derive it from
     `APP_URL`, or honour `X-Forwarded-Proto` when `TRUSTED_PROXY_ENABLED`),
     then point every absolute-URL builder at it.

  5. **`/admin/account` offers MFA enrolment while `AUTH_MFA_ENABLED`
     is not `true` in production.** That page branches on `account.mfa.enabled`
     (the user's ENROLMENT state), not on `isMfaFeatureEnabled` (the DEPLOYMENT
     switch). So the button shows and the endpoint refuses — exactly the "fake
     affordance" that the `LanguageSwitcher` comment itself condemns. SUSPECTED on the
     endpoint refusal (it needs a session to run); the UI branch
     is readable directly in the source. The same holds for the SSO section
     (`AUTH_SSO_ENABLED` is not `true` either).

  6. **Missing public surfaces:** `/news/`, `/sitemap.xml`, and `/rss.xml`
     are all **404** in production, while `/blog/{tenantCode}` and
     `/blog/{tenantCode}/feed.xml` are **200**. For a CMS, the absence of
     `sitemap.xml` is a distribution hole, not cosmetics. Decide the canonical
     public URL shape first — this neighbours the public locale work
     already blocked in the cache-key item.

  ### P2 — architecture
  7. **Two PRODUCTION-ONLY failure classes are now proven, and neither had a
     gate before 14 August:** (a) Astro's `checkOrigin` vs a TLS-terminating
     proxy, (b) Astro inlining a script with no cross-chunk import, so the CSP
     refuses it. Both passed 47 gates and 4,375 tests. `tests/form-post-origin-check.test.ts`
     closes both for THAT component; what does not exist yet is the general
     BUILD-ARTEFACT gate: "there must be no inline script other than the
     theme-init hash". That is one check over `dist/`, and it would catch
     the whole class, not one instance of it.

  8. **A smoke test that speaks HTTPS.** Playwright, dev, and `bun run build`
     all speak plain HTTP to the app, and that is why the two defects above
     were invisible. One scenario behind a TLS-terminating reverse proxy
     (just Traefik/Caddy in front of `dist/`) would find both in
     seconds.

  ### P3 — performance
  9. **Varnish is HEALTHY — and how you measure it matters.** Measured INSIDE the
     Varnish container: `MISS` → `HIT` → `HIT` with a rising `Age`. Measured through
     Cloudflare it looks `DYNAMIC` forever, because the origin only sends
     `Surrogate-Control` (which Varnish understands) and `max-age=0,
must-revalidate` for the browser. **Do not** conclude the cache is dead from
     Cloudflare's headers — `environments.md` §gap C14 already says so, and
     my own first measurement today violated it.

  10. **Cloudflare therefore caches NOTHING** (only TLS + compression).
      Adding `s-maxage` would change that, but it is ONLY safe when the purge queue
      also reaches the CF zone API — today it does not. All of it, or none of
      it; half of it serves stale content.

  11. **The client asset ceiling is 94% used** (168,759 B of 180,000 B). Not a
      problem today, but the headroom is thin for one new screen. Raise it
      with a written reason, or trim.

  ### P4 — security
  12. **`COMMENTS_SUBSCRIBER_ENCRYPTION_KEY` is not set** (the only
      `security:readiness` failure, warning level, 0 critical). It fails
      CLOSED — no plaintext address is written — but it means
      reply notifications cannot be sent. Set it, or turn the feature off
      explicitly so the state is declared.

  13. **MFA, SSO, and Turnstile are all off in production** even though all three
      are built and tested. For an admin surface that holds owner rights,
      MFA being off is an exposure that deserves a conscious, recorded
      decision, not an inheritance from the defaults.

  ### P5 — debuggability
  14. **The foundation is there, the downstream is not.** `correlationId` is propagated, logs are
      structured JSON, `setLogSink` is available as an extension point — but
      no sink is configured, so the logs stop at the container's stdout
      and VANISH when each deploy replaces the container. Ship them off the host (this host
      already does that for `hermes`).

  15. **There is no error-rate alarm, and that has proven expensive.** The language switcher
      answered 403 for EVERY user for hours and nothing told
      anybody; it was found only because I `curl`ed a
      surface I had just shipped. One synthetic check over two
      or three core flows would catch it.

  ### ROUND RESULT — 15 August 2026

  Eleven of fifteen CLOSED. The method was one thing: **run it, do not read it.**
  Running all 23 jobs with `--dry-run` against production found two defects
  that NO gate saw, and reading `dist/` found a third.

  | #         | State                                                                                                             | Evidence                                                                                        |
  | --------- | ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
  | 1, 2      | CLOSED — the schedule became DATA (`ModuleJobSchedule`), `ops/awcms-jobs.crontab` is generated, 23 jobs installed | `crontab -l` = 23 lines; the `jobs:crontab:check` gate rejects a job without a schedule         |
  | 3         | CLOSED — a verified daily backup + a weekly restore rehearsal                                                     | backup of 1,556 objects; the rehearsal restored 148 tables / 128 migrations / 1 tenant          |
  | 4         | CLOSED — one site-origin source + the `site-origin:check` gate                                                    | and the CORRECTION above: there are THREE sources, not two                                      |
  | 5         | CLOSED — `/admin/account` branches on the DEPLOYMENT switch, not only on enrolment                                |                                                                                                 |
  | 6         | **DIAGNOSED, not fixed — and it is NOT a missing feature**                                                        | see below                                                                                       |
  | 7         | CLOSED — `build:inline-scripts:check` reads the built manifest                                                    | it found a THIRD INSTANCE: `ThemeToggle` inert in production for weeks                          |
  | 8         | CLOSED — `tests/tls-terminating-proxy.test.ts` stands up a real TLS proxy in front of a plain-HTTP origin         | reverting the resolver to bare `url.protocol` fails 3 of its scenarios                          |
  | 9, 10, 11 | DECISIONS, not defects                                                                                            | Varnish is healthy; `s-maxage` stays blocked by the CF purge queue; the asset ceiling is at 94% |
  | 12, 13    | DECISIONS — see below                                                                                             |                                                                                                 |
  | 14        | CLOSED — logs SURVIVE a deploy (`ops/ship-logs.sh`, every minute, re-attaching when the container is replaced)    |                                                                                                 |
  | 15        | CLOSED — `ops/synthetic-check.sh` every 10 minutes, alarming once on failure and once on recovery                 | **it caught the site-origin defect that was STILL LIVE on its very first run**                  |

  **Two new defects, both found by running the jobs:**

  - `data-lifecycle:archive-purge` **cannot run at all** —
    `permission denied` on `awcms_delegated_access_grants` and
    `awcms_subject_requests`. Not "not scheduled" but "would not
    work". ADR-0094 retention is enforced by NOTHING for those two tables.
    `sql/129` + the `data-lifecycle:worker-grants:check` gate closes the CLASS.
  - `domain-events:deliveries:purge` the same, on `awcms_domain_event_replays` —
    and that new gate does **not** catch it, because that table is only READ
    by the `delegated` job and has no descriptor. That gap is RECORDED, not
    papered over: what found it was running all 23 jobs.

  **Item 6 — the 404 public surfaces are CONFIGURATION, not code.** Three facts,
  all verified:

  1. `awcms_tenant_domains` has only ONE row, and it is a DIFFERENT host
     (`coba.ahlikoding.com`), `is_primary = false`, `status =
pending_verification`.
  2. So `resolveTenantPrimaryHost` returns `null`, and
     `sitemap.xml`/`feed.xml`/`rss.xml` **404 by design** (fail-closed, never
     inventing a host). `robots.txt` answers 200 without a `Sitemap:` line — exactly
     the degradation it promised.
  3. `PUBLIC_TENANT_RESOLUTION_MODE` is NOT set, so the host-resolved route
     (`/news/**`) never resolves a tenant.

  Fixing it means registering a primary domain and switching on host
  resolution — which CHANGES the shape of the public URLs. This recommendation itself
  requires that decision to be taken first, so it stays a decision.

  **What is WAITING on the repo owner's decision, not work left undone:**

  - **MFA, SSO, Turnstile are off** (#13). Switching MFA on changes login for
    everybody; that is a security posture that deserves a conscious, recorded decision.
  - **`COMMENTS_SUBSCRIBER_ENCRYPTION_KEY` is not set** (#12). It fails CLOSED
    (no plaintext address); switching it on ENABLES reply notifications,
    i.e. outbound email. Set the key, or declare the feature off.
  - **Cloudflare `s-maxage`** (#10). Still blocked: the purge queue does not
    reach the CF zone API. All of it or none of it.
  - **Asset ceiling at 94%** (#11). Raise it with a written reason, or trim.

- **i18n (ADR-0095) and the account surface (ADR-0096) — what HAS landed,
  and exactly what is left. 14 August 2026.**

  **Landed:** the i18n foundation (gettext catalogues `locales/en.po` + `id.po` which are
  COMPILED into `src/lib/i18n/catalogs/*.generated.ts` so they travel into
  `dist/`), locale resolution in the middleware, a `LanguageSwitcher` that actually
  works (replacing the dead `LocaleBadge`), per-PRINCIPAL language + theme
  preferences (`sql/128`), and `/admin/account`, which finally gives a
  surface to the 17 self-service endpoints that previously could only be `curl`ed.

  **The numbers that remain, all carrying a ledger that may only SHRINK:**

  | Ledger                                               | Now             | What it means                                        |
  | ---------------------------------------------------- | --------------- | ---------------------------------------------------- |
  | `i18n:screens:check`                                 | **0** (was 18)  | screens still rendering English template literals    |
  | `MAX_UNTRANSLATED_ID_ENTRIES` (`i18n:catalog:check`) | **0** (was 718) | msgids declared but the `id` `msgstr` is still empty |

  **Step 1 is CLOSED — 718 → 0, and the count was hiding a defect. 15 August 2026.**

  All 1,258 msgids carry Indonesian. What the pass found is worth more than the
  number: **eighteen msgids were already Indonesian** — the msgid ITSELF, in
  `en.po`, the file ADR-0097 calls the English source. `/admin/blog-settings`
  was all of them: its bulk `t()` migration wrapped the screen's existing
  Indonesian literals instead of translating them first.

  Because `en.po` uses the gettext identity fallback (`msgstr ""` → the msgid IS
  the output), an **English reader got an Indonesian screen**, while an
  Indonesian reader got the same page by ACCIDENT — falling back to a msgid that
  happened to be their language. Two more strings (`Tersimpan.` and a save
  failure) were hard-coded in the client script, Indonesian in _every_ locale
  with nothing declaring them.

  Both locales rendered something plausible, so no gate and no screenshot review
  could have caught it. The only artefact that disagreed was the untranslated
  counter — and only once somebody read the strings it was counting. That is the
  argument for keeping a ledger at 0 rather than deleting it.

  A fifth check now guards the class the ledger cannot: `i18n:catalog:check`
  asserts **placeholder parity** — every `{name}` in a msgid survives into its
  translation, and none is invented. A dropped `{days}` reads perfectly and has
  lost its number; an invented one is printed verbatim by `interpolate()`.
  Proven against both shapes, not merely green.

  **Step 2 is CLOSED — 18 screens → 0, and the gate could not see a third of the
  work. 15 August 2026.**

  The 23 ledgered literals were the split-sentence class, merged into whole
  msgids with placeholders. Two costs are worth recording because the next
  merge pays them again: `t()` returns a STRING, so a `<code>`/`<strong>` around
  a placeholder is lost (keep a real `<a>` as its own label rather than folding
  a link into a sentence); and where the interpolated value is OPTIONAL, one
  `{code}` msgid renders "platform tenant ()" — so that shape needs TWO whole
  msgids, one per branch.

  **What the ledger did not count, and nothing would have:** the scanner reads
  template text only where it follows a TAG. Text after an EXPRESSION —
  `<caption>{roles.length} role(s)</caption>` — is invisible. Nineteen such
  strings were found by hand across 15 screens the gate already called
  finished, every one of them rendering English to an Indonesian reader. They
  are fixed (the `{n} thing(s)` captions became real `tn()` plurals, which is
  also the first use of the plural path through the `.po` round-trip). The
  SCANNER still cannot see the class: widening it would start capturing
  template literals and chained ternaries as prose, which is the false-positive
  failure `CODE_SHAPED` exists to hold back, so that widening is its own change
  with its own mutation test. Until then an empty ledger means "no untranslated
  text after a tag", which is less than "nothing untranslated" — the limitation
  is written into the gate's header rather than left for the next reader to
  discover.

  **And the catalogue gate was blind to 86 msgids.** Its literal harvester
  excluded any string containing a backslash, and prettier rewrites an em dash
  inside `t()` as `—` — so the longest, most prose-like msgids were never
  REQUIRED to exist. Consequence: `users.astro` had been calling `t()` on a
  sentence declared in neither catalogue, rendering English in every locale,
  with both ledgers reading 0. The harvester now decodes escapes; proven by
  deleting one escaped msgid and watching the old pattern pass it silently.

  **Steps 3 and 5 are DECIDED — [ADR-0098](adr/0098-the-cache-key-carries-the-locale-in-the-path.md)
  and [ADR-0099](adr/0099-changing-the-login-address-is-account-recovery.md),
  15 August 2026. Both are `Accepted (not yet implemented)`, bound to their
  promised artifacts by `tests/adr-implementation-status.test.ts`.**

  **Step 3 — the locale goes in the PATH, and the cache key is not touched.**
  `Vary: Cookie` multiplies cache objects by the number of distinct cookie
  strings and puts a credential-bearing header in the key; `Vary:
Accept-Language` bounds the fan-out at two but cannot see an explicit click,
  which would make the language switcher decorative on the surface most readers
  see. `/en/…` and `/id/…` are already different objects under the key that
  exists, so hit rate is unchanged and no request header enters the key at all.
  Selection is a `private, no-store` 307, so the cookie is honoured without ever
  reaching the cache.

  **Step 5 — the login address IS the account, so the flow is built like
  recovery.** Both addresses are proven, differently: the new one by a
  single-use, short-lived, hashed, BOUND token; the old one is notified with a
  cancel link valid LONGER than the confirmation window, because the notice is
  the only part of the design that helps somebody already compromised. Fresh
  re-authentication is required (a session alone is not authority to move the
  recovery channel), confirmation revokes every other session and every
  outstanding reset token, and uniqueness is checked at confirmation so the form
  is not an account-existence oracle.

  3. **Step 3 is CLOSED — the locale is in the PATH, ADR-0098 is `Accepted`.
     15 August 2026.**

  `src/lib/i18n/public-locale-path.ts` is the decision made executable: a path
  goes in, a routing decision comes out, and it cannot read a header. `/blog/…`
  answers `307 private, no-store` to `/en/…` or `/id/…`; the prefixed URL is
  rewritten back onto the existing route, so there is no duplicated `[locale]`
  page tree. On a prefixed URL the PATH sets `locals.locale` and outranks the
  cookie — that inversion is the whole safety property, because the URL is the
  cache key and the key must decide the body.

  Three things are worth carrying forward. **The prefix is scoped to CACHEABLE
  HTML**, not to every public URL: `/admin`, `/login` and `/blog/{t}/search` are
  `private, no-store` and localise from the cookie exactly as ADR-0098 decision 6
  says `/admin` may, so prefixing them would cost a redirect and buy nothing;
  `robots.txt` is protocol-fixed and the feeds already carry `?locale=`, which is
  the same key in a different spelling. **`matchPublicCacheSurface` needed a
  second matching attempt** or every prefixed URL would have missed the registry
  and been stamped uncacheable — the ADR would have moved the locale into the key
  while turning the public surface uncacheable, a regression that reads as a
  caching bug rather than a routing one. And **the sitemap had to move with the
  canonical**: a `<loc>` naming the bare path while the page's own
  `<link rel="canonical">` names the prefixed one is a disagreement search engines
  resolve by trusting neither.

  Decision 2 is enforced twice rather than documented once. `decideCacheability`
  REFUSES a response that varies on `Cookie` or `Accept-Language` (refusing, not
  stripping — stripping would cache a body its own author said varies), and
  `edge-cache:surfaces:check` fails the build on the same two names anywhere
  under `src/`. Both were proven by planting the defect: three spellings of a
  forbidden `Vary`, a machine surface given a prefixed alias, and a `localePrefixed`
  flag flipped out of agreement with the path patterns.

  Still open behind it: multi-language content fields for `blog_content` (the
  reader's interface language and the POST's own language are different axes —
  `<html lang>` still comes from `post.locale`), and the public chrome itself is
  not yet translated, so `/en/…` and `/id/…` differ today only in their
  `hreflang` and canonical. 4. **Step 4 is CLOSED — `awcms_principal_preferences.time_zone`, sql/130.
  15 August 2026.**

  `/admin/account` renders every timestamp in the reader's chosen zone, and the
  fallback stays UTC rather than the host's — the original reasoning ("guessing
  the server's zone would make 'last seen' wrong with nobody able to detect it")
  is exactly why. What changed is that there is a stated preference to read
  instead of a guess to make.

  Two things are worth carrying forward. The CHECK is a SHAPE check and the
  migration says so: 445 zones, a list that is tzdata's and changes several
  times a year, means an enumerating constraint would start REFUSING valid
  values within months — and a CHECK may not read `pg_timezone_names`. The
  authority on renderability is `Intl.DateTimeFormat`, which throws on an
  unknown zone. And because it throws, `readPreferences` coerces on the way OUT:
  a zone dropped by a newer tzdata must read as "not chosen", or the account
  screen 500s on the day somebody opens it to check a suspected breach. 5. **Changing the login address.** Deliberately OUTSIDE ADR-0096: that is account recovery,
  not profile editing, and it demands proof of ownership of the new address.

- **OPERATIONAL BLOCKER — the production image CANNOT run a single one of the
  29 registered jobs. Found on 14 August 2026 while deploying v9.0.0.**

  `Dockerfile.production`'s `runtime` stage copies only `dist/`,
  `node_modules/`, and `package.json`. No `scripts/`, no `src/`.
  Every job a module registers through `ModuleDescriptor.jobs` has the form
  `bun run <target>`, and **every single one of those 29 targets exits with
  `error: Script not found` inside the production container** — `email:dispatch`,
  `logs:audit:purge`, `blog:publish:scheduled`, `domain-events:dispatch`,
  `push:dispatch`, `data-lifecycle:archive-purge`, all of them.

  The application also has NO in-process scheduler (zero `setInterval`/cron in
  `standalone-entry.ts` or `middleware.ts`), so there is no second path.

  **Why this was never seen:** the job registry only verifies that
  `command` points at a target that exists in `package.json` — a fact about the
  REPO, not about the running image. The gate is correct and green; what
  is missing is the question "can that target be executed where it is
  supposed to run". A complete registry made 29 jobs look
  installed, while zero of them could run.

  **Consequences that already happened:** audit retention was never executed,
  the domain-event outbox was never delivered, scheduled posts never published
  — all of it silent, without an error, because nothing ever called them.

  **The mitigation installed today (on the host, NOT in the repo):** a second image
  `awcms-jobs:<version>` built from the same source (`scripts/` + `src/` +
  `sql/`), plus `/home/admin1/awcms-jobs/run-job.sh`, which reads the env from the
  app container that is CURRENTLY running (the container name changes with every deploy, so
  it is resolved, not hardcoded) and runs any target on the
  `coolify` network. The first cron entry to use it: `*/5` `email:dispatch`.

  **CORRECTION a few hours later — the failure mode is worse than first
  assumed, and easier to see.** This note originally warned that the job image
  would "go stale silently". What actually happens: **Coolify prunes images
  that no container uses every time the application is deployed, and
  `awcms-jobs` is exactly that — so it is DELETED on every deploy.**
  Proven on the first redeploy afterwards: `pull access denied for
awcms-jobs, repository does not exist`. So it is not a misleading stale
  result but a cron that dies hard — noisier, and that is
  luck.

  Its build context (an ordinary directory at `/home/admin1/awcms-jobs/`) survives
  the prune, so `run-job.sh` now **rebuilds the image itself when it is
  missing** instead of depending on somebody remembering. The rebuild takes ~55 seconds,
  and the `*/5` cron absorbs it invisibly.

  **The debt that remains, and this one belongs to the REPO, not the host:** that build context is
  a SNAPSHOT of the source — it does not follow releases. The auto-rebuild fixes the
  deletion, NOT the obsolescence: after the next release the cron will
  rebuild the **old version of the code** against the new schema, and this time
  genuinely silently. The correct fix is a `jobs` stage in
  `Dockerfile.production` published by `release.yml` alongside the runtime
  image, so the job version and the app version CANNOT diverge. Until that
  exists, **refresh the `/home/admin1/awcms-jobs/` context on every release** — this
  step is written down in the `awcms-deploy` skill.

- **ROUND of 14 August 2026 (the thirtieth) — release v9.0.0, and four documents
  that aged in the WRONG direction.**

  Preparing a 26-commit release (ADR-0085…0094) meant re-reading the docs and
  skills against the code. What was found is not merely "incomplete": four
  artefacts state something whose **opposite is true**, and three of them
  are instructions that will be FOLLOWED, not prose read in passing.

  1. **Two skills order a command that does not exist.** `awcms-deploy` and
     `awcms-production-preflight` both list the target bun run
     production:preflight (deliberately written WITHOUT backticks — see below)
     as the core command; it exits with `error: Script not found`. Doc 07
     already states that this orchestrator was never implemented — so
     the document is right while the two skills referring to it are wrong, and it is the skills
     that people run. Replaced with the real steps (`config:validate` →
     `check` → `db:pool:health` → `security:readiness`, the only one that
     blocks with an exit code).

     Even writing this round down turned its gate red: `check:docs` demands that
     every **backticked** `bun run` reference in a current-state file points at a
     real script, so naming a target that does not exist — even in order to
     say that it does not exist — is rejected. That is the CORRECT behaviour: the gate has
     no way of distinguishing "I am quoting this as a defect" from "I am telling you
     to run this". What deserves attention is its coverage: `.claude/skills/`
     sits OUTSIDE `check:docs`, and that is why both skills could carry
     this fake command for months while the document that stated the
     truth passed the gate without complaint.

  2. **`privacy-analysis.md` declares a surface that HAS been built to be a
     gap.** It still reads "the export endpoint does not exist yet" and "the erase-this-person
     flow does not exist yet" after #557 landed both. This is the most
     expensive form of rot: a reader who believes it will **rebuild**
     something that already exists, complete with the authority of the two being merged.
  3. **The subject-data ledger is known to NOT ONE skill.** Zero skills mention
     `subjectData`, ADR-0094, or either of its gates — including the skill of the module that
     OWNS it. The practical consequence: anybody adding a table will be
     pointed at the retention registry (which their skill does explain) and then rejected by
     `bun run check` by a registry mentioned nowhere. `awcms-data-lifecycle`
     now has a §Subject data rights; `awcms-new-migration` rule 14;
     `awcms-new-module` rule 5b.
  4. **`awcms-sensitive-data` contradicts the new surface.** Its rule
     "never send a raw value into a response" now collides with the LEGITIMATE
     subject-rights export. Left as it was, it teaches that an existing
     feature is forbidden. Fixed as an exception that explains its
     control (`redactedColumns`), not as a loosening.

  Two number corrections followed: `MODULE_CONTRACT_VERSION` was written as `2.5.0` in
  `awcms-module-management` (it is actually `4.0.0`) and `1.3.0` in
  `family-compatibility.md` (the manifest itself says `4.0.0` and is gated —
  the document had drifted, not the pin). The claim "base ships 1 SoD rule"
  appears in TWO places and both now say 2.

  **What to remember from this round:** the `project-state:inventory`
  and `repo:inventory` generators produce markdown tables WITHOUT padding, and prettier
  then formats them. Running the generator and then `git status` looks like a large
  drift (431 lines) while nothing changed in meaning — run
  `bunx prettier --write` on the generated file before concluding there is a
  drift. This is not a bug; it just looks exactly like one.

- **ROUND of 13 August 2026 (the twenty-ninth) — RUNNING IT found
  THREE defects that 41 gates did not see.**

  Every test of the #557 surface is pure: its plan is pure, its registry gate is
  pure, its screen contract is text. Not one of them executes a single statement, and
  the executor is nothing but statements. `bun run check` was green without
  touching it. One integration test against a real PostgreSQL found three things
  — and **two of them are production defects**, not test defects.

  1. **`hard_delete` on a table whose privileges were REVOKED.** Two per-tenant MFA
     descriptors promise deletion; ADR-0087/`sql/114` deliberately
     retired them to read-only and revoked INSERT/UPDATE/DELETE from
     `awcms_app`. The deletion would fail with `42501` mid-transaction, AFTER
     the request had been claimed. The tempting move — granting the privileges back —
     would undo exactly the control that ADR installed; so **the descriptor
     gives way**, to `severed_with_subject_row`, which happens also to be the most
     honest answer for a table the runtime must not write to.

  2. **A migration comment that lies about its own control.** `sql/125`
     writes "no DELETE, and that is a decision" and then only
     `GRANT SELECT, INSERT, UPDATE`. But `sql/019` gives `awcms_app`
     all four privileges over the WHOLE schema (`ON ALL TABLES` + `ALTER DEFAULT
PRIVILEGES`), so a GRANT that "does not mention" DELETE **withholds
     nothing** — it re-grants what already exists. Closed with an explicit
     `REVOKE`. The transferable lesson: in a schema with a blanket grant, the only
     way to withhold a privilege is to REVOKE it, and a selective GRANT
     reads like a control while not being one.

  3. **The Bun.SQL binding trap for jsonb** (a TEST defect, not a production one):
     `${JSON.stringify(arr)}::jsonb` stores a jsonb **string**, not an array —
     `jsonb_typeof` answers `string` and every containment test becomes false.
     `${arr}::jsonb` (what production uses) stores an array. The first fixture
     used the first form and made a CORRECT executor look broken.

  Findings 1 and 2 are now gated: `subject-data:registry:check` replays
  every `GRANT`/`REVOKE` on `awcms_app` from `sql/`, starting at the blanket grant,
  and rejects a deletion mode that demands a revoked privilege. Its message
  warns against "fixing" it by granting the privilege back.

  **And fixing finding 2 turned a THIRD gate red, which is also correct.**
  `checkRuntimeRoleGrants` demands that every table with privileges narrower than the
  default be DECLARED, both ways — "narrowed on purpose" must be distinguishable
  from "broken", and only a human can supply the difference. So
  `awcms_subject_requests` enters `RETIRED_TENANT_TABLE_PRIVILEGES` as an
  entry of a SECOND kind: not a retired `SELECT`-only table, but a live
  ledger that withholds exactly one verb. The constant's documentation was widened
  so that its name stops describing only half of its contents, instead of
  smuggling in an entry that does not match its own description.

- **ROUND of 13 August 2026 (the twenty-eighth) — THE DATA SUBJECT RIGHTS SURFACE
  (#557 DONE), and four layers that each catch a different
  failure.**

  Closes #557 entirely: export, maker/checker deletion, four permissions +
  a seed migration, and the `/admin/subject-requests` screen.

  **Four layers for one rule, and that is not excessive.** "The approver
  is not the requester" is guarded by: two separate permissions, a `critical` SoD rule,
  a CHECK constraint `decided_by <> requested_by`, and a conditional claim in one
  UPDATE. Each layer catches a failure the others do not — the permission
  catches the wrong person, SoD catches the wrong grant, the constraint
  catches the race, and the conditional claim catches TWO simultaneous approvals which
  would otherwise run an irreversible deletion twice. A pattern worth
  repeating for every irreversible action to come.

  **The SoD rule's `exceptionPolicy` is `allowed: true`, and that is a
  counter-intuitive decision.** `false` reads stricter but is worse: a rule
  that forbids exceptions has no pending row for a checker to look at,
  so the only way out during a real incident is a grant change outside
  the system that nobody reviews. Seven days, not fourteen as for
  legal hold, because this one hands over the ability to delete unilaterally.

  **A SECOND gate tension, resolved by obeying the gate.**
  The first four routes were copied from the `withTenant` pattern of `legal-holds.ts` — which sits
  in the `NOT_YET_MIGRATED` allowlist. `api:tenant-route:check` rejected them and
  its message writes itself: "Do not add this file to NOT_YET_MIGRATED".
  All four were rewritten onto `defineTenantRoute`. The lesson: copying a file
  that EXISTS in the repo is no proof that its pattern is still right — that file may be
  exactly the debt currently being paid down.

  **The executor writes ~7 tables, not ~100**, because `erasureTargets`
  drops every `severed_with_subject_row`. This is a direct payoff from the
  vocabulary the twenty-seventh round found: without that union member,
  a compliant executor would rewrite ninety stamp columns and
  destroy tenant records in order to sever a link that is already severed.

- **ROUND of 13 August 2026 (the twenty-seventh) — THE SUBJECT-DATA LEDGER REACHES
  ZERO (#557, ADR-0094 wave 2), and four answers that had no vocabulary yet.**

  **139 → 0.** #542 landed the foundation and left 139 tables in debt;
  #557 wrote its own prerequisite honestly — an export endpoint on top of
  that ledger would answer with 3 tables and stay silent about the remaining 139. Now 139
  descriptors + 7 reasoned refusals cover 146 tables, and completeness becomes
  a property the schema forces rather than one a PR claims.

  **Writing down 139 answers found FOUR things the model could not yet
  express, and not one of them was visible from the three wave-1 descriptors.** This is
  a lesson worth repeating: forcing yourself to answer for the WHOLE population, not
  a convincing sample, is what exposes the limits of the model.
  `severed_with_subject_row` (the answer for ~90 tables; without it a compliant executor
  would rewrite `deleted_by` stamps and destroy tenant records in order to
  sever a link that is already severed), `references: "profile"` (without it
  `awcms_profiles` — the FIRST table the issue names — is genuinely
  unreachable, because the link runs the other way),
  `unreachableBySubject` (for tables that are pseudonymous ON PURPOSE, where
  `NO_SUBJECT_DATA` would be a lie and a subject column a fiction), and an explicit
  `tenantColumn: null`.

  **A gate that found seven defects in its own PR's descriptors.**
  `subject-data:registry:check` asks whether the answer is RIGHT, not whether
  it EXISTS — and all seven of its findings are a plausible-looking
  string that would fail silently at runtime: five misspelled redaction columns, two
  `references` that do not match a real foreign key. Compare it with
  the already-recorded gate lesson: a COVERAGE gate can be green while
  every one of its answers is wrong, and this is its counterpart.

  **A gate-versus-gate tension resolved NARROWLY.** `awcms_access_assignments`
  was retired by ADR-0079 and `access:grant-readers:check` forbids any file
  from naming it; with the ledger at zero it still has to answer. Adding
  `module.ts` to `GRANT_READERS` would make the gate stop watching
  the whole file — exactly the protection that was intended. The exemption is therefore keyed
  to the FORM of the mention (only as the value of `tableName:`), and tested by
  planting a SQL read that must still turn red. A pattern worth repeating
  when two gates collide: narrow the exemption until it cannot hide
  the defect that gate is looking for, do not widen its coverage.

- **ROUND of 13 August 2026 (the twenty-sixth) — THE MODULE SETTINGS EDITOR (#546),
  and a link that had been pointing at a 404 all along.**

  Closes 2 keys, **49 → 47**. Three documents state that the
  `/admin/modules/{key}` panel exists; it never existed, and
  `/admin/blog-settings` rendered a LIVE link to a 404. One document used
  that claim to justify not building the editor.

  **Building what the documents claimed is the correction.** Deleting the sentence
  leaves the gap and loses the note; building the page makes
  all three true at once. A pattern worth repeating when you find
  documentation that lies about the existence of a control: ask first
  whether it is cheaper to make it true.

  **One gate was widened, and the difference from loosening it deserves recording.**
  `admin-navigation-registry` demands that every admin page have a sidebar entry —
  the right proxy for a static page and the wrong one for a PARAMETERISED route,
  because the sidebar cannot hold `[moduleKey]`. The property was kept and
  the proxy replaced: a dynamic page must have a PARENT and must not have a sidebar
  entry. Compare the twentieth round, where the enforcement gate was
  NOT widened because there what was wrong was how the guard had been written, not
  the gate's proxy.

  **A PATCH box, not a document editor — and that is a finding, not a style choice.**
  `updateModuleSettings` merges shallowly and its contract has no
  deletion convention at all. A textarea presenting the overrides as a
  document would let an operator delete one key, submit, and then watch it come
  back. Giving the API a deletion path is a decision about what
  `null` means, and it is deliberately NOT taken here.

- **ROUND of 13 August 2026 (the twenty-fifth) — THE PARTNER REGISTRY SCREEN (#540).**

  Closes 2 keys, **51 → 49**. The most important thing about this screen is where
  it is NOT: `/admin/partners` is the CUSTOMER view, and a registry
  there would put the list of every platform partnership in front of every customer.
  Its contract test enforces that separation from BOTH directions.

  **The nav decision the issue worried about turns out not to exist.** Sidebar
  grouping is per MODULE, not per scope, and platform-ness is expressed through a
  platform-scoped `requiredPermission` — exactly how `/admin/tenants` does it. A second
  platform screen therefore demands no new mechanism.

  **There is no tenant picker, and that is not a shortcoming:** a list of tenants you can
  choose from is the directory ADR-0089 refused. `/admin/tenants` exists for the
  platform operator who needs to search for one, and it is the PERMISSION boundary that should
  decide, not a `<select>`.

- **ROUND of 13 August 2026 (the twenty-fourth) — THE INVITATIONS SCREEN (#541).**

  Closes 4 keys, **55 → 51**. The surface landed complete in Wave 4 and
  without a page, exactly the reason the ledger recorded for all four.

  **Creating one invitation runs up to THREE gates**, and the form
  says which: `invitations.create`, then `access_control.assign`
  as soon as a role is named, then the platform-scoped `invitations.configure` for
  `skipEmailConfirmation`. A form that gates all of it on `create`
  offers two controls that 403 on submit.

  **Finding: an invitation created while email is down is a dead invitation.** The
  creation response names `delivery`, and no endpoint returns
  its link — so the invitation exists, is valid, and cannot be handed to
  anybody; resending fails the same way. The page reports it as it
  is. Making the link retrievable is a decision about where an invitation token
  may appear, and it is deliberately NOT taken here.

  **`Idempotency-Key` is sent exactly once**, and the asymmetry is deliberate on both
  sides: creation requires it, `resend` refuses it, because replaying would have to
  return a token that has already been rotated away. It is bounded through
  `resend_count < 5` in its UPDATE, not through a header.

- **ROUND of 13 August 2026 (the twenty-third) — THE EMAIL SUPPRESSION SCREEN (#544).**

  Closes 3 keys, **58 → 55**. The second group that the screen-coverage ledger names
  itself as not cosmetic: a suppressed address silently stops
  receiving mail, INCLUDING password resets, and nobody could list or
  clear it from a page. Diagnosing it was until now a SQL query whose existence
  you had to know about.

  **`alreadySuppressed` is an ANSWER, not an error — and that is what shapes
  the page.** The list only stores masked addresses and is capped at 100 rows,
  so "is THIS address suppressed?" cannot be answered by reading it.
  Its endpoint answers 200 with `alreadySuppressed` instead of 409, so one
  request serves "add it" AND "is it already there"; reloading on that branch
  throws away the only thing the operator asked.

  **`SUPPRESSION_REASONS` is exported, and `KNOWN_REASONS` is derived from it.**
  A small change with the same rule as the write-class checkbox one
  round ago: a list copied into the UI is right today and
  falls silently behind when the next value is added. The mutation that
  proves it is the same shape too, and the most useful one is **emptying the source
  list** — a "derived" assertion that does not turn red on an empty list is a
  hollow assertion.

- **ROUND of 13 August 2026 (the twenty-second) — EPIC #423 CLOSED, ITS BACKLOG
  MOVED INTO ISSUES, and the `/admin/machine-credentials` screen landed.**

  **#423 is closed.** The criterion the issue wrote for itself ("OPEN until
  Wave 8") is met, and all three Wave 8 follow-ups are closed (#535,
  #537, #538). An epic that stays open after its scope is exhausted stops meaning
  anything.

  **The rest becomes eight issues** (#539–#546), not prose in this §4. The reason is
  mechanical: this repo would have ZERO open issues while its real backlog lived
  as a paragraph you have to read in full to know what is left. §4
  remains the place where DECISIONS and refusals are written down; an issue is what can be assigned
  and closed one at a time.

  **The machine credentials screen (#539) closes 4 keys, 62 → 58.** The argument is the same
  as for `/admin/partners`: revocation is the control you look for when a token
  leaks, and until this page existed it was a `POST` nobody would remember under
  pressure. #537 sharpens it — until now there was nowhere to
  see which credential can WRITE.

  **Two permissions, one form, and that is not cosmetic.** If the page derived
  the write fieldset from `machine_credentials.create`, the separation ADR-0092 made
  precisely to prevent grant widening would be undone again — this time in the UI, where
  no gate sees it. Its action checkboxes are **derived** from
  `MACHINE_CREDENTIAL_WRITE_ALLOWED_ACTIONS`, because a hand-written pair of write
  checkboxes is right today and falls silently behind when the ceiling is widened.

  **A testing lesson that applies to every screen to come:** a source assertion
  bound to INDENTATION turns red on correct code as soon as the formatter moves
  one line. The two assertions here about ADJACENCY (the verb next to its URL,
  the ternary that tests the write list) have their whitespace normalised first.
  A related failure is already recorded in the eighteenth round — there
  the cause was mixing an audit action with a guard action.

- **ROUND of 13 August 2026 (the twenty-first) — THE PARTNER REGISTRY HAS A WRITER.**

  Closes the remainder of #423 item 3. `sql/123` + `GET`/`POST /api/v1/partners`; with no
  new ADR — ADR-0089 already named this surface, and `sql/116` deliberately
  shipped its table without a writer. Evidence that this was felt: the Wave 8 E2E suite
  wrote its own row, with the comment "there is no request path for
  this yet". That comment is gone now, and the flow starts from the same writer.

  **Both of its permissions are platform-scoped, and `read` is not an oversight.** `create`
  states who MAY BECOME a partner — the platform half of the separation
  ADR-0089 guards against the customer's `partner_access.configure`. `read`
  lists ALL partners, and a tenant-scoped version of it is the
  cross-tenant directory the same ADR refused as a table, rebuilt as a
  permission.

  **There is no `DELETE`, and that is a decision.** Its row is the FK target of
  engagements AND of the delegated grants `sql/120` deliberately made
  outlive it; DELETE fails as soon as one partnership has ever existed, and
  `ON DELETE CASCADE` would cut every partnership in the installation. Retirement is a
  `status` change — and `status` remains pinned, so this surface does not
  accept it at all.

  **The conflict is resolved without reading SQLSTATE.** Both of its natural keys have a
  GLOBAL unique index, so telling its two 23505s apart through the driver error means
  reading SQLSTATE from a place that in this repo is not `error.code`.
  `ON CONFLICT DO NOTHING` plus one decisive read avoids the question
  — and that is also why this route carries no `Idempotency-Key`.

  **A trap found while wiring up the E2E:** `set_config` is
  SESSION-scoped, so on a pooled client the second statement can land on a
  connection that never saw it. The single-statement write that was in that suite
  survived by accident; three statements would not. Its call is
  wrapped in `withTenantOrThrow`.

  `NOT_YET_SCREENED` 60 → 62. Its screen is NOT `/admin/partners` — that page is
  the CUSTOMER's view of who reaches into their own tenant, and putting
  the registry there puts the list of every platform partnership in front of every
  customer.

- **ROUND of 13 August 2026 (the twentieth) — WRITE-CLASS MACHINE CREDENTIALS CAN
  BE ISSUED, and they get their own permission.**

  Closes the remainder of #423 item 1. `sql/122` + two optional fields on
  `POST /api/v1/access/machine-credentials`; with no new ADR, because ADR-0092
  §Consequences already named this surface as follow-up work, not as a
  decision still to be taken.

  **The permission is NEW, and that is the whole decision.** The obvious shape is
  to accept `allowedWriteActions` on the existing `machine_credentials.create`.
  Its wrongness is only visible when you ask from the grant side: every role
  that holds `create` today would GAIN the right to mint credentials that
  change data on release day — a widening without a single grant being edited, without
  a single line in a diff to review. So the write class gets a third activity,
  `machine_credentials_write.create`. `revoke` is deliberately NOT split with it: during an
  incident, whoever can kill a leaked credential must be able to kill
  every class of it.

  **A CIDR on a READ credential is refused, and nothing other than that validator
  guards that direction.** `isMachineCredentialWriteRefused` answers "not
  refused" for `read` BEFORE it touches the CIDR list — the database allows
  such a row and the runtime gate does not care, so an operator would
  believe they had bound something that is never consulted.

  **A gate trap worth remembering, and its cost is real:**
  `access:permissions:enforcement:check` reads a guard as a **three-key object
  literal**. The first attempt wrote its guard as a single literal
  with a ternary on `activityCode`, and the gate reported **both** permissions as
  "enforced by nothing" — including the one that was already enforced before this PR. The
  correct shape is two COMPLETE literals in both branches; widening the gate so it
  fits a writing preference is a trade in the wrong direction.

  **One defect was found by its own test:** the write class was initially derived
  from the actions that PASSED parsing, not the ones REQUESTED, so a request carrying `delete`
  with a correct CIDR came back as read-only and was then scolded about its CIDR.
  One mistake, two messages, and the second one contradicts the request.

  The ADR-0065 consumer contract was **regenerated deliberately** — its diff is prose plus
  two OPTIONAL properties, zero renames, zero removals, zero fields becoming required.
  The "read-only" text in the contract had been a false claim ever since ADR-0092 landed;
  that is fixed here too. `NOT_YET_SCREENED` 59 → 60.

- **ROUND of 13 August 2026 (the nineteenth) — THREE FLOW GAPS CLOSED.**

  [`awcms/privacy-analysis.md`](awcms/privacy-analysis.md) (step 3),
  [`awcms/templates/definition-of-ready.md`](awcms/templates/definition-of-ready.md)
  (step 9), and [`awcms/post-release-reviews.md`](awcms/post-release-reviews.md)
  (step 18), plus two supporting templates.

  **The privacy analysis points, it does not copy.** Per-table retention numbers stay
  in the gated descriptors; copying them into the privacy document produces
  a number that is stale on the first day somebody changes it, and a stale number
  there is more dangerous than no number. It also states what
  only an OPERATOR can answer, and one real gap that remains: **there is no
  per-data-subject export/erasure flow**.

  **The first question in the Definition of Ready is the one this repo paid for
  twice**: does the policy allow the read the plan needs. ADR-0087
  and ADR-0088 both failed there.

  **The release register lands EMPTY and says so.** Filling it in backwards from
  memory is the opposite of its use. One line of its template —"what was seen
  first in production and not in CI"— is where the price of ADR-0083
  is paid, and the only way to know whether that price is still worth it.

- **ROUND of 13 August 2026 (the eighteenth) — the `/admin/partners` screen:
  revoking partner access stops being an API call.**

  Closes the last three `partner_access` entries in `NOT_YET_SCREENED` (62 → 59).
  What drove it was not completeness but one sentence from the previous
  round: revocation is the control a customer looks for when something goes
  wrong, and until this page existed it was a `DELETE` nobody would remember
  under pressure.

  **There is no partner picker**, and the page says why — a
  `<select>` full of partners is the cross-tenant directory ADR-0089 refused
  as a table, rebuilt in the UI. **This page also does not reload after
  approving**: the approval response is the only place the code is readable, and
  a reload means a lost credential plus a grant that has to be revoked.

  **A trap found while writing its contract test, worth remembering:**
  the assertion `not.toContain('action: "revoke"')` over the whole route file FAILS on
  CORRECT code, because the route also writes an audit row with `action:
"revoke"`. An audit action ≠ a guard action; a test that mixes them turns red on
  correct code.

- **ROUND of 13 August 2026 (the seventeenth) — THE DEVELOPMENT FLOW HAS A CANONICAL
  DOCUMENT, and one of its steps CONTRADICTS a standing ADR.**

  [`awcms/alur-pengembangan.md`](awcms/alur-pengembangan.md): 18 steps from the
  Master Blueprint to the post-release review, each step mapped onto a REAL
  artefact and the gate that enforces it. It replaces
  `alur-pengembangan-mini-first.md` (revoked by ADR-0055) and is the
  binding one; `CONTRIBUTING.md` and §"Mandatory workflow" in `AGENTS.md`
  now both declare themselves to be **steps 10–12 only**.

  **REPO OWNER'S DECISION, TAKEN 13 August 2026: ADR-0083 STANDS.** Steps 13
  (Deploy Staging) and 14 (internal UAT) are marked **NOT APPLICABLE to this
  repo** — a decision, not a gap. Their replacements are stated in the flow document
  (the ephemeral CI database, Playwright E2E, `security:readiness`, the production
  preflight), **and so is their price**: human testing against production-like
  data, and verification of Cloudflare/Varnish/Traefik behaviour outside the production
  path. Both are legitimate reasons to revisit ADR-0083 later; neither
  is something lost without anybody noticing.

  The flow document therefore distinguishes a **gap** from a **decision** in its
  summary table — mixing them is how work that has not been done
  acquires the appearance of a judgement.

  **The three gaps that remain — purely not-yet-existing, and being worked on
  next:**
  the privacy analysis/DPIA (step 3), a general Definition of Ready (step 9 — what
  exists is only an admission checklist for a new module), and a per-RELEASE
  post-release review (step 18 — this §4 is the closest thing, but it is tied to work
  rounds, not releases).

  Step 9 has its own evidence of cost in this repo: **two consecutive waves**
  (ADR-0087, ADR-0088) wrote plans that assumed a cross-tenant read
  FORCE RLS forbids, and both were only discovered during implementation.

  The repo history was moved out of `README.md` into
  [`awcms/sejarah-repo.md`](awcms/sejarah-repo.md) — the README answers "what is this,
  now", and history at the front buries that answer. All three agents
  (`.claude/agents/`) now point at the flow document; the reviewer is asked to determine
  the CLASS of the change first, and the auditor is reminded that a control is not
  proven until it has been proven to FAIL.

- **ROUND of 13 August 2026 (the sixteenth) — PR 8.5 LANDED. WAVE 8 IS
  DONE, AND PROGRAMME #423 IS EXHAUSTED.**

  [ADR-0092](adr/0092-machine-credentials-may-write.md) (`sql/121`): machine
  credentials may write, and their actions are the CODE ceiling ∩ the row's column. If
  the action list became a pure column, a single backup restore could mint
  a write credential covering the whole catalogue with every gate green.

  The property "no high-risk action in the write ceiling" is **computed from the live
  constant**, not written as a list — a literal list drifts silently
  on the day somebody adds a new high-risk action.

  **An absent IP is a DENY.** Without that, a route that does not yet forward the
  caller's address silently switches the condition off. `defineTenantRoute` fills it in on
  both of its paths, including SSE. Its CIDR parser narrows when in doubt, and that
  direction is tested.

  Verified 7/7 against a real Postgres; three mutations turned the right test red.

  **WAVE 8 IS CLOSED** — PR 8.1 (#529), 8.2 (#530), 8.3 (#531), 8.4 (#532),
  8.5. The nine waves of the #423 membership-model programme are done.

  **What remains and has NOT been done**, recorded so that it does not have to be derived
  again:

  1. **The write-class issuing surface** — the column exists and the gate
     enforces it, but there is no route yet that can issue a write
     credential. Deliberately: every PR of this wave landed inert ahead of
     its surface.
  2. **An admin screen for `partner_access`** (3 permissions in
     `NOT_YET_SCREENED`). Revoking partner access today is an API
     call — one that works, and one nobody will remember under pressure.
  3. **A partner registration surface** (`platform` scope) — `awcms_partners`
     today can only be written by an operator through SQL.

- **ROUND of 13 August 2026 (the fifteenth) — PR 8.4 LANDED, and the E2E
  found a defect that survived every reading.**

  `sql/119` + `sql/120`, six endpoints: the customer engages/disengages a partner and
  approves/revokes a grant; the partner sees their book through a narrow
  `SECURITY DEFINER` function; redemption exchanges the code for a MEMBERSHIP (not a
  session — a second copy of the tenant-entry policy is where an MFA gate
  gets missed).

  **Its scope is deliberately wider than the plan.** The plan names only the partner
  side; shipping that alone produces a surface over data that no
  request path can create.

  **A correction to `sql/117`, found by the E2E:** the grant→engagement FK makes
  disengaging a partnership IMPOSSIBLE once a single grant has ever existed. It reads correctly in
  every review and is wrong as soon as the full sequence is run. `sql/120`
  moves the FK onto the registry; its write invariant moves into
  `INSERT … SELECT … WHERE EXISTS`, not into TypeScript. **The lesson is not
  "the FK was wrong" but that an invariant of the form "X cannot exist without Y"
  must be interrogated: must X outlive Y?**

  Its definer function is measured as `awcms_app`, not as the migration owner —
  `sql/048` itself warns that a definer does NOT bypass RLS in this
  posture. The new 18-test E2E suite is registered in both workflows.

  **Remaining in Wave 8:** PR 8.5.

- **ROUND of 13 August 2026 (the fourteenth) — PR 8.3 LANDED, and a
  "cannot be done" two ADRs old turns out to be possible.**

  [ADR-0091](adr/0091-two-sided-attribution.md) (`sql/118`): three columns make
  an outsider's action distinguishable from an employee's —
  `awcms_audit_events.actor_tenant_id`, `delegated_grant_id` on the audit, and
  `delegated_grant_id` on the decision log. `NULL` means "from inside", not
  "unknown"; there is no backfill, because old rows are genuinely correctly NULL.

  **An open ADR-0054 follow-up is closed**: "a created tenant does not see
  the record of its own birth". It was open because it looked impossible for a
  CORRECT reason — `awcms_audit_events` is FORCE RLS, the same wall that
  felled the ADR-0087 and ADR-0088 plans. What makes it possible:
  `createTenantWithOwner` **already stands inside the new tenant's context**. What
  distinguishes this case is not a new rule but **where the code happens to
  stand** — and that lesson is worth reading for whoever next
  concludes "you cannot write across tenants".

  A performance decision worth seeing: the decision log does **not** get
  `actor_tenant_id` (two columns per request on the largest table, for the sake of one join
  only an investigation ever runs), all three of its indexes are **partial**, and the grant id
  is resolved by a **second query** that stops early for an ordinary member —
  not by a join into the authentication query that every request pays for.

  Verified 10/10 against a real Postgres, including one assertion that genuinely
  provisions a tenant and then reads its own log. Two mutations turned the right test
  red.

  **Remaining in Wave 8:** PR 8.4, 8.5.

- **ROUND of 13 August 2026 (the thirteenth) — PR 8.2 LANDED: delegated access
  mints a REAL tenant user, and two planned PRs meet reality.**

  [ADR-0090](adr/0090-delegated-access-prints-a-real-tenant-user.md)
  (`sql/117`): a redeemed grant produces an ordinary `awcms_tenant_users` row
  bound to a role **the customer chooses**, with an expiry date — so RLS,
  the decision log, audit, SoD, and business-scope facts work unchanged.
  The only thing that crosses the inter-organisation boundary is a short-lived
  redemption code (`awcmsd_…`, hash `dg-sha256:`), on the ADR-0050 precedent.

  **Two items from the previous PR are closed here.** The `support` role PR 8.2
  assumed exists does not, and on inspection it also should not
  exist: planting it makes the platform decide the contents of somebody else's tenant,
  undoing ADR-0089 from the other side. The fifth `origin_auth` value (`delegated`)
  landed, and the non-switchable rule stops being spelled out inline in `switch.ts`
  and becomes `NON_SWITCHABLE_ORIGIN_AUTH` — two values may still be spelled out, three
  is already where the fourth value gets forgotten.

  **A finding that changed the design:** the gate "a delegated actor does not write
  authority" must not lean on `awcms_sessions.origin_auth`, because there are
  TWO paths to the chokepoint and the direct tenant-user path would be
  ungated — the ADR-0079 class. The kind therefore lives as
  `awcms_tenant_users.principal_kind`, a column both resolvers already SELECT,
  write-once so there is no second-writer obligation.

  Redemption uses `materializeMembership` (the ADR-0082 membership writer),
  not a fifth INSERT — which also gives it system-role refusal for
  free, so `owner` cannot be delegated. `bun run check` is green,
  `sql/117` is verified 13/13 against a real Postgres, and **four mutations** turned
  the right test red (moving the gate below the fetch, removing
  `tu.principal_kind` from one resolver, removing `delegated` from the
  non-switchable list, and dropping the code-namespace refusal in the gate).

  **Remaining in Wave 8:** PR 8.3, 8.4, 8.5.

- **ROUND of 13 August 2026 (the twelfth) — WAVE 8 OPENS. PR 8.1 landed,
  and this time the cross-tenant assumption was CHECKED BEFORE the plan was written.**

  [ADR-0089](adr/0089-a-partner-is-an-ordinary-tenant.md) (`sql/116`):
  `ModulePermissionScope` stays `tenant | platform`, **there is no
  `partner` value**, and partnership reach is modelled as DATA —
  `awcms_partners` + `awcms_partner_managed_tenants`, both landing inert.
  The sentence kept verbatim: _`scope` governs who may HOLD
  a permission; a partnership governs WHICH OBJECTS it touches._

  **The check that was done first, and the six things it found.**
  The last two waves had plans that were wrong in the same way, so the
  Wave 8 plan (written on 9 August, three days and two ADRs before what actually
  landed) was checked against the real code before a single line was written:

  1. **The ownership side of the mapping row was unanswered.** The plan places
     the RLS-carrying grant row on the TARGET tenant, but places nothing
     for the partner→tenant mapping, which has exactly the same problem. Answered in
     ADR-0089: the TARGET, with the partner's view through `SECURITY DEFINER` once
     PR 8.4 gives it a caller.
  2. **The partner registry CANNOT take the shape "one row in the partner's tenant".**
     Under FORCE RLS the platform tenant cannot insert a row carrying another
     tenant's `tenant_id`. The row belongs to the platform and NAMES the other tenant.
  3. **`sql/048` is bigger than the quotation of it.** "A narrow `SECURITY
DEFINER` function precedent" is true, but `sql/048` itself documents that in
     this repo's posture a definer does NOT bypass RLS — it needs a NOLOGIN owner role,
     an explicit read policy, a fixed column list, and a locked-down `EXECUTE`. Whoever
     writes it in PR 8.4 must read all four of those parts, not one.
  4. **The non-switchable rule that landed is based on `origin_auth`, not on a
     `switchable` column** as the 8.2 plan wrote. A session derived from a grant demands
     a FIFTH `origin_auth` value (`delegated`) in the `sql/115` CHECK — one ALTER,
     but it had to be in the 8.2 plan and is now recorded.
  5. **`actor_tenant_id` already exists** on `awcms_tenant_status_transitions`
     (`sql/092`, ADR-0054) — a shape and FK precedent for PR 8.3 that its plan
     did not mention.
  6. **The `support` role PR 8.2 assumed DOES NOT EXIST.** A role is a per-tenant
     row in `awcms_roles`; making it uniform demands a seed **plus a
     backfill**, because a seed migration only reaches tenants created
     AFTER it and older tenants would silently 403.

  The chokepoint step order (cross-wave rules 1 & 2) was verified still
  intact after PR 7.4 inserted the selection-token refusal at the top: selection →
  machine → `tenant_suspended` → `module_disabled` → entitlement →
  `platform_scope_required` → `fetchGrantedPermissionKeys` →
  `narrowPermissionKeys` → `ownershipGrant`.

  **One ceiling increase the repo owner should see:**
  `BOUNDED_BY_DESIGN` rises **13 → 15**, and this increase **does not meet the bar
  PR 7.3 wrote** ("a fourth argument, not a fourteenth table that
  repeats one of the three"). Both partner tables repeat the AUTHORSHIP
  argument, and that is stated plainly instead of being dressed up as a
  new class. The reason for raising it stands: that bar exists to prevent a table that
  grows with TRAFFIC from being parked there, and neither of these is
  one — while reading it literally forces one of two worse
  outcomes (fake novelty, or a `generic` descriptor that would delete
  live partners). The bar is replaced with a sharper one: **the next increase must
  bring a fourth argument OR shorten the list somewhere else.**

  The chain stays at **41 gates**. There is no forty-second gate for a two-value union —
  the `partner` refusal lives in `tests/platform-scoped-permissions.test.ts`,
  proven to turn red by three mutations (adding `partner`, renaming the type,
  deleting the registry entry).

  **Remaining in Wave 8:** PR 8.2 (the delegated-access ADR), 8.3 (two-sided attribution),
  8.4 (the `/api/v1/partner/**` surface), 8.5 (the machine credential write class).

- **ROUND of 12 August 2026 (the eleventh) — WAVE 7 IS DONE. PR 7.4 landed,
  and its plan was wrong for the SECOND time in the same way.**

  [ADR-0088](adr/0088-tenant-selection-and-switching.md) (`sql/115`): a login without a
  tenant header → `409 MEMBERSHIP_SELECTION_REQUIRED` + a selection token (≤120
  seconds, single use, **two columns on `awcms_principals`** — not a fifth table
  that grows with traffic), exchanged at `POST /auth/session/tenant`;
  `POST /auth/session/switch` moves a live session.

  **The invariant that is guarded: a selection token never authenticates
  `authorizeInTransaction`** — the `pt-sha256:` hash namespace is refused in the gate's
  FIRST statement, without a single query, so "zero decision-log rows" is true
  by construction. Its test uses a transaction that fails the test if the
  gate touches the DB at all.

  **Finding: the plan assumed a cross-tenant read that FORCE RLS forbids
  — again.** ADR-0087 had already refused "an audit row in every reachable tenant";
  PR 7.4 was supposed to carry the membership list in the 409 response, and PR 7.1's own
  index comment writes that `awcms_identities (principal_id)` serves
  that query. Measured against a real database: **1 row inside a tenant context,
  ZERO without a context.** A global membership projection would make it possible and was
  refused — it is the cross-tenant membership directory ADR-0087 refused in
  another guise. **The caller names its tenant**, and that is the repo owner's choice,
  not an unconsidered default.

  The non-switchable rule (`sso`/`handoff` may not move) closes a
  cross-tenant takeover in which every step is legitimate. The destination tenant's
  MFA gate applies on both paths — without it, switching tenants is an MFA
  bypass. The chain stays at **41**; the DB-gated suite gains one file (registered in
  both workflows). A one-way correction: `standar-performa-dan-keamanan.md` says
  "18 route files" are rate-limited; it is actually **26**, already six files stale
  before this PR added two.

  **WAVE 7 IS CLOSED.** Next is Wave 8 (partner/EaaS + delegated
  access), which has not started.

- **ROUND of 12 August 2026 (the tenth) — PR 7.3 LANDED: MFA moves to the
  principal, and an obligation the PLAN WROTE turns out to be
  unbuildable.**

  [ADR-0087](adr/0087-mfa-moves-to-the-principal.md) (`sql/114`): MFA factors and
  recovery codes come to belong to the **human** —
  `awcms_principal_mfa_factors`/`awcms_principal_mfa_recovery_codes`, GLOBAL
  without RLS, reusing all four ADR-0085 controls. The `sql/024` encryption is not
  touched. `awcms_mfa_challenges` and `awcms_tenant_mfa_policies` do **not** move
  with them, each with a concrete attack as the reason. The HTTP surface
  does not change by a single file.

  **This round's finding — "audited in both tenants' logs" is IMPOSSIBLE, and also
  should not be.** The Wave 7 plan asked for it and the first edition of ADR-0087
  copied it. The database refuses: `awcms_identities` under FORCE RLS makes
  `WHERE principal_id = … AND tenant_id <> …` return **zero rows
  forever** — that code would be green across 41 gates while never finding
  anything — and `awcms_audit_events` refuses an `INSERT` carrying another `tenant_id`.
  More importantly: the list of other tenants where an address has an identity
  is a **cross-tenant membership oracle**, handed to whoever holds
  `mfa_admin.reset` through an endpoint whose job is to recover people. Replaced with
  `crossTenantReach` on the audit row + `disabled_by_tenant_id` on the global row:
  stating THAT it reached outward, not where. **The lesson agrees
  with §6: check the policy, do not trust the plan.**

  **A second finding, and it only appeared because the script was RUN.** Both
  preflight censuses — the new one AND `identity:principals:preflight`, which landed
  back in PR 7.1 — iterate over tenants inside `withTenantOrThrow` and lean on
  RLS to cut their rows down. A superuser and the migration role **bypass RLS
  entirely**, and running an ops script as the owner is a common setup:
  every iteration reads every row in the installation and then stamps it with whichever tenant
  is currently up. The MFA census multiplied its counts (two factors
  reported as four, with the wrong tenant); worse was the principal census —
  **one legitimate human working in two tenants was reported as TWO BLOCKING
  collisions**, telling the operator to decide which real account is the duplicate, in exactly
  the case principals exist for. Both now carry an explicit
  `tenant_id` predicate, with a source-based regression test that mutations
  turn red. The recurring §6 lesson: **run it, do not read it** — neither
  of them was visible in the diff.

  New tooling: `bun run identity:mfa-collisions:preflight` (READ-ONLY, a census of
  who loses their authenticator before the deploy window). The
  `identity:principal-access:check` gate now guards **three** tables with a
  **separate allow-list per table** — the chain stays at **41**, it does not grow.
  `BOUNDED_BY_DESIGN` 11 → 13 with a third-class argument (the bound is enforced by the
  SCHEMA, not by authorship/derivation).

  **What remains of Wave 7:** PR 7.4 (tenant selection + switching).
  Not started. The prohibition PR 7.4 inherits from ADR-0087 and must not be
  loosened: **a challenge in tenant A must not be exchangeable for a session in
  tenant B.**

- **ROUND of 12 August 2026 (the ninth) — WAVE 7 OPENS, #430 IS CLOSED, and
  one consistency round that did not touch a single line of code.**

  **Two PRs landed.** [ADR-0085](adr/0085-one-human-one-credential-many-tenants.md)
  (#524, PR 7.1, `sql/112`) landed `awcms_principals` — GLOBAL, without RLS,
  one row per human — together with the new `identity:principal-access:check` gate
  (**chain 40 → 41**). [ADR-0086](adr/0086-the-lockout-counter-is-global.md)
  (#525, PR 7.2, `sql/113`) moved the lockout counter there and
  **closes [#430](https://github.com/ahliweb/awcms/issues/430)**.

  **What remained of Wave 7** (when that round was written): PR 7.3 (MFA
  moves to the principal) and PR 7.4 (tenant selection + switching). PR 7.3 has since
  landed — see the tenth round above.

  ### The consistency round: what was CHECKED and not found

  This round began from the request "resolve all the conflict problems", and
  half of its result is **the absence of findings** — recorded here because a later
  round that re-derives the same conclusion pays for a full audit
  to get an answer that is already known.

  - **Git conflicts: NONE.** The working tree is clean, zero open PRs, and the repository
    on GitHub has only **one** branch: `main`.
  - **And one tooling trap that almost became a false finding.** This audit
    at first reported **87 remote branches piling up**, then tested them one by
    one with `git merge-tree` and concluded "zero conflicts". Both
    sentences stand on a false premise: `git fetch` **without
    `--prune`** leaves remote-tracking refs for branches GitHub deleted long ago
    at merge time, and `git branch -r` displays them exactly like a
    live branch. What was piling up was **stale refs in the local clone**, not anything
    on the server — proven with `gh api repos/.../branches`, which returned
    `main` alone, and cleaned up by `git fetch --prune`. The lesson agrees with
    what §6 has recorded many times over: **ask the source, do not read its local
    cache** — a confident audit can be born whole out of tooling
    that happens to be stale.
  - **The gate chain: fully green** (41/41 + 3973 tests, 0 failures), CI and CodeQL
    green at `68c9c50`.
  - **ADR-0086 left no reader behind.** All five lockout-reset
    paths were checked one by one against the principal counter: successful login,
    password reset, password change, the SSO callback, and MFA enrolment verification.
    One path that LOOKED left behind — `mfa/totp/verify.ts`, which only writes
    `awcms_identities.failed_login_count` — turns out to be correct: `login.ts` already
    calls `clearPrincipalLockout` **the moment the password is proven**, before the
    challenge is issued, so the identity column on that path really is only
    history. This note exists so that the next reader does not "fix" it.
  - **SoD is not blind to grants that arrive through a user group.** `resolveOrdinaryRbacFacts`
    reads `activeRoleGrants`, and that fragment `UNION ALL`s direct grants
    with grants derived from `awcms_user_groups` — so the ADR-0079 relapse that
    once made SoD report "no conflict" does not recur through ADR-0081.

  ### What WAS found: six documents describing a world that does not exist

  All of the same class — **the writer moved, the document did not** — and
  all about a lockout that since `sql/113` is no longer per-identity:

  | Document                                   | Claim that is already wrong                                               |
  | ------------------------------------------ | ------------------------------------------------------------------------- |
  | `standar-performa-dan-keamanan.md`         | A07/V2/V11 "per-identity lockout"; **34 gates**; **69 ADRs**              |
  | `20_threat_model_security_architecture.md` | A07 "per-identity lockout"                                                |
  | `turnstile-bot-protection.md`              | "per-identity lockout"                                                    |
  | `18_configuration_env_reference.md`        | `AUTH_LOGIN_MAX_ATTEMPTS` "per identity"                                  |
  | `04_erd_data_dictionary.md`                | `awcms_principals` absent; the identity lockout columns still "important" |
  | `ARCHITECTURE.md`                          | the auth path with no principal at all                                    |

  **Why this is not tidiness.** `standar-performa-dan-keamanan.md` is the
  document used to answer an auditor, and its row reads "Met"
  next to a description of a control that is **weaker** than the one actually
  running. A document that understates its own control will be corrected in the wrong
  direction by the next person who believes it — exactly the failure mode
  already recorded for stale skills.

- **ROUND of 12 August 2026 (the eighth) — WAVE 5 (ENTITLEMENT/SaaS) IS DONE. The engine stands, and the first real
  entitlement is installed without refusing a single tenant.**
  [ADR-0084](adr/0084-an-entitlement-refuses-it-never-grants.md), four PRs:
  #517 (schema + the refusal branch + the deny-only gate), #518 (the subscription ladder +
  job), #519 (grandfathering + the blast-radius report), #521 (the first attachment).

  **An entitlement REFUSES, it never grants.** Every decision
  function exported by `identity-access/domain/entitlement.ts` is typed
  `EntitlementDenial | null` — there is no value shape meaning "yes". That property
  is machine-checked by the new `access:entitlement:deny-only:check` gate
  (chain **39 → 40**), not left to review, because the mutation that
  breaks it is one line and reads like tidiness. It is the shape of the
  refusal this §4 already recorded: `subject.entitlements` was REFUSED as an
  ABAC attribute.

  **It lands INERT, and that is proven, not claimed.** Zero modules declare
  `requiresEntitlement`, and `resolveModuleAvailability` on the null path
  emits the **SAME SQL statement** as before this wave —
  compared as TEXT in a test.

  ### Four places where the plan was not followed
  1. **The subscription ladder job does NOT call `suspendTenant`**, and the reason is
     a PRIVILEGE, not a preference. It would demand an `UPDATE` on `awcms_tenants`
     for `awcms_worker`, while `WORKER_ROLE_GRANTS` itself writes down
     the rule that would be broken — and `awcms_tenants` is a root table WITHOUT RLS,
     so there is no policy standing between one mistaken UPDATE and every tenant in the
     installation. The consequence still arrives through the entitlement gate (`suspended`
     and `cancelled` are outside `ENTITLING_SUBSCRIPTION_STATUSES`), and that is also
     the PROPORTIONATE answer: an unpaid invoice takes away the feature that
     stopped being paid for, not the public site, login, and data access.
  2. **The `BOUNDED_BY_DESIGN` ceiling was raised 5 → 10**, with the derivation that would
     have avoided it recorded as REFUSED: "the request path cannot write,
     so it does not grow with traffic" is wrong, and its counter-example is in this
     repo — `awcms_idn_admin_regions` forbids `awcms_app` all three write verbs and
     holds ~91,000 rows, because that list binds `awcms_app` while the import
     job runs as `awcms_worker`.
  3. **The blast-radius bound on the job** (`MAX_ENTITLEMENT_LOSSES_PER_RUN = 25`)
     is not in the plan. It is not a rate limit but a detector for "this is a bug, not
     a Tuesday": real attrition trickles, every failure mode that matters arrives
     as a cliff. All-or-nothing, and it counts LOSSES, not
     transitions.
  4. **A `requiresEntitlement` declaration on an `isCore` module turns
     `modules:compose:check` red**, rather than merely being ignored at runtime. A declaration
     the runtime ignores is worse than no declaration — it reads
     as a control that exists.

  ### Two defects, both found by RUNNING it
  - **`sql/109` does not revoke the rights the default privileges grant.** `sql/019`
    installs `ALTER DEFAULT PRIVILEGES ... GRANT SELECT, INSERT, UPDATE, DELETE
ON TABLES TO awcms_app`, so the three GLOBAL catalogue tables are born with all four
    verbs while `GLOBAL_TABLE_FORBIDDEN_PRIVILEGES` declares them read-only.
    **All forty pure gates were green** while the declaration and the database
    contradicted each other; only `checkRuntimeRoleGrants` — in the DB-gated CI
    suite — ASKS Postgres what is actually held. This is an exact repeat
    of the "run it, do not read it" lesson.
  - **The structural gate-order test found its own defect while it was being written.**
    The entitlement branch does not contain its sentinel textually because it
    FORWARDS `entitlementDenial.matchedPolicy`. Its detector was keyed to the error
    code instead of being loosened: imitating the literal for uniformity with the four
    older branches would RESTORE exactly the drift that constant removed.

  ### PR 5.4 changed shape TWICE, and the gates that found both

  The plan wrote it as "the first real entitlement attachment on one
  non-core module". That shape is wrong, and **its own correction was then wrong too** —
  both are recorded because both are how this repo finds things.

  **The first correction (from reading the code).** Attaching `requiresEntitlement` with
  nothing else would refuse that module to EVERY tenant in EVERY downstream
  installation: `resolveModuleAvailability` demands an effective plan containing the key,
  and **no tenant has a subscription row at all**. The first answer:
  `createTenantWithOwner` creates a subscription on the default plan, plus a
  cross-tenant backfill migration.

  **The second correction (from `modules:table-writes:check`).** That answer makes
  `awcms_tenant_subscriptions` written by `tenant_admin` AND `identity_access`
  — the shared-table write ADR-0013 §6 forbids. The gate refused, and
  its refusal points at a better design: **derive the default,
  do not write it.** A tenant with no subscription row is treated as being on the
  `is_default` plan — exactly the "a missing row is not a decision" convention
  `awcms_tenant_modules` has used since `sql/008`.

  The result: exactly ONE writer of that table (the subscription ladder job), zero
  cross-tenant backfill, zero `NO FORCE` toggling, and one new convention replaced by a convention
  this repo already teaches. The fallback deliberately does NOT apply when a subscription
  row EXISTS but its status grants nothing — that case is a lapse, and falling
  back to the default plan would silently undo it.

  **What was attached:** `tenant_domain` → `custom_domain`. Its entire GUARDED
  surface is domain management; host resolution for an already-configured
  domain is a public read path that never reaches the chokepoint,
  so a tenant without the entitlement is still served on the domain it already has.
  Losing the ability to add a domain is a plan wall; losing a domain
  already in use is an outage. `site_search` and `comments` were refused
  precisely because both have an unauthenticated public surface that bypasses the
  chokepoint — an entitlement there would be enforced on half the module and
  silently ignored on the other half.

  The "this wave is inert" test was REPLACED, not deleted: what is worth guarding was never
  "inert" but **"nobody is refused"**, and that is now asserted against the TEXT
  of the migration — proven by mutating `sql/111`.

  ### WHAT REMAINS of Wave 5: the `/admin/subscriptions` screen

  Deliberately SPLIT off from #521 and not yet built. The reason for the split is mechanical and
  worth knowing: a new permission must be claimed by a screen or enter the ledger
  (`admin:screen-coverage:check`), so an admin surface and its permission must
  land together — while the entitlement attachment adds no permission
  at all and can therefore land alone, smaller and easier
  to review.

  Its shape: assigning a tenant to a plan (`awcms_tenant_subscriptions`,
  tenant-scoped, writable). It can **NEVER** change the CONTENTS of a plan
  — that catalogue is migration-only, and that is the ADR-0084 property most easily
  broken by an admin screen that "completes" itself.

  ### Wave status

  | Wave  | Status                                                                                                 |
  | ----- | ------------------------------------------------------------------------------------------------------ |
  | 0–4   | done                                                                                                   |
  | **5** | **done — four PRs landed (#517, #518, #519, #521); `/admin/subscriptions` remains, see above**         |
  | 6     | not yet — metering & quotas (IaaS)                                                                     |
  | 7     | not yet — the global principal; **#430 is closed here (PR 7.2)**, it cannot precede `awcms_principals` |
  | 8     | not yet — partner/EaaS + delegated access                                                              |

  ### Merge notes

  All four PRs were merged in sequence with fully green CI at every step (10/10
  checks, including the Postgres integration suite). Two things that slowed it down and
  are worth knowing next time: **the `main` ruleset uses
  `strict_required_status_checks_policy`**, so every PR has to be rebased onto the
  newest `main` after its predecessor merges (a `BEHIND` status is not a failure);
  and **a squash-merge rewrites its predecessor's commits**, so `git rebase
origin/main` on a stacked PR will conflict — the correct one is
  `git rebase --onto origin/main <old-tip-of-predecessor>`.

- **ROUND of 11 August 2026 (the seventh) — ONE ENVIRONMENT, THE `staging` PROFILE
  REMOVED, AND THE ROOT STOPS 404-ING.** A repo owner's decision, landing as
  [ADR-0083](adr/0083-this-template-deploys-to-one-environment.md).

  **This repo has exactly one live deployment: production at
  `awcms.ahlikoding.com`.** There is no staging — and not merely "we do not have one
  ourselves": the profile itself no longer exists, see the next two paragraphs.
  The reason was given by the owner and written out in full in the ADR: this repo is a **template**;
  its live deployment demonstrates and validates the template, it does not serve a
  business. What would be "staged" is the template itself — and that is validated by
  39 gates + the Postgres integration suite in CI, not by a second running
  copy. Staging here is not a safety net but a second environment
  that has to be maintained: one more set of secrets, one more database needing
  backups, one more migration queue.

  **ADR-0083 WAS AMENDED IN PLACE, AND THE REVERSAL IS RECORDED HERE.** The first
  edition of that ADR — written the same morning, in this same round —
  **KEPT** `staging` as a valid `DeploymentProfile` in
  `module-contract.ts`, arguing that what changed is this repo's topology
  and not the template's capability, so removing it would take
  something away from EVERY user of the template. **The repo owner overruled that
  argument.** `staging` is removed **ENTIRELY**: not only this repo's own
  environment, but the deployment profile itself and every reference to it.

  **The reasoning that corrects the first edition's premise: a deployment profile nobody
  has ever run is a CLAIM, not a capability.** All
  `staging` ever offered was a string literal that passes a
  type check — zero code paths treating it differently from
  `production`, zero deployments that ever enforced it as a real
  staging, and (the sixth round's finding) one `APP_ENV=staging` that was actually
  SERVING the production domain on top of the staging database. A capability that can only
  be demonstrated by pointing at a type union is not a capability; it is a promise.
  A template user who genuinely needs a second environment builds it with a
  second `APP_ENV=production` and a second database — exactly what has
  been happening all along — without needing a name that no code reads.

  **Why AMENDED, not superseded.** ADR-0083 was not yet committed and
  not yet released when this decision arrived, so it was edited in place instead of
  being answered by a new ADR. What must not happen is precisely the tidier shape:
  leaving an ADR reading "`staging` remains valid" next to code
  that no longer contains it. This repo has been bitten many times by a document that is
  confident and wrong — and an ADR is the document the next reader
  trusts most.

  **What this ADR actually corrects is a document describing a world that
  does not exist.** The two-environment topology had already stopped applying before this
  round: the production app row is absent from `applications`, there is no production
  database, and the production domain is served by the staging deployment. The ADR makes the documents
  and reality agree **by choosing one**, not by rebuilding the
  second.

  **`/` stops being a 404.** ADR-0071 accepted the 404 on the open premise
  that `awcms-astro` carries the domain root. That premise is true for a SITE,
  not for this template's deployment host — there is no `awcms-astro` in front of it
  (both of its apps are `exited`). A front door that answers 404 to anybody who
  types the domain name is a defect, not a decision. `src/pages/index.astro`
  now serves it: **zero database queries, zero tenant context, zero enumeration**
  (it names no tenant name/count, version, or module status), and **zero NEW client
  scripts** — the only script is `THEME_INIT_SCRIPT_BODY`, whose
  hash is already in `script-src`, so the CSP does not change at all.
  Verified by RUNNING the built server: `/` → **200**,
  `/nope-xyz` → **404** (the catch-all is intact), six cards rendered, one `<h1>`,
  one `<script>`, zero external `src=`.

  **A gate that came calling, and it was right to.** `modules:routes:check` refused
  `/index` as an unclaimed route. It enters `PLATFORM_ROUTES` with a reason,
  rather than being given to a module: giving it to a module makes the front door
  **disableable**, which is exactly the failure (a 404 at the root) this page
  exists to fix.

  **What was REFUSED, with the reasons:** rebuilding a separate production +
  staging (restoring a cost nobody is buying); leaving the production
  domain served by `APP_ENV=staging` (an environment name that stops meaning
  anything is worse than a missing name — the next reader of `APP_ENV` will be
  confidently wrong); making the landing page a themed tenant page
  (binding the front door to `theming` + tenant resolution); and redirecting `/` to
  `/login` (shoving a credentials form at somebody who does not yet know what AWCMS
  is).

  **What was refused and then REVERSED, and it is not deleted quietly:**
  "remove `staging` from the type union" was item 2 in the refusal list of the first
  edition of ADR-0083. That item is precisely what is now being done. It is written this way
  — as a refusal that was overturned, not as a refusal that never existed —
  because the value of this document is that it records reversals instead of smoothing them over.
  The next reader who proposes bringing `staging` back deserves to know that
  the "template capability" argument was already made, written down, then weighed and
  refused — not simply unconsidered.

  **The cost accepted and stated:** there is no longer a pre-production rehearsal
  for migrations. Its replacement is the CI integration suite + the obligation to take a
  restore-verified backup before migrating (`deploy/backup/restore-postgres.sh`
  in verify-only mode). That is a mitigation, **not an equivalent replacement**.

  **Infrastructure: DONE 11 August 2026, v8.0.0 is live in production.**
  Verified, not claimed: `https://awcms.ahlikoding.com/api/v1/health`
  answers `moduleCount: 22` (v7.0.0 answered 21), `/` answers **200**
  (the landing page, no longer a 404), the container image tag
  `1d9534f1717282440376263f8e18c8b812a8b997` = exactly the `v8.0.0` release commit, and
  `awcms-staging.ahlikoding.com` is now a **503** because no router names it
  any more. `awcms_app` was checked as `rolsuper=f, rolbypassrls=f`, so the FORCE RLS
  on 124 tables genuinely applies.

  **The last migration rehearsal, the one ADR-0083 gives up — used once before it was
  given up.** Because staging still existed, 18 migrations (`091`–`108`) were run
  first against a COPY of the production data (`awcms_rehearsal`) and their
  invariants checked — `migrations=108`, `unbackfilled=0`, `force_rls=124`,
  `awcms_invitations → awcms_worker = DELETE,SELECT` — and only then run
  for real, with identical results. That rehearsal cannot be repeated: staging
  no longer exists.

  **Four env vars that had been missing since v7.0.0 were closed during standup:**
  `TRUSTED_PROXY_ENABLED=true` + `TRUSTED_PROXY_HOP_COUNT=1` (without them every
  client collapses into a single rate-limit bucket behind Traefik),
  `AUTH_COOKIE_SECURE=true`, and `AUTH_SOURCE_RATE_LIMIT_MAX=60`.

  **The tenant itself carried `tenant_code = staging`** and was named "AWCMS
  Staging" — a staging reference inside production DATA. Changed to
  `ahliweb` / "AWCMS", with `PUBLIC_DEFAULT_TENANT_CODE` following. The consequence
  accepted: the URL `/blog/staging/**` becomes `/blog/ahliweb/**`.

  **A backup was taken and VERIFIED first, before anything was deleted:**

  - file `/home/admin1/backups/awcms/awcms-preprod-20260811-090628.dump`
  - sha256 `08f677c5f13d7386c77dd41841090b60f95159550bdab3e90b7bfb6353a0bd68`
  - **restore-drilled into a scratch database** (`awcms_tenants` = 1 row read back
    from the restored result) — not merely a `pg_dump` that exited 0.
  - the repo owner's decision: that data is **promoted**, not discarded — production
    receives a restore of this backup, so the existing tenant + owner account can
    still log in and the setup wizard does not have to be run.

  That order is part of the decision, not extra caution: ADR-0083
  gives up the pre-production rehearsal for migrations, so a backup PROVEN
  to be restorable is the only net that remains — and a net that
  has never been pulled is not a net. It is also the only copy of the data
  `awcms.ahlikoding.com` ever served during the sixth round's period,
  when the production domain was running on top of the staging database.

  **A self-inflicted trap during teardown, and how it was noticed.**
  Deleting the `awcms_staging` database made the Postgres container's healthcheck —
  `psql -U awcms_staging -d awcms_staging -c "SELECT 1"`, baked in by Coolify when the
  container was created — point at a database that no longer exists. The container still
  reported `healthy` for several minutes (the interval had not elapsed) while
  `FailingStreak` was already 4. Fixed by updating `postgres_db` in
  Coolify and then restarting the resource, and **verified by re-reading
  `Config.Healthcheck.Test` on its new container**, not by looking at the word
  "healthy". The lesson is the same as the sixth round's: a green status that has not
  had time to change yet is not evidence.

  **TWO staging remnants that CANNOT/MUST NOT be deleted, and why:**

  1. **The DNS record `awcms-staging.ahlikoding.com` still exists.** The Cloudflare token on the
     host is scoped only to the `dinkes.top` zone, so the `ahlikoding.com` zone is out of
     reach. The hostname itself is already dead (503, no router). Delete
     the record manually to finish the job.
  2. **The Postgres role `awcms_staging` is deliberately KEPT.** It is the
     container's `POSTGRES_USER` (superuser/owner). Renaming it would put
     `POSTGRES_USER`, the healthcheck, and Coolify's connection string out of step with
     each other — trading a cosmetic name for the risk that production cannot start. That
     name is only a label; what matters is that `awcms_app` (not it) serves
     requests, and that has been checked not to pierce RLS.

  **Continuation point.** Always verify production against Coolify's
  `applications`/`standalone_postgresqls`, **not against `curl`** —
  the sixth round's lesson that misled for hours: `https://awcms.ahlikoding.com`
  answered 200 and looked healthy the whole time production did not exist. The v8.0.0
  `sign-attest-publish` job is waiting for maintainer approval in the
  `release` environment; its image is already published because the `build` job precedes
  that gate.

- **ROUND of 11 August 2026 (the sixth) — DEPLOY READINESS AUDIT. The code is ready;
  what is missing is the PLACE.** Triggered by the question "can we deploy
  now". A 64-agent audit with adversarial verification: **55 of 56 findings were
  REFUTED**, one survived. There is not a single blocker in the code.

  **The biggest finding is not in this repo.** The awcms **production environment no
  longer exists**: Coolify's `applications` table has no row for
  `got4etcblum9kowdv4mrixqo` (not a soft-delete — the row is gone), and
  `standalone_postgresqls` has no production database, only `awcms_staging`.
  Meanwhile `awcms-staging-varnish` installs the Traefik rule
  ``Host(`awcms-staging.ahlikoding.com`) || Host(`awcms.ahlikoding.com`)`` —
  so **the production domain is served by staging, using the staging database**
  (`APP_ENV=staging`). What is running is the v7.0.0 release commit (`ea25fff6`),
  **90 commits behind HEAD**; the v7.0.1 image was built but never
  deployed. Its database is at migration **090**. Not yet decided: deliberate or
  incident. **Do not assume there is a production to deploy to.**

  **What blocks procedurally, not technically:** `release:verify` for
  v7.1.0 exits 1 (package.json is still 7.0.1, the CHANGELOG has no section yet, 72
  changesets unconsumed → a MINOR bump); images are only built from a release tag;
  and **the migrations MUST run BEFORE the container is swapped**, because
  `grant-source.ts:111,119-123` reads `awcms_access_policies` unconditionally on
  the authenticated request path. A precheck against the live database: `awcms_sync_outbox`
  **0 rows** (so `sql/099` does not abort), 1 tenant, 1 access assignment.

  **Eight fixes landed, with the whole `bun run check` green (3888 pass/0 fail):**

  1. **The CSP `img-src` — the only finding that survived verification.** `default-src
'self'` without `img-src` blocks every one of your own cross-origin R2
     images. **`media-src` has an IDENTICAL defect** and is closed with it: the same
     renderer emits `<img>` and `<video src=…>` from the same R2 URL, so
     patching `img-src` alone leaves a half-correct policy — the image
     shows, the video next to it stays blocked, with no error. `data:` is deliberately
     NOT carried over to `media-src`: nothing emits a data-URI video.
  2. **`sql/108`** — `awcms_invitations` was never GRANTed to
     `awcms_worker` even though its descriptor says `executionMode: "generic"`, and
     `archive-purge-job.ts` has **zero `catch`** → one `permission denied` kills
     the WHOLE purge. Its verbs are derived from the code, not by analogy:
     `SELECT, DELETE` only — a worker with `INSERT`/`UPDATE` could address
     a membership offer to any mailbox at all or rotate `token_hash`.
  3. **Article authoring is alive.** The create form sent `contentText: ""` → an
     ALWAYS 422; there is now a `<textarea>` + a PATCH path on `/admin/blog` and
     `/admin/blog-pages`. The validator was NOT loosened — `content-quality-checklist.ts`
     has no content-exists rule, so loosening it would let an empty post through.
  4. **The sitemap** is no longer silently truncated at 200 URLs (the cursor is treated as opaque).
  5. **Ops**: `deploy/backup/*.sh` + `deploy/cron/awcms.crontab` (23 jobs that
     until now had no scheduler at all) + `lock_timeout`/`statement_timeout`
     in `db-migrate.ts`.
  6. **Five wrong documentation claims** were fixed — `production:preflight` really
     does not exist, and it slipped through because `scripts/skills-check.ts:134` whitelists it.
  7. **The env gate stops being blind.** `config:env:coverage:check` reported OK over
     53 variables while the code reads **173**; the script's own header recorded
     that limit as "accepted". It now **resolves aliases** (`const env =
process.env`, `env: NodeJS.ProcessEnv = process.env`) instead of matching
     any `env.X` at all — the old precision is preserved, proven by two negative tests.
     26 real deployment variables entered `.env.example`, including **all of
     `REDIS_*`**: without `REDIS_ENABLED=true`, the cross-instance rate limiter
     silently becomes N× the limit per replica.
  8. Two stale `sql/NNN` ranges in `ARCHITECTURE.md` + `.claude/skills/README.md`.

  **What was REFUSED, with the reasons:**

  1. **Rebuilding the production infrastructure & triggering a deploy** — hard to reverse,
     and it waits on a decision about whether losing that environment was deliberate.
  2. **#430** — both workarounds (rekeying the identifier, a global lockout) have already
     been refused in writing in §816-821/§884-889; the real fix is the global
     principal, Wave 7. Do not propose it again.
  3. **Loosening `validateContentTextField`** — see item 3 above.
  4. **Flipping the `SYNC_HMAC_ALLOW_LEGACY` default** to fail-closed —
     `sync-auth.ts:29-31` really is fail-OPEN (its absence accepts v1, which is
     cross-tenant forgeable, GHSA-c972-3q5p-g3h4), but flipping it cuts off
     v1 nodes already deployed in other installations; it is latent here because sync
     is off. It needs a conscious decision, not a side effect of this round.

  **A limit that MUST be read.** The env gate that now sees 173 variables is STILL
  blind to computed reads (`process.env[prefix + suffix]`). And
  `EMAIL_ENABLED` defaulting to `false` + `APP_URL` defaulting to `http://localhost:4321`
  mean **the Wave 4 invitations are written and then never sent**, with
  links pointing at localhost — a dead feature not because of a bug, but because of config.

  **Continuation point.** What remains of the remediation plan and has NOT been done: a gate that
  derives the worker verbs from every `generic` descriptor (this defect class has already
  slipped through TWICE — `sql/091`, then `sql/106`), a health/readiness that really
  503s when the DB is down/the migrations have drifted, retention descriptors for `awcms_sessions` and friends,
  and `/metrics`. Wave 5 (entitlement/SaaS) is still next.

- **ROUND of 11 August 2026 (the fifth) — WAVE 4 IS DONE.** Three PRs
  (#512/#513 + this entry); zero open PRs. ADR-0082.

  **Invitations landed whole across two PRs.** `awcms_invitations` +
  `awcms_invitation_policies` (`sql/106`, permissions in `sql/107`), then
  acceptance. An invitation names an address and carries the role that person
  will hold; that role is **inert** until acceptance calls `grantRolePolicy`,
  the same writer as every other grant — so `activeRoleGrants`
  never needs to know this table exists, and no second grant path is
  born.

  **Four places where the programme plan was not followed, all with reasons
  checked against the code:**

  1. **The scope columns EXIST, but are PINNED** by `CHECK (scope_type = 'tenant' AND
scope_id = tenant_id)`. This is the answer to a limit ADR-0080 wrote
     for itself — a PR that adds a scoped-grant writer must not land
     without answering it — and the answer is **refusing to be that writer**.
     Removing the columns was also considered: the argument "a column its writer
     ignores is lying" is true for an UNCONSTRAINED column, and the CHECK
     removes that. The ADR-0078 shape is preserved, so a later widening is one
     `DROP`/`ADD CONSTRAINT`.
  2. **`resend` is not an action of its own.** It does not exist in `AccessAction`, and
     adding it would declare that resending is a different authority
     from issuing. It is not — a resend mints a new secret with the same
     power, so it is gated by `create`.
  3. **The rate limit uses `checkAuthRateLimit`, not a bare
     `checkSharedRateLimit`** as the plan wrote. That plan predates #447:
     the tenant header is a key an attacker can CHOOSE, and
     `checkAuthRateLimit` checks the per-SOURCE ceiling first. Its prose
     is corrected in ADR-0066 §C.
  4. **`approveRegistrationRequest` was NOT repointed at
     `materializeMembership`.** That would turn the wave-closing PR into a
     self-registration + SSO refactor, and would turn
     `access-assignment-writers.test.ts` red, which names `self-registration.ts`
     as a direct caller of `grantRolePolicy`. That convergence belongs to
     Wave 7, which does schedule it.

  **Two defects found, both by RUNNING it rather than reading it:**

  1. **The invitation link does not carry the tenant.** `buildInvitationUrl` only contains
     `?token=` while both of its public endpoints demand the
     `X-AWCMS-Tenant-ID` header — the link produces a page that cannot
     make the call it exists for. Found while
     WRITING the page, not while reviewing its writer; 39 gates were green
     throughout, because not one gate connects the shape of the link to
     what the page needs.
  2. **One of my own test assertions was wrong, in the right direction.** I demanded that
     the losing side of a concurrent acceptance answer `identifier_taken`; it answers
     `invalid` — it waits for the row lock, re-reads the row with `status =
'accepted'`, and **never reaches the identity INSERT**. That is the
     better answer, and it belongs to the lock: removing `FOR UPDATE OF i`
     makes it THROW (a 23505 mid-transaction = a 500 for somebody who
     presses the button twice).

  **What was REFUSED, with the reasons:**

  1. **Acceptance issuing a session** — it would step over the tenant's MFA policy
     (`required_for_all` would produce a member with a full session and no second
     factor), `isPasswordLoginDisabledForIdentity` on an SSO-only tenant, and
     the login rate limit. An invitation mints an ACCOUNT; who may hold a session belongs to
     `/login`.
  2. **`410 Gone` for an expired token** — it tells the token holder that
     the token WAS once valid. A uniform 404 for all five failure classes.
  3. **Returning the address in the preview** — its caller is unauthenticated.
     A legitimate link holder has already read it in their mailbox; the holder of a
     STOLEN link has not.
  4. **A nullable `recipientTenantUserId` on `AuthNotificationPort`** —
     it would leave every existing caller one typo away from queueing
     a message with no destination. A SECOND operation instead.
  5. **`update` and `delete` for invitations** — editing an invitation that has already
     been sent makes the link in somebody's inbox no longer match what was
     reviewed; deleting it destroys the only record that an offer
     was ever made.
  6. **A feature switch in the style of `AUTH_SELF_REGISTRATION_ENABLED`** — that switch exists
     because registration is a PUBLIC endpoint that writes rows for an
     anonymous caller. An invitation can only be issued by a permission holder, so there is no
     surface for a switch to protect.
  7. **A lifecycle descriptor of its own for `awcms_invitation_policies`** —
     a `generic` purge deletes purely by age, so it would strip the roles
     off invitations that are still pending and produce an acceptance that
     silently grants nothing. `BOUNDED_BY_DESIGN` + `ON DELETE CASCADE`.

  **Gates that grew:** `BOUNDED_BY_DESIGN` 4 → 5 (its ceiling, and the next
  increase has to be harder — ADR-0081 already wrote that down);
  `NOT_YET_SCREENED` +4; `EXPECTED_PLATFORM_KEYS` +1; the rate-limit ledgers 11 → 13
  and 7 → 9. Permissions 214 → 218.

  **A limit that MUST be read.** `config:env:coverage:check` only matches
  `process.env.X` and is **blind** to an `env.X` passed in as a
  parameter — a limit the gate records itself in its header. The three invitation env vars
  were therefore written into `.env.example` BY HAND. The next config module that
  uses the `env: NodeJS.ProcessEnv = process.env` pattern will have the same
  problem, and nothing will tell it.

  **Continuation point.** Wave 4 is complete. Next is **Wave 5**
  (entitlement/SaaS — landing INERT). Three things still hanging from
  earlier waves and not yet done: the `/admin/invitations` screen (4
  permissions in the ledger), an admin surface for scoped grants (with an answer
  to the ADR-0080 limit — which this PR DEFERS, it does not resolve), and the
  lifecycle `delete` decision for groups. #430 stays in Wave 7.

- **ROUND of 10 August 2026 (the fourth) — WAVE 3 IS DONE, and three live defects
  were found while closing it.** Four PRs (#508/#509/#510 + this entry);
  zero open PRs. ADR-0079, ADR-0080, ADR-0081.

  **What was planned was a backfill. What was found is bigger.** PR 3.2
  (#506) moved every grant WRITER onto `awcms_access_policies`. **FIVE
  readers did not follow**, so for every tenant created after that PR
  they answer about a table nobody writes — and each of them is
  wrong in a different way:

  1. `GET /api/v1/auth/session` reports the owner **with no roles at all**;
  2. `/admin/users` shows every user with an empty role list;
  3. `TenantContext.roles` is empty → ABAC policies on `subject.roles` stop
     matching. For an `allow` that is a narrowing (safe); a **`deny` becomes INERT,
     which is a WIDENING**;
  4. SoD stops seeing ordinary RBAC grants and reports "no conflict";
  5. the `last_admin_blocked` guard concludes the tenant has no administrator →
     **the last owner can be deactivated**, locking the tenant out with no in-app
     recovery.

  **38 gates were green throughout**, `bun run check` passed, the unit tests passed —
  because each of them asserts a reader against **itself**.
  Nothing wrote a grant through the real writer and then ASKED the
  readers. That is the shape of the test that now exists
  (`tests/integration/grant-readers.integration.test.ts`), and pointing
  one reader back at the old table turns it red — tested, not claimed.

  **A second defect, and the gate cannot see it.** `awcms_setup` was never
  granted privileges on the Policy table, so the setup wizard fails with
  `permission denied` in every deployment carrying `SETUP_DATABASE_URL` since #506.
  `checkWorkerSetupRoleGrants` checks whether the grants MATCH its matrix —
  and both sides still agree with each other. Nothing checks whether
  that matrix matches what the code NEEDS.

  **A third defect, found while writing a test rather than while reading:** the `tx` stub
  in `business-scope-facts-guard.test.ts` answers EVERY statement with the same
  row, so any second query is answered with the first query's row.
  Its assertions did not change; the stub stopped lying.

  **What landed.** ADR-0079: `sql/103` copies every
  `awcms_access_assignments` row into Policy with the **`id` preserved**, then
  revokes writes; the `UNION ALL` collapses **in the same change**, because the old
  rows are kept as history, and a kept row that still
  counts is a grant nobody can revoke. ADR-0080: scope
  qualification, a single clause that **has no coverage-producing branch**, proven
  as a property over the corpus plus an anti-vacuity assertion; a
  **build-time** kill switch (two instances must not disagree). ADR-0081: a group
  as a SUBJECT that grants ROLES, reaching every reader through **one
  branch** — the ADR-0079 payoff, without which that PR would have had to touch seven
  readers.

  **Three places where the programme plan was not followed, all with reasons
  checked against the code:**

  1. **PR 3.3 retires ONE table, not two.**
     `awcms_business_scope_assignments.role_id` grants no
     permission key at all today, so moving it would give every scoped
     subject that role **across the whole tenant** for as long as scope is not qualified;
     and its `role_id` is nullable while its destination is not.
  2. **`fetchGrantedPermissionKeys` stays a `Set<string>`**, not
     `{ keys, scopes }`. That map would duplicate what
     `resolveBusinessScopeFacts` already answers from the same source — and two derivations of one
     value is exactly the ADR-0079 lesson.
  3. **The `access:sod-fact-parity:check` gate was not built.** ADR-0079 already
     closes its gap more tightly: the readers no longer name the grant table at
     all. "Refers to the same constant" can be true while the two queries
     differ; "uses the same fragment" cannot.

  **What was REFUSED, with the reasons:**

  1. **A database VIEW as the single definition of a grant** — the first view in this
     repo would have to answer `security_invoker` in the same change, and without it
     it runs as its OWNER and **bypasses FORCE RLS** while every
     RLS test stays green.
  2. **Deleting the old rows instead of keeping them** — an empty table is not
     history, and audit references to `id` would die.
  3. **Revoking `SELECT` as well** — that makes the history unreachable, not
     immutable.
  4. **Filtering scoped grants out of `fetchGrantedPermissionKeys`** —
     the RBAC gate runs first, so the scoped path becomes impossible
     to reach and a scoped grant would refuse everything, including inside its own
     scope.
  5. **An env var for the scope kill switch** — two instances in one deployment
     could disagree.
  6. **A group granting permission KEYS directly** — an empty `subject.roles` makes
     DENY policies inert; that is a widening nobody observes.
  7. **A separate `user_groups.grant` permission** — a group administrator who
     can also grant roles to their own group could grant `owner` to a group
     they belong to.
  8. **`delete` for groups** — three unanswered decisions (its grants,
     its memberships, the `external_id` a directory will hand over again tomorrow).
  9. **Accepting `source` from the request** when creating a group — a caller would
     declare a group uneditable with no directory behind it.
  10. **Auditing the member list when a role grant is given to a group** — that list
      stops being true the moment somebody joins; what is audited is the GROUP.

  **Two gates grew, and both because the surface changed, not because the
  gates are fussy.** `RETIRED_TENANT_TABLE_PRIVILEGES` (a new class: a
  tenant-scoped table that is deliberately read-only must be DECLARED, enforced both
  ways), and `GRANT_TABLES` gained two group names — changing who is in
  a group is changing authorization. The `BOUNDED_BY_DESIGN` ceiling rises 3 → 5,
  and raising that line is a reviewed action: all four entries are one
  argument in two halves (the granting table + the table bounded by it).

  **A limit that MUST be read before a scoped-grant writer surface is
  built.** Scope qualification is only as strong as the routes that **declare** a required
  scope. `fetchGrantedPermissionKeys` still returns the keys of every grant
  — it must, because the RBAC gate runs first — so on a route that
  declares no scope, a scoped grant grants that permission across the whole
  tenant. Today it is inert (zero writers, asserted against the database), but the
  admin surface PR **must not land without answering it**.

  **Continuation point.** Wave 3 is complete. Next is **Wave 4** (invitations —
  `awcms_invitations` + `awcms_invitation_policies`, an invitation carrying its
  own Policy). Two things that must come with it: the admin surface for scoped grants
  (with an answer to the limit above) and the lifecycle `delete` decision for groups.
  #430 stays in Wave 7.

- **ROUND of 10 August 2026 (the third) — five dependabot PRs cleared, two review
  defects fixed, WAVE 3 IS HALF WAY.** Five PRs
  (#502/#503/#504/#505/#506 + this entry); zero open PRs.

  **Five dependabot PRs were merged into two, and the reason is the same for both:
  not one of them could be green alone.** `codeql-action/init` and `analyze`
  are split by dependabot per path, but CodeQL refuses to run with a mismatched SHA
  pair — so whichever PR merges first stays red UNTIL the second
  follows, and the only green ordering is one PR (#502, together with
  `attest-build-provenance` in both `release.yml` steps). Astro and
  `@astrojs/node` (#503) are the same: `family:conformance:check` compares the family
  manifest with `package.json` field by field. Landing with it: the
  `astro-files-not-type-checked` divergence stated 42 `.astro` files (22,328 lines);
  it is actually **44 (24,359)** — that entry exists to record the SIZE of the exposure
  `tsc` does not check, so a summary that understates it is the
  one error there that actually costs something.

  **Two defects from reviewing today's PR (#504), both green across 38
  gates:**

  1. **`<tr hidden>` is NOT hidden inside a stacked table.**
     `.data-table--stack tr { display: block }` (0,1,1) beats the user-agent
     `[hidden] { display: none }` (0,1,0), so on a phone the `/admin/users`
     session panel never closes: every user row grows a permanent empty
     strip that no button can close. Its regression test
     enforces the GENERAL property for all admin screens — and its first draft was
     **satisfied by its own CSS comment**, so a mutation that REMOVED
     the fix stayed green. The sixth time that shape has appeared in this repo.
  2. **`POST /auth/password/change` reads the body INSIDE the transaction.**
     `await request.json()` waits on the CLIENT, so it holds a reserved pool
     connection plus its work-class slot for as long as the caller chooses to send
     its body. The self-service seam now has a `prepare`, the same shape as
     `defineTenantRoute`.

  **Wave 3 is half way.** [ADR-0078](adr/0078-a-grant-carries-its-own-scope.md):
  `sql/102` derives `awcms_access_policies`, `fetchGrantedPermissionKeys`
  reads both grant shapes through a `UNION ALL` (#505), and every new grant
  now lands as a Policy (#506). 3.1 and 3.2 landed as **one unit
  of commitment**, as the previous round recorded.

  **Three places where the programme plan was not followed, all in the direction of "do not
  ship what cannot be used yet":** `subject_type` accepts only `'tenant_user'`
  (`'user_group'` arrives with its own table); the return type of
  `fetchGrantedPermissionKeys` is **not yet** `{ keys, scopes }` (a field
  nothing reads + eleven call sites stirred into the riskiest PR); and
  the `access:grant-readers:check` gate was moved **out** of PR 3.1
  (#500, the previous round).

  **What was REFUSED, with the reasons:**

  1. **Dual writes into both grant tables** — two writes that can succeed
     separately leave a subject who holds a role according to one table and
     not according to the other, with no way to decide which is right. That is the
     failure ADR-0078 avoids by choosing a third table.
  2. **Age-based purging for the two Policy tables** —
     `executionMode: 'generic'` deletes purely by age with no status
     predicate, so it would delete LIVE grants; and a revoked row is
     the only thing that answers "did this person have access last March".
     Both enter `BOUNDED_BY_DESIGN` (2 of a ceiling of 3) with their bounding
     mechanism named.
  3. **`platform-bootstrap.ts` calling the shared writer** — `tenant_admin`
     must not import `identity_access` application code; the module DAG runs
     the other way. Its INSERT is inline and pinned by the writer test.
  4. **Growing `TABLES_PREDATING_THE_RULE`** — that ledger is closed to
     new tables, and using it would skip the question the gate
     exists to force.

  **Four gates turned red in #506 and each of them was right** — including the
  "writer" marker in `access-assignment-writers.test.ts`, which had to change TWICE:
  the table moved, AND a file can now cause a grant without containing
  a single `INSERT`. A marker that only looks at INSERTs would silently
  narrow the four-writer rule to two, and `user-admin.ts` — the carrier of
  this repo's main system-role refusal — would fall out of its own rule.

  **One defect was caught by CI, not locally:** the composite FK `awcms_access_policies`
  → `awcms_roles` turned the teardown of two DB-backed e2e suites red, the ones that delete roles.
  Locally those suites were already red because of a harness artefact, so the signal was only
  readable in CI.

  **Continuation point.** Wave 3 PR **3.3** — backfill the old rows into Policy
  (preserving `id` so audit references survive), then
  `REVOKE INSERT,UPDATE,DELETE … FROM awcms_app` on the two old tables so that
  both become read-only history. The equivalence oracle is run **once
  more after** the backfill. After that, 3.4 (scope qualification, the build-time
  kill switch) and 3.5 (User Groups). #430 stays in Wave 7.

- **ROUND of 10 August 2026 (continued) — WAVE 2 IS DONE, the Wave 3
  prerequisite landed.** Five PRs (#496/#497/#498/#499/#500 + this entry).
  The session & credential surface from the
  [membership model programme](awcms/program-model-keanggotaan-2026-08-09.md)
  is complete; #430 and #423 stay open deliberately.

  **What landed.** `GET`/`POST /api/v1/users/{id}/sessions[/revoke-all]`
  (two `user_sessions` permissions, `sql/101`, plus a session panel on `/admin/users`);
  `POST /api/v1/auth/sessions/revoke-all`; `POST /api/v1/auth/password/change`.
  Together with PR 2.1 (#491) that is the whole content of Wave 2. Plus the 38th gate
  `access:grant-readers:check` (#500) — the Wave 3 prerequisite, explained
  below.

  **The 38th gate was moved OUT of PR 3.1.** The plan placed
  `access:grant-readers:check` inside the riskiest PR in the whole programme.
  It landed on its own, first, on the same argument that placed
  `access:decision-log:coverage:check` ahead of the deny branch it guards:
  a gate that must be green TODAY is cheapest to add today, and
  a list written AFTER a risky change is written by somebody who already has a
  reason to shorten it. The result: **eleven** files name the grant table, three
  of them OUTSIDE `identity_access` — including one ROUTE
  (`access/policies/simulate.ts`) that assembles its own join to
  simulate ABAC, so the preview of a policy can differ from
  its behaviour in production. Not one of them violates an existing gate:
  they all reach the table through a SQL template, not an import, so the module DAG
  has no opinion and `modules:table-writes:check` only governs WRITES.

  **Three corrections to the plan, each verified against the code:**

  1. **The `user_sessions` permission split is the REVERSE of what was assumed.** The plan
     quoted the `machine_credentials` reasoning ("whoever can kill a leaked credential
     without being able to mint one"). Here the axis is different: only one of the two
     REVEALS anything. `read` is a permanent window onto a colleague's
     movements; `revoke` destroys access and returns a number. So what
     is bought is `revoke` **without** `read` — an incident responder with no
     view of everybody's movements.
  2. **The `?exceptCurrent=true` flag was NOT built.** Its other value also
     ends the requesting session, and that is `POST /auth/logout` — which
     ALSO clears the cookie that route cannot see. A default that must not
     be flipped is more honestly written as the absence of a parameter.
  3. **The aal2 step-up on password change landed CONDITIONALLY.** `requireStepUp`
     refuses every session that is not currently `aal2`, and somebody with no enrolled
     factor can never reach it — unconditionally, every user
     without MFA is permanently unable to change their password, and the ones who need it most
     are exactly the ones who just learned their password leaked. The ADR-0058 §E trap in another costume.
     The mutation `if (mfa.enabled)` → `if (true)` turns 4 tests red.

  **A finding about #430 that changes its value.** The temporary mitigation
  its own issue proposed — a rate-limit key of `(ip, login_identifier)` instead of
  `(ip, tenant, identifier)` — is **already closed** by the per-SOURCE ceiling that
  landed in #447: `auth-source:${clientIp}` applies across ALL auth routes and
  does not care about the tenant, so header rotation is already bounded there. The
  `auth-rate-limit.ts` docblock even corrects #430 directly ("not 'bound N
  times looser', as issue #430 described, but not bound"). What REMAINS in #430
  is the lockout counter in the database (N × `maxFailedAttempts` before one
  account locks) and the per-tenant MFA asymmetry — both of which only the global
  principal closes.

  **What was REFUSED, with the reasons:**

  1. **Growing the `NOT_YET_SCREENED` ledger for two new permissions** — the
     `/admin/users` screen already exists and is their natural home; a surface without
     a screen is exactly the class of debt that ledger exists to count.
  2. **Refusing target = yourself on the admin revoke-all (409)** — simpler,
     but it leaves a gap until PR 2.3 lands and forces the
     operator to memorise an asymmetry. `token_hash <> caller` is inert for other targets,
     so it is free.
  3. **Auditing the SELF-SERVICE revoke-all** — the audit trail records what
     an administrator does to SOMEBODY ELSE; recording every self-cleanup
     fills the trail an investigator reads with people acting
     on themselves.
  4. **Clearing the lockout on a self-service revoke-all** — somebody who
     tidies up stray sessions has proven nothing about their credential;
     combining them makes session hygiene a lockout-reset oracle.
     (A password change DOES clear it, because there the credential is proven.)
  5. **Merging the self-service and admin `revoke-all` into one endpoint
     with an optional parameter** — their subjects differ (bearer vs URL), their gates
     differ (zero permissions vs two), their audits differ. One route with three
     branches like that is three routes sharing a bug.

  **A seam change.** `defineTenantRoute` now hands `tokenHash` to its
  handler — the seam already computes that value for `authorizeInTransaction`, and
  deriving it a second time inside the route is how two derivations of one value start
  to disagree. A pure addition, zero call sites changed.

  **Continuation point — and one ordering constraint that MUST be read first.** Next is
  Wave 3 (the Cloudflare Policy shape — `awcms_access_policies`, User Groups,
  scope qualification), **the highest risk in the programme**. Both of its prerequisites are
  met and both were verified, not assumed: Wave 1 is complete
  (32/32 `src/pages/admin/**/*.astro` screens use `loadAdminScreen`,
  `ADMIN_SCREEN_CHOKEPOINT_MIGRATION` is EMPTY), and the grant-reader gate has
  locked its reader list.

  **PR 3.1 must not land alone.** It derives an EMPTY
  `awcms_access_policies` table with a `UNION ALL` reader — deliberately, so that
  its equivalence oracle can prove the result is identical to today's. But
  stopping there leaves a table nobody writes, which is **exactly the
  defect the previous round DELETED** in #477 (`awcms_sync_outbox`). So 3.1
  and 3.2 (the grant writers + `POST /api/v1/access/policies`) are one unit
  of commitment, not two PRs that merely happen to be consecutive — and if there is room
  for only one, do not start.

  #430 stays in Wave 7.

- **ROUND of 10 August 2026 (issue analysis) — #477 closed by DELETING
  its table, the #430 census completed, Wave 2 started.** Four PRs
  (#487/#490/#491 + this entry); one issue closed (#477); two stay open
  deliberately (#430, #423).

  **#477 — the question is not "how do we fill it".**
  [ADR-0077](adr/0077-one-outbox-sync-pull-reads-domain-events.md): `awcms_sync_outbox`
  is deleted (`sql/099`), `/sync/pull` reads `awcms_domain_events`. Its behaviour
  does not change — still a `200` with an empty list — what changes is **why**:
  from "there is no path" to "`SYNC_REPLICABLE_EVENT_TYPES` is empty".

  That allow-list is empty because **the mechanism is not right yet**, and that is the
  most valuable result of the issue: `event_sequence` is assigned at `INSERT`
  but becomes visible at `COMMIT`, so a cursor of `event_sequence > checkpoint` can
  **skip** an event whose commit was late — dormant in the old table because it had zero
  writers, REAL in `awcms_domain_events`. This repo already has the
  right answer, and it is not a cursor: `appendDomainEvent` writes a delivery row per
  consumer **in the same transaction**.

  **#430 — its census claims something false.** `looksLikeEmail` (the census)
  and `isMailableLoginIdentifier` (the password reset path) are two different
  sets: `a@localhost` is not an email according to the census but **can** be sent
  mail. The authoritative predicate is now **imported**, not copied, and a third
  category (`not_mailable`) is reported separately.

  **Wave 2 PR 2.1 landed** (#491): `GET`/`DELETE /api/v1/auth/sessions`,
  **zero new permissions**, plus three fingerprint columns (`sql/100`). A detail that
  is not in the plan: `hashClientIp` uses a per-process random key without
  `AUTH_IP_HASH_SECRET` — tolerable for an audit, NOT for a persisted
  column, so `persistableClientIpHash` returns `null` instead of a hash
  that cannot be compared after a restart.

  **Four corrections to the Wave 2 plan**, verified against the code:
  session issuance is **two** `INSERT`s through **five** entry points (not "three
  issuers"); `summarizeUserAgent` needs a `Request`, so each issuer
  computes it itself and passes it on; `access:permissions:enforcement:check`
  scores **208/208** (not 203/203); and `origin_auth: 'switch'` +
  `switchable` have **zero producers** today, so neither has landed.

  **What was REFUSED, with the reasons:**

  1. **Giving `awcms_sync_outbox` a producer** — this repo already has a
     transactional outbox; a second outbox that was never wired up is better
     deleted than filled.
  2. **Filling the replication allow-list with one event "to prove
     the mechanism"** — the mechanism is not right yet, and one entry would
     land a silent and permanent event loss.
  3. **A third identifier-keyed rate-limit bucket to close #430
     early** — the variant that really closes it (an identifier-ONLY key) hands
     an anonymous attacker the lever to keep one human refused login across ALL tenants,
     which is the EXACT objection already recorded when refusing a global lockout
     table; the safe variant `(ip, identifier)` is nearly inert on top of the
     per-source ceiling of #448 and buys the IMPRESSION that #430 has been handled.
  4. **`last_seen_at` on `awcms_sessions`** — one UPDATE per request per session
     on the authorization read path, forever, for a cosmetic column.
  5. **A `switch` value in the `origin_auth` CHECK** — a CHECK that contains a value
     nothing can produce reads as a capability that already exists.

  **Continuation point.** Wave 2 PR 2.2 (the admin surface for other people's sessions —
  `read` and `revoke` as TWO separate permissions), then Wave 3
  (the Policy shape). #430 stays in Wave 7; the number that determines its size
  (`principalsSpanningMultipleTenants`) can only be measured by running
  its census against production data — locally there are zero tenants, zero identities.

- **ROUND of 10 August 2026 (continued) — both #468 blockers decided, #468
  closed, and one concurrency defect found along the way.** Four PRs
  (#482/#484/#485 + this entry), two issues closed (#468, #483), one new issue
  filed (#483) from a finding nobody asked for.

  **What was decided, and why the two need different answers.**
  `TABLES_PREDATING_THE_RULE` cannot distinguish a table that has **not yet** been
  described from one that **cannot** be; both are one line, and while that
  is so its count stops being readable as debt.
  `awcms_edge_cache_purges` (#479) gets a second registry keyed by `ownerPath`
  ([ADR-0076](adr/0076-infrastructure-tables-may-hold-lifecycle-descriptors.md)),
  with `ownerOfFile()` — the same function
  `modules:table-writes:check` uses — deciding who may be in it;
  `awcms_sync_outbox` (#477) moves into `BOUNDED_BY_DESIGN` as its first
  entry, the only one whose premise is machine-checked.

  **One of the issue's own premises turns out to be wrong.** #479 wrote that nothing
  deletes from `awcms_edge_cache_purges`; `bun run edge-cache:purge` has been
  trimming `done` rows since ADR-0042. What was missing is the ability to
  DECLARE it. That correction changes the shape of the decision — from "write a purge"
  to "give the contract a way to name a non-module owner".

  **An unrequested finding: the login lockout is not atomic** (#483). The password path
  uses read-modify-write in JS, so K PARALLEL failed attempts cost ONE
  increment — measured against a real PostgreSQL: four attempts → a counter of
  `1`. Worse than the defect: **four documents state it is "atomic in the DB"**,
  one of them naming exactly the shape that should be avoided, and
  `rate-limit.ts` rests its Redis fail-open posture on that sentence.
  All fixed, and they now name the statement instead of the word "atomic".

  **A gate green on top of the wrong answer, twice.**
  `checkLoginLockoutImplemented` (severity `critical`) only calls a pure
  function — green for two years on top of a lockout that could be held at one; it now
  checks the mechanism. And every lockout test is pure domain, **zero** of them
  raise the counter through a real route, so its suite would never
  see either that defect or its fix.

  **What was REFUSED, with the reasons:**

  1. **Loosening `ownerModuleKey` to optional** — it saves one file
     and makes every module descriptor lose its guardrail: a descriptor
     that FORGETS to name an owner stops being an error and starts meaning
     "infrastructure". A typo becomes an ownership claim.
  2. **Assigning `awcms_edge_cache_purges` to one of its three writing
     modules** — already refused in the previous round; still refused.
  3. **Making `src/lib/edge-cache/` a module** —
     [ADR-0043](adr/0043-lib-boundary-and-module-presentation-layer.md) turns a
     `src/lib/<x>/` namespace that collides with a `moduleKey` red, and
     `scripts/module-job-registry-check.ts` already refuses "create a module for
     documentation convenience" for the same table. It stays open as an
     architectural decision, not as a way of turning a gate green.
  4. **A GLOBAL lockout table without RLS to close #430 early** — it
     hands an attacker a weapon that does not exist today: locking one human
     out of ALL tenants, from any tenant context, with no unlock endpoint and
     with a password reset that only clears `awcms_identities`. #430
     waits for Wave 7, and the `identity:principals:preflight` census that
     determines the size of the real multiplier has not been run against production data.
  5. **Changing the `/sync/pull` operation description in OpenAPI** — the pre-migration
     contract snapshot is frozen and requires every path to be byte-identical. Its notice was
     moved into the TAG description, which is not frozen and does render into
     `awcms/api-reference.md`.
  6. **Editing `awcms/repo-assessment-2026-08-04.md`**, which repeats the
     "atomic" claim — it is a dated note, and editing an old finding is
     falsifying the record.

  **Continuation point.** Wave 1 of the membership model programme is **ALREADY CLOSED** (#450,
  33 screens, two ledgers at zero) — its programme document is corrected in this PR because it
  still promised a helper called `defineAdminScreen` that never existed.
  Next is **Wave 2** (the session & credential surface). #477 stays open
  for a wire-it-up-or-retire-it decision; #430 is scheduled for Wave 7.

- **ROUND of 10 August 2026 — the push notification programme (#463) is complete, outbox
  retention is 4 of 6, SSE landed with its ADR.** Twelve PRs, all
  merged; five issues closed (#464, #465, #466, #467, partly #468) and three
  new issues filed because their findings are not leftover work but
  decisions not yet taken.

  **Why the list is HERE.** The same rule as the previous two
  rounds: a list that is not written into the repo has to be derived again, and
  deriving it again costs a full audit while writing it down costs
  one paragraph. The refusals are written down too, because a refusal that is not recorded
  will be proposed again.

  **What landed.** The `push_delivery` module, complete: a SECOND lease-carrying outbox
  (ADR-0074), FCM HTTP v1 and Web Push/VAPID adapters with not one new dependency,
  five endpoints, a same-origin service worker, and the
  `/admin/push-notifications` console — the module moved `experimental` → `active` only
  after its console existed, because ADR-0021 criterion 1 refuses an `active` module without
  an admin screen, without exception. Then retention for four outbox tables
  (`email` ×2, `object_sync_queue`, `domain_event_deliveries`), all
  `delegated`. Then SSE with ADR-0075.

  **Six things that were only discovered by RUNNING it, not by reading**, and that is
  the part of this round most worth remembering:
  - **`bun run check` fully green with a migration that cannot apply.**
    `ADD CONSTRAINT … UNIQUE (tenant_id, id)` was placed after the child table that
    references it. All 37 gates passed; only `db:migrate` against a real
    Postgres showed it.
  - **`isBlockedAddress` fails closed for anything that is not an IP literal.**
    Called directly to validate a push endpoint, it refuses EVERY real push
    service — registration would be impossible, with an error message naming
    a private address.
  - **The FCM error mapping order is reversed relative to its own docblock.**
    `status === 401` is checked before the error code, so `THIRD_PARTY_AUTH_ERROR`
    is reported as an expired token.
  - **`withTenant` RETURNS a `Response` when the pool refuses, it does not throw.**
    The first design of the SSE loop only had a `catch`, which means the main refusal
    path was missed.
  - **`awcms_sync_outbox` has ZERO producers** (#477) and
    **`awcms_edge_cache_purges` is owned by infrastructure, not by a module** (#479).
    Both look like tables that have NOT YET received a retention descriptor; both
    are actually tables that CANNOT — and that difference is invisible from the ledger.
  - **`check:docs` is blind to a new document.** It reads `git ls-files`, i.e.
    the index, so ADR-0075 passed locally with a broken link and then turned CI red.
    Green locally then red in CI is a gate failure: it trains people
    not to trust their local run. Closed in the same PR.

  **What was REFUSED, with its numbers, so it is not proposed again:**
  - **The FCM Web SDK** (ADR-0074 §What was REFUSED) — 45,041 B on the page + 46,292 B in the
    service worker against a ceiling of 21,000 B per file, and three third-party
    origins against a CSP that locks in zero (ADR-0029). Web Push/VAPID gives the same
    result with **10,174 B** in total and **zero** new origins.
  - **A short connection TTL + reconnect** as an alternative to per-tick re-authorization
    (ADR-0075) — it moves the question instead of answering it, and trades
    one number that has to be kept consistent for two.
  - **A `push_delivery.subscriptions.*` permission** — registering your own device
    is self-service; a permission for it is a wall in front of
    the feature, and an action that is not seeded refuses everybody including the owner
    (the latent-authz trap, ADR-0058 §E).
  - **Assigning `awcms_edge_cache_purges` to one of the three modules that
    write it** so that its gate turns green — a descriptor naming the wrong
    owner is a false claim that reads as a decision.
  - **A retention descriptor for `awcms_sync_outbox`** — a fiction twice over (a status
    predicate that never matches, on a table that cannot grow) and it would
    take that table out of the ledger, i.e. out of everybody's sight.

  **What remains from this round:** #468 waits on the #477 and #479 decisions
  before it can be closed; both are product/architecture decisions, not work
  left to be done.

- **RECOMMENDATION ROUND of 9 August 2026 — the membership model programme
  (Cloudflare-shape). Full design:
  [`awcms/program-model-keanggotaan-2026-08-09.md`](awcms/program-model-keanggotaan-2026-08-09.md).**
  A two-sided mapping against the Cloudflare _Manage members_ + _Tenant
  API_ documentation gives an unexpected answer: **this repo's authorization engine is stronger
  than Cloudflare's** (ABAC deny-overrides, SoD, FORCE RLS, the decision log,
  37 gates — Cloudflare has not one of the first four). What
  is missing is **the shape of its membership** — the layer that makes a system
  sellable as a service. ±43 atomic PRs in 9 waves.

  **Nine verified findings that shaped the design.** The most
  decisive, because each of them kills an "obvious" approach:
  - **184 route files call `authorizeInTransaction` directly** (255 in total;
    only 16 through `defineTenantRoute`) — so every new input must go through the
    `options?` bag, never a positional parameter.
  - **`scripts/access-chokepoint-check.ts` pins the literal
    `fetchGrantedPermissionKeys(`.** Renaming that function makes the gate
    **green and blind** — the defect class already recorded as R9 below. The name
    is kept; it is its return type that changes.
  - **`awcms_tenants.status='suspended'` was never enforced outside login.**
    A tenant's public site dies immediately, but an already-issued admin session keeps
    full access until it expires by itself, and machine credentials are
    untouched. This asymmetry is a live defect, and closing it is nearly free.
  - **The login lockout is per-`(tenant, email)`** — rotating the
    `x-awcms-tenant-id` header gives an attacker N × `AUTH_LOGIN_MAX_ATTEMPTS` against
    the same human. The global principal fixes it, it does not burden it.
  - **`awcms_business_scope_assignments` (`sql/027`) already has every column
    a Cloudflare Policy needs** — it is a Policy table that just happens to
    have only ever been pointed at one kind of subject. And its coverage today is
    **permission-agnostic**: it asks "is there a scope fact that covers this?",
    never "for THIS permission". Closing that is a one-clause change
    that can only refuse more.
  - **`awcms_abac_decision_logs` has no retention at all** (~8.6 million rows/day
    @100 rps) **and** is the cursor source of the `reporting` projection whose
    description calls it "never deleted". Retention and projection authority
    are **one** decision. In addition: `sql/022` only grants `awcms_worker`
    SELECT, so a purge job today would not be able to delete anything.

  **Four decisions that lock the scope:** (1) the target is a **global principal**,
  executed as an authority lift that does not move a single foreign
  key; (2) Cloudflare is used as a **MODEL, not an integration target** —
  the partner Tenant API is not built; (3) the commercial layer is **complete**, including
  partner/EaaS; (4) start from **Wave 0**.

  **Wave 0 — DONE, ten PRs landed (epic #423).** Nothing
  widened; everything tightened. Each PR with the FULL `bun run check` green:

  - **#433** (#424) — `api:tenant-route:check` gets `SCAN_ROOTS`, so it
    sees `src/pages/admin/**/*.astro` too. **32** screens were seeded into the ledger,
    not 31: the issue miscounted because `src/pages/admin/tenant/domains.astro`
    nests one level deeper and escaped `ls src/pages/admin/*.astro`. The
    zero-file guard becomes **per root** — a root that finds not a single file
    is a blind gate, not a passing one.
  - **#434** (#425) — the `ownershipGrant` assertion becomes structural (exactly one
    `allowed: true`, its index > the index of `evaluateAccess(`), and the gate
    refuses `deciding.length === 0`. Previously it could report "0 handlers
    decide the permission" and then exit 0.
  - **#435** (#426) — the new gate `access:decision-log:coverage:check` (chain
    36 → 37 segments). **Lexical dominance, not an ordering regex**: a log that is
    textually earlier but sits in a sibling branch does not count.
  - **#436** (#427, **ADR-0072**) — `sql/091` grants `awcms_worker` the
    `DELETE` right; a 365-day retention descriptor. The projection authority dispute
    is settled in the same document: incremental is authoritative for all time,
    a rebuild is authoritative **from the retention horizon onward**.
  - **#439** (#429, **ADR-0073**) — `suspended` is enforced at the chokepoint for
    sessions AND machine credentials, plus one line in `resolveSsrContext` that
    covers all 32 screens. `sql/092`.
  - **#440** (#430) — `identity:principals:preflight`. **A census, not a
    fix**: #430 stays open until Wave 7.
  - **#441** (#431) — R8 **CLOSED**, and **with no migration**: its constraint is about
    which tenant may hold a platform permission, not about roles.
  - **#443** (#442) — `scripts:inventory:check` compares the generated block,
    not only its lines. Found **while merging this wave**: two PRs
    wrote identical count sentences from different bases, git merged
    their lines and left their sentences alone — a half-correct block without a single
    conflict. The old gate covered exactly the part git cannot mis-merge.
  - **#444** (#438) — the rate-limit client IP is counted from the **right** of
    `X-Forwarded-For` (`TRUSTED_PROXY_HOP_COUNT`, default 1). Behind a proxy
    that APPENDS — which is this repo's production nginx profile — the leftmost entry
    is whatever the attacker typed.

  **Two corrections to its own plan, recorded because both save
  work.** The ASCENDING `(tenant_id, created_at)` index for the purge was not
  written after all (a PostgreSQL btree can be scanned backwards — the `DESC` index in `sql/005` already
  serves it; a second index only adds write load to the most frequently
  written table in the repo). The per-role `attachable_scope_types`/`permission_scope` columns
  for R8 were not written either (it would be inert — the same defect class as the one
  it closes).

  **And one issue I wrote up wrongly:** #428 reported that `identity_access`
  imports `resolveClientIp` from `visitor-analytics` — an ADR-0011 violation.
  Verification found **zero** violations: `resolveClientIp` is already in
  `src/lib/security/`, and `resolveAnalyticsClientIp` is only imported by its own module's
  routes. That finding was born of a `grep -rl` over two similar names. Closed as a
  false premise, replaced by #438 — which found something more important.

  **Two PRs afterwards, and both were born of INSPECTING the remaining issues —
  not of working on them.**

  - **#446** (#437) — the gate `data-lifecycle:table-coverage:check` (chain
    37 → 38). Its plan asked for a gate over HIGH-VOLUME tables whose list was
    derived. Three derivations were built and measured, and **all three failed**:
    append-only at the source (46 tables — `ON CONFLICT DO UPDATE` reads as an
    append), no delete path (94 — this repo uses `ON DELETE CASCADE` in
    exactly one migration), unbounded according to the schema (121 of 128 — a bounded table
    is keyed to curated text). A gate whose exceptions are 90% of the
    schema is a hand-written list in disguise. So the question was replaced:
    derive that a table **exists**, then make its obligation impossible
    to skip. 114 old tables sit in a ledger that may only shrink and
    whose length is pinned by a test; a new table must bring a descriptor or a
    reasoned exception.
  - **#448** (#447) — a per-SOURCE rate limit ceiling for seven public auth routes.
    Found while inspecting #430, and **sharper than #430**: the bucket key
    is the raw `x-awcms-tenant-id` header, so it is chosen by the attacker and
    the limiter does not bind at all — while every request that gets through
    still pays for argon2id `m=64MB`. Proven inert on a single tenant, so it
    landed without a flag. There turned out to be **seven** routes, not six; it was its
    structural test that found the seventh after the first six had been converted
    by hand.

  **#430 shrinks, and one of its premises turns out to be too soft.** It wrote
  "N × `AUTH_LOGIN_MAX_ATTEMPTS`"; the real effect is not a multiplier but
  the removal of the limiter (#447). Two of the three multiplication axes are now closed —
  `X-Forwarded-For` rotation (#444) and tenant header rotation for the rate-limit
  bucket (#448). What remains is exactly one: the **lockout** counter per `(tenant,
email)`, which cannot be made global without `awcms_principals`. Patch it
  with a Redis counter? Deliberately not — `checkSharedRateLimit` **fails open**
  when Redis is in trouble, so the control would die exactly when it is needed.
  Wave 7 PR 7.2.

  **Refused, and the refusals are part of the result.** Building a Cloudflare Tenant API
  provisioning module (it demands a signed partner
  agreement; its credentials can permanently delete a customer account — a blast
  radius of another category, so a second module, not an extension of the existing DNS adapter).
  Adding a `partner` value to `ModulePermissionScope` (`scope` governs who
  may _hold_ a permission; a partnership governs _which objects_ it
  touches — merging them produces a permission that is held correctly
  and executed against the wrong tenant, with not a single RLS policy
  objecting). Adding `subject.groups` and `subject.entitlements` to the ABAC
  allow-list (a group is modelled as a role granter so `subject.roles` suffices;
  an entitlement is a structural deny-only gate, and exporting it gives two
  answers to one question). Bundling the real `env.ipTrusted` wiring
  into any PR (it is a live authorization change disguised as
  infrastructure work). Creating 43 issues up front instead of per wave
  (a backlog that ages in a dangerous direction — the defect class already recorded in #289).

- **RECOMMENDATION ROUND of 8 August 2026 — R1–R10, six landed, four remain.**
  An audit on six axes (documents-vs-code, surface-without-UI, blind gates,
  backlog-vs-code, security/authorization, `awcms-astro` interop), every finding put through
  a sceptical verifier: **24 survived → 10 work entries**.

  **Why the list is HERE and not in a session note.** This round began
  by re-deriving the recommendation list of the previous round — because that list
  was never written into the repo, and the five PRs that landed from it (#411–#415)
  could only be read back out of the commit messages. Writing it down here costs
  one paragraph; deriving it again costs one audit.

  **Landed (fully green, each PR with the FULL `bun run check`):**
  - **R1** (#416) — `registration_requests.approve` could grant `owner`.
    A principal holding only `{read,approve}` could mint an account with the full
    catalogue, and `owner` appeared in the `/admin/registrations` dropdown. Closed +
    a gate for its class (`tests/access-assignment-writers.test.ts`: every writer of
    `awcms_access_assignments` must read `is_system`).
  - **R2** (#417) — five DB-gated files (**36 tests**) were never executed by
    any pipeline: MFA lockout/replay, cross-tenant OIDC, Turnstile in the
    login handler, office response conformance. The explicit lists in both workflows had
    drifted since #188–#191. A two-way parity gate + both workflows fixed.
    The legacy suite 10→15 files, 64→100 tests.
  - **R4** (#418 + #419) — `/news/**` was still "alive" in AGENTS.md (the first file
    every agent reads, **scheduling work that is already done**),
    in ARCHITECTURE, in this document, in standar-performa, and in skill frontmatter; three
    inert edge-cache surfaces; and its own gate pinned four FILE NAMES,
    so an `index.astro` could bring it back to life without a single assertion
    moving (verified: 9 pass/0 fail).
  - **R5** (#420) — `skills:check` rule 5: every backticked `/admin/…` URL
    must resolve, and its corpus includes `src/modules/<name>/README.md`.
  - **R6** (#421) — `bun run admin:screen-coverage:check`: **32 screens claim
    133 of 203 permissions**; 16 reasoned decisions, **54 in a one-way ledger**
    (`scripts/admin-screen-coverage-ledger.ts`) that may only shrink.

  **Remaining, in order of consequence.** Their details (evidence, fix, the gate that
  must land with them) are in the body of the PR that names their number:
  - ~~**R3 — admin screens decide with `ssr.permissions.has()` alone**~~ —
    **CLOSED** (issue #450, Wave 1, nine PRs: #451, #452, #454–#461).
    All 32 screens now decide in `authorizeInTransaction`, so when READING
    they no longer bypass `evaluateAccess` (a tenant's `deny` policy),
    `resolveModuleAvailability`, business-scope facts, SoD, and
    `recordDecisionLog`. Both ledgers — `ADMIN_SCREEN_CHOKEPOINT_MIGRATION` and
    the screen section of `NOT_YET_MIGRATED` — are **empty**.

    What to remember when touching this area again:
    - `loadAdminScreen` (`src/lib/auth/admin-screen.ts`) decides and reads
      inside ONE transaction. `authorize` accepts an **array = any-of** for the eight
      consoles that refuse only when ALL of their panels are refused; an empty array refuses.
    - The whole-file leniency is **closed for screens** and **kept for
      routes**. Found through a mutation: a screen that is routed but still reads
      `ssr.permissions.has()` for one affordance made its gate exit 0
      while reporting "1 still decide outside the chokepoint".
    - Two alarms became inert when the ledger reached zero and were replaced: the detector's
      self-test is now a **synthetic probe**, and the gate demands that every screen is
      genuinely ROUTED (not merely silent).

  - **R7 — machine credentials, email suppression, the homepage composer, with no screen.**
    They are now automatically visible in the R6 ledger, so it can land incrementally.
  - ~~**R8 — a platform permission could be granted through the role editor**~~ —
    **CLOSED** (#431). `listPermissionCatalog` now demands an explicit `scope`
    decision and `grantPermissionToRole` re-checks on the server with a
    409 `PLATFORM_SCOPE_REQUIRED`. Zero migrations: the constraint is about which TENANT
    may hold a platform permission, not about roles.
  - **R9 — five gates promise coverage they do not check**, e.g.
    `logging:lint:check`, whose `SCAN_ROOTS` misses `src/middleware.ts`
    and the whole of `src/pages` (an identical probe: `src/lib/` → EXIT 1,
    `src/middleware.ts` → EXIT 0).
  - **R10 — C7/RUM is recorded as "waiting on the product owner's decision"** even though
    ADR-0067 has been `Accepted` since 8 August 2026.

  **Refused, and the reasons are part of the result:** demanding a screen for all six
  `workflow.definition.*` (their absence is already a checked decision), rewriting
  §C of ADR-0066 (an ADR is a record at one point in time — a policy change =
  a new ADR), putting shell commands in `awcms-family-compatibility.yaml`
  (arbitrary execution from a data file into a gate), and widening the text gate
  to the whole of `docs/awcms/` (§10 already refused it).

- **FULL ASSESSMENT of 4 August 2026 — [`awcms/repo-assessment-2026-08-04.md`](awcms/repo-assessment-2026-08-04.md).**
  The repo was assessed against four axes (the AWCMS standards, the `awcms-astro` relationship,
  international performance, international security). Seven ranked recommendations.

  > **ROUND 1 DONE — six of the seven landed on the same day.**
  > ADR-0063 (#380) the per-handler chokepoint, postcss `overrides` (#381),
  > ADR-0064 (#382) the FK-index gate, ADR-0065 (#383) the frozen consumer contract,
  > ADR-0066 (#384) a rate limit shared through Redis, the query budget (#385).
  > The seventh — Core Web Vitals — deliberately did **not** land: it became
  > [ADR-0067](adr/0067-core-web-vitals-collection.md) `Proposed`, waiting on
  > the product owner's decision. The P0/P1 text below is kept as context;
  > do not read it as remaining work.

  > **ROUND 2 — thirteen new findings, [`§9 of the assessment document`](awcms/repo-assessment-2026-08-04.md).**
  > Re-assessed AFTER the six fixes were in. The top four, the ones that change the
  > backlog:
  >
  > 1. **DONE (commit 769292d7, gap C1 CLOSED).** The original text is kept
  >    as context: `scripts/validate-env.ts` now refuses production with
  >    `AUTH_COOKIE_SECURE !== "true"` — including when the variable is **not set**
  >    (fail-closed); the absent state is gated by `tests/validate-env.test.ts`.
  >    **`AUTH_COOKIE_SECURE` fails OPEN when it is not set.** The production rule
  >    in `validate-env.ts` only refuses the literal string `"false"`, while the
  >    runtime demands `"true"` — so a variable that is **not set** yields
  >    a session cookie without `Secure` with `config:validate` green. Its neighbour in
  >    the same file (`TRUSTED_PROXY_ENABLED`) does turn red when empty.
  > 2. **NOTE (5 August 2026): this finding is reframed, C3 is downgraded.**
  >    Production/staging readers DO in fact receive gzip — from Cloudflare, because
  >    both hosts are proxied (`Cloudflare (proxied) → Traefik :443 → varnish:80 → app`,
  >    [`awcms/environments.md`](awcms/environments.md) §Edge cache). What remains
  >    and stays true: this repo compresses nothing itself, its compression is
  >    inherited from a layer no gate checks, and a template
  >    deployment outside a compressing CDN gets no compression. Original text:
  >    **There is no response compression anywhere** — not in the application, not in
  >    `infra/varnish/default.vcl` (zero occurrences of `gzip`), not as a
  >    declared Traefik middleware. Meanwhile
  >    `edge-cache/response-headers.ts` already emits `Vary: Accept-Encoding`
  >    — a promise with nothing keeping it. Measured: the `dist/client` text assets 139 KB → 49.7 KB
  >    (2.79×), and HTML/JSON/sitemap compress better still.
  > 3. **NOTE (5 August 2026): BLOCKED externally.** `@astrojs/check`
  >    demands the TypeScript 6.x API while the repo is already on 7.0.2 — gap C4
  >    cannot be closed from here today; that state is recorded as a
  >    family divergence in ADR-0068 §C (`awcms-family-compatibility.yaml`,
  >    reviewDate 2027-02-04). Original text:
  >    **42 `.astro` files (22,328 lines) are never type-checked.** `tsc`
  >    cannot parse `.astro` and skips them silently; `@astrojs/check`
  >    is not installed. `awcms-astro` runs `astro check`; this repo —
  >    with far more `.astro` files — does not.
  > 4. **DONE (ADR-0068, gap C8 CLOSED).** `scripts/api-consumer-contract.ts`
  >    now separates `CONSUMED_PATHS` (3: `/api/v1/blog/posts`,
  >    `/api/v1/media/objects`, `/api/v1/media/public-origin`) from
  >    `COMMITTED_PATHS` (2: `/api/v1/auth/session`,
  >    `/api/v1/access/machine-credentials`, each entry carrying an ADR) — ADR-0065 +
  >    ADR-0068. Original text:
  >    **The consumer contract freezes six surfaces; `awcms-astro` calls
  >    three.** The list over there is extracted from the code **with comments stripped** and
  >    gated both ways; the list here was assembled by grepping that repo
  >    without stripping comments, so three entries froze calls that
  >    never happen (one of them was deleted by ADR-0018 in that repo).
  >
  > The control status moves to the document that was designed to be kept up to date:
  > [`awcms/standar-performa-dan-keamanan.md`](awcms/standar-performa-dan-keamanan.md)
  > — the control ↔ standard map (OWASP Top 10 2021 / API Top 10 2023 / ASVS 4.0.3 /
  > ISO 27001:2022 / ISO 25010 / NIST SSDF / RFC 9111 / Core Web Vitals), thirteen
  > gaps with checkers, and the list of controls that are **deliberately refused**.
  - **P0 (DONE, ADR-0063) — one route BYPASSES the authorization chokepoint.**
    `POST /api/v1/blog/posts/{id}/submit-review` does not call
    `authorizeInTransaction` at all; it assembles its own path
    (`fetchGrantedPermissionKeys` + `evaluatePostUpdateAccess`). What it skips:
    the **ABAC evaluator** (`evaluateAccess`), the platform-scope gate (ADR-0053),
    business-scope facts (ADR-0060), and SoD (#181). Its concrete consequence —
    **an ABAC `deny` policy on `blog_content.posts.update` is honoured in
    `PATCH /{id}` and silently ignored on this route.** Moderate severity (a narrow blast
    radius, RBAC + the ownership rule still apply); what is serious is
    its CLASS. `access:permissions:enforcement:check` cannot see it: it
    asks "does this permission have an enforcer", not "does every enforcement
    site use the chokepoint" — an exact repeat of the PR #351 lesson.
    Its fix has two parts: route it through the chokepoint, AND gate the class.
    The set of violators today is **exactly two** files, one of which
    (`auth/login.ts`) is genuinely pre-authentication — so its exception list is born
    with one entry.
  - **P1 (DONE, ADR-0065) — the contract `awcms-astro` uses is guarded by no test at all.**
    The frozen OpenAPI snapshot is a **PRE-#182-migration** snapshot, while the five
    surfaces that repo actually consumes landed AFTERWARDS
    (`/auth/session`, `/media/objects`, `/media/public-origin`,
    `/access/machine-credentials`, and the `/blog/posts` traversal). Verified: zero
    occurrences in the snapshot file. Changing the response shape of one of them is **green in
    CI here and breaks the build over there** — a failure that appears where the person
    who caused it does not look. The fix: a second CONSUMER contract snapshot
    (do not extend the pre-migration one — its job is different and it must stay frozen).
  - **P1 (DONE, ADR-0066) — the rate limiter does not survive across instances.** `src/lib/security/rate-limit.ts`
    uses an in-process `Map` (its own file records this): with N replicas the
    effective limit becomes N × the configured limit, so the deployment that most
    needs the protection is the weakest. Redis is ALREADY in the repo. Three authentication
    endpoints had no limiter at all (`session-handoff/issue`/`redeem`,
    `sso/{providerKey}/callback`) — completeness, not a hole (each has another
    mitigation), but ASVS demands anti-automation across the whole auth surface.

  This assessment note **NO LONGER APPLIES** and its numbers must not be used. The original
  text is kept below as context. The performance status that does apply is
  in [`awcms/standar-performa-dan-keamanan.md`](awcms/standar-performa-dan-keamanan.md)
  §8 "Performance gates: from one to four surfaces" — the **only**
  place that count is maintained. Duplicating it here is what makes it
  stale: this paragraph contradicts §4 in the same file, which already records
  that the query budget landed, and `query-budget-admin.integration.test.ts` already
  covers the sitemap builder that is described below as having no budget.

  > Original text: "of the **34** gates in the `check` chain (per the §2 table, which is now
  > generated), **one** checks performance (`db:fk-index:check`). The query
  > budget (#385) lives as a **DB-gated integration test**, not as a chain
  > gate — on a machine without PostgreSQL it is `skip`ped and `bun run check` stays
  > green. Its coverage is also only the public blog read path: 31 admin screens and
  > the sitemap builder have no budget."

- **Admin screens that are still empty (a direct continuation of ADR-0051).** The second wave
  (PR #335–#338, 2 August 2026) closed FOUR of the seven — re-verify with
  `grep -L 'navigation:' src/modules/*/module.ts`, not from this list:
  - ~~`reporting`~~ **DONE (#335)** — `/admin/reporting`. Not a second dashboard:
    `/admin` already renders four of the five views, so this screen takes the whole
    projection/export engine of Issue #753 **plus** `email-health`, the one view that
    was never rendered anywhere.
  - ~~`workflow-approval`~~ **DONE (#336)** — `/admin/approvals` (inbox + recovery
    - delegation). The six `definition.*` permissions were **deliberately left out**: composing
      a node graph needs a real editor, and a JSON textarea that accepts a broken graph
      until `publish` refuses it is worse than nothing at all. A contract
      test enforces that none of the six leak into this screen, so that separation
      stays a decision, not a gap.
  - ~~`domain-event-runtime`~~ **DONE (#337)** — `/admin/domain-events`.
  - ~~`sync-storage`~~ **DONE (#338)** — `/admin/sync`.
  - ~~`blog-content`~~ **DONE (#340)** — `/admin/blog`, the post lifecycle console
    (eleven permissions out of **41** — not 43: `sql/089` REVOKED
    `blog_content.seo.configure` and `.posts.export` when ADR-0058 emptied
    the exception list of the permission gate). The rest wait for its sibling screens
    (pages, taxonomy, presentation, settings, homepage) — **`pages` turned out
    to need its surface first**, see the ADR-0057 entry below. One absence
    gated by a contract test: `search.read` has a route, but the admin list
    already has a search of its own that tolerates an empty query. (`posts.export`
    used to be the second absence here; it no longer exists to be absent — revoked by
    `sql/089` precisely because no endpoint enforced it.)
  - ~~`media-library`~~ **DONE (#345)** — `/admin/media`. And this is not merely a
    screen ([ADR-0056](adr/0056-media-library-admin-surface.md)): five of its eleven
    permissions were enforced by nothing (`attach`/`detach`/`delete`/`restore`/
    `purge`), five application functions had zero callers, and there was no
    `list*` function at all — `GET /api/v1/media/objects` demands `?ids=`, it is a batch
    resolver for the `awcms-astro` build. ADR-0056 splits it in three: revoke
    `attach`/`detach` (obsolete since the ADR-0036 inversion), give
    `delete`/`restore`/`purge` a surface (a real hole), add a list route of its own. The screen
    follows AFTER all three.

    **Progress: §A + §B DONE.** §B gives `delete`/`restore`/`purge`
    guarded, audited endpoints carrying an `Idempotency-Key`
    (`DELETE /api/v1/media/objects/{id}`, `.../{id}/restore`, `.../{id}/purge`).
    Zero `media_library` permissions are now ungated. `purge` purges the
    REGISTRY only — the reconciliation job remains the only writer of the bucket — and
    runs inside a SAVEPOINT because the hard FK from
    `awcms_news_portal_ad_placements` makes a `23503` ABORT the transaction
    (without the savepoint, an actionable 409 turns into a 500 at
    COMMIT).

    **§C is DONE too.** `listMediaObjects` (keyset, 50/page) +
    `GET /api/v1/media/objects/list` — its OWN route, not a dual mode on
    `?ids=`. Previously the application layer only had a point lookup, so a browse
    screen genuinely COULD NOT be built on the old surface, whatever its
    permissions said. This list deliberately GOES BEYOND the resolver's safe rule (any
    status, plus soft-deleted when asked): it is precisely those unhealthy objects that
    make an administrator open it. `/list` cannot collide with an id because
    the `/{id}` route now demands a uuid. The cursor carries microsecond-precision text —
    an integration test inserts 107 rows in ONE statement and then walks
    every page; putting the cursor back to a `Date` loses 57 rows (the
    #158 trap, and the media registry is the likeliest place for it to recur).

    **The screen (#345).** An object lifecycle console: filtered browse, then
    delete/restore/purge — four permissions, every mutation carrying a fresh
    `Idempotency-Key` (no opt-out like `/admin/blog`, and no endpoint that
    refuses the header like `/admin/sync`). THREE deliberate absences, gated by a
    contract test so they stay decisions: **upload** (`create`/`verify`/`cancel`)
    — a three-step flow in the browser, and a button that starts a session but cannot
    finish it leaves a `pending_upload` row on every misclick;
    **`enforcement.*`** — a ONE-WAY tenant policy switch, not an object action,
    whose place is `/admin/security`; and **no `<img>` preview** — a row can be
    `pending_upload`/`failed`, its bytes may not exist, may be unverified,
    or may be exactly the thing the operator is deleting.

    **ADR-0056 IS ENTIRELY DONE, and with it ADR-0021 criterion 1 has zero
    unintended exceptions** — `idn-admin-regions` is the only module without a
    screen, and that is a decision (ADR-0052). This screen's contract test also
    enforces it across modules, so the next module that lands without
    `navigation` turns CI red instead of silently adding an exception.

    > **A side finding, already fixed in the same PR.** The Postgres SQLSTATE
    > is on `error.errno`, NOT on `error.code` — Bun fills `code` with
    > a constant of its own (`ERR_POSTGRES_SERVER_ERROR`) for ALL server
    > errors. So `error.code === "23505"` is not a slightly wrong check but
    > a check that can NEVER be true. Ten sites in this repo are already right
    > (`String(error.errno)`); one is not: `tenant-provisioning.ts` —
    > `POST /api/v1/tenants` promises a 409 for a duplicate `tenant_code` but
    > serves a 500 in the race case (the pre-check SELECT covers the ordinary case).
    > Found by PROBING a real database, not by reading; gated by
    > `tests/postgres-sqlstate-detection.test.ts`.

    **§A DONE.** `sql/087` revokes `attach`/`detach` from the catalogue
    and from every role grant; two zero-caller functions were deleted. The module now
    declares **9 permissions (7 `media.*` + 2 `enforcement.*`)**, and only
    **three** remain ungated: `delete`/`restore`/`purge` — all
    covered by §B. The `attached` status was deliberately NOT revoked with them (the `sql/041`
    CHECK still accepts it, old rows still resolve); all that is gone is the ability
    to write it. The first edition of ADR §A wrote "the five dead functions are deleted" —
    wrong, that collides with §B, which actually uses three of them;
    the ADR has been corrected.

    > **A correction to the number above.** The previous entry (#339) wrote "**six**…
    > including `verify`". That is wrong: `media.verify` IS GATED — inside the
    > application function `media-finalize-upload-session.ts`, not in a route file. Scanning
    > route files alone gives a wrong answer in both directions at once, because
    > `media-object-directory.ts` is also full of `action: "..."` strings that are
    > AUDIT action names, not permission gates.

  - **`blog-content` — four sibling screens remain, and `pages` is NOT one of
    the screens that is merely missing its page** ([ADR-0057](adr/0057-blog-page-lifecycle.md)).
    Auditing `pages.*` before writing its screen repeats the ADR-0056 finding, more
    sharply: **four of the eight `pages.*` permissions are enforced by nothing**
    (`publish`/`archive`/`restore`/`purge`), and unlike `media_library` —
    whose application functions exist but have zero callers — here the functions **do not
    exist at all**.

    The consequence is functional, not merely an idle permission: `createBlogPage`
    writes the literal `'draft'`, `updateBlogPage` never touches `status`
    or `published_at`, and `blog-scheduled-publish.ts` only reads
    `awcms_blog_posts`. **There is no other writer of
    `awcms_blog_pages.status` anywhere in the repo — a page can never
    leave `draft`.** That is already live on the public surface: `blog-search.ts`
    filters the page branch with `status = 'published' … AND published_at IS NOT
NULL`, so a public search for pages **always** returns zero rows — on top of the index
    `awcms_blog_pages_tenant_status_published_idx` that `sql/035` built for exactly
    that query.

    ADR-0057 gives all four a surface (rather than revoking them — revoking
    `pages.publish` would bless that defect as design), with a lifecycle
    deliberately **narrower** than a post's: no `review`, no `scheduled`,
    because `sql/036` never seeded `pages.schedule`. `purge` **reports,
    it does not refuse**, the number of ad placements that become inert — the first draft of that ADR
    chose a 409, and `ad-placement-reference-validation.ts` contradicted it: that module
    had already decided that a target which disappears later "is not an error and never
    becomes one", and a soft delete today has exactly the same rendering effect.
    **Zero migrations** — the columns, CHECK,
    index and catalogue rows already exist; what is missing is purely the application layer + routes.
    The order binds: the surface first, `/admin/blog-pages` after.

    **ADR-0057 IS ENTIRELY DONE — three PRs, zero migrations.** The surface (#350):
    four guarded/audited routes carrying an `Idempotency-Key` through
    `defineTenantRoute`, plus `domain/page-status.ts` and three directory functions.
    The screen (#352): **`/admin/blog-pages`** drives all **eight** permissions,
    two views (live + bin), STRUCTURE editing (title/slug/type/menu order)
    rather than a body editor, with no re-parenting (the API has no cycle detection).
    Its contract test carries one forward-looking assertion: a NINTH seeded `pages.*`
    permission will turn CI red, because that is exactly how these four slipped through
    for months.

- **A bug found along the way, already fixed (#351).** The
  **Restore** button on `/admin/blog` (#340, six days earlier) **could never have
  worked**. `listBlogPostsForAdmin` hard-filters `deleted_at IS NULL` and
  that screen has no "deleted" filter, so Restore was hung off
  `status === "archived"` — a DIFFERENT axis. Its endpoint demands
  `canRestorePost` (`deleted_at IS NOT NULL`), so the button was rendered
  exactly on the rows guaranteed to 404 and never on the rows that would
  succeed. Its delete confirmation text even promises the opposite
  ("recoverable until it is purged"). Fixed with a `deletedOnly` filter
  in both admin list functions + a `?view=deleted` view on both screens.

  > **Gate §F did NOT catch this, and that is a limit worth knowing.** It
  > asks "does this permission have an enforcer" — and `posts.restore` does;
  > its endpoint exists and is correct. What is wrong is that the SCREEN calls it on the wrong
  > rows. That is the per-screen contract-test layer, and the contract test that existed
  > did not ask it. It asks now, on both screens, mutation-proven.
  > The general lesson: the permission coverage gate and a screen contract test answer
  > **two different questions**, and a control can pass the first
  > while being impossible to use.

- **The permission coverage gate — ENTIRELY DONE, its exception list EMPTY
  ([ADR-0058](adr/0058-unenforced-permissions-disposition.md), PR #359–#363).**
  `bun run access:permissions:enforcement:check` (ADR-0057 §F) demands that every
  declared permission has an `authorizeInTransaction` call site or is
  registered as a reasoned exception. Pure (registry + source text),
  part of the `check` chain. Score: **203/203 gated, 0 exceptions**.

  Its first six entries are used up, and **not one of them was excused**. ADR-0058
  splits them into two different classes — not one:
  - `profile_identity.profile_management.restore` — **A SURFACE** (§A, #361).
    A real hole: `party-directory.ts` exports `softDeleteParty` with no
    counterpart, so `restored_at`/`restored_by` (`sql/003`) could never be
    written and a soft-deleted profile was permanent.
  - `comments.moderation.delete` — **A SURFACE** (§B, #362). Its whole machinery
    has existed since ADR-0041 (a legal transition from all four non-terminal statuses,
    the queue can filter `deleted`); the only actor who could
    produce it was the comment's **author**.
  - `blog_content.seo.configure` — **REVOKED** (§C, `sql/089`). A SECOND
    authorization axis over columns `settings.configure` already governs.
  - `blog_content.posts.export` — **REVOKED** (§D, `sql/089`). Zero export machinery
    anywhere; building the feature to justify a catalogue row is the tail
    wagging the dog.
  - `visitor_analytics.settings.read`/`.update` — **NOT A GAP** (#359), see
    the note below.

  An **empty** list is worth more than a short one: the NEXT
  exception will be the only entry there, so it cannot slip past without being
  seen in the middle of a list that already looks settled.

  > **Its first score was 199/205 with 6 exceptions, and TWO of them
  > were bugs in the gate itself.** `visitor_analytics.settings.read`/`.update`
  > ARE **gated** — `src/pages/api/v1/analytics/settings.ts` builds
  > `READ_GUARD`/`UPDATE_GUARD` on exactly those activities. What was wrong: the scanner
  > read the constants of the whole repo as **one flat namespace**, while
  > `MODULE_KEY` is bound to **four different values across five files**, so
  > the rule "a conflicting name = unresolvable" killed it in **every** file
  > — including the file that binds it itself one line above its guard.
  > The written reason for both exceptions even stated, about a route that
  > exists, that "no route names a settings activity".
  >
  > This is exactly the warning written in the header of the scanner file itself,
  > and it was believed anyway. Draft 4 is now frozen as a test alongside the three
  > earlier drafts: constants are resolved **file-first**
  > (`resolveConstantsForSource`), and the cross-file table is used only for names
  > that file does not bind — which is exactly the set that can only arrive through
  > an `import`. A name bound TWICE inside one file stays
  > unresolvable; guessing there only trades one wrong answer for
  > its opposite. Mutation-proven at two layers: the helper AND
  > `evaluateEnforcementCoverage`, because a correct helper whose only
  > caller still passes the flat table would **look** fixed.
  >
  > The more general lesson, and this is the third time in this repo: a
  > gate that answers "ungated" about something that is gated does not stop
  > at one wrong report — it **gives birth to documents**. Both of those entries were written
  > as reasoned DECISIONS, not as findings awaiting verification.

  > **The gate itself needed three rewrites, and that is the lesson.**
  > Draft 1 only read string literals → **39 false positives**, including three
  > permissions whose endpoints landed that same week (many modules write
  > `moduleKey: THEMING_MODULE_KEY`). Draft 2 matched the innermost braces →
  > every guard with a nested field was invisible (`workflow.approval.approve`).
  > Draft 3 demanded a literal action → two conditional guards
  > (`comments.moderation.approve`/`.reject`) were missed. A scanner that answers
  > "ungated" about something that is gated is WORSE than no
  > scanner: it trains its readers to add exceptions until the gate asks
  > nothing at all. All three drafts are frozen as tests in
  > `tests/permission-enforcement-coverage.test.ts`.

  The three remaining `blog_content` siblings (taxonomy, presentation, settings/homepage)
  have complete surfaces — and that is now a **guarded** claim, not the result of a
  one-off manual audit.

  - ~~`idn-admin-regions`~~ **ALREADY HAS A SCREEN** — `/admin/idn-regions`, landed
    in #332. This entry previously read "deliberately without a screen"; that is **stale**,
    and it was repeated in the body of PR #345 ("the only module without a screen").
    Verified against the code: `grep -L 'navigation:' src/modules/*/module.ts` now
    returns **zero** lines. ADR-0052 moved its dataset LIFECYCLE into an
    operator job — not the whole module — and the two remaining read permissions
    are exactly what that screen drives.

  Follow the pattern of the #321–#330 wave in §3 — including the per-screen contract test, which is
  **mutation-proven** (restore the original defect and make sure it goes RED) before it is committed.

  **Two new lessons from the second wave, both applying to the next screen:**
  - **A module README can claim a screen that never existed.** `reporting/README.md`
    describes `/admin/reporting/projections` + a `submitJson` helper, and
    `workflow-approval/README.md` describes `/admin/workflows` —
    neither ever existed in this repo; the text came along with the port. Because neither
    module declares `navigation`, the `admin-navigation-registry.test.ts` gate
    that catches a dangling path **has nothing to check**. Docs are not
    gated the way descriptors are gated — so read a module README as a
    claim to be verified against `ls src/pages/admin/`, exactly like
    [[awcms-stale-skill-flips-direction]] for skills.
  - **The value of `Idempotency-Key` is not uniform across the repo but per endpoint, and
    a screen must copy that split exactly.** Three shapes have appeared already:
    `/admin/reporting` (five required, `reconcile` without one — it only appends a snapshot),
    `/admin/domain-events` (three ways: `replay` requires one because every call is NEW work,
    `pause`/`resume` do not because they are status transitions), and `/admin/sync` (ZERO — all three of
    its mutations are naturally idempotent status transitions). The contract test must bind
    that split **per request** (slice the string from its URL), not as a global
    header count, and at the same time assert that its endpoint still agrees.

- **The contract that was holding `awcms-astro` back — DONE (2026-08-01, ADR-0049, `sql/082`/`083`).**
  Read-only machine credentials + `GET /api/v1/auth/session`. A credential
  AUTHENTICATES, it never AUTHORIZES (it is bound to one service account;
  the module-enabled → RBAC → ABAC → decision log → SoD chain is unchanged); its
  effective permissions are the INTERSECTION with that account's permissions (narrowing, never widening);
  every one of its requests is refused except the `read` action, decided **before** permissions
  are even looked at. The token **carries its own tenant**, so a build client needs a single
  env var — that closes the ADR-0047 header defect for builds without adding a header
  alias (`x-awcms-tenant-id` remains the only spelling for a human session).
  Verified against a real Postgres: 83 clean migrations + 18 integration tests
  (permission intersection, read-only even when the account is `owner`, revocation/expiry,
  cross-tenant, a decision log carrying `machine_credential_id`, safe introspection
  claims). Recorded as a divergence in `awcms-family-compatibility.yaml`
  as it landed (ADR-0047 §4). **What remains in `awcms-astro`:** using that token in the
  BFF + the feed build.
- **The context of the defects it closes (ADR-0047, verified against staging).**
  (1) `resolveAuthInputs` reads `x-awcms-tenant-id` while `awcms-astro`
  sends `X-Tenant-Code`/`X-Tenant-Id` — every `X-Tenant-Code` value answers
  `400 TENANT_REQUIRED`; (2) **there was no credential a build could hold** —
  the bearer `/api/v1/blog/posts` accepts is a hashed **session** token, and the schema
  here has no machine token table at all. Closing (2) means the
  **machine credential** concept in `identity_access` — and the session introspection endpoint
  `GET /api/v1/auth/session` that [ADR-0045](adr/0045-jualanku-porting-awcms-system-of-record-astro-bff.md)
  had already decided (design in [`awcms/jualanku/05-kontrak-sesi-dan-bff.md`](awcms/jualanku/05-kontrak-sesi-dan-bff.md) §3)
  also needs it, so the two are **one design conversation**, not two.
  ADR-0048 stated that both had to be finished before the first internal screen in
  `awcms-astro` could call this repo. Both are now in the code (the entry above).
- **The wave that closed the `awcms-astro` contract — DONE (2026-08-01).** Five consecutive
  changes, each an atomic PR with full CI:
  - **#316** `bun run identity-access:permissions:backfill` — the `owner` role receives its permissions
    ONCE when the tenant is created, so every tenant older than a module gets a 403.
    Only permissions whose catalogue row is **newer** than the role are granted; older
    ones are treated as deliberately revoked and are reported, not restored. Dry-run by default.
  - **#317** a stable cursor for `GET /api/v1/blog/posts?order=created_at` — the feed build no longer
    stops at 100 posts. A `?cursor=` on top of `updated_at` ordering is refused with a 400: a keyset key
    that can change skips/repeats rows with no symptom.
  - **#318** `GET /api/v1/media/objects` — the media registry had no read endpoint at
    all, so an outside consumer knew a post had an image without being able to learn its URL.
  - **#319** deactivating a tenant user **revokes their session immediately** — `resolveTenantContext`
    never read `status`, so a deactivated user kept working until
    their session expired.
  - **[ADR-0050](adr/0050-bff-session-handoff-code.md)** — the BFF obtains a human session through
    a single-use handoff code; proxying the password was refused because login here is not one
    step (MFA/OIDC/Turnstile would have to be copied into a second repo). **THE `awcms` SIDE IS DONE
    (#347)** — `sql/088` (`awcms_bff_clients` + `awcms_session_handoff_codes`),
    `POST /api/v1/auth/session-handoff/issue` (self-service: the identity comes from the SESSION,
    never from the body) and `.../redeem` (a registered client, server-to-server, the only
    endpoint in this repo authenticated by a client secret). The code lasts ≤60 seconds, is single-use
    through `UPDATE … WHERE redeemed_at IS NULL`, its `redirect_uri` allow-list matches exactly,
    and its row stores `identity_id` + assurance — not a token — so no
    live credential is stored and an `aal1` login cannot be laundered into an `aal2` session.
    What remains belongs to `awcms-astro`: `/internal/login`, the server-side BFF session, the portal
    cookie, CSRF.

    > **A trap found by the integration test, not by reading.** `created_at` DEFAULT
    > `now()` is the instant the TRANSACTION STARTED, while `expires_at` is derived from the
    > application clock — two different clocks, so the CHECK `expires_at <= created_at + 60 seconds`
    > refuses a normal code as soon as the transaction has been open for a moment. The application now writes
    > both from one clock.
- **The OpenAPI tag catalogue & fragment ownership — DONE (2026-07-30).** The graphify finding
  of 2026-07-29 turned out to be **wider than reported**: it was not only `blog_content` that was
  missing from `docs/awcms/api-reference.md`, but **55 operations from four modules** —
  `blog_content` (30 paths), `visitor_analytics` (12), `tenant_domain` (7),
  `data_lifecycle` (6) — because the generator groups by the **declared** root
  tags, so an operation with an undeclared tag disappears without turning
  anything red. Fixed by adding those four tags, re-attributing the
  `News Media`/`News Portal *` tags to today's owners (`media_library`/`blog_content`;
  **the tag names & public paths were deliberately NOT changed** — ADR-0044 §3/§6 moves
  ownership, not the surface), merging `openapi/modules/news-portal.openapi.yaml` into
  the `blog-content` fragment, and repointing the `api.openApiPath` of `blog_content` +
  `media_library` from the BUNDLE to their own fragments. Two new gates in
  `api:spec:check` close the defect class in both directions: `collectTagCatalogProblems` (every
  operation has a tag, every operation tag is declared, **and** every declared tag is used)
  and `collectFragmentOwnershipProblems` (one fragment = one registered module; only
  `foundation.openapi.yaml` is exempt). The bundle did not change apart from the tag catalogue —
  zero paths, zero schemas.
- **The family is now Bun-only without exception (2026-07-29).** `awcms-astro` —
  the family's static site template, the fourth repo — was moved from Node 22 + npm to
  Bun (ADR-0015 in that repo): `bun.lock`, `bun:test`, `oven/bun` in the image,
  `setup-bun` in CI, Dependabot `package-ecosystem: bun`. A trap caught
  during the migration that applies to EVERY family repo: `bun run` resolves
  a name to a `package.json` script **before** `node_modules/.bin`, so a script
  named the same as its binary (e.g. `"astro": "bun --bun astro"`) produces
  unbounded recursion that dies as `E2BIG: Argument list too long` — a message
  that does not mention its cause at all.
- **Porting Jualanku.info ([ADR-0045](adr/0045-jualanku-porting-awcms-system-of-record-astro-bff.md), 2026-07-29).**
  `awcms` = the system of record + internal admin; `awcms-astro` = the experience layer + BFF.
  The full blueprint (architecture, merchant authorization, data model, API contracts, the
  cross-origin session contract, UI/UX, roadmap & compliance) is in [`awcms/jualanku/`](awcms/jualanku/README.md).
  **Status: P0 — there is not one `jualanku_*` module/table/route in the code yet.** The five planned
  bounded contexts (`jualanku_directory`, `jualanku_catalog_growth`,
  `jualanku_affiliate`, `jualanku_commercial`, `jualanku_trust_operations`) each
  still need an admission ADR. Two decisions that bind the implementation: **a merchant =
  a business scope** (filling the fail-closed NO-OP resolver, not adding a new ABAC attribute)
  and **the browser never calls `awcms` directly** (the BFF is in `awcms-astro`).
- **~~Absorb the awcms-mini backbone~~ — REVOKED as a pathway (ADR-0055).** What follows
  is now a **list of REQUIREMENTS, not a port list**: every capability is re-assessed
  and **built here** with its own admission ADR. That `awcms-mini` happens to
  already have an implementation is no longer a reason to build it — nor is it
  the design. The old context is kept below.
- **(historical) Absorb the awcms-mini backbone → awcms (the business foundation + SaaS control plane).**
  The execution map is in
  [`awcms/absorb-awcms-mini-backbone-roadmap.md`](awcms/absorb-awcms-mini-backbone-roadmap.md).
  **Audit finding of 2026-07-25:** five modules have been `Accepted` by an ADR in this repo but
  **have no code** — `organization_structure` (ADR-0016), `document_infrastructure`
  (ADR-0017), `data_exchange` (ADR-0018), `integration_hub` (ADR-0019), `reference_data`
  (ADR-0021); all five are mature in mini. [ADR-0020](adr/0020-erp-extension-readiness-contracts.md)
  (the ERP readiness contracts) is also `Accepted` without a `_shared` implementation. The SaaS control
  plane cluster (7 mini modules) **has not been admitted at all** here and needs a new admission ADR
  before a line of its implementation may be worked on.
- **Absorb awcms-micro → awcms (the main programme, [ADR-0035](adr/0035-awcms-online-first-erp-saas-superset-repositioning.md)).**
  The wave map & dependency order are in
  [`awcms/absorb-awcms-micro-roadmap.md`](awcms/absorb-awcms-micro-roadmap.md) — one atomic
  PR per module, adaptation (rename `awcms_micro_` → `awcms_`, migrations continuing from the next
  number after `sql/070`), passing `bun run check`. Progress:
  - **Wave 0 — DONE:** `tenant-domain` (#219), admin shell/chrome parity (#229).
    **NOT YET:** the `src/components/ui/` component library + design-token parity (#229 touched
    the admin shell, not a reusable component library). The descriptor contribution seams
    (`dataLifecycle`, the `seo_facts` capability, `searchSources`, `commentableResources`) landed
    throughout Wave 1; `newsletterContentSources` has not.
  - **Wave 1 — DONE:** `visitor-analytics` (#220), `media-library` (#221, the ADR-0036 inversion),
    `data-lifecycle` (#222, ADR-0037), `seo-distribution` (#223/#224, ADR-0038/0039 — discovery
    **and** redirect governance, COMPLETE), `form-drafts` (#230), `site-search` (#231, ADR-0040).
    `comments` ([ADR-0041](adr/0041-comments-module-admission.md), `sql/066`–`067`).
    **NOT YET:** `newsletter`, `social-publishing` (which activates the publish hook that is
    currently a no-op in `blog-content`).
- **Deployed environments — DONE, three equalised phases.** Production
  `awcms.ahlikoding.com`, staging `awcms-staging.ahlikoding.com`, and
  local development are now identical: migration **70**, 118 tables, 197 permissions, RLS
  `ENABLE`+`FORCE` on 109/118, the runtime as `awcms_app` (not a superuser), owner
  `admin@ahlikoding.com` with the `owner` role at 197/197 (those numbers are a snapshot from when
  the phases were equalised; as of 5 August 2026 the repo holds **90** migrations and **203**
  permissions — verify with `ls sql/` and the catalogue, do not quote from here), and
  `PUBLIC_DEFAULT_TENANT_*` pinned per phase. Isolation was proven as
  `awcms_app` (`0 / 1 / 0`), not assumed. The DB-gated suite runs in dev
  (harness 142 + legacy 64, zero failures). Details and its traps are in
  [`awcms/environments.md`](awcms/environments.md).
- **The Varnish edge cache ([ADR-0042](adr/0042-varnish-edge-cache-auto-activation.md), `sql/068`).**
  An OPTIONAL cache tier in front of the application, OFF by default and a no-op while off. A fail-closed
  surface allow-list (`src/lib/edge-cache/`), automatic activation based on origin pressure,
  a default-deny VCL (`infra/varnish/`), a durable invalidation queue + the
  `bun run edge-cache:purge` worker, the `bun run edge-cache:surfaces:check` gate.
  **DONE since #246:** purge emission from `theming` (publish/rollback/retire, in one
  transaction with the change) and the ownership gate — every module that owns a
  declared surface MUST have a purge call-site. Details in
  [`awcms/edge-cache-architecture.md`](awcms/edge-cache-architecture.md).

  **Host-resolved surfaces may be cached ([ADR-0061](adr/0061-host-resolved-public-surfaces-are-edge-cacheable.md)).**
  What was found while doing it is bigger than "one route family is not
  cached yet": **the number-one tenant source of ADR-0042 §8 never had a writer.**
  `locals.edgeCacheTenantId` is declared in `src/env.d.ts`, read by
  `src/middleware.ts`, preferred by `resolveEdgeCacheTenantId` — and zero routes
  ever assigned it, so that branch has been unexecutable since ADR-0042
  landed. The consequence is the exact reverse of the ADR-0059 direction: the edge cache speeds up
  `/blog/{tenantCode}/**` (the legacy shape) and **does not touch** a single
  host-resolved surface.

  **ENTIRELY DONE.** §A — the `/news/**` family (3 entries, owned by
  `blog_content`) — **those entries were later REVOKED**: ADR-0071 deleted their routes,
  and all three surfaces survived a few days longer than the routes
  they served. Inert, not dangerous (`requiresTenant` fails closed) —
  but an inert entry is standing permission for a SHARED cache to store
  a path nobody serves, and a gate that reports OK over 11
  surfaces reads as coverage of 11 things, not 8. `edge-cache:surfaces:check`
  now refuses a surface whose owning module declares no serving route.
  §B — the six root discovery routes (`seo-robots`/`seo-sitemap`/
  `seo-feed`); `serveDiscovery` receives `locals` and publishes after
  `build(ctx)` has produced a payload, so `/sitemap-99999.xml` matches the pattern but
  never publishes a tenant — walking page numbers cannot fill the cache.

  **A §B finding that applies to every aggregate surface to come: a discovery
  body has TWO writers.** Its configuration belongs to `seo_distribution`
  (`PUT /api/v1/seo/config` now purges), but its CONTENT is aggregated from every
  `seo_facts` provider — publishing a post changes `/sitemap.xml` without touching
  a single row belonging to `seo_distribution`, and a module purge tags
  `t:<tenant>:m:<moduleKey>`, so a `blog_content` purge does not reach it.
  Without a fix: `/blog/{code}/feed.xml` is purged on publish while
  `/feed.xml` — the same content, the host-resolved spelling — stays stale until its TTL, with not one
  report. `enqueueModuleContentPurge` now also purges a module that
  `consumes` the changed module AND owns a surface: read from the REGISTRY (so
  `blog_content` never names `seo_distribution`) and limited to surface
  owners (a ban for a key that tags no object at all = ceremony that looks
  like coverage, the same rule already used for `media_library`).

  > **Two traps that cannot be read out of the code, both now enforced by tests.**
  > (1) The prerequisite "the VCL hashes `Host`" is **two** properties: `hash_data(req.http.host)`
  > EXISTS, but that sub must also NOT `return (lookup)` — a custom sub that
  > `return`s ends the chain, so the `vcl_hash` of `builtin.vcl` (which
  > hashes `req.url`) never runs, and every path on one host collapses
  > into ONE cache entry. Adding that line reads like completing the
  > subroutine. (2) **When** a route publishes the tenant is a disclosure
  > question, not a style one: a 404 may be cached, so publishing before the
  > "post/term does not exist" branch makes a missing-resource 404 carry `Surrogate-Control`
  > while an unknown-host 404 carries `private, no-store` — answering "does
  > this hostname map to a live tenant?" from ONE request, through a second
  > channel onto the question `padUnresolvedHostRouteLatency` was built
  > to close. One line a few lines too high; it still compiles,
  > still serves the right HTML, passes every functional test.
  - **Wave 2 — ITS CORE IS DONE:** the auth/admin delta. **DONE:** per-tenant sidebar arrangement
    (#272, `sql/071`–`072`); **password reset by email** (`sql/073`) — two enumeration-safe
    public endpoints + `/forgot-password`/`/reset-password`, single use enforced with a row
    lock, a reset revokes every session, an SSO-only identity is refused on the request path AND
    on the redemption path, delivery through the `auth_notification` capability port (not a cross-module
    INSERT into `awcms_email_messages`); **self-registration with admin approval** (`sql/074`–`075`,
    OFF by default, never storing a credential — approval creates an account with an unusable
    password and then sends a reset link); the `/admin/security` screen (read-only deployment posture +
    the tenant authentication policy + MFA enforcement + a read-only list of OIDC providers) —
    its endpoints had existed since #184/#185, its screen had not, so the policy could only be changed through
    `curl`. **The core of Wave 2 is DONE**; what is optional and remaining: Google-specific OIDC login,
    reframing the `online-security-config` defaults, admin page parity for the Wave 0–1 modules.
  - **Wave 3 — NOT YET:** the e-commerce/online-shop trajectory (its own ADR).
  - Before every subsequent port: **check inversion-vs-net-new** (e.g. media is already one owning
    module — consumers must go through the `media_library` port, do not create a new media table).
    (`blog-content` HAS been ported — PR #214; `news-portal` was merged into it, ADR-0044.)

- **~~Host-resolved public routes~~ — REVOKED ([ADR-0071](adr/0071-kosakata-url-publik-dibelah-blog-di-sini-news-di-awcms-astro.md)
  supersedes ADR-0059; §4 `SUDAH DILAKSANAKAN`).** The public URL vocabulary is
  split per repo: **`/blog/**` permanently here, `/news/**` belongs to
  `ahliweb/awcms-astro`** — one family per repo, never both in
  one repo. All four route files, the `withHostResolvedBlogTenant` gate, and
  the `publicRouteMode` switch were **deleted**; what runs now is only the
  `seo_distribution` 301 to `/blog/{tenantCode}/**`, because that family of URLs was once
  live and we advertised it ourselves in the sitemap and the feed.
  `legacyTenantRouteEnabled` survives as the only switch for the
  `/blog/{tenantCode}` family. The original context is kept below — the lesson
  beneath it still applies and does not depend on the routes:

  <!-- historis:mulai -->

  > Original text: "**Host-resolved public routes — DONE (ADR-0059).** The
  > `/news/**` family (index, post detail, category, tag) now exists: with no
  > `tenantCode` segment, the tenant is resolved from the request through
  > `withHostResolvedBlogTenant` (the same shape as `site_search`/`comments`, with latency
  > padding), gated by a per-tenant `publicRouteMode` switch symmetrical
  > with `legacyTenantRouteEnabled`. **Zero migrations, zero permissions, zero
  > OpenAPI changes.** `/news/feed.xml`/`sitemap-news.xml`/`search` were deliberately
  > NOT built — the host root already serves all three host-resolved."

  <!-- historis:selesai -->

  What matters most to carry into the next piece of work, and it is not
  the feature:

  > **The defect the previous entry recorded here DOES NOT EXIST.** That entry
  > read "for a host-resolved tenant, **every URL in the sitemap and the feed
  > points at a page that 404s**" because `createBlogContentSeoFactsAdapter`
  > uses a `/blog` default. Verified against the code: the discovery routes never
  > use that default — `discovery-providers.ts` calls it with
  > `` `/blog/${tenantCode}` `` **ever since the module landed** (`git log -S`,
  > #223), its docblock even writes down the reason, and that `/blog`-defaulted
  > singleton has **zero callers in `src/`**. The six discovery routes go through one
  > choke point, so there is no second path. This is a repeat of ADR-0058 §1: a
  > guess written up as a finding, then copied into this document as a
  > decision. What was genuinely missing is **the route family**, not
  > the correctness of the URLs.

  Instead, the invariant now guarded: **never advertise a URL
  we do not serve.** `resolveEnabledSeoProviders` now CHOOSES the base path
  from the family that actually serves, and when a tenant switches BOTH
  families off it contributes **zero providers** — an empty sitemap, not a sitemap
  full of 404s. Mutation-proven (put the base path back to the old constant → two
  integration tests go red).

  And one piece of evidence that closes the original backlog request: `/blog/{slug}`
  **cannot** be the shape. Probed directly — Astro warns that the route
  "is defined in both" files together with `/blog/[tenantCode]/index.ts` and **the build
  still succeeds**, one silently shadowing the other, with the note "a
  collision will result in a hard error in following versions of Astro".

- **`ahliweb/awcms-astro` readiness — analysed 3 August 2026, and the result
  inverts a reasonable assumption.** ADR-0021 in that repo **holds back** all of
  its development until "the `awcms` foundation is finished", with two indicators:
  (1) every module has a screen — **ALREADY zero exceptions**; (2) §4 of this document
  is exhausted — not yet.

  What was verified against the code rather than against the list: **every content and
  session contract `awcms-astro` actually calls is complete.** That repo only
  touches five surfaces — `/api/v1/blog/posts` (the `view=full` traversal +
  cursor + `?locale=`), `/api/v1/media/objects`, `/api/v1/auth/session`,
  `/api/v1/access/machine-credentials`, and `/api/v1/blog/posts/{id}` — and
  all five have landed (#317/#318/#346, ADR-0049/0050).

  One real gap was found and **has been closed** (#370): the media `publicUrl`
  is built from `NEWS_MEDIA_R2_PUBLIC_BASE_URL`, a server-side env var, so a
  build client had no way to discover the media origin — even though its CSP must
  name it in `img-src` **at build time**, before a single object is fetched.
  The only alternative was copying that env var by hand; the same shape
  as `MAX_REASON_LENGTH` across five files, with a failure
  (images silently blocked) that does not mention its cause.
  `GET /api/v1/media/public-origin` closes it.

  **What remains and is NOT this repo's:** article image resolution, share
  cards, and the `img-src` choice are all `awcms-astro`-side decisions. What
  remains AND is this repo's: **zero**. The host-based content routes landed through
  ADR-0059, and the business-scope resolver — needed by the Jualanku portal BFF,
  not by its static site — through ADR-0060. The shape of the Jualanku merchant scope itself
  still needs its own admission ADR, but the foundation no longer refuses
  everything.
  `newsletter`/`social-publishing`/the `src/components/ui/` library still do not
  exist (21 modules, `src/components/ui` is absent), but none of them blocks
  `awcms-astro`.

- **~~Port the `repo:inventory` generator~~ — DONE, and built here (not
  ported).** `bun run repo:inventory:generate|:check` (`scripts/repo-inventory.ts`)
  fills the marked block in [`awcms/repo-inventory.md`](awcms/repo-inventory.md)
  from the module registry, `sql/`, `tests/`, `src/pages/`, and `docs/adr/`;
  `:check` is part of the `bun run check` chain. That document previously carried a
  "GENERATED FILE" banner with no generator, and its contents aged in the most damaging direction:
  "no tables yet"/"no test files yet" against 126 tables and 296 test
  files, a migration count of **45** in one paragraph and **89** in another,
  and **20** modules while the registry held 21. The RLS status is parsed from the migration
  text **cumulatively** (sql/020 turns FORCE off for a data fix
  and then turns it on again — a reader of the first OR the last statement alone would
  report the opposite of the truth); `security:readiness` remains the authority
  for a real deployment. One cross-artefact test guards its claim: the set of
  RLS-free tables the generator derives must be the SAME as the keys of
  `GLOBAL_TABLE_FORBIDDEN_PRIVILEGES` — one side derived from the migrations, one
  side declared by a human with a reason per entry.
- **~~A seam waiting for a provider~~ — the business-scope resolver ALREADY HAS A PROVIDER
  ([ADR-0060](adr/0060-business-scope-hierarchy-provided-by-tenant-admin.md)).**
  `tenant_admin` resolves the `office` scope type against `awcms_offices`; the old
  NO-OP was deleted. What was found while doing it is bigger than "an empty seam":
  `POST /api/v1/identity/business-scope/assignments` — guarded, audited,
  RLS-carrying, SoD-evaluated — **refused EVERY input in EVERY deployment**, because
  its composition root injected the NO-OP and the fallback `tenant` scope type
  is refused by the validator as unassignable (#180 F2). The whole subsystem
  behind it died with it: zero rows for `businessScopeFacts`, zero for the expiry
  job, zero scopes for the SoD `same_scope_only`. That NO-OP was right when it was written
  (waiting for a derived application) and then ADR-0034 deleted that pathway — and
  its `providedBy` names `organization_structure`, a module ADR-0016
  `Accepted` without a line of code. Only LIVE rows resolve, every bound
  (cycle/depth/count) REFUSES rather than truncating, plus a hardening of the read
  path: the `tenant` sentinel is only trusted when it names that tenant itself.
  Mutation-proven against a real Postgres. Zero migrations.
  Base SoD shipped **1 rule** at the time (`data_lifecycle.legal_hold_maker_checker`,
  ADR-0037) — the additional illustrative rule stays in a fixture. **Now 2**: ADR-0094
  adds `data_lifecycle.subject_erasure_maker_checker` (#557).

## 5. Workflow contract (in brief)

1. **Mini-first is REVOKED** ([ADR-0055](adr/0055-development-confined-to-awcms-and-awcms-astro.md),
   2 August 2026, superseding ADR-0047): development happens only in `ahliweb/awcms` +
   `ahliweb/awcms-astro`. `awcms-mini`/`awcms-micro` are **archives** — they may be read
   as history, but **no work is scheduled as "ported from" there**;
   a desired capability is **built here** with its own admission ADR.
   [`awcms/alur-pengembangan-mini-first.md`](awcms/alur-pengembangan-mini-first.md)
   is kept as a historical note. Its guardrails REMAIN: **an ADR is mandatory** for
   standards changes, an extra security review for `auth`/`access`/`sync`,
   the full `bun run check`, OpenAPI/AsyncAPI in sync, RLS `FORCE`, ABAC default-deny.
   The obligation to add a divergence entry in `awcms-family-compatibility.yaml` is
   **revoked** — the ADR itself is now that record.
2. **Branch first** (do not commit to `main`); one PR = one atomic change.
3. **The FULL `bun run check`** before a PR (lint + docs + contracts + typecheck + tests + build;
   run `bun run format` first if needed). A changeset is mandatory for a behaviour change.
4. Migrations/OpenAPI/AsyncAPI are kept in sync with every schema/API/event change.

## 6. Traps that are invisible from the code (read before touching the relevant area)

- **An applied migration is immutable**: editing a `sql/NNN` that has already run (even a comment)
  blocks `db:migrate` on a running deployment — correct it with a new migration.
- **RLS `ENABLE` without `FORCE` is inert** for the table owner; `FORCE` +
  a non-owner role (`awcms_app`) is mandatory. Test RLS under the `awcms_app` LOGIN role, not as a superuser.
- **A 4xx `return`ed from inside `withTenant` is a COMMIT** — not a rollback.
- **Keyset cursors**: microsecond timestamptz vs millisecond JS `Date` → carry `created_at`
  as full-precision text, do not re-parse it into a `Date`.
- **The frozen OpenAPI snapshot**: an add-only subset test — do not edit the snapshot; evolve through
  the `INTENTIONALLY_EVOLVED_PATHS` allow-list.
- **An OpenAPI tag = a documentation visibility requirement**: `api-docs-generate` groups
  by the tags **declared** in `openapi/awcms-public-api.src.yaml`, so an operation
  tag that was never registered makes a module's whole surface disappear from
  `api-reference.md` with not one gate going red (it once hit 55 operations/4 modules).
  Gated both ways since PR #308, together with the fragment ownership gate
  (`api.openApiPath` must point at its own fragment, not at the bundle).
- **A permission seed does not reach older tenants, and "grant everything that is missing" is
  WRONG.** A seed migration only extends the global catalogue; a tenant's `owner` role
  gets its permissions once, when the tenant is created. Its backfill now has tooling:
  `bun run identity-access:permissions:backfill` (dry-run by default, `--commit` writes,
  `--tenant` for doing it gradually). It deliberately does **not** grant every permission
  that is missing — only those whose catalogue row is newer than the role. Older missing
  ones are treated as deliberately revoked by an admin and are reported, not restored;
  bringing them back is an authorization change nobody asked for and
  nobody sees.
- **`bun run <target>` references in CODE COMMENTS are gated too** since the
  scripts↔docs synchronisation: `check:docs` inspects current-state files — the five root markdown files,
  this document, `scripts/README.md`, the `src/**` module READMEs, **and the whole of the
  `src/`/`scripts/` source**. Previously it was only the five root markdown files, so six comments in
  `src/modules/module-management/` could tell their reader to run a
  `modules:sync` target that never existed (the real mechanism is `POST /api/v1/modules/sync`)
  with `bun run check` still green. `docs/awcms/` stays OUTSIDE that gate:
  its contents are a mix of history + specification that is allowed to name tooling that does not exist yet
  (`production:preflight`, `performance:*`, and so on — the full list is in
  [`../scripts/README.md`](../scripts/README.md) §Deferred).
- **`.claude/skills/` IS NOW GATED** ([ADR-0062](adr/0062-skills-are-gated-against-the-code-they-describe.md),
  `bun run skills:check`) — its old exemption was revoked because ADR-0055 revoked
  its reason. What forced it: **eleven consecutive ADRs (0051–0061) landed with NOT ONE
  skill mentioning them**, four LIVE module skills pointed at `src/lib/<module>/…` for files
  that had moved to `src/modules/<module>/presentation/…`, and several announced that an admin
  screen was "NOT ported" months after that screen landed. **Skills are FOLLOWED, documents
  are read** — and their direction of ageing is inverted: "this module does not exist here yet" starts out true and then
  ages into a confident lie that tells an agent to rebuild something that already exists.
  Its three rules rest on the module registry, not on prose: a live module skill must point at
  a real path (no exceptions), every `ADR-NNNN` must have a file, and a skill for code
  that does NOT exist must be registered in `ASPIRATIONAL_SKILLS` with its reason. DEAD entries
  (the module got built → rule 1 takes over) are reported too — three entries were already dead when
  it was written. **A side effect worth knowing:** the body of many skills contains the
  awcms-mini specification as-is, so a path belonging to the source repo must now be written `awcms-mini:src/…`,
  not `src/…`.
- **An unquoted parenthesis kills the WHOLE mermaid diagram** on GitHub (not part of it):
  in `flowchart`/`graph`, `(` is the opening token of a node shape, so
  `-->|online (primary)|` or `{... (x)?}` fails to parse and is replaced by an "Unable to
  render rich display" box. Quote the label; parentheses that really are SHAPES (`[( )]`, `([ ])`,
  `(( ))`, `[[ ]]`, `{{ }}`) must not be touched. Gated by `check:docs` since PR #309 —
  before that the gate only checked the block fences and the diagram type, so two broken
  diagrams lived alongside a green `bun run check`.
- **Local Postgres**: the host can break, and a host→container connection can now time out in the
  sandbox → run `db:migrate` + the DB-gated tests **inside** a bun container that shares the
  network namespace with the Postgres container (`docker run --network container:<pg> oven/bun …`).
  Note: the bun image has no git → 2 `check-docs-integration` tests fail spuriously in the container
  (verify on the host/CI).
- **CI**: ten required checks since 8 August 2026 (the `main only` ruleset, id 11653326) — three of them newly added: `Integration tests (RLS + DB
role separation)`, `E2E smoke (Playwright)`, `Minimum-supported versions`.
  Previously all three ran without blocking a merge, and because the `quality` job
  deliberately runs with `DATABASE_URL: ""`, the existing required checks were **structurally
  blind** to RLS isolation, DB role separation, and the query
  budget. The cost accepted and stated: the integration job pulls a Postgres image
  from Docker Hub, so a registry outage now **blocks merges** (it happened once
  on 8 August, run 31234082007 — three retries, all timing out).
  A CodeQL run is sometimes orphaned in the queue → re-trigger it with an empty commit; a
  Postgres CI flake → `gh run rerun --failed`.
- **A subagent/another session in a shared working tree** can move HEAD →
  **`git branch --show-current` IS NOT ENOUGH.** It reports the name of the branch you
  just created, which always looks right. What must be verified
  is its **PARENT commit**: `git rev-parse --short HEAD` before `checkout -b`,
  and `git merge-base HEAD origin/main` afterwards. This really happened on
  8 August 2026 — PR #409 was created while HEAD was on another session's branch, so
  it carried **32 files** instead of 10, and merging it landed the whole of PR
  #408 (including the reversal of ADR-0067's status) into `main` without that PR ever
  being reviewed. The symptom that was missed: the squash message contained the commit messages of the OTHER PR
  as bullets. Before merging, `gh pr diff <n> --name-only` and
  `gh pr view <n> --json commits -q '.commits|length'`.
- **`.astro` is the blind spot of EVERY type-based gate.** `bun run typecheck`
  is `tsc --noEmit`, and `tsc` cannot parse `.astro` — it skips them
  **silently**, even though `tsconfig.json` says `"include": ["src/**/*"]`.
  `astro build` does not type-check either. So 42 files / 22,328 lines (every
  admin screen + login + the public pages) write TypeScript nobody ever
  checks. The class most likely to slip through: `withTenant`
  (which returns `T | Response`) used where the correct choice is `withTenantOrThrow`
  (which throws) — the page still compiles and renders data that is
  actually a `Response`. Until `astro check` is in the chain, **re-read the
  types in `.astro` with your eyes**, do not trust a green CI. Status as of 5 August 2026:
  adding `astro check` is **BLOCKED externally** — `@astrojs/check` demands the
  TypeScript 6.x API while the repo is on 7.0.2; this state is recorded as the
  ADR-0068 §C divergence (`awcms-family-compatibility.yaml`, reviewDate
  2027-02-04), so this trap applies in full.
- **This repo compresses nothing — and the compression readers receive is
  inherited from a layer no gate checks.**
  `edge-cache/response-headers.ts` emits `Vary: Accept-Encoding` on
  cacheable responses, but there is no compression in the application, no
  `beresp.do_gzip` in `infra/varnish/default.vcl`, and no Traefik
  `compress` middleware declared in the repo; Varnish does **not** compress
  on its own initiative. Production/staging readers DO still receive gzip —
  from Cloudflare, because both hosts are proxied (`Cloudflare (proxied) → Traefik
:443 → varnish:80 → app`, [`awcms/environments.md`](awcms/environments.md)
  §Edge cache). The consequence: a deployment of this template outside a compressing CDN
  gets no compression at all. Since 5 August 2026 that dependency is
  **declared, not hidden** (gap C3 CLOSED):
  `bun run security:readiness` includes `checkResponseCompressionOwnership`, which
  scans the five layers this repo ships and — because none of them
  compresses — demands that the block marked `kompresi-tepi` in `environments.md`
  names its compressing tier. Its limit must still be read: what is gated
  is **the declaration**, not the outer layer. No gate in this repo
  would go red if Cloudflare stopped compressing or were removed from in front of
  Traefik — that is only visible by checking `content-encoding` at the edge of the
  actual environment.

Deeper detail is in the relevant skills (`awcms-new-migration`, `awcms-abac-guard`,
`awcms-testing`, `awcms-sync-hmac`, and so on) and in the ADRs.

## 7. How to continue

- Start a unit of work: the `awcms-implement-issue` skill (the orchestrator) → `awcms-new-module` /
  `awcms-new-migration` / `awcms-new-endpoint` / `awcms-new-event`.
- Capabilities from the mini/micro archives: **not a port** — [ADR-0055](adr/0055-development-confined-to-awcms-and-awcms-astro.md)
  makes mini/micro archives; a new capability arrives through an **admission ADR and is
  built in this repo**. The `awcms-port-from-mini` skill is HISTORICAL (a record of how a
  port used to be done; its §Adaptation is still useful when reading archive code).
- Review/security: the `awcms-pr-review`, `awcms-security-review` skills, the
  `awcms-reviewer` / `awcms-security-auditor` subagents.
- Update **this document** whenever there is a major state change (a new module/migration, a
  governance decision, a finished backlog item) so it stays an accurate continuation point.
