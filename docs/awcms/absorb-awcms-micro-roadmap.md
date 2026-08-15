🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](absorb-awcms-micro-roadmap.id.md)

# Roadmap for Absorbing awcms-micro → awcms

> **Read through the lens of [ADR-0055](../adr/0055-development-confined-to-awcms-and-awcms-astro.md) (2 August 2026):**
> `awcms-mini`/`awcms-micro` are now **archives**, so this document is a list of
> **capability needs**, not a port queue. Each item enters through **its own
> admission ADR and is built in this repo**; archive code may be read as a
> specification/reference, not as a source that gets ported. The status table in §5
> is therefore **no longer maintained as a work queue** — it is a historical
> snapshot of the absorption programme up to the point its pathway was closed.

> **Original decision sources:** [ADR-0035](../adr/0035-awcms-online-first-erp-saas-superset-repositioning.md)
> (refining the positioning of [ADR-0034](../adr/0034-awcms-family-direct-use-templates-and-derived-pathway-removal.md)).
> `awcms` is positioned as an **online-first hybrid, ERP + integrated SaaS ready, and the
> family superset** that absorbs the website/e-commerce cluster, the UI/UX, and the auth
> hardening of `awcms-micro` **directly into `src/modules/`** (not a derived repo; ADR-0034 §2/§3
> still applies). The source of truth for state remains the code + `sql/` + `bun run check`.

> **Companion to** [`absorb-awcms-mini-backbone-roadmap.md`](absorb-awcms-mini-backbone-roadmap.md),
> which carries the same banner for the business foundation + SaaS control plane cluster.

`awcms-micro` code may be read as a specification. It is not a "port source repo":
the mini-first flow ([`alur-pengembangan-mini-first.md`](alur-pengembangan-mini-first.md))
has been **PERMANENTLY REVOKED** by ADR-0055, and there is no second port pathway
replacing it.

## 1. Absorption principles (mandatory per module)

Every absorption = **one atomic PR**, **adapt do not copy**:

1. **Delta analysis first.** Compare against what ALREADY exists in `awcms` (§2). Port **only**
   what does not exist yet; do not overwrite/regress awcms capabilities that are already further
   ahead (e.g. auth: awcms already has MFA/OIDC/SSO/business-scope/SoD/Turnstile/break-glass).
2. **Rename the prefix** `awcms_micro_` → `awcms_` (tables, GUCs, constants, env, permission catalogue).
3. **Migration numbering continues, tightly packed** from the current highest migration (`ls sql/ | tail -1`
   — as of 2026-07-25 `sql/067`, so the next number is `068`), **sequential with no gaps** — the gaps
   micro has deliberately (the un-ported ERP ranges) are NOT carried over here. An applied migration is
   immutable; correct it with a new migration.
4. **Drop dependencies/toolchain that do not exist in awcms yet**; if a module needs a seam that
   does not exist yet, port the seam in Wave 0 first.
5. **RLS FORCE + tenant_id-first** for every tenant-scoped table; test RLS under the
   `awcms_app` LOGIN role (not a superuser).
6. **Keep the contracts in sync**: per-module OpenAPI fragment + bundle (ADR-0026), AsyncAPI for
   new events. Frozen snapshot → evolution via `INTENTIONALLY_EVOLVED_PATHS`.
7. **Tests** unit + integration (two-world) + contract + security; module **docs + skill**;
   **changeset**; register it in `src/modules/index.ts`.
8. **Pass the FULL `bun run check`** before the PR.

`MODULE_CONTRACT_VERSION` **rises one additive MINOR per new contribution seam** that this
absorption needs — the initial estimate of "no contract bump" turned out to be wrong.
From `2.0.0` (ADR-0034): `2.1.0` `dataLifecycle` (#222), `2.2.0` `searchSources` (#231),
`2.3.0` `commentableResources`. `2.4.0` `api.routes` (#267) and `2.5.0` `ModulePermissionDescriptor.scope` (ADR-0053) have ALREADY taken the following slots, so `newsletterContentSources` will be `2.6.0` — not `2.4.0` as previously written.
Every bump **must** be accompanied by updating the `contracts.moduleDescriptorContractVersion` pin
in `awcms-family-compatibility.yaml`, or `bun run family:conformance:check` goes red.

## 2. Delta: already in awcms vs what is absorbed

**Already present (DO NOT re-port):** `tenant-admin`, `identity-access` (login, sessions, RBAC,
ABAC DSL, MFA TOTP + step-up, generic OIDC/SSO + break-glass, business-scope, SoD, Turnstile),
`profile-identity`, `logging`, `module-management`, `sync-storage`, `workflow-approval`,
`reporting`, `email`, `domain-event-runtime`, **`theming`, `blog-content`**
(which since [ADR-0044](../adr/0044-merge-news-portal-into-blog-content.md) also
owns all of the former `news-portal`).

**Absorbed from awcms-micro (full scope; per-module status in §5):** the UI library
`src/components/ui/`, the content contribution seams, `media-library` ✅, `tenant-domain` ✅,
`visitor-analytics` ✅, `data-lifecycle` ✅, `seo-distribution` ✅, `form-drafts` ✅,
`site-search` ✅, `comments` ✅, `newsletter`, `social-publishing`; the auth/admin delta
(self-registration, password reset, admin security policy UI, per-tenant sidebar menu,
Google-specific OIDC login — **verify which of these does not exist yet**); the
e-commerce/online shop trajectory (a follow-on epic). ✅ = already landed (2026-07-24/25).

## 3. Waves & dependency order

Modules within one wave are mostly logically parallel, but migration numbering serialises the
commit order. Work through them row by row.

### Wave 0 — foundation infra (opens the way for the rest)

| Item                                                         | Micro source                                                       | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------------ | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The `src/components/ui/` library + design-token parity       | `src/components/ui/`, `src/styles/tokens.css`                      | **Reconcile** with the existing awcms admin overhaul (PR #215: `admin.css`/`admin-screens.css`) — do not overwrite it. Components: DataTable, FilterBar, FormField, Pagination, StatusBadge, StateNotice, ConfirmDialog, ActionBanner + wizard primitives.                                                                                                                                                                                                                                                                                                 |
| Contribution seams on `ModuleDescriptor`                     | `_shared/module-contract.ts`                                       | Add the descriptor fields `seo_facts`, `searchSources`, `commentableResources`, `newsletterContentSources` **if they do not already exist** in `src/modules/_shared/module-contract.ts`. Consumed by Wave 1.                                                                                                                                                                                                                                                                                                                                               |
| `media-library` (**an INVERSION wave**, not additive Wave-0) | `src/modules/media-library/`, micro's media-library sql            | ✅ **done** ([ADR-0036](../adr/0036-media-library-module-admission-ownership-inversion.md)). Not an additive port: an **ADR-0026 ownership inversion** — the R2 registry + presign/finalize/cancel + MIME sniffing + the `news-media:reconcile` job were **EXTRACTED out of `news_portal`** into `media_library`; the `news_media` port was retired → `media_library`; destructive permission migration `052`, tenant-state `053`, enforcement `054` (+ endpoint `POST /api/v1/media/enforcement`). Steps 5b/5c/5d (`/admin/media`, srcset, PDF) deferred. |
| `tenant-domain`                                              | `src/modules/tenant-domain/`, micro's tenant-domain sql (ADR-0010) | host→tenant routing; **open the host-resolved public `/news/**` routes + custom domains** (high priority, already flagged in PROJECT_STATE). Adopt the [ADR-0010](../adr/0010-public-host-tenant-routing.md) that already exists in awcms.                                                                                                                                                                                                                                                                                                                 |

### Wave 1 — website/content cluster (relies on the Wave 0 seams; blog/news already exists)

| Item                                                                      | Micro source                                | Depends on                                                                              |
| ------------------------------------------------------------------------- | ------------------------------------------- | --------------------------------------------------------------------------------------- |
| `form-drafts` + wizard primitives                                         | `src/modules/form-drafts/`                  | the UI lib (W0)                                                                         |
| `seo-distribution` (+ public sitemap/robots/RSS/Atom/JSON feed endpoints) | `src/modules/seo-distribution/` (ADR-0028)  | the `seo_facts` seam; blog/news already exists (the fact provider)                      |
| `site-search`                                                             | `src/modules/site-search/` (micro ADR-0031) | the `searchSources` seam; published content                                             |
| `comments`                                                                | `src/modules/comments/` (micro ADR-0032)    | the `commentableResources` seam; anti-abuse (honeypot/timing/rate-limit), PII hash+mask |
| `newsletter`                                                              | `src/modules/newsletter/` (micro ADR-0033)  | the `newsletterContentSources` seam; double-opt-in, suppression                         |
| `social-publishing`                                                       | `src/modules/social-publishing/`            | `blog-content` (activates the publish hook that is currently a no-op)                   |
| `visitor-analytics`                                                       | `src/modules/visitor-analytics/`            | privacy-first; rollup/purge                                                             |
| `data-lifecycle`                                                          | `src/modules/data-lifecycle/`               | per-module retention descriptor + legal hold                                            |

### Wave 2 — auth/admin delta + online-first hardening

- ~~**self-registration** (public registration request + admin approval)~~ — **DONE**
  (`sql/074`–`075`, OFF by default): a public submit never creates an account & never receives
  a password; approval creates the account with unusable credentials and then sends a reset link.
- ~~**password reset**, enumeration-safe~~ — **DONE** (`sql/073`): awcms was proven to have none
  at all, so it was ported + adapted (SSO-only is rejected, delivery through the `auth_notification`
  capability port, single-use with a row lock). See `identity-access/README.md`.
- ~~**admin security policy UI** (`/admin/security`) for tenant auth policy~~ — **DONE**:
  deployment posture (read-only) + tenant authentication policy + MFA enforcement + a read-only
  list of OIDC providers. Provider CRUD remains API-only.
- ~~**per-tenant sidebar menu management** (`/admin/sidebar-menu`)~~ — **DONE** (#272).
- **Google-specific OIDC login** — awcms has generic OIDC; port only if wanted.
- **Reframe the `online-security-config` defaults** for online-first (the full-online gate active
  by default, LAN/offline still exempt per the Turnstile divergence).
- **Admin page parity** for all the new Wave 0–1 modules.

### Wave 3 — e-commerce/online shop trajectory (a follow-on epic, with its own ADR)

Online catalogue/storefront/cart/checkout. Not built in micro either — design it through a new
ADR + its own planning before implementation.

## 4. Verification per PR

The full `bun run check` (lint + docs + contract + typecheck + test + build); for non-trivial UI
changes add the E2E `bun run test:e2e`. Test RLS under `awcms_app` LOGIN. The OpenAPI snapshot is
frozen (add-only). A changeset is mandatory.

## 5. Absorption status (historical snapshot, not maintained)

| Wave | Item                                                                                                                                                                                                  | Status                                                                                                                                                                                                                               | PR                  |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------- |
| 0    | `src/components/ui/` + tokens                                                                                                                                                                         | 🟡 partial — the admin shell/chrome is at parity (#229: topbar, two-level sidebar, breadcrumb, theme toggle via CSP hash, KPI dashboard); the reusable component library + token parity are not                                      | #229                |
| 0    | `ModuleDescriptor` contribution seams                                                                                                                                                                 | 🟡 partial (`dataLifecycle` #222, the `seo_facts` capability #223, `searchSources` #231, `commentableResources` ADR-0041 are done; `newsletterContentSources` is not)                                                                | #222/#223/#231      |
| 0    | `media-library` (INVERSION wave, ADR-0036)                                                                                                                                                            | ✅ done                                                                                                                                                                                                                              | #221                |
| 0    | `tenant-domain`                                                                                                                                                                                       | ✅ done                                                                                                                                                                                                                              | #219                |
| 1    | `form-drafts`                                                                                                                                                                                         | ✅ done (the store only; the wizard components in `src/components/ui/` are still open Wave-0 work)                                                                                                                                   | #230                |
| 1    | `seo-distribution` — discovery ([ADR-0038](../adr/0038-seo-distribution-module-admission-discovery-scope.md)) + redirect governance ([ADR-0039](../adr/0039-seo-distribution-redirect-governance.md)) | ✅ done (discovery + redirect/404)                                                                                                                                                                                                   | #223/#224           |
| 1    | `site-search` ([ADR-0040](../adr/0040-site-search-module-admission.md))                                                                                                                               | ✅ done (cross-content FTS index + public query/suggest + admin index/settings/diagnostics; inline typeahead & non-`blog_post` sources are follow-ups)                                                                               | #231                |
| 1    | `comments`                                                                                                                                                                                            | ✅ done ([ADR-0041](../adr/0041-comments-module-admission.md); the `commentableResources` seam + `MODULE_CONTRACT_VERSION` 2.3.0, `sql/066`–`067`, admin queue + 10 routes; reply notifications await the email dispatcher consumer) | —                   |
| 1    | `newsletter`                                                                                                                                                                                          | ⏳ not yet                                                                                                                                                                                                                           | —                   |
| 1    | `social-publishing`                                                                                                                                                                                   | ⏳ not yet                                                                                                                                                                                                                           | —                   |
| 1    | `visitor-analytics`                                                                                                                                                                                   | ✅ done                                                                                                                                                                                                                              | #220                |
| 1    | `data-lifecycle` ([ADR-0037](../adr/0037-data-lifecycle-module-admission.md))                                                                                                                         | ✅ done                                                                                                                                                                                                                              | #222                |
| 2    | Auth/admin delta                                                                                                                                                                                      | 🟡 core done — per-tenant sidebar (#272), password reset (`sql/073`), self-registration (`sql/074`–`075`), `/admin/security`; optional remainder: Google OIDC, reframing `online-security-config`, admin page parity for Waves 0–1   | #272/#273/#276/#274 |
| 3    | E-commerce/online shop                                                                                                                                                                                | ⏳ not yet (needs an ADR)                                                                                                                                                                                                            | —                   |
