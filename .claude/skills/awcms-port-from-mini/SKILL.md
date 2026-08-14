---
name: awcms-port-from-mini
description: HISTORICAL / DO NOT FOLLOW AS A PROCEDURE — [ADR-0055](../../../docs/adr/0055-development-confined-to-awcms-and-awcms-astro.md) (2 August 2026) REVOKES the mini-first flow. AWCMS development now happens only in `ahliweb/awcms` + `ahliweb/awcms-astro`; `awcms-mini` and `awcms-micro` are **ARCHIVES** — they may be READ as history/specification, but **no work is scheduled as "ported from" there**. A desired capability is BUILT in this repo with its own admission ADR. This skill is kept as a record of HOW the port used to be done (and §Adaptation is still useful when READING archive code as a reference), not as a work order. If you are asked to "port module X from mini": the answer is admission ADR + build it here. The guardrails this flow used to carry STILL apply and are re-listed in ADR-0055 §3: an ADR is mandatory for standards changes, an extra security review for `auth`/`access`/`sync`, the full `bun run check`, OpenAPI/AsyncAPI in sync, RLS FORCE, ABAC default-deny.
---

🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](SKILL.id.md)

# AWCMS — Port a module from awcms-mini (HISTORICAL)

> **REVOKED as a procedure — [ADR-0055](../../../docs/adr/0055-development-confined-to-awcms-and-awcms-astro.md), 2 August 2026.**
> The mini-first flow no longer applies. `awcms-mini`/`awcms-micro` are **archives**:
> readable, receiving no changes, and **not a source of scheduled work**.
> A desired capability is **built in this repo** with its own admission
> ADR — the fact that the archive happens to already have an implementation is no
> longer a reason to build it, nor is it its design.
>
> Why it was revoked, briefly: the half-position ("frozen but still portable out of")
> forced documents and gates to keep maintaining a relationship with a repo that does
> not move — the manifest declared `standard: awcms-mini`, and nine scheduled
> divergences were re-reviewed with a `reviewDate` that turns CI red when it passes.
>
> **What is STILL useful on this page:** §Adaptation. When you read archive code
> as a design reference, the list of differences below (table prefix, migration
> numbering, toolchain that does not exist here) still explains why archive code
> cannot be copied as-is. Treat it as reading notes, not as work steps.

The historical context below is kept as-is.

- SOURCE (read only): `/home/data/dev_react/awcms-mini`
- TARGET: `/home/data/dev_bun/awcms`

> **Also applies to porting from `awcms-micro`** — and since 2026-07-24 that is
> the most active source. [ADR-0035](../../../docs/adr/0035-awcms-online-first-erp-saas-superset-repositioning.md)
> makes `awcms` the **superset** that absorbs the `awcms-micro`
> website/e-commerce cluster; its wave map + dependency ordering is in
> [`absorb-awcms-micro-roadmap.md`](../../../docs/awcms/absorb-awcms-micro-roadmap.md).
> The playbook below is identical, with two adjustments: SOURCE =
> `/home/data/dev_react/awcms-micro`, and the rename rule of §2 applies to the prefix
> `awcms_micro_` → `awcms_` (not `awcms_mini_`). One **awcms-specific adaptation**
> that recurs in every content port: micro's public routes are **host-resolved**
> (`/news/:slug`), whereas this base is **tenant-path-scoped**
> (`/blog/{tenantCode}/{slug}`, ADR-0009) — so any descriptor's `urlTemplate`
> needs a server-resolved `:tenantCode` placeholder.

## 1. Recon before writing

```bash
M=/home/data/dev_react/awcms-mini; A=/home/data/dev_bun/awcms
sed -n '/dependencies:/,/]/p' $M/src/modules/<mod>/module.ts     # deps → ALL of them must already exist in $A/src/modules/index.ts
find $M/src/modules/<mod> -type f | wc -l                         # module size
ls $M/sql | grep -i <mod>                                         # migrations (can be >1 — consolidate them)
find $M/src/pages/api -path "*<mod>*"                             # routes
grep -rl "<mod>\|<Symbol>" $M/tests                               # tests (port the unit/domain ones)
grep -rn "<mod>:" $M/package.json                                 # scripts (dispatcher/worker)
ls -1 $A/sql | tail -1                                            # last migration number in awcms → +1
```

If one of the module's dependencies does **not** yet exist in awcms → port that dependency first (in dependency order), or adapt so it is not imported (§4).

## 2. Rename rules (non-negotiable)

- Tables/env/identifiers `awcms_mini_…` → `awcms_…`, `AWCMS_MINI_…` → `AWCMS_…`.
- Strings/paths/event names `awcms-mini` → `awcms` (e.g. `awcms-mini.<mod>.x` → `awcms.<mod>.x`); headers `X-AWCMS-Mini-*` → `X-AWCMS-*`.
- `openApiPath` → a **per-module fragment** `openapi/modules/<module>.openapi.yaml` (ADR-0026, Issue #182 — the modular OpenAPI pipeline; `bun run openapi:bundle` merges them). **Every** module uses this form now: the fragment-ownership gate in `api:spec:check` rejects an `openApiPath` that points at the bundle, requires its fragment file to exist, and requires each fragment to be claimed by exactly one registered module (PR #308 — two modules used to point at the bundle, and that is what let a retired module's fragment survive without an owner). The port MUST also declare its module tag in the `tags:` of `openapi/awcms-public-api.src.yaml`; without it every ported operation disappears from `docs/awcms/api-reference.md` (the tag gate now turns that red). `asyncApiPath` → `asyncapi/awcms-domain-events.asyncapi.yaml`.
- Clean verification: `grep -rnE "awcms[_-]mini_[a-z0-9]" <new-file>` returns nothing **except** the provenance header comment (e.g. `-- ported from awcms-mini migration 0NN`). For `.md`: after `git add -A`, `git ls-files '*.md' | xargs grep -lnE "awcms[_-]mini_[a-z0-9]"` MUST be empty (a changeset/README must not trigger a `check:docs` regression; write `<worker-role>` rather than an `awcms_mini_…`-style role name).

## 3. Migrations

- Continue the numbering (`NNN` = last+1), name `NNN_awcms_<area>_<desc>.sql`. Consolidate several mini migrations into one coherent final shape (fresh DB, no legacy backfill step).
- MANDATORY per tenant-scoped table: `tenant_id uuid NOT NULL REFERENCES awcms_tenants(id)`, `ENABLE ROW LEVEL SECURITY` **+ `FORCE ROW LEVEL SECURITY`** + the policy `tenant_id = current_setting('app.current_tenant_id')::uuid` (follow the style of `sql/005`/`008`/`013`). `ENABLE` without `FORCE` is **inert** as long as the app connects as the table owner — that is exactly the gap `sql/017` closed for 23 tables; do not create a new one. An index for every FK, `timestamptz`, `numeric` (not float).
- **GRANT**: the role `awcms_app` ALREADY EXISTS since `sql/019_awcms_db_role_separation.sql` (Issue #141) and has a **blanket grant** — a new table does not need its own `GRANT ... TO awcms_app`. **CORRECTION 2026-07-25: the roles `awcms_worker` (and `awcms_setup`) ALREADY EXIST** since `sql/022_awcms_db_worker_setup_roles.sql` — an earlier version of this skill told you to DROP the `GRANT ... TO awcms_worker` block; that is **WRONG** and will produce scheduled jobs that hit `permission denied` in production. The correct thing: if the ported module has a worker job, write explicit least-privilege grants per table **and** add the EXACTLY matching entry to `WORKER_ROLE_GRANTS` in `scripts/security-readiness.ts`. That matrix is guarded by a two-way drift test (`tests/*worker*`/`security-readiness`): under-grant → the job dies in production, over-grant → the isolation that was the reason for the role split is a lie. Forgetting to update it = `bun run check` red, not a silent failure.
- The generic idempotency store `awcms_idempotency_keys` already exists (`sql/009`) — do not recreate it.

## 4. Contract & dependency adaptation

- The awcms `ModuleDescriptor` contract (`src/modules/_shared/module-contract.ts`) is leaner than mini's, BUT since Issue #178 (contract v1.2.0) it does model `capabilities` (`provides`/`consumes`, ADR-0011) and `compatibility.deploymentProfiles` — so those fields **may be kept** while porting (validated by `bun run modules:compose:check`). The awcms `ModuleType` is still WITHOUT `"derived"` (the DB CHECK constraint in `sql/008` only allows base/system/domain/integration) — a derived module uses `"domain"`. Other fields that do not exist yet must still be DROPPED; add to the contract only if truly needed (bump `MODULE_CONTRACT_VERSION`).
- **A navigation entry IS ALLOWED** — CORRECTION 2026-07-25: the SSR admin UI read+write exists (Issue #166/#171, parity shell #229) and modules like `blog_content`/`tenant_domain`/`visitor_analytics` already declare `navigation`. The condition still holds: **only** point at a path that really has a page in `src/pages/admin/*` — nav to a route that does not exist = a 404 for the user. If the ported module is API-only, do not declare nav.
- **The composition/contract toolchain ALREADY EXISTS**: `modules:compose:check`, `modules:composition:inventory:generate`/`:check` (Issue #178), `openapi:bundle` + `api:docs:generate`/`:check` (Issue #182) — use them where relevant. **`extension:check` WAS DELETED** by ADR-0034 (the derived-application pathway was revoked) — DO NOT reference it. What STILL does not exist in awcms (DO NOT reference): `repo:inventory`, `work-class`, `i18n:*`. Always check `package.json` for the real script list before referencing anything.
- If mini imports a module that has **not** been ported (email, reporting, integration-hub, etc.) → DROP that route/consumer/adapter, or turn it into a no-op/optional seam that does not import the absent module. Record every drop.
- Register the module in `src/modules/index.ts` (in an order that keeps the DAG valid).

## 5. API/event contracts, security, tests

- Thin route: `withTenant` → `authorizeInTransaction` (default-deny ABAC) → handler; the `_shared/api-response.ts` helpers; audit to `awcms_audit_events` for high-risk mutations; `Idempotency-Key` (`_shared/idempotency.ts`) for high-risk mutations.
- Add the paths to the module's fragment `openapi/modules/<module>.openapi.yaml`, then `bun run openapi:bundle` (parity is tested by `api:spec:check`; study `scripts/api-spec-check.ts`). The frozen OpenAPI snapshot is **add-only** — do not edit the snapshot, update its allow-list. For domain events: `appendDomainEvent` + a channel in `asyncapi/awcms-domain-events.asyncapi.yaml` + register the event type in the `domain-event-runtime` registry.
- External providers outside the transaction (ADR-0006) via outbox + dispatcher; add the dispatcher script to `package.json`, and if you add a job update `tests/module-management-job-registry.test.ts`.
- Port the **unit/domain** tests into `tests/` (flat layout; adjust imports `../../src`→`../src`). Integration tests (which need Postgres) may be skipped — record it.

## 6. Definition of Done — everything MUST be green

```bash
cd /home/data/dev_bun/awcms
git add -A                       # so check:docs scans the new .md files (changeset/README)
bun run format                   # MANDATORY first: prettier --write (files made by a subagent are often unformatted)
bun run check                    # the FULL chain — this is what CI enforces
```

`bun run check` runs, in order: `lint` → `check:docs` →
`check:docs:translation` → `api:spec:check` → `api:docs:check` →
`modules:dag:check` → `modules:compose:check` →
`modules:composition:inventory:check` → `reporting:projections:registry:check` →
`identity-access:sod-registry:check` → `data-lifecycle:registry:check` →
`site-search:sources:check` → `family:conformance:check` →
`logging:lint:check` → `typecheck` → `test` → `build`. This chain **grows every
time a new descriptor seam lands** — read `package.json` rather than trusting
this list if it feels shorter than what is in there.

What bites most often when porting:

- `family:conformance:check` — if the port raises a contract version
  (module/capability/OpenAPI/AsyncAPI) or the stack version, update
  `awcms-family-compatibility.yaml` **first** (Issue #183,
  `docs/awcms/family-compatibility.md`).
- `modules:composition:inventory:check` — regenerate the inventory when the registry changes.
- The descriptor registry gates (`data-lifecycle`, `site-search:sources`, etc.) —
  registering a descriptor without updating them = red.
- `WORKER_ROLE_GRANTS` matrix drift (see §3) when the migration grants to the worker.

**Do not settle for a subset.** CI (`.github/workflows/ci.yml`) runs `lint` (prettier) AND `build` in addition to the checks above — skipping those two is the most common cause of "green locally but red in CI". Always `bun run format` + `bun run lint` + `bun run build` before commit/PR (equivalent to the full `bun run check`). DO NOT run `config:validate` (needs env) or `db:migrate` without a DB. To **validate migrations against a real Postgres** without host→container connectivity, use the `docker-host-container-network` skill §7 (`docker cp sql/` + `psql -f` inside the container). Add a **minor** changeset.

## 7. Atomic commit

One module = one commit (AGENTS.md: one PR = one change). Format:
`feat(<mod>): port <mod> module from awcms-mini` + a concise body (migrations+RLS, routes+OpenAPI, events, dropped features, test count). Include the `Co-Authored-By` trailer. Verify the coder's output **independently** (do not just trust its report): re-run the DoD + `grep` for prefix leakage + count the RLS in the migration before committing.

## 8. Mandatory final report

Files created/changed; migrations+tables+RLS; contract fields dropped; routes+OpenAPI; events/channels; features/consumers dropped + why; tests ported/skipped; files changed outside the module + why; the EXACT result of every DoD command (honestly — do not claim green when it is not).
