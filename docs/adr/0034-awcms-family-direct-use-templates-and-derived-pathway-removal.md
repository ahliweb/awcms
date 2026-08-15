🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](0034-awcms-family-direct-use-templates-and-derived-pathway-removal.id.md)

# ADR-0034 — The AWCMS family as DIRECT-USE templates for any development, and removal of the derived-application pathway

- **Status:** Accepted
- **Date:** 2026-07-21
- **Decision maker:** @ahliweb
- **Supersedes:** [ADR-0013](0013-extension-layers-and-boundary-model.md) (Derived Application layer), [ADR-0014](0014-deterministic-build-time-module-composition.md) (build-time composition for derived applications / `application-registry.ts`), [ADR-0015](0015-derived-application-compatibility-manifest.md) (derived compatibility manifest + `extension:check`), [ADR-0022](0022-erp-modules-live-in-extension-repos.md) (domain modules live in extension repos), [ADR-0025](0025-implement-deterministic-build-time-module-composition.md) (composition implementation for the base registry + derived applications). Reaffirms: the core technical conventions (ADR-0001 Bun-only/RLS/RBAC-ABAC, ADR-0003 RLS, ADR-0004 default-deny, ADR-0011 capability ports).
- **Aligned with:** awcms-micro `ADR-0034` (direct-use templates, deprecation of the derived pathway) and `ADR-0035` (the base composition mechanism stays) — this document aligns that decision across the whole family (see §5), with awcms going one step further: it **removes** the derived-pathway surface rather than merely deprecating it.
- **Partially refined by:** [ADR-0035](0035-awcms-online-first-erp-saas-superset-repositioning.md) (2026-07-24) — specifically the **positioning of `awcms`**: the scope table in §Decision.1 and the "offline-first" identity for `awcms`. ADR-0035 sets `awcms` to be a **hybrid online-first, ERP + integrated SaaS ready, family superset** (absorbing the awcms-micro website/e-commerce cluster). The governance model below (§Decision.2 & §3: direct use, NO derived repos) **remains fully in force**.

> **Partial supersede note (ADR-0035).** The line "Operating mode: offline-first" and the `awcms` ↔ `awcms-micro` scope boundary in this document are **replaced** by [ADR-0035](0035-awcms-online-first-erp-saas-superset-repositioning.md): `awcms` is now **online-first hybrid + superset** (absorbing awcms-micro). The rest (removal of the derived pathway, three direct-use templates, domain modules in `src/modules/`) is unchanged.

## Context

Epic #177 and pilot #187 built the **derived-application pathway**: `awcms` used as a foundation on top of which a domain application is built in a **separate repo** (e.g. `awcms-erp-pilot`) via the seam `src/modules/application-registry.ts` + migration namespace 900–999 + a compatibility manifest + the gate `bun run extension:check`. ADR-0022 even ruled that domain modules (including every content/website module) **must not** live in the base `src/modules/`, but in an extension repo instead.

Two unintended consequences:

1. **A derivative repo adds a layer without an equivalent benefit.** To build anything, the "create a separate derived repo on top of the base" model requires an application registry, a special migration numbering scheme, a compatibility manifest, and gates that have to be maintained — when for many needs it is enough to **use the template repo directly** and add modules inside it.
2. **The three family repos are in fact standalone templates.** `awcms-mini` (the modular-monolith standard), `awcms` (ERP foundation + back-office solution), and `awcms-micro` (full-online website through to online shop) are each already complete as a starting point. awcms-micro has already stated this position (its own ADR-0034/0035). The "mandatory base + separate derivative" framing contradicts that reality.

## Decision

### 1. The three family repos = DIRECT-USE templates for any development

`awcms-mini`, `awcms`, and `awcms-micro` are **three peer base templates**, each **used directly** as a development starting point — not a mandatory derivation base on top of which a separate application repo must be built. Their difference is **scope/lineage**, not hierarchy:

| Repository    | Role (used directly)               | Scope                                             |
| ------------- | ---------------------------------- | ------------------------------------------------- |
| `awcms-mini`  | Standard modular-monolith template | Generic reusable foundation                       |
| `awcms`       | ERP / back-office lineage template | ERP, business solutions, and any development      |
| `awcms-micro` | Full-online website template       | Content sites through to online shop (e-commerce) |

The primary way to use them: **fork/use the repo whose scope is closest, then develop modules directly inside it.** The inheritance of conventions across repos is still recorded (Bun-only, RLS/FORCE, RBAC/ABAC default-deny, OpenAPI/AsyncAPI contracts, CI gates), but no repo is positioned as "a derivative that must continuously port from another repo".

### 2. Do NOT create derivative repos

New development is **not** done by creating a separate derived-application repo on top of one of the templates. Domain modules — including content/website modules — **may and should** live directly in `src/modules/` of the template being used. This supersedes ADR-0022 (which forbade domain modules in the base): that restriction is revoked.

### 3. The derived-application pathway in `awcms`: REMOVED

Unlike awcms-micro, which deprecated it (its own ADR-0034) and then **kept** the code (ADR-0035, because the composition mechanism = load-bearing base infrastructure), `awcms` **removes** the surface that is **specific to the derived pathway**:

- The derived seam `src/modules/application-registry.ts` (always `undefined` in the base), the gate `bun run extension:check`, and the fixture `tests/fixtures/derived-application-example`.
- The concept of a derived migration namespace (900–999) and the derived compatibility manifest (`extension.manifest.json`, ADR-0015).

**What is KEPT** because it is load-bearing for the base (not derived-only; used by base registry assembly, SoD, reporting, conformance): `src/modules/index.ts` `listModules()`, the `ModuleDescriptor`/`defineModule` contract (`_shared/module-contract.ts`), `module-management`, and base composition validation to the extent that it checks **the base registry itself** (not a derived application registry). The removal is carried out as a separate **evidence-gated** step (its own PR, `bun run check` + full CI green) — not in this ADR; this ADR is the decision.

### 4. Derived-pathway documents & issues: obsolete

`docs/awcms/derived-application-guide.md`, `derived-app-pilot-plan.md`, `derived-app-pilot-purchase-requisition-plan.md`, and `derived-app-pilot-purchase-requisition-execution.md` are marked **DEPRECATED** (pointing at this ADR). Issue #187 (the derived ERP pilot) and the derived-pilot part of EPIC #177 are closed as obsolete; the foundational capabilities that are already finished and valuable (ABAC/SoD/business-scope authorization #179–#181, modular OpenAPI contracts #182, conformance #183) **stay** — only the "separate derived repo" premise is revoked.

### 5. Cross-family harmonisation

The same posture is applied to all three repos (a separate step per repo):

- **awcms-micro:** already in this position (its own ADR-0034/0035). Aligned to the "three peer templates + no derivative repos" framing. Removal of the composition code is **not** forced here — its own ADR-0035 already proved that mechanism is load-bearing; only the narrative/positioning is aligned.
- **awcms-mini:** repositioned from "a base on top of which derived applications are built" to "a direct-use standard template"; the derived-pathway documents/ADRs (ADR-0013/0015) are deprecated; code removal follows the load-bearing reality per repo (as with micro).
- **awcms:** this document + full removal of the derived-only surface (§3).

## Consequences

- **Positive:** no mandatory derived-repo layer; development happens directly in the template; website modules may enter the base (`no-content-website-modules` is revoked, opening the way to implementing website modules directly, e.g. `theming`).
- **Enforced separately:** (a) removal of the derived-only code/gates in `awcms` (§3) — an evidence-gated PR; (b) direct implementation of the first website module (`theming`, adapted from awcms-micro); (c) an update to `awcms-family-compatibility.yaml` (revoking the `no-content-website-modules` divergence, adjusting `module-type-without-derived`); (d) repositioning README/AGENTS; (e) mini/micro harmonisation.
- **Unchanged:** every runtime convention (Bun-only, RLS/FORCE, RBAC/ABAC default-deny, contracts, the current base registry, non-derived CI gates). This ADR changes the **usage & governance model**, not the runtime architecture.
