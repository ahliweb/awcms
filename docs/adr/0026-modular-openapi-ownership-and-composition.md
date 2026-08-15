🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](0026-modular-openapi-ownership-and-composition.id.md)

# ADR-0026 — Modular OpenAPI contract: per-module ownership, deterministic bundle, and fragment contributions from derived applications

- **Status:** Accepted
- **Date:** 2026-07-19
- **Decision maker:** @ahliweb
- **Related:** Issue #182 (epic #177 "Derived ERP foundation readiness", Wave 1), ADR-0008 (independent contract versioning), ADR-0025/ADR-0014 (composition seam #178), ADR-0013 (extension boundary), ADR-0022 (ERP modules live in the extension repo), ADR-0023 (bilingual docs), `openapi/awcms-public-api.src.yaml`, `openapi/modules/*.openapi.yaml`, `scripts/openapi-bundle.ts`, `scripts/api-spec-check.ts`, `scripts/api-docs-generate.ts`, `openapi/README.md`, `docs/awcms/api-contribution-guide.md`

## Context

Until Issue #182, the awcms public REST contract was centralised in one monolithic file `openapi/awcms-public-api.openapi.yaml` (~153 KB, 96 paths, 118 operations). That pattern is still manageable on a 10-module foundation, but it becomes a bottleneck once a derived ERP application adds many modules: there is no per-module ownership boundary, every change touches one giant file, and there is no mechanism for a derived module to contribute its own contract without editing base files.

AWCMS-Mini has already validated the fragment + bundler + documentation generator + consistency gate pattern (Issue #695/#700). This ADR records the decision to **port** that pattern into awcms, with the structural differences specific to awcms, without copying mini's content modules (blog/news/etc.) which are not this repo's scope.

The principles that remain binding: an API change requires OpenAPI; the public contract does not change without a changeset/ADR (ADR-0008); ERP domain modules are not built in the base (ADR-0022); derived composition is 100% compile-time without editing the base registry (ADR-0013/0025).

## Decision

### 1. Source structure: a root fragment + one fragment per module, bundle generated

- `openapi/awcms-public-api.src.yaml` — root fragment: `openapi`/`info`/`servers`/`tags`/`security`, and `components.securitySchemes`/`parameters`/`responses`, plus schemas used by 2+ modules (or used by no path at all). For awcms only two schemas live at the root: `ApiError` (the error envelope, referenced by `components.responses`) and `ApiMeta` (referenced by many modules).
- `openapi/modules/<module>.openapi.yaml` — one fragment per base module that owns an API (10 modules) plus `foundation.openapi.yaml` for platform operations that genuinely belong to no module (`health`, `db pool health`). Each fragment owns every path tagged with that module plus every `components.schemas` referenced ONLY by its operations.
- `openapi/awcms-public-api.openapi.yaml` — a **GENERATED artifact** produced by `bun run openapi:bundle`, at the same path as before (every consumer — the route-parity check, health-registry, the documentation generator — keeps reading it). Never edited by hand.

**Structural difference awcms vs mini (documented deliberately):** mini uses the convention "one file = one tag" (e.g. `management-reporting.openapi.yaml` and `reporting-projections.openapi.yaml` kept separate). awcms uses **"one file = one module"** because `ModuleDescriptor.api.openApiPath` points at exactly one fragment. The consequence is that the `reporting` module owns BOTH tags (`Management Reporting` + `Reporting Projections`) in a single `reporting.openapi.yaml`. `foundation.openapi.yaml` is owned by no module descriptor (there is no "foundation module") — it is a standalone fragment that is still bundled because the bundler globs the whole of `openapi/modules/`.

### 2. Contract equivalence with the pre-migration monolith (no API behaviour change)

The migration splits the monolith WITHOUT changing any URL, security, request/response, or schema. Proven by `tests/openapi-bundle.test.ts`, which compares the generated bundle against the frozen snapshot `tests/fixtures/openapi-pre-migration-snapshot.openapi.yaml` semantically (order-independent deep-equal over `paths`/`components.schemas`/`securitySchemes`/`parameters`/`responses`/`security`/`info`/`servers`).

The only deviation allowed and documented: the `Domain Event Runtime` tag declaration, which was previously USED by the `/api/v1/domain-events/*` operations but never declared in the top-level `tags` list. Added as a pure documentation fix (no path/schema/security change) — the same pattern as mini's fix in Issue #695. The test verifies that the bundle's tags are a SUPERSET of the monolith's tags with that single addition.

### 3. Bundle determinism

The bundler loads fragments in explicitly sorted filename order (not the `readdir` order, which is not guaranteed stable), re-sorts every `paths` and `components.schemas` key alphabetically, uses a fixed top-level key order, and formats with the project Prettier (no randomness). `bun run openapi:bundle` is idempotent: same input → byte-identical output (proven by the test "bundling twice produces byte-identical output").

### 4. Fragment contributions from derived applications through composition seam #178

`ModuleDescriptor.api.openApiPath` (a field that ALREADY EXISTS since the foundation — no addition needed, so `MODULE_CONTRACT_VERSION` is not bumped) now points at each module's source fragment rather than at the monolithic bundle. A derived module contributes its contract by (a) declaring `openApiPath` pointing at its own fragment and (b) having the derived build feed every registered module's `openApiPath` into the seam `buildBundledDocument(rootDir, { extraFragmentFiles })`. Derived fragments merge into the bundle **without editing any base fragment**.

Override guardrail: a fragment (root/base or module) that re-declares an existing path or schema throws `BundleConflictError` — a module can NEVER silently overwrite a root/base path/operation/schema. Proven by `tests/openapi-extra-fragment.test.ts` (successful merge + two rejected override cases) using the fixture `tests/fixtures/example-domain-modules/`.

### 5. New gates and the documentation generator

- `bun run openapi:bundle` (`scripts/openapi-bundle.ts`) — merges fragments → bundle (mutating; not part of `check`).
- `bun run api:spec:check` (extended) — beyond the old guarantees (two-way route↔OpenAPI parity, unique `operationId`, explicit security + `security: []` allow-list, path parameters), it now also covers: **bundle freshness** (the committed bundle == the generated result; catches both a fragment edited without re-bundling AND a bundle edited by hand), **standard error schema** (every 4xx/5xx/`default` response resolves to the `ApiError` envelope), **allow-list is used** (every `ALLOWED_PUBLIC_OPERATIONS` entry actually exists). Merge conflicts from derived fragments surface as a spec-check failure.
- `bun run api:docs:generate` (`scripts/api-docs-generate.ts`) + `bun run api:docs:check` — a deterministic Markdown documentation generator producing `docs/awcms/api-reference.md` from the bundle + AsyncAPI (example values are always synthetic, no real secrets/hostnames), plus a read-only freshness gate.

Added to `bun run check` (`api:docs:check`) AND as an explicit step in `.github/workflows/ci.yml` (parity — a repo invariant). `release.yml` runs `bun run check` verbatim so it is covered automatically.

### 6. Contract versioning

The contract's `info.version` remains SemVer independent of the package version (ADR-0008), bumped only when the contract's SHAPE changes. This migration does not bump it (the contract is equivalent; the tag declaration is pure documentation).

## Consequences

- **Positive:** Per-module API ownership becomes explicit; a change touches a small fragment, not the monolith. Derived modules contribute contracts without editing the base. A deterministic bundle + freshness gate closes route↔fragment↔bundle↔docs drift. The error envelope stays uniform across fragments.
- **Neutral:** Adds no SQL migration, endpoint, or event; does not bump `MODULE_CONTRACT_VERSION` (the `api.openApiPath` field already exists). The bundle stays at its old path so consumers are unchanged.
- **Negative/trade-off:** Adds an `openapi:bundle` step to the API-change flow (edit fragment → re-bundle → commit both) — enforced by the freshness gate so it is not forgotten. Contract authors must know that shared schemas go in the root and single-module schemas go in the fragment.
- **Reconciliation:** `docs/awcms/api-reference.md` was previously a copied mini artifact (docs-ahead-of-code: referencing scripts/fragments that did not exist, mini blog/news content, `info.version 1.0.0`). It is now regenerated from the real awcms contract.

## Alternatives considered

- **Keeping the monolith** — rejected: an ownership bottleneck once derived modules multiply (epic #177 context).
- **One file = one tag (the mini convention)** — rejected for awcms: a single `openApiPath` per module fits "one file = one module" better; §1.
- **Allowing derived fragments to override base paths (sanctioned override)** — rejected in this scope: default-deny is safer; an explicit override can be added later if a real need appears, through its own mechanism.
- **Adding `additionalProperties: false`/`required` to response schemas during the migration** (so drift is detected more sharply) — rejected: that changes the contract's shape and violates the migration's equivalence guarantee; do it separately with its own changeset/ADR if wanted.
