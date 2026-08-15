🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](0035-awcms-online-first-erp-saas-superset-repositioning.id.md)

# ADR-0035 — awcms as an online-first hybrid template, ERP + integrated SaaS ready, and family superset (absorbing awcms-micro)

- **Status:** Accepted
- **Date:** 2026-07-24
- **Decision maker:** @ahliweb
- **Refines (partial supersede):** [ADR-0034](0034-awcms-family-direct-use-templates-and-derived-pathway-removal.md) — specifically the **positioning** part: the scope table in §Decision.1 and the "offline-first" identity for `awcms`. **Reaffirms** (unchanged) ADR-0034 §Decision.2 & §3 (direct-use templates, NO derived repos, domain modules live directly in `src/modules/`) and every runtime convention.
- **Reaffirms:** ADR-0001 (Bun-only/RLS/RBAC-ABAC), ADR-0003 (RLS FORCE), ADR-0004 (default-deny, deny-overrides-allow), ADR-0006 (outbox/sync — now the _offline half_ of the hybrid mode), ADR-0007/0008 (contracts), ADR-0011 (capability ports).
- **Aligned with:** awcms-micro (remains the lean full-online website template) and awcms-mini (remains the hybrid offline-first foundation template, SaaS-ready).

## Context

ADR-0034 positioned `awcms-mini` / `awcms` / `awcms-micro` as **three peer direct-use templates**, distinguished by **scope**, and recorded `awcms` as **offline-first / LAN-first** with the scope "ERP foundation + ERP readiness contracts". That positioning left two things the maintainer now wants changed:

1. **Operating mode.** `awcms` is used for ERP/back-office and SaaS solutions that are **online-connected as the normal state** (synchronised multi-branch, customer portal, provider integrations). Marketing it as "offline-first" puts the priority in the wrong place: the correct statement is **hybrid online + offline with an online-first priority** — online is the primary path, offline/LAN is the resilience mode (not the other way round as in `awcms-mini`).
2. **Scope.** The ADR-0034 scope boundary between `awcms` (ERP/back-office) and `awcms-micro` (full-online website → online shop) makes the website/e-commerce, UI/UX, and auth hardening capabilities that are **already mature in `awcms-micro`** look like they "belong to another repo". Yet a real ERP/SaaS product needs them (public portal, catalogue, online shop, SEO, comments, newsletter, media library, self-registration). The maintainer decides `awcms` becomes a **superset**: the awcms-mini foundation + the ERP scope + **the whole** awcms-micro website/e-commerce cluster.

This change is **positioning & scope**, not runtime architecture, and it does **not** revive the derived-repo pathway removed by ADR-0034.

## Decision

### 1. `awcms` = online-first hybrid template, ERP + integrated SaaS ready

The canonical operating mode of `awcms` is **hybrid online + offline with an online-first priority**: online connectivity is the primary path and the deployment default; the offline/LAN capabilities (outbox/HMAC sync, ADR-0006) remain present and supported as a **resilience mode**, not the main assumption. `awcms` is positioned as **ERP-ready** (consuming the ADR-0020 ERP readiness contracts with domain modules directly in `src/modules/`) and **built for integrated SaaS** (multi-tenant, public portal, provider integrations).

`awcms` is **developed from the technical base of `awcms-mini`** (adopting its modular-monolith stack & standards) and takes mature capabilities from `awcms-micro`. This is a statement of **lineage/positioning**, not a return to the "mandatory base + derivative" model: all three remain direct-use templates (the governance points of ADR-0034 §Decision.1 still apply; only the scope/mode row for `awcms` is refined here).

### 2. `awcms` = family superset (absorbing awcms-micro)

`awcms` **absorbs** the awcms-micro website/e-commerce, UI/UX, and auth hardening cluster **directly into this template's `src/modules/`** (not a separate repo, consistent with ADR-0034 §2/§3). The scope of absorption (the delta against what already exists in `awcms`):

- **Website/content modules:** `media-library`, `tenant-domain` (host→tenant routing), `form-drafts`, `seo-distribution`, `site-search`, `comments`, `newsletter`, `social-publishing`, `visitor-analytics`, `data-lifecycle`. (`theming`, `blog-content`, `news-portal` already exist.)
- **UI/UX:** the `src/components/ui/` component library + design-token parity, aligned with the existing `awcms` admin overhaul (PR #215), not overwriting it.
- **Auth/admin:** self-registration, password reset, admin security policy UI, per-tenant sidebar menu, OIDC delta (e.g. a specific Google login) — **only what does not exist yet** in `awcms` (which already has MFA, generic OIDC/SSO, the ABAC DSL, business-scope, SoD, Turnstile, break-glass).
- **The e-commerce/online shop trajectory** (catalogue/storefront/cart/online checkout) is a follow-on epic with its own ADR (it has not been built in micro either).

The staged execution map (per module, one atomic PR, passing `bun run check`) is in [`docs/awcms/absorb-awcms-micro-roadmap.md`](../awcms/absorb-awcms-micro-roadmap.md). Absorption follows the **adapt, don't copy** pattern (rename the `awcms_micro_` prefix → `awcms_`, migration numbering continuing from `sql/045`).

### 3. The position of the three templates after this ADR

| Repository    | Operating mode                          | Scope                                                       |
| ------------- | --------------------------------------- | ----------------------------------------------------------- |
| `awcms-mini`  | **hybrid offline-first**, SaaS-ready    | Generic reusable foundation (the modular-monolith standard) |
| `awcms`       | **hybrid online-first**, ERP+SaaS ready | **Superset**: ERP/back-office + website + e-commerce        |
| `awcms-micro` | full-online                             | Full-online website → online shop (lean, website-only)      |

`awcms` becomes the "most complete" template: the mini foundation + ERP + the whole micro website/e-commerce, online-first, with offline still supported. `awcms-micro` remains the lean full-online website-only template (it does not carry the ERP scope). `awcms-mini` remains the hybrid offline-first foundation.

## Consequences

- **Document repositioning (this document's step):** README/README.id, AGENTS, PROJECT_STATE, the `docs/awcms/` package (01/06/09/10/12/13/15, alur-pengembangan-mini-first, the README index, api-contribution-guide) are set to the new positioning; older documents calling `awcms` "offline-first" or placing "ERP in a separate derived repo" are treated as obsolete/updated.
- **Family manifest:** the `role` field in `awcms-family-compatibility.yaml` is updated (drop the ADR-0022 reference, state online-first hybrid superset); the Turnstile divergence rationale is aligned ("offline-first guarantee" → "the offline/LAN mode of the hybrid"). Divergence `reviewDate` values are not changed. The `family:conformance:check` gate stays green.
- **Contract:** no bump. `MODULE_CONTRACT_VERSION` is already `2.0.0` (raised by ADR-0034); module absorption uses the same contract.
- **`sync-storage`/ADR-0006:** kept as the **offline half** of the hybrid mode — still load-bearing, merely prioritised below the online path.
- **Unchanged:** every runtime convention (Bun-only, RLS FORCE, RBAC/ABAC default-deny, OpenAPI/AsyncAPI contracts, the base registry, CI gates) and the ADR-0034 governance model (direct use, no derived repos). This ADR changes **positioning & scope**, not the mechanism.
