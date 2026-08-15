🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](0008-independent-contract-and-module-versioning.id.md)

# ADR-0008 — Independent versioning: package, API/event contract, module descriptor

- **Status:** Accepted
- **Date:** 2026-07-06
- **Decision maker:** maintainer
- **Related:** `docs/awcms/09_roadmap_repository_commit.md`, `docs/awcms/05_openapi_asyncapi_detail.md`, ADR-0007 (OpenAPI/AsyncAPI contracts mandatory), Issue #451

## Context

`package.json` is already at `0.23.5` (SemVer, Changesets-driven, bumped on every PR that changes behaviour), while `openapi/awcms-public-api.openapi.yaml` and `asyncapi/awcms-domain-events.asyncapi.yaml` are still at `info.version: 0.1.0`, and all 7 `src/modules/*/module.ts` are still `version: "0.1.0"` with `status: "experimental"` — even though those modules are fully implemented, tested, and hardened by the security work (Issue #437). Without a written policy, these numbers look stale/conflicting with no explanation.

## Decision

We decide on **three independent version schemes**, each with its own bump rules — not mechanically kept in lockstep with one another:

1. **`package.json` (repo release SemVer)** — already correct, unchanged. Driven by Changesets; bumped on every PR that changes application behaviour (feature/fix/breaking). This is the _release_ version, not the _contract_ version.

2. **OpenAPI/AsyncAPI `info.version` (contract SemVer)** — independent of the release version. Bumped only when **the shape of the contract itself** changes:
   - **PATCH** — fixes to contract descriptions/documentation, with no schema change.
   - **MINOR** — backward-compatible additive changes (new endpoint/event, new optional field, new parameter).
   - **MAJOR** — breaking changes (field/endpoint removed/renamed, response shape changed).

   `1.0.0` marks a contract **declared stable** for production consumption — not "first release", but "this API is mature and ready to be used by derived applications/external clients without an experimental disclaimer". All 18 base backlog issues + M9 hardening being complete is the right point for that declaration, so `info.version` is raised **once** from `0.1.0` to `1.0.0` as part of this ADR (not mechanically following `package.json` — the next PR that adds a new optional field simply bumps to `1.1.0`, NOT jumping along to release version `0.24.0`).

3. **Module descriptor `version`/`status` (`src/modules/*/module.ts`)** — independent of both, following the maturity of the module itself:
   - `status: "experimental"` — new/scaffold module, the API/schema surface can still change significantly, not used by a real feature yet.
   - `status: "active"` — the module is fully implemented, has real endpoints/domain logic that are used, is tested, and has been through a security review.
   - `status: "deprecated"` — the module is superseded, scheduled for removal.

   All seven base modules (`identity_access`, `logging`, `profile_identity`, `reporting`, `sync_storage`, `tenant_admin`, `workflow_approval`) already have real endpoints/domain logic, RLS+ABAC, tests, and passed the Issue #437 security audit — status changed `experimental` → `active`, version raised `0.1.0` → `1.0.0` (the same stability declaration as for the contract). The next module version bump happens when that module's own capability really changes, decided by whoever ships that change — not by following the package or contract release.

The module descriptor `status` is purely descriptive metadata — it is not validated or consumed by any runtime (checked: no endpoint exposes it or gates behaviour on this field) — so changing it carries zero behavioural risk.

### Minimal enforcement

`scripts/api-spec-check.ts` (`bun run api:spec:check`) now validates that the OpenAPI **and** AsyncAPI `info.version` must be SemVer-shaped (`X.Y.Z`) — not merely "present", as before. This prevents empty/placeholder contract versions without forcing a particular value, so a legitimate contract bump never fails this check.

## Consequences

- **Positive:** every version number (`package.json`, contract, module) has its own meaning and bump rule that can be explained — no more "why is this still 0.1.0?" without an answer. The `active` module descriptor now honestly reflects real maturity.
- **Trade-off:** contributors must know which scheme to bump for a given change (application behaviour → package; contract shape → OpenAPI/AsyncAPI; module capability → module descriptor) — documented here so it is not ambiguous.
- **Neutral:** derived applications that add their own domain modules follow the same pattern (start at `0.1.0`/`experimental`, move to `active`/`1.0.0` when mature).

## Alternatives considered

- **Mechanically align all versions to `package.json`** — rejected: it would falsely signal that the contract/module changes every time _anything_ in the repo changes, when in fact both have their own change cycles (contract shape rarely changes; module scope rarely changes).
- **Leave contract/module versions independent with no written policy** — rejected: that was exactly the situation before this ADR, confusing new contributors and external API consumers (precisely the problem raised by Issue #451).
