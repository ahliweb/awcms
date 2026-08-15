🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](0011-capability-ports-for-cross-module-collaboration.id.md)

# ADR-0011 — Capability ports for cross-module collaboration

- **Status:** Accepted
- **Date:** 2026-07-11
- **Decision makers:** The `blog_content`/`news_portal` module team
- **Related:** Issue #681 (epic #679, platform-hardening), Issue #636/#637 (the origin of the cross-module imports fixed here), `src/modules/_shared/module-contract.ts` (`ModuleCapabilityContract`)

## Context

`blog_content` and `news_portal` have been importing each other's `application`/`domain` code directly since Issue #636 (`blog_content` needed `news_portal`'s R2 media registry) and Issue #637 (`news_portal`'s homepage composer needed `blog_content`'s post/category queries). Both directions were documented explicitly as a conscious decision at the time ("a cross-module TypeScript import ≠ the `dependencies` array, which only governs enable/disable ordering") — but the end result is still a cycle at the SOURCE CODE level: `blog-content/application/news-media-reference-gate.ts` imports `news-portal/application/news-media-object-directory.ts`, while `news-portal/application/homepage-section-composer.ts` imports `blog-content/application/public-blog-directory.ts` AND `blog-content/application/news-media-reference-gate.ts` (which, as noted above, imports `news-portal` right back) — a three-hop chain that is completely invisible from any `module.ts` `dependencies` array.

Epic #679's static audit flagged this as a risk: two modules that cannot be understood, tested, or (hypothetically) separated without each other, even though the registry metadata looks clean.

## Decision

We decide to separate the **capability** (the agreed interface) from the **implementation** (one module's real code), via a minimal ports-and-adapters pattern:

1. **Port** — a pure TypeScript interface in `src/modules/_shared/ports/*.ts`, importing NOTHING from any module. `NewsMediaPort` (a capability owned by `news_portal`, consumed by `blog_content`) and `PublicContentPort` (a capability owned by `blog_content`, consumed by `news_portal`).
2. **Adapter** — a concrete implementation of one port, living in the module that OWNS the capability itself (`news-portal/application/news-media-port-adapter.ts`, `blog-content/application/public-content-port-adapter.ts`). Other modules NEVER import another module's adapter file directly.
3. **Composition root** — the route handler (`src/pages/api/v1/**`, `src/pages/news/**`, `src/pages/blog/**`) that imports the concrete adapter and injects it (an ordinary function parameter, not a DI framework) into the other module's `application` function that needs the capability. Route handlers ALREADY are the outermost layer allowed to import across modules (an existing convention, not a new one) — which is what makes them the natural composition root, with no new infrastructure.
4. The gallery-rendering part of `renderContentJsonToHtml` (used by BOTH modules; previously `news_portal` imported the `blog_content` function for it) moves to `_shared/rendering/gallery-block-renderer.ts` — code that is genuinely shared moves to neutral ground, rather than one module "borrowing" from the other.
5. `ModuleDescriptor` (`_shared/module-contract.ts`) gets a new optional field, `capabilities?: {provides, consumes}` — structured documentation of this port relationship, kept separate from `dependencies` (which stays purely about enable/disable lifecycle ordering).
6. A new structural test (`tests/unit/module-boundary.test.ts`) scans `blog-content`/`news-portal`'s `application`/`domain` trees for direct imports into another module's tree and fails loudly when it finds one — preventing a silent regression to the old pattern.

## Consequences

- **Positive:** `blog_content`/`news_portal`'s `application`/`domain` layers now genuinely know nothing about each other's implementation — only about data shapes (DTOs) and interfaces (ports) that are independent of who implements them. Verified automatically, not merely documented.
- **Positive:** the port DTOs (`PublicContentPostSummaryDTO`, etc.) are deliberately NOT re-exports of the owning module's original types — a port never creates a source dependency on today's implementation.
- **Negative/trade-off:** every function that needs a cross-module capability now takes one extra parameter (the port), and every calling route handler has to import the concrete adapter and inject it — slightly more verbose than the old direct import, a price worth paying to remove a real cycle.
- **Neutral:** BOTH modules' `dependencies` arrays still deliberately do NOT list each other (the Issue #632 decision, still in force) — `capabilities` is a SEPARATE documentation/verification layer for the source-level relationship, not a replacement for or an addition to the enable/disable lifecycle graph.

## Alternatives considered

- **Leave the cycle as it is and just document it** — rejected: epic #679's audit explicitly flags it as a P0 risk, and without a structural test anyone could silently add a new edge in the future without realising they are deepening the same cycle.
- **Merge `blog_content`+`news_portal` into one module** — explicitly outside the scope of issue #681 itself ("Merging the two modules" is in §Out of scope) — the two modules have genuinely different lifecycles/permissions/product scopes (basic blog vs. an R2-only editorial layer), and merging them removes the independent enable/disable flexibility that already exists.
- **A global service-locator/registry for adapters** (instead of manual parameter injection) — rejected: this repo has no DI framework/container anywhere, and adding one JUST for these two modules is new complexity out of all proportion; an ordinary function parameter is enough and is consistent with the "pure functions + an explicit `tx: Bun.SQL`" style already used across the codebase.
