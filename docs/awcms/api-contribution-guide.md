🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](api-contribution-guide.id.md)

# API Contribution Guide for Domain/Website Modules (Issue #182, ADR-0026)

> **Reframing by [ADR-0034](../adr/0034-awcms-family-direct-use-templates-and-derived-pathway-removal.md) & [ADR-0035](../adr/0035-awcms-online-first-erp-saas-superset-repositioning.md).** The "derived application in a separate repo" pathway (ADR-0022) is REVOKED — the AWCMS family is now a set of **used-directly** templates, and `awcms` is positioned as an **online-first hybrid + superset** that absorbs the awcms-micro website/e-commerce cluster straight into `src/modules/` (ADR-0035). Read this document with that mapping: "derived repo/module" = a domain/website/e-commerce module added **directly to `src/modules/`** of this template. The modular OpenAPI pipeline (per-module fragment + bundler + composition seam) is still real and still applies; only the separate-repo framing is obsolete.

This document explains how a **domain/website module** (e.g. an ERP on
top of the AWCMS base) contributes the REST contract for its own
domain, **without editing the root/base OpenAPI fragment** or the bundle file.

Read first: [`openapi/README.md`](../../openapi/README.md) (fragment structure +
bundler) and [ADR-0026](../adr/0026-modular-openapi-ownership-and-composition.md)
(the ownership/composition decision).

## Principles

- **Ownership per module.** One module = one fragment
  `openapi/modules/<module>.openapi.yaml`. Every module owns its own
  fragment; it does not add paths/operations/schemas to another module's fragment.
- **The bundle is generated and deterministic.** The final public contract is always the
  output of `bun run openapi:bundle` — never hand-edited. Same input → byte-identical
  output.
- **Default-deny override.** A module fragment CANNOT override a root/base/shared
  path, operation, or schema. An override attempt throws
  `BundleConflictError` and fails the gate.
- **Uniform envelope.** Every error response (4xx/5xx) must resolve to the shared
  `ApiError` schema (root fragment). Success responses use the
  `success: true` + `data` pattern. The `standard error schema` gate enforces this.
- **The contract is mandatory.** Every `/api/v1/**` route must have an OpenAPI operation and
  vice versa (route↔contract parity). `operationId` must be globally unique.

## Steps

1. **Create the module fragment** (including for a domain/website module) in `src/modules/`
   of this template ([ADR-0034](../adr/0034-awcms-family-direct-use-templates-and-derived-pathway-removal.md):
   templates are used directly, there is no separate derived repo), e.g.
   `openapi/modules/<module>.openapi.yaml`. Fill in `paths` (your module's
   paths, all under the module's `basePath`, e.g. `/api/v1/<domain>/...`) and —
   if needed — `components.schemas` used ONLY by your module. Reference
   the base's shared components via `$ref` as usual
   (`#/components/responses/BadRequest`, `#/components/schemas/ApiMeta`,
   `#/components/parameters/CorrelationId`). A fragment does NOT stand on its own
   as valid OpenAPI — that is expected; shared `$ref`s resolve after the merge.

2. **Declare `api.openApiPath`** in your module's `module.ts`,
   pointing at that fragment:

   ```ts
   api: {
     openApiPath: "openapi/modules/<module>.openapi.yaml",
     basePath: "/api/v1/<domain>"
   }
   ```

   This field is also what the `module_management` readiness check reads
   (`openapi_documented`) to make sure a module documents its API.

   Pointing it at the BUNDLE (`openapi/awcms-public-api.openapi.yaml`) now
   turns the gate red: besides claiming every other module's surface, it
   leaves that module's own fragment ownerless — exactly how the
   `news_portal` fragment survived after its module was retired by ADR-0044.
   The gate demands a one-to-one relationship in both directions: every module points at one
   fragment that EXISTS in `openapi/modules/`, and every fragment is claimed by exactly
   one registered module (`foundation.openapi.yaml` being the only reviewed
   exception — it genuinely belongs to the platform, not to a module).

3. **Declare your module's tag in the root catalogue.** An operation tag that is not present
   in `tags:` of `openapi/awcms-public-api.src.yaml` makes that operation
   DISAPPEAR from `docs/awcms/api-reference.md` — the generator groups by
   DECLARED tags. This is not hypothetical: 55 operations belonging to four modules
   (`blog_content`, `visitor_analytics`, `tenant_domain`, `data_lifecycle`)
   were once undocumented because of this, with every gate green. The tag gate
   now rejects it from both directions at once — undeclared operation tags AND
   declared tags nobody uses (leftovers from retired modules).

4. **Compose via the composition seam.** The build feeds every registered module's
   `openApiPath` into the `extraFragmentFiles` seam:

   ```ts
   import { buildBundledDocument } from "./scripts/openapi-bundle";
   const bundle = await buildBundledDocument(process.cwd(), {
     extraFragmentFiles: registeredModules
       .map((m) => m.api?.openApiPath)
       .filter((p): p is string => Boolean(p))
   });
   ```

   The simplest alternative: put the fragment in
   `openapi/modules/` so it is picked up by the bundler's default glob. What
   matters: **the existing root/base fragment is not edited directly.**

5. **Regenerate + validate:**

   ```bash
   bun run openapi:bundle
   bun run api:docs:generate
   bun run api:spec:check
   bun run api:docs:check
   ```

   Commit your fragment, the generated bundle, and the Markdown reference in
   one PR.

## Common mistakes

- **Overriding a base path/schema** → `BundleConflictError`. Pick a path/schema name
  unique to your domain.
- **Inline error responses (not `ApiError`)** → the `standard error schema` gate goes
  red. Use `$ref: "#/components/responses/*"` or `#/components/schemas/ApiError`.
- **A route with no operation (or vice versa)** → the route parity gate goes red.
- **An `operationId` colliding with a base operation** → use a domain prefix
  (e.g. `listSalesInvoices`, not `list`).
- **Editing `openapi/awcms-public-api.openapi.yaml` directly** → the bundle
  freshness gate goes red (the bundle is generated, not a source).
- **An operation tag not declared in the root catalogue** → the tag gate goes red. The symptom
  if this gate did not exist: your operation vanishes from the API reference without a single
  error message.
- **A fragment with no owning module** (e.g. the module was deleted/merged but its fragment
  was left behind, or `openApiPath` points at the bundle) → the fragment ownership gate goes
  red. When a module is merged away, MOVE its paths+schemas into the successor module's
  fragment and then delete the old fragment.

## Versioning

The contract's `info.version` is SemVer independent of the package version (ADR-0008):
PATCH = documentation, MINOR = backward-compatible additions (a new optional
endpoint/field), MAJOR = breaking (removing/renaming a field/endpoint, changing a response
shape). A change to the base contract's shape requires a changeset + (if it is an
architectural decision) an ADR.
