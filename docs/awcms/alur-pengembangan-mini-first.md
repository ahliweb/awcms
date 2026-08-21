🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](alur-pengembangan-mini-first.id.md)

# Development flow: awcms-mini first, then port to awcms

> **SUPERSEDED by [`alur-pengembangan.md`](alur-pengembangan.md)** (13 August
> 2026), which is now the canonical process document. This file remains as a
> historical note and binds nobody.

> **PERMANENTLY REVOKED ([ADR-0055](../adr/0055-development-confined-to-awcms-and-awcms-astro.md), 2 August 2026).**
> The ADR-0047 suspension (31 July 2026) turned into a revocation: `awcms-mini`
> and `awcms-micro` are now **archives** — they may be read as historical
> reference, but the mini-first flow **will not come back**. New capabilities
> enter via an **admission ADR and are built directly in this repo**, under the
> guardrails re-listed in ADR-0055 §3 (ADR mandatory for standards changes, an
> extra security review for `auth`/`access`/`sync`, the full `bun run check`,
> OpenAPI/AsyncAPI in sync, RLS `FORCE`, ABAC default-deny).

> **Status:** historical note — this document records the mini-first working
> contract as it once applied, and **no longer binds anyone**. The claims in the
> body ("must", "still applies", module/migration counts) are a snapshot of their
> era; the current state lives in
> [`../ARCHITECTURE.md`](../ARCHITECTURE.md) and
> [`../PROJECT_STATE.md`](../PROJECT_STATE.md).

## 1. The relation between the two repos

AWCMS is not a single repo — it lives paired with its standards repo,
**awcms-mini**.

| Aspect          | **awcms-mini** (foundation/standard)                              | **awcms** (this repo)                                                                                                                                                                                                                                                                                                |
| --------------- | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role            | _Modular monolith standard_ — laboratory & source of the standard | **Used-directly ERP/back-office template** — foundation + domain modules (ERP, website/e-commerce, content) live directly in `src/modules/` ([ADR-0035](../adr/0035-awcms-online-first-erp-saas-superset-repositioning.md)/[ADR-0034](../adr/0034-awcms-family-direct-use-templates-and-derived-pathway-removal.md)) |
| Maturity        | Mature — many modules already tested end-to-end                   | Mature for the foundation + website/content cluster; ERP still growing                                                                                                                                                                                                                                               |
| Modules in code | ~23 modules (foundation + CMS + supporting)                       | **24 modules** — verify with `listModules()`, do not quote the number from a document                                                                                                                                                                                                                                |
| SQL migrations  | 76 (`001`–`076`)                                                  | **79** (`001`–`079`)                                                                                                                                                                                                                                                                                                 |
| API routes      | ~290                                                              | see `openapi/awcms-public-api.openapi.yaml` (deterministic bundle)                                                                                                                                                                                                                                                   |
| DB prefix       | `awcms_mini_…`                                                    | `awcms_…`                                                                                                                                                                                                                                                                                                            |
| Character       | Stable reference/standard                                         | Used-directly template — developed from mini's technical base & absorbing the awcms-micro website/e-commerce cluster                                                                                                                                                                                                 |

**A family of three parallel templates (used directly):** `awcms-mini` (**hybrid offline-first** foundation, SaaS-ready — a proven standard) · `awcms` (**hybrid online-first** **ERP/back-office** template, a **superset** absorbing the awcms-micro website/e-commerce cluster) · `awcms-micro` (lean **full-online** website template) — see [ADR-0035](../adr/0035-awcms-online-first-erp-saas-superset-repositioning.md)/[ADR-0034](../adr/0034-awcms-family-direct-use-templates-and-derived-pathway-removal.md). Domain modules (ERP, website/e-commerce, content) live **directly in `src/modules/`** of these templates — there is no separate derived/extension repo. The mini-first flow still applies: a feature is matured in awcms-mini and then ported here; some website modules are also ported from awcms-micro.

Every document in [`docs/awcms/`](README.md) is a **target/plan** adapted from
the awcms-mini document set — not a mirror of the current state of the awcms
code (see [`README.md` §Status](README.md)). Claims of "already live/available"
that came from awcms-mini sources must be read as a **binding target**, not as a
fact in this repo.

## 2. Mandatory rule: test in awcms-mini first

**Every feature addition/change is implemented and tested first in awcms-mini,
and only then ported to awcms.** This repo is not the place to pioneer new
features from scratch.

The reasons:

- awcms-mini is the **reference standard** — maturing the patterns (contracts,
  migrations, ABAC, audit, idempotency, tests) there keeps the foundation tested
  before it enters the ERP product.
- It lowers risk: awcms inherits a foundation that has **already** passed its
  tests, not an experiment that has not stabilised.
- It keeps both repos aligned at the pattern/standard level, so the ERP
  adaptation here focuses on **scope** rather than reinventing the foundation.

Exceptions apply only to things specific to awcms with no counterpart in
awcms-mini (e.g. an ERP-specific contract) — and even then an ADR comes first if
it changes a base standard (see [`GOVERNANCE.md`](../../GOVERNANCE.md)).

## 3. Steps for porting awcms-mini → awcms

1. **Finish & test in awcms-mini** — the module/feature complete with its
   migration, OpenAPI/AsyncAPI, layered tests, and `bun run check` green there.
2. **Adapt the scope** — map the feature onto the foundation/ERP scope of this
   repo; drop the parts specific to the awcms-mini CMS product if they are not
   relevant.
3. **Rename identifiers** — change the prefix `awcms_mini_…` to `awcms_…` in
   table names, env vars, and artifacts; leave no naming residue from the
   reference repo (enforced automatically by `bun run check:docs`, pattern
   `awcms[_-]mini_…`).
4. **Sync the contracts** — update `openapi/`, `asyncapi/`, the migrations in
   `sql/`, the module registry `src/modules/index.ts`, and the related
   `docs/awcms/` documents so they match the ported code.
5. **Write/port tests** — make sure the tests come along and pass in this repo.
6. **Validate locally** — `bun run check` green before opening a PR.
7. **Family conformance** — if the port raises a contract version (module/capability/OpenAPI/AsyncAPI), changes a stack version, changes the semantics of a reusable control, or adds a deliberate divergence from mini, update [`awcms-family-compatibility.yaml`](../../awcms-family-compatibility.yaml) and make sure `bun run family:conformance:check` is green (part of `bun run check`) — see [`family-compatibility.md`](family-compatibility.md).
8. **Changeset** — add one when behaviour changes (SemVer policy,
   [doc 09](09_roadmap_repository_commit.md)).

## 4. Implications for agents

- Before building a new feature here, **check whether a counterpart already
  exists/is tested in awcms-mini**. If not, mature it there first.
- Do not treat the `docs/awcms/` documents as evidence that the code exists —
  always verify against `src/modules/`, `sql/`, `openapi/`, `asyncapi/`.
- When quoting/copying from awcms-mini, always **rename the prefix** and adjust
  the scope; `bun run check:docs` will reject leftover `awcms_mini_…`.

## 5. References

- [`../adr/0001-rebuild-on-awcms-foundation-erp-scope.md`](../adr/0001-rebuild-on-awcms-foundation-erp-scope.md)
  — the decision to rebuild on top of the awcms-mini foundation.
- [`README.md`](README.md) — the technical document set (target) & adaptation status.
- [`../ARCHITECTURE.md`](../ARCHITECTURE.md) — what already exists in the code.
- [`../../AGENTS.md`](../../AGENTS.md) — the mandatory workflow for every task.
