---
"awcms": patch
---

ci(api): new gate `bun run api:contract:lint` (in `bun run check`, right after `api:spec:check`) compiles every schema of the bundled OpenAPI contract with `ajv` 8.20.0 (dev dependency, exact-pinned, draft 2020-12, `strict: true`, Bun-only): all `components.schemas`, every request body and every success and error response. A failure names the operation and the JSON pointer. OpenAPI-only keywords (`discriminator`, `xml`, `externalDocs`, `example`, `x-*`) are registered explicitly; strictness is not turned off. Against `main` before the hygiene fix (#1389) it reports 80 defects; on the fixed contract it compiles 2,292 locations in about 3 s. Negative tests cover `properties: null`, `nullable` without `type`, a dangling `$ref` and broken request/response schemas. Tooling and docs only; no runtime change.
