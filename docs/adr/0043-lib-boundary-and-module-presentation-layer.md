# ADR-0043 — `src/lib` boundary and the module presentation layer

- Status: Accepted
- Date: 2026-07-26
- Issue: #257
- Related: ADR-0025 (build-time module composition), ADR-0034 (family
  direct-use templates); awcms-micro ADR-0038 decides the same question there.

## Context

`src/lib` had become a second module system that no gate watched.

Four namespaces — `src/lib/{seo,theming,comments,search}` — carried the name of
an existing module and held code owned by that module.
`seo_distribution`'s application layer even referred UP into `src/lib/seo/`
along a path `modules:dag:check` cannot see, because that validator reads the
DECLARED graph and never an import statement.

`tests/module-boundary.test.ts` did read imports, but only under
`src/modules/*`. So the two layers that actually held cross-module wiring —
`src/lib` and `src/pages` (38k lines, larger than the three biggest modules
combined) — were both ungated.

The cause was structural rather than sloppiness. The module contract had
nowhere to put presentation/delivery code, so `src/lib/<module-name>/` was the
only home available.

## Decision

1. **`src/lib` is technical infrastructure that does not carry a domain name.**
   `database`, `auth`, `security`, `redis`, `edge-cache`, `jobs`,
   `observability`, `semver`, `html`, `tenant`, `ui`, `integration`, `logging`.

2. **Module presentation/delivery code lives in
   `src/modules/<module>/presentation/`** — route composition roots, middleware
   glue, browser client scripts.

3. **The layer is not enumerated in code.** No new field in
   `module-contract.ts`; the other three layers (`domain`, `application`,
   `infrastructure`) are not enumerated either. What is machine-enforced is the
   GATE, not the naming.

4. **`modules:dag:check` fails on a `src/lib/<x>/` namespace that collides with
   a `moduleKey`** — exactly, or through a registered domain alias
   (`seo` → `seo_distribution`, `search` → `site_search`, and four more).
   Without aliases, two of the four real cases would have passed.

5. **One recorded exception: `src/lib/logging/`.** The database-free logger
   primitive, imported by ~139 files including `src/lib` itself; the `logging`
   MODULE is the audit-trail service. Recorded as an exception rather than an
   exclusion so the test can prove it is DETECTED and merely excused.

6. **`tests/module-boundary.test.ts` extends to `src/pages`**, attributing each
   route to its owning module via `api.routes` (Issue #256) and requiring every
   cross-module import to be declared by that owner. `identity_access` joins
   `logging` as foundational FOR ROUTES ONLY — the authorization chokepoint is
   reached from 184 route files, and declaring it everywhere would tell a reader
   nothing while making it a dependency of nearly the whole registry.

## Consequences

Eight files moved with `git mv`; behaviour, API, migrations, events,
permissions and the registry are unchanged (still 21 modules,
`MODULE_CONTRACT_VERSION` untouched by this ADR).

Making the boundary visible surfaced four edges that had been hidden:

| edge                                      | resolution                                                                                                                                                                                                           |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `theming` → `module_management`           | DECLARED. The public token-CSS route gates on `fetchTenantModuleEntry`; `seo_distribution` and `site_search` already declare the same edge for the same call.                                                        |
| `visitor_analytics` → `data_lifecycle`    | DECLARED. `/api/v1/analytics/retention/purge` runs behind the non-bypassable legal-hold guard.                                                                                                                       |
| `visitor_analytics` → `module_management` | DECLARED. `/api/v1/analytics/settings` reads through the module-settings service.                                                                                                                                    |
| `seo_distribution` → `visitor_analytics`  | REMOVED, not declared. `extractReferrerDomain` is a pure string→hostname function; moving it to `_shared` deletes the edge. Declaring it would have made 404 telemetry depend on the analytics module being ENABLED. |

That last row is the general rule: an edge that appears only because a pure
helper sits in the wrong place should be deleted, not documented.

## Alternatives rejected

**An allow-list of composition roots inside `src/lib`.** This was the first
design. It documents the ambiguity and then enforces the documentation; it does
not remove the reason `src/lib/<module-name>/` keeps reappearing. Naming the
real home does.
