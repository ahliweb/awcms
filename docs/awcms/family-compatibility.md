🇬🇧 English (default) · 🇮🇩 [Bahasa Indonesia (sumber)](family-compatibility.id.md)

<!-- i18n-source-hash: sha256:a4277f1c5ec7fcc10bfe2a5cdd6f893e75690a8e89afa9a58069e6c5310abef2 -->

# AWCMS family contract manifest

> **Status:** operational working contract (Issue #183, epic #177, [ADR-0032](../adr/0032-family-compatibility-manifest-and-ci-conformance.md), re-anchored by [ADR-0055](../adr/0055-development-confined-to-awcms-and-awcms-astro.md)).
>
> **This document used to be titled "…with the AWCMS-Mini standard".** ADR-0055 retired that anchor: there is no external family standard, `awcms` defines its own contracts, and `awcms-mini`/`awcms-micro` are **archives**. [`alur-pengembangan-mini-first.md`](alur-pengembangan-mini-first.md) (mature it in mini first, then port) is kept as a historical note and is **PERMANENTLY REVOKED** as a workflow. [ADR-0015](../adr/0015-derived-application-compatibility-manifest.md) (the downstream manifest toward derived applications) is likewise no longer a live pathway.

AWCMS **was** rebuilt on top of the [AWCMS-Mini](https://github.com/ahliweb/awcms-mini) modular-monolith standard ([ADR-0001](../adr/0001-rebuild-on-awcms-foundation-erp-scope.md)) — provenance that stays true forever. As of [ADR-0055](../adr/0055-development-confined-to-awcms-and-awcms-astro.md), this document describes how this repo declares the contracts it **OWNS** in a machine-readable, CI-enforced way — the ones [`ahliweb/awcms-astro`](https://github.com/ahliweb/awcms-astro) binds against, and the place every **deliberate difference from that repo** is recorded with an owner and a review date.

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

Deliberate differences from a contract this repo must bind against — today that means [`ahliweb/awcms-astro`](https://github.com/ahliweb/awcms-astro)'s, and only its — are listed explicitly under `intentionalDivergences`. They are **not** a backlog of unfinished ports; each entry requires a `reason`, `owner`, `reviewDate` (the gate fails once it is in the past), and `adr` (the file must exist).

**The table below is what the manifest holds TODAY.** The nine mini-era entries that used to occupy it were emptied by ADR-0055 and moved verbatim to [§Historical divergences](#historical-divergences-archived-by-adr-0055) — do not mix the two.

| id                                  | Summary                                                                                                                                                                                            | ADR      | reviewDate |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ---------- |
| `hsts-include-subdomains`           | This repo sends HSTS with `includeSubDomains`; `awcms-astro` without — both correct for their own surface                                                                                          | ADR-0068 | 2027-02-04 |
| `astro-files-not-type-checked`      | `astro check` cannot run here (TypeScript 7 vs the 6.x programmatic API)                                                                                                                           | ADR-0068 | 2027-02-04 |
| `owasp-edition-pin-owned-here`      | The OWASP/ASVS edition pin is owned here; `awcms-astro` follows it                                                                                                                                 | ADR-0068 | 2027-02-04 |
| `coop-corp-cross-origin-isolation`  | This repo sends COOP/CORP; `awcms-astro` sends neither — CORP is explicitly REJECTED there                                                                                                         | ADR-0069 | 2027-02-04 |
| `admin-user-surface-in-awcms-astro` | ADR-0051 **as written** says every admin screen is built here; ADR-0070 narrows it to SYSTEM screens — a **USER** admin surface (never `owner`) may live in `awcms-astro` when a site declares one | ADR-0070 | 2027-02-04 |

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

## Historical divergences (archived by ADR-0055)

> **Status: a historical record, not a standing obligation.** The nine entries
> below used to live in the manifest's `intentionalDivergences` and were CI-
> gated: each carried an `owner` and a `reviewDate` that turned the build red on
> expiry until the difference was re-justified.
>
> [ADR-0055](../adr/0055-development-confined-to-awcms-and-awcms-astro.md)
> retired that obligation. Development now happens in `ahliweb/awcms` and
> `ahliweb/awcms-astro` only; `awcms-mini` is an archive, so "is this difference
> from awcms-mini still justified?" is a question whose answer can no longer
> change.
>
> The entries are kept **verbatim** because their reasoning still explains why
> this code has the shape it does — and their ADR links are still verified to
> exist by `check:docs`, which fails on a link to a missing file.

```yaml
intentionalDivergences:
  # The `no-content-website-modules` divergence (blog_content/news_portal/etc.
  # are not part of the base) was REVOKED by ADR-0034 (§Konsekuensi): website
  # modules may now live directly in `src/modules/` here ("template
  # dipakai-langsung"), and the first one — `theming` — is implemented in the
  # base (ADR-0034 Fase 3). Website/content modules that are not yet ported are
  # simply not-yet-ported (drift is tracked per-module), not a standing divergence.
  - id: platform-scoped-permissions
    summary: >-
      awcms_permissions carries a `scope` column (`tenant`/`platform`), and the
      authorization chokepoint refuses a platform-scoped permission unless the
      acting tenant is the platform tenant. awcms-mini has no such split — every
      permission there is tenant-scoped.
    reason: >-
      This base owns GLOBAL reference data (the Indonesia region dataset:
      no tenant_id, no RLS, served identically to every tenant), so it has
      actions with no honest per-tenant subject. Recorded as it lands, per
      ADR-0047 §4, because it is a foundation authorization primitive prototyped
      here while awcms-mini is frozen.
    owner: "@ahliweb"
    reviewDate: "2027-08-02"
    adr: 0053-platform-scoped-permissions.md
    since: "ADR-0053"
  - id: openapi-one-file-per-module
    summary: >-
      OpenAPI fragments are one-file-per-MODULE, not one-file-per-tag as in
      awcms-mini.
    reason: >-
      ModuleDescriptor.api.openApiPath is a single path per module, so a module
      owns exactly one fragment (a fragment may carry more than one tag).
    owner: "@ahliweb"
    reviewDate: "2027-07-19"
    adr: 0026-modular-openapi-ownership-and-composition.md
    since: "#182"
  - id: oidc-ssrf-blocks-private-ip
    summary: >-
      The OIDC/SSO SSRF guard BLOCKS private/loopback/link-local/metadata IPs on
      issuer URLs — reversing awcms-mini's deliberate no-IP-block posture.
    reason: >-
      awcms is API-first with no assumed VPN-to-on-prem-IdP topology; SSRF
      defense is a headline requirement. A documented escape hatch exists only
      for loopback fake-IdP test hosts and is rejected in production.
    owner: "@ahliweb"
    reviewDate: "2027-07-19"
    adr: 0028-oidc-sso-tenant-aware-account-linking-break-glass.md
    since: "#185"
  - id: mfa-session-assurance-built-new
    summary: >-
      Session assurance (aal1/aal2), step-up, and enrollment-state-driven MFA
      enforcement are built new; awcms-mini has none, and the "full-online
      security" epic that gates MFA in mini is not ported.
    reason: >-
      MFA enforcement is driven by DB factor/enrollment state (fail-closed),
      not by a deployment-wide online-security flag, so disabling a flag can
      never bypass an enrolled second factor.
    owner: "@ahliweb"
    reviewDate: "2027-07-19"
    adr: 0027-mfa-totp-session-assurance-step-up.md
    since: "#184"
  - id: business-scope-base-resolver-noop
    summary: >-
      The base business-scope hierarchy resolver is a fail-closed NO-OP;
      awcms-mini's default adapter reads its own offices table.
    reason: >-
      The base ships no organization hierarchy of its own. A real resolver is
      supplied by a module that provides the business_scope_hierarchy
      capability port; with no provider, scope-gated high-risk actions deny by
      default.
    owner: "@ahliweb"
    reviewDate: "2027-07-19"
    adr: 0030-business-scope-hierarchy-generic-authorization-layer.md
    since: "#180"
  - id: sod-rules-illustrative-in-fixture
    summary: >-
      The base ships ZERO segregation-of-duties rules; awcms-mini hardcodes
      example rules into identity_access.
    reason: >-
      A base must not invent business rules. Illustrative SoD rules live only in
      the in-repo test-support fixture (tests/fixtures/example-domain-modules/);
      real rules are declared by domain modules added to the template.
    owner: "@ahliweb"
    reviewDate: "2027-07-19"
    adr: 0031-segregation-of-duties-conflict-enforcement.md
    since: "#181"
  - id: turnstile-keeps-deployment-profile-gate
    summary: >-
      Cloudflare Turnstile RETAINS the deployment-profile gate (LAN/offline
      exempt) — the one full-online gate MFA/OIDC deliberately dropped.
    reason: >-
      Bot protection is only meaningful for full-online profiles; forcing it on
      the offline/LAN resilience mode of the online-first hybrid would break that
      degraded-connectivity path.
    owner: "@ahliweb"
    reviewDate: "2027-07-19"
    adr: 0029-deployment-profile-aware-turnstile-bot-protection.md
    since: "#186"
  - id: semver-continues-legacy-major-line
    summary: >-
      The awcms release version continues the pre-rebuild legacy major line
      (5.x) rather than resetting to 1.0.0.
    reason: >-
      Continuity for existing deployments on the legacy line; the family
      contract version is tracked independently of the package release version.
    owner: "@ahliweb"
    reviewDate: "2027-07-19"
    adr: 0024-semver-numbering-continues-legacy-major-line.md
    since: "#177"
  # ADR-0047 §4 — the FIRST foundation feature prototyped directly here during
  # the awcms-mini/awcms-micro freeze, recorded as it lands rather than
  # discovered when the freeze lifts.
  - id: machine-credentials-read-only-bearer
    summary: >-
      awcms accepts a SECOND kind of bearer — a read-only, scope-narrowed
      machine credential bound to a service account — which no other family
      template has; and it exposes GET /api/v1/auth/session for cross-origin
      session introspection.
    reason: >-
      awcms-astro could not fetch its own content: the only bearer this family
      accepts is a hashed SESSION token, which no build can hold (sessions
      expire, are revoked by password reset, and are rotated by MFA step-up).
      Built here because the freeze leaves foundation work nowhere else to land.
      The divergence is contained: a credential AUTHENTICATES only, its
      permissions are the intersection with its service account's, and every
      request it makes is refused unless the action is read-only.
    owner: "@ahliweb"
    reviewDate: "2027-08-01"
    adr: 0049-machine-credentials-and-session-introspection.md
    since: "ADR-0049"
```
