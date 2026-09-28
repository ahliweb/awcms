---
"awcms": patch
---

chore(deps-dev): bump yaml from 2.9.0 to 2.9.1

Patch release of the YAML parser/stringifier used by `scripts/family-conformance-check.ts`,
the OpenAPI/AsyncAPI bundling and contract-check scripts, and
`src/modules/module-management/application/health-registry.ts`. `2.9.1` is a bugfix-only
release with no breaking changes to the parse/stringify API this repo calls, so no source
change is needed beyond the bump.
