🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](0032-family-compatibility-manifest-and-ci-conformance.id.md)

# ADR-0032 — AWCMS family compatibility manifest and CI conformance against the AWCMS-Mini standard

- **Status:** Accepted
- **Date:** 2026-07-19
- **Decision-maker:** maintainer
- **Related:** Issue #183, epic #177 (derived ERP foundation readiness, Wave 1); ADR-0001 (rebuild on the awcms-mini foundation); ADR-0008 (independent contract versioning); ADR-0015 (derived-application compatibility manifest — the pattern mirrored upstream); ADR-0025 (module composition #178); ADR-0026 (modular OpenAPI #182); ADR-0023 (bilingual documentation); ADR-0027/0028/0029/0030/0031 (sources of intentional divergence)

## Context

AWCMS adopts the AWCMS-Mini technical standard (ADR-0001), but keeping in sync relies on manual porting, documentation, and human review. That pattern has repeatedly produced drift in migration references, agent skills, modules, CI gates, and documentation — and there is not a single machine-readable artifact that can distinguish:

- the parts that **must be semantically compatible** with the standard (default-deny, RLS, redaction, audit, idempotency, envelope, migration immutability);
- the parts that are **deliberately different** because AWCMS's scope is ERP readiness foundation, not a CMS product (e.g. the SSRF guard reversing mini's decision, MFA session-assurance built fresh, content modules not ported);
- the **stack versions** that have been tested together (Bun/Astro/@astrojs/node/TypeScript/PostgreSQL);
- the **conformance evidence** that can be audited.

ADR-0015 (Issue #741, adapted from mini) already built the compatibility manifest in the **downstream** direction — how a derived application states its compatibility with a base release. This ADR builds the complementary layer in the **upstream** direction: how the AWCMS base states its conformance with the AWCMS family standard, enforced by CI.

## Decision

### 1. A versioned machine-readable manifest + schema

`awcms-family-compatibility.yaml` (repo root) is the single declarative source. It is validated by `validateFamilyManifestShape()` in `src/modules/_shared/family-contract.ts` (the authoritative, zero-import validator — the same discipline as `module-contract.ts`) AND published as JSON Schema draft-07 `awcms-family-compatibility.schema.json` for external tooling. Both sides are kept from drifting: the gate verifies that the JSON schema's `required` list equals the validator's `REQUIRED_TOP_LEVEL_KEYS`.

### 2. Family contract version — the SEVENTH versioning scheme

`FAMILY_CONTRACT_VERSION` (`family-contract.ts`, `"1.0.0"`) is the seventh versioning scheme on top of the six already documented by ADR-0008/ADR-0015 (package release, REST contract, event contract, module descriptor, per-capability, extension-manifest). It is the version every conformance fixture/snapshot is pinned to. Every contract version the manifest declares MUST be one of:

- **matching a real source constant** — `MODULE_CONTRACT_VERSION`, `CAPABILITY_CONTRACT_VERSIONS`, the OpenAPI/AsyncAPI `info.version` (the gate reads the source and fails on mismatch); or
- **family-owned** — pinned in `FAMILY_OWNED_CONTRACT_VERSIONS` (`family-contract.ts`) and given teeth by SEMANTIC contract tests that go RED when their control drifts (envelope, tenant-context/RLS, audit/redaction, idempotency, migration checksum).

No version number floats without a source of truth.

### 3. The `family:conformance:check` gate — wired in three places (the lesson of PR #769/#770)

`scripts/family-conformance-check.ts` — pure (no DB/network), safe in every build. It cross-references the manifest against real sources, validates the intentional divergence allow-list (well-formed, not expired, ADR exists), and emits a pass/fail evidence report per contract (no secrets/DSNs — asserted by `assertEvidenceReportSecretFree`). The pure decision function `collectFamilyConformanceChecks(manifest, actuals)` takes injected `actuals` so contract tests can mutate one fact and prove the gate goes RED (the `checkRuntimeRoleGrants(policy?)` injection pattern).

Per ADR-0015 §6: it is added to (1) `package.json`'s `check`, (2) an explicitly named step in `.github/workflows/ci.yml`'s `quality` job (not assumed automatic), and (3) `release.yml` inherits it verbatim via `bun run check`. Parity is guarded by `tests/family-conformance-ci-parity.test.ts` so the step cannot silently disappear from CI or from `bun run check`.

### 4. SEMANTIC contract tests, not byte-equality

Every critical reusable control is pinned to behaviour, and each test is MUTATION-PROVABLE (goes RED if the control is weakened): module descriptor/composition (duplicate module key → invalid), tenant-context fail-closed under `FORCE RLS` (no GUC → zero rows; a fail-open policy → every row leaks), the response envelope, audit/redaction (weaken the redactor → the leak is detected), idempotency (hash collapse → the conflict goes undetected), migration immutability/checksum (edit an applied migration → `validateAppliedChecksums` throws — pure, no DB), OpenAPI/AsyncAPI metadata, database role/RLS (the `checkRlsEnabled` FORCE invariant). The parts that need a real Postgres (`tests/family-conformance-db.test.ts`) are gated on `DATABASE_URL` and listed explicitly in the ad-hoc DB suite list in ci.yml + release.yml (the two DB suites must not collide inside one `bun test` process).

Any weakening of default-deny/RLS/redaction/audit/idempotency counts as **breaking** (a MAJOR family contract change) and makes conformance fail.

The **Astro SSR build/start on Bun** contract has NO standalone test in the conformance suite (a duplicate build+start+probe would only re-run the `e2e-smoke` job). It is really exercised by `bun run build` (inside `bun run check`) AND by the `e2e-smoke` job, which starts the built server on Bun (`bun ./dist/standalone-entry.mjs`) and then runs login/SSR rendering. `tests/family-conformance-ci-parity.test.ts` asserts that the `e2e-smoke` job + that start line EXIST in ci.yml — so removing them turns conformance red.

### 5. Compatibility matrix: current AND minimum-supported are really run

The `quality` job pins current Bun (1.4.2); a separate `minimum-supported` job sets up and RUNS the `engines.bun >=1.3.0` floor (Bun 1.3.0) for a meaningful subset: `bun install --frozen-lockfile`, `typecheck`, `build` (Astro SSR), `family:conformance:check`. Verified for real: Bun 1.3.0 runs that subset cleanly. The gate itself asserts that the set of Bun versions in CI is EXACTLY {current, minimum} (`stack.bun.ci` + `stack.bun.ciMinimum`, with `ciMinimum` == the `engines` floor), so removing the minimum-supported job turns the gate red. The Astro/@astrojs/node/TypeScript "minimum" == the caret range of their current versions (`^7.0.7`/`^11.0.2`/`^7.0.2`), so no separate cell is needed; PostgreSQL only declares 18.4 (no separate floor), so there is no minimum-PG gap.

### 6. Intentional divergence requires a reason + owner + review date + ADR

The `intentionalDivergences` allow-list records every deliberate difference from the mini standard. It is not a backlog of unfinished ports — each entry has a `reason`, an `owner`, a `reviewDate` (the gate fails when it expires — an un-reviewed divergence cannot live forever), and an `adr` (a file that must exist). The initial divergences: content modules not ported (ADR-0022), ModuleType without "derived" (ADR-0025), OpenAPI one-file-per-module (ADR-0026), SSRF blocking private IPs (ADR-0028), new MFA session-assurance (ADR-0027), the base business-scope resolver being a NO-OP (ADR-0030), illustrative SoD rules in a fixture (ADR-0031), Turnstile keeping the profile gate (ADR-0029), SemVer continuing the legacy major line (ADR-0024).

### 7. No live dependency on upstream mini

CI never downloads a mini branch. All conformance is proven against local source constants + pinned fixtures; the build is reproducible even when external GitHub is unavailable (the same principle as ADR-0015 §5).

## Consequences

- **Positive:** foundational changes relative to the family standard become explicit, testable, and no longer dependent on comparing copies of files. The manifest is schema-validated; version/divergence drift turns CI red.
- **Positive:** semantic contract tests catch real weakenings (not just source changes), proven by mutation (fail-open RLS, redaction bypass, envelope drift, duplicate module key, editing an applied migration).
- **Positive (F1):** the AC "test current AND minimum-supported" is really met — the `minimum-supported` job runs Bun 1.3.0 (the floor), and the gate asserts the CI Bun set = {current, minimum}. The minimum cell covers install/typecheck/build/family-conformance; residual: the Astro/@astrojs/node/TS minimum == the caret of current (no separate cell needed), PostgreSQL has no separate floor.
- **Positive (F3):** ADR index drift is closed by the `check-docs` gate (`checkAdrIndexCoverage`) — every `docs/adr/NNNN-*.md` (except template 0000) must have a row in `README.id.md`; deleting a row or adding an unindexed ADR turns CI red. The 0027-0032 index entries that had drifted are now filled in.
- **Neutral (F4):** the manifest declares only capabilities whose owning module actually exists in the base (`party_directory`/`profile_identity`); the three content capabilities (`news_media`/`public_content`/`social_publishing`) carried over from mini are removed from `CAPABILITY_CONTRACT_VERSIONS` + the manifest because their owning CMS modules are excluded (`no-content-website-modules`, ADR-0022) — correcting the dishonesty of that list. The historical detail of the 4-capability list is in ADR-0015 §1 (not edited; it is a historical ADR, corrected by this one).
- **Negative/trade-off:** a seventh versioning scheme enlarges the policy surface — documented in `family-contract.ts` + `docs/awcms/family-compatibility.md`.
- **Neutral:** no migration (tooling/docs only); no change to existing module/OpenAPI contracts.

## Alternatives considered

- **Git-submoduling the whole mini source + byte diffing** — rejected (out of scope for the issue): non-deterministic, dependent on another repo being live, and making the entire source identical is not the goal (AWCMS deliberately has a different scope).
- **Adding a JSON Schema validator dependency (ajv, etc.)** — rejected: Bun-only, minimal dependencies (ADR-0002); a hand-written TypeScript validator is enough for this small schema, and the JSON Schema is still published for interop.
- **Family contract version = package release version** — rejected: the two evolve differently (ADR-0008 already established independent versioning); the legacy major line (ADR-0024) must not bind the family contract.
