🇬🇧 English (default) · 🇮🇩 [Bahasa Indonesia (sumber)](family-compatibility.id.md)

<!-- i18n-source-hash: sha256:194ef733f7d4b4f77f012e016aa9f4201bd481371c2daef01b1d84c3e0ed6318 -->

# AWCMS family compatibility with the AWCMS-Mini standard

> **Status:** operational working contract (Issue #183, epic #177, [ADR-0032](../adr/0032-family-compatibility-manifest-and-ci-conformance.md)). Complements [`alur-pengembangan-mini-first.md`](alur-pengembangan-mini-first.md) (mature it in mini first, then port) and [ADR-0015](../adr/0015-derived-application-compatibility-manifest.md) (the downstream compatibility manifest toward derived applications).

AWCMS is a **foundation rebuild** on top of the [AWCMS-Mini](https://github.com/ahliweb/awcms-mini) modular-monolith standard ([ADR-0001](../adr/0001-rebuild-on-awcms-foundation-erp-scope.md)). This document describes how this base declares its **conformance** to that family standard in a machine-readable, CI-enforced way — so differences from the standard are explicit, testable, and never depend on comparing file copies by hand.

## 1. Artifacts

| Artifact                                                                                 | Role                                                                                                |
| ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| [`awcms-family-compatibility.yaml`](../../awcms-family-compatibility.yaml)               | Single declarative manifest (repo root) — contract versions, stack versions, divergence allow-list. |
| [`awcms-family-compatibility.schema.json`](../../awcms-family-compatibility.schema.json) | JSON Schema draft-07 for external/human tooling.                                                    |
| `src/modules/_shared/family-contract.ts`                                                 | Source of truth: `FAMILY_CONTRACT_VERSION`, manifest types, authoritative validator (zero-import).  |
| `scripts/family-conformance-check.ts`                                                    | The `bun run family:conformance:check` gate + evidence-report generator.                            |
| `tests/family-conformance*.test.ts`                                                      | SEMANTIC contract tests that give each version teeth (mutation-provable).                           |

## 2. Family contract version — a seventh versioning scheme

`FAMILY_CONTRACT_VERSION` (`family-contract.ts`) is the **seventh** versioning scheme on top of the six already documented ([ADR-0008](../adr/0008-independent-contract-and-module-versioning.md)/[ADR-0015](../adr/0015-derived-application-compatibility-manifest.md): package release, REST contract, event contract, module descriptor, per-capability, extension-manifest). It is the version every conformance fixture/snapshot is pinned to.

- **MAJOR** — a reusable control's semantic contract is weakened/removed so a derived application written against the previous family contract breaks (a change in default-deny/RLS/redaction/audit/idempotency/envelope/migration-immutability semantics). Every such change is **breaking**.
- **MINOR** — a new contract is added, or an existing one tightened in a backward-compatible way.
- **PATCH** — documentation-only clarification.

## 3. Pinned contract versions

Every version the manifest declares is checked by the gate against the real source (mismatch → CI red). "Family-owned" contracts have no standalone constant; their number is pinned to `FAMILY_OWNED_CONTRACT_VERSIONS` and given teeth by a semantic contract test.

| Contract                      | Value   | Pinned to                                                               |
| ----------------------------- | ------- | ----------------------------------------------------------------------- |
| module descriptor contract    | `1.3.0` | `MODULE_CONTRACT_VERSION` (`module-contract.ts`)                        |
| capability contract           | `1.0.0` | `CAPABILITY_CONTRACT_VERSIONS` (per capability key)                     |
| REST API contract             | `0.1.0` | `info.version` of `openapi/awcms-public-api.openapi.yaml`               |
| event API contract            | `0.1.0` | `info.version` of `asyncapi/awcms-domain-events.asyncapi.yaml`          |
| response/error envelope       | `1.0.0` | family-owned; envelope test over `_shared/api-response.ts`              |
| tenant-context/RLS            | `1.0.0` | family-owned; fail-closed test under `FORCE RLS`                        |
| audit/redaction               | `1.0.0` | family-owned; redaction test over `_shared/redaction.ts`                |
| idempotency                   | `1.0.0` | family-owned; test over `_shared/idempotency.ts`                        |
| migration checksum (`sha256`) | `1.0.0` | family-owned; `validateAppliedChecksums` test (`scripts/db-migrate.ts`) |

## 4. Validated stack versions + compatibility matrix

A manifest `declared` value MUST equal the real value at the `source` it points to (the compatibility-matrix assertion). Matrix intent: exercise the **current** and **minimum-supported** versions.

| Component        | Current   | Minimum-supported | Source                                                         |
| ---------------- | --------- | ----------------- | -------------------------------------------------------------- |
| Bun (pin)        | `1.3.14`  | `>=1.3.0`         | `package.json` `packageManager` / `engines.bun`                |
| Bun (CI current) | `1.3.14`  | —                 | `.github/workflows/ci.yml` job `quality` `setup-bun`           |
| Bun (CI minimum) | —         | `1.3.0`           | `.github/workflows/ci.yml` job `minimum-supported` `setup-bun` |
| Astro            | `^7.0.7`  | `^7.0.7`          | `package.json` `dependencies.astro`                            |
| `@astrojs/node`  | `^11.0.2` | `^11.0.2`         | `package.json` `dependencies`                                  |
| TypeScript       | `^7.0.2`  | `^7.0.2`          | `package.json` `devDependencies`                               |
| PostgreSQL       | `18.4`    | `18.4`            | `.github/workflows/ci.yml` `services.postgres`                 |

Minimum-supported is **actually run**, not merely declared: the `minimum-supported` job sets up Bun `1.3.0` (== the `engines.bun` floor) then runs `bun install --frozen-lockfile` + `typecheck` + `build` (Astro SSR) + `family:conformance:check`. The gate asserts the set of CI Bun versions is EXACTLY {current, minimum} AND that `ciMinimum` == the `engines` floor — so deleting the minimum job or shifting the floor turns the gate RED. The Astro/@astrojs/node/TypeScript "minimum" == their current caret ranges, so no separate cell is needed; PostgreSQL declares only 18.4 (no separate floor). The Astro SSR runtime on Bun (the `@astrojs/node` adapter) is exercised for real by `bun run build` (in `check` AND the minimum cell) and the `e2e-smoke` job that STARTS the server (`bun ./dist/server/entry.mjs`) → login → SSR render; the existence of `e2e-smoke` is asserted by `tests/family-conformance-ci-parity.test.ts` (there is no standalone in-suite SSR test — a duplicate build+start+probe would just re-run e2e-smoke).

## 5. Intentional-divergence registry

Deliberate differences from the mini standard are listed explicitly under `intentionalDivergences`. They are **not** a backlog of unfinished ports — each entry requires a `reason`, `owner`, `reviewDate` (the gate fails once it is in the past), and `adr` (the file must exist).

| id                                        | Summary                                                     | ADR      |
| ----------------------------------------- | ----------------------------------------------------------- | -------- |
| `no-content-website-modules`              | The mini CMS/content modules are not ported to the base     | ADR-0022 |
| `module-type-without-derived`             | `ModuleType` omits "derived" (uses "domain")                | ADR-0025 |
| `openapi-one-file-per-module`             | OpenAPI one-file-per-module, not per-tag                    | ADR-0026 |
| `oidc-ssrf-blocks-private-ip`             | SSRF guard blocks private IPs (reversing the mini decision) | ADR-0028 |
| `mfa-session-assurance-built-new`         | Session assurance/step-up built new                         | ADR-0027 |
| `business-scope-base-resolver-noop`       | Base hierarchy resolver is a fail-closed NO-OP              | ADR-0030 |
| `sod-rules-illustrative-in-fixture`       | Base ships 0 SoD rules; illustrative rules only in fixture  | ADR-0031 |
| `turnstile-keeps-deployment-profile-gate` | Turnstile keeps the profile gate (LAN/offline exempt)       | ADR-0029 |
| `semver-continues-legacy-major-line`      | Release version continues the legacy major line (5.x)       | ADR-0024 |

## 6. Gate, contract tests, and evidence report

`bun run family:conformance:check` validates the manifest against the schema AND cross-references each version against the real source, checks the divergence allow-list, then emits a pass/fail-per-contract **evidence report**. The report is built only from version strings + contract names — it **never** contains secrets/DSN/env (asserted by `assertEvidenceReportSecretFree`). Write it to a file: `bun run family:conformance:check --report <path>` or the `FAMILY_CONFORMANCE_REPORT_PATH` env.

Contract tests are **semantic** and **mutation-provable** — weakening a control turns the test/gate RED:

- **tenant-context fail-closed** — no tenant GUC → zero rows; a fail-open policy (`USING (true)`) → leaks every row (`tests/family-conformance-db.test.ts`, needs Postgres).
- **response envelope** — `{success,data,meta}` / `{success:false,error:{code,message}}` shape; envelope drift is caught.
- **redaction** — sensitive keys/values → `[REDACTED]`; a weakened redactor → the leak is caught.
- **idempotency** — key-order-stable, payload-sensitive hash; a collapsed hash → conflicts are missed.
- **migration immutability** — editing an applied migration → `validateAppliedChecksums` throws (pure, no DB).
- **module composition** — a duplicate module key → composition invalid.

Gate wiring ([ADR-0015](../adr/0015-derived-application-compatibility-manifest.md) §6 lesson): `package.json` `check` + an explicit step in `ci.yml`'s `quality` job + `release.yml` inherits via `bun run check`. A parity test (`tests/family-conformance-ci-parity.test.ts`) keeps the step from silently dropping out.

## 7. Upgrade / contract-change checklist

When a change touches the family contract:

1. **Classify the change.** Bumping a source contract version (e.g. `MODULE_CONTRACT_VERSION`), adding/changing the stack, or changing a reusable control's semantics?
2. **Update the source first**, then **update `awcms-family-compatibility.yaml`** to match (contract + stack versions).
3. **A weakening is breaking.** If the change weakens default-deny/RLS/redaction/audit/idempotency/envelope/migration-immutability, bump `FAMILY_CONTRACT_VERSION` **MAJOR** and update the pinned contract tests/snapshots in the same PR.
4. **A new divergence** needs a complete allow-list entry (reason/owner/reviewDate/adr) + its ADR.
5. **Run** `bun run family:conformance:check` to green, then the FULL `bun run check`, then the DB suite (`DATABASE_URL` set) including `tests/family-conformance-db.test.ts`.
6. **Prove the gate bites** — mutate one contract (e.g. change a version in the manifest) and confirm the gate goes RED before reverting.
7. **Changeset** + update the Changelog below if `FAMILY_CONTRACT_VERSION` bumped.

## 8. Stack migration/upgrade runbook

Raising a stack version (Bun/Astro/@astrojs/node/TypeScript/PostgreSQL):

1. Bump it in the authoritative source (`package.json` and/or `.github/workflows/ci.yml`).
2. Sync `stack.*.declared` in the manifest.
3. `bun install` (Bun-only — no npm/npx/pnpm/yarn), `bun run build`, `bun run check`.
4. For PostgreSQL: run `bun run db:migrate` + the DB suite against the new image; verify the `FORCE RLS` invariant (`tests/family-conformance-db.test.ts`).
5. For minimum-supported: re-run the suite on the stated minimum before raising the `engines` floor.
6. `bun run family:conformance:check` green (the declared == actual compatibility-matrix assertion).

## 9. Versioning policy + family-contract changelog

`FAMILY_CONTRACT_VERSION` is bumped only by a change that alters the family contract (sections 2/7); the package release version evolves separately ([ADR-0024](../adr/0024-semver-numbering-continues-legacy-major-line.md)).

### Changelog

- **1.0.0** (Issue #183, 2026-07-19) — first declaration. Manifest + schema + `family:conformance:check` gate + semantic contract tests + a registry of 9 intentional divergences.

## 10. References

- [`alur-pengembangan-mini-first.md`](alur-pengembangan-mini-first.md) — the "mature it in mini first, then port" contract.
- [`../adr/0032-family-compatibility-manifest-and-ci-conformance.md`](../adr/0032-family-compatibility-manifest-and-ci-conformance.md) — the full decision.
- [`../../AGENTS.md`](../../AGENTS.md) — the mandatory per-task workflow.
