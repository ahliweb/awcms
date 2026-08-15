🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](0001-rebuild-on-awcms-foundation-erp-scope.id.md)

# ADR-0001 — Rebuild AWCMS as an ERP platform on modular monolith standards

- **Status:** Accepted (point 3 & one alternative amended by [ADR-0022](0022-erp-modules-live-in-extension-repos.md))
- **Date:** 2026-07-14
- **Related:** migration history ADR-013..023 (old repo, Bun migration & off-Supabase); [ADR-0013](0013-extension-layers-and-boundary-model.md), [ADR-0020](0020-erp-extension-readiness-contracts.md), [ADR-0022](0022-erp-modules-live-in-extension-repos.md)

> **Amendment (ADR-0022, 2026-07-16).** Point 3 below — "ERP domain modules … developed as modules in `src/modules/`" — **no longer applies**. Since epic #738 (`platform-evolution`, ADR-0013/0020), ERP domain modules live in **separate extension/derived repos** (the _ERP Extension_/_Derived Application_ layers), not inside this base; the base only provides reusable foundation modules + neutral ERP-readiness contracts. The alternative "develop the ERP in a separate repo" that was rejected back then (see §Alternatives) **is now the adopted direction**. Points 1, 2, 4 and all of the foundation's technical standards still apply. See [ADR-0022](0022-erp-modules-live-in-extension-repos.md).

## Context

The `awcms` repo previously held a CMS platform built on Node.js, Vite/React (admin & public separated), and Supabase. Over the course of a staged migration (ADR-013..023), every component (mcp, public, admin) was moved to the Bun runtime and off Supabase. Once the migration finished, the legacy files were removed entirely (`chore(foundation): remove legacy repository files`), leaving a repo with no active code.

The current business need is bigger than a generic CMS/base: an **ERP** platform (finance, inventory, procurement, manufacturing, HR/payroll) plus **integration with other business solutions** (payment gateway, marketplace, tax/Coretax systems, logistics), at multi-tenant/multi-entity scale.

## Decision

We decided:

1. The `awcms` repo is **not archived** — it is rebuilt as a modular monolith ERP platform with these technical standards: Bun (runtime, Bun-only), Astro 7 (SSR), PostgreSQL + mandatory RLS, default-deny RBAC/ABAC, offline-first/LAN-first with an HMAC-signed sync outbox, OpenAPI/AsyncAPI contracts, idempotency on high-risk mutations, and an audit trail with redaction.
2. Those baseline technical standards are recorded as ADRs in this repo's `docs/adr/` (starting with ADR-0002 onward) and become the binding baseline for every module.
3. ~~ERP domain modules (finance, inventory, procurement, manufacturing, hr-payroll) and external business integration modules are developed as modules in `src/modules/`, following the same modular monolith structure (module.ts + domain/application/infrastructure/api).~~ **(Amended by [ADR-0022](0022-erp-modules-live-in-extension-repos.md): ERP domain modules live in separate extension/derived repos, not in the base's `src/modules/`; the base only provides reusable foundation modules + neutral ERP-readiness contracts.)**
4. Any adjustment of the standards for ERP-specific needs (e.g. a particular performance/scale requirement) must be recorded as a separate ADR with an explicit rationale, not as a silent deviation.

## Consequences

- **Positive:** the technical foundation (RLS, ABAC, offline-first, API contracts) is already proven and does not need to be designed from scratch again; the previous migration git history stays relevant as historical context; one repo, one standard, lowering cross-repo coordination cost.
- **Trade-off:** this repo carries the entire maintenance burden of the foundation + the ERP modules by itself (there is no split with a separate base); ADR discipline is required so ERP modules do not silently violate the baseline standards.
- **Neutral:** this repo has its own `AGENTS.md`, `docs/adr/`, and governance documents covering both the foundation standards and the ERP requirements.

## Alternatives considered

- **Archive the repo and develop the ERP in a separate repo/base** — ~~rejected: splitting standards and code across two repos adds synchronisation overhead with no clear benefit at the current team scale.~~ **(Amended by [ADR-0022](0022-erp-modules-live-in-extension-repos.md): developing the ERP in a separate repo — on top of this base, not archiving it — is now the adopted direction. Epic #738 provides build-time module composition, a compatibility manifest, and versioned port/event contracts that remove the synchronisation overhead which used to be the basis for the rejection.)**
- **Keep the old platform (Node/Vite/React/Supabase)** — rejected: it contradicts the already-completed Bun migration direction (ADR-019) and adds maintenance cost for an already-obsolete stack.
- **Build the ERP from scratch without clear modular monolith standards** — rejected: it risks repeating the non-modular base problems (hard to split, likely to become a big ball of mud) that previous migration experience already taught us to avoid.
