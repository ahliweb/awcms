# OpenAPI Contracts

The published public contract is
[`awcms-public-api.openapi.yaml`](awcms-public-api.openapi.yaml) — **do not
edit this file by hand.** Since Issue #182 (epic #177, ADR-0026) it is a
GENERATED artifact, bundled from source fragments:

- [`awcms-public-api.src.yaml`](awcms-public-api.src.yaml) — the root fragment:
  `openapi`/`info`/`servers`/`tags`/`security`, and
  `components.securitySchemes`/`parameters`/`responses`, plus any schema shared
  by 2+ modules (e.g. `ApiError`, `ApiMeta`).
- [`modules/*.openapi.yaml`](modules/) — **one file per base module** (Issue
  #182 convention: one file = one module, not one file = one tag). Each file
  owns every `paths` entry whose operations carry that module's OpenAPI tag(s),
  plus every `components.schemas` entry referenced ONLY by that module's
  operations. `foundation.openapi.yaml` holds the truly module-less platform
  ops (`/api/v1/health`, `/api/v1/database/pool`) and is owned by no
  descriptor. `reporting.openapi.yaml` owns two tags (`Management Reporting` +
  `Reporting Projections`) because the `reporting` module owns both.

Neither the root fragment nor a module fragment is independently valid OpenAPI:
fragments reference shared components (`$ref:
"#/components/schemas/ApiError"`, `"#/components/responses/BadRequest"`, etc.)
that only resolve once every fragment is merged into one document.

Each base module points at its own fragment via
`ModuleDescriptor.api.openApiPath` in its `src/modules/<module>/module.ts` —
that is also what `module-management`'s readiness check reads to confirm the
module documents its API.

## Changing the contract

1. Edit the owning module's fragment in
   `openapi/modules/<module>.openapi.yaml` for anything
   path/operation/module-schema-shaped. Edit `openapi/awcms-public-api.src.yaml`
   instead for anything genuinely shared (a new security scheme, a new shared
   header parameter, a schema two-or-more modules need).
2. Regenerate the bundle and the readable reference:
   ```bash
   bun run openapi:bundle
   bun run api:docs:generate
   ```
3. Validate everything (bundle freshness, route parity, operationId uniqueness,
   path-parameter matching, standard error schema, security metadata, and the
   AsyncAPI baseline):
   ```bash
   bun run api:spec:check
   bun run api:docs:check
   ```
4. Commit **all three** in the same PR: the source fragment(s) you edited, the
   regenerated `awcms-public-api.openapi.yaml`, and the regenerated
   `docs/awcms/api-reference.md`. `api:spec:check` fails the build if the
   committed bundle is stale relative to the fragments; `api:docs:check` fails
   if the reference doc is stale.

Both `bun run openapi:bundle` and `bun run api:spec:check` run entirely offline
against files already in the repo — no network access, no external CLI.

## What `api:spec:check` verifies (`scripts/api-spec-check.ts`)

- **Bundle freshness** — the committed bundle byte-matches what
  `bun run openapi:bundle` produces right now from the source fragments (catches
  a fragment edited without a re-bundle AND a hand-edited bundle). Bundling also
  throws `BundleConflictError` on a duplicate path/schema across fragments —
  including a derived fragment trying to override a base path/operation/schema.
- **Route parity** — every `/api/v1/**` route file's template matches an
  OpenAPI path, and every OpenAPI path has a route file (or an explicit
  `ROUTE_PARITY_EXEMPTIONS` entry — empty today).
- **Public operation allow-list** — every `security: []` operation is listed in
  `ALLOWED_PUBLIC_OPERATIONS`, and every allow-list entry is actually used.
- **Operation security metadata** — every operation states its security
  requirement explicitly (a real requirement, or `security: []` plus an
  allow-list entry).
- **operationId uniqueness** — every `operationId` in the bundled spec is
  globally unique.
- **Path parameters** — every `{param}` in a path template has exactly one
  matching `in: path` parameter, and vice versa.
- **Standard error schema** — every non-2xx/3xx response resolves (directly, via
  `components.responses`, or through `allOf`/`oneOf`/`anyOf`) to the shared
  `ApiError` schema — never an ad-hoc inline error shape.

## Derived-application fragments

A derived (downstream ERP) repository contributes its own module fragments
without editing any base fragment — see
[`docs/awcms/api-contribution-guide.md`](../docs/awcms/api-contribution-guide.md)
and ADR-0026. Its module declares `api.openApiPath` pointing at its own
fragment; the derived build feeds every registered module's `openApiPath` to
`buildBundledDocument`'s `extraFragmentFiles` seam. A fragment that redefines a
base path/schema is rejected, never silently applied.

## Readable reference documentation

[`docs/awcms/api-reference.md`](../docs/awcms/api-reference.md) is a GENERATED,
human-readable Markdown reference — built from the bundled OpenAPI file plus the
AsyncAPI file by `bun run api:docs:generate` (`scripts/api-docs-generate.ts`),
with synthetic (never real) example values. `bun run api:docs:check` (part of
`bun run check`) fails the build if it's stale.
