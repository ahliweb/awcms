> **Documentation Authority**: [../../SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) -> [../../AGENTS.md](../../AGENTS.md) -> [../../README.md](../../README.md) -> [../../DOCS_INDEX.md](../../DOCS_INDEX.md)
>
> **Status:** Maintained
>
> **Last Updated:** 2026-04-04

# OpenAPI Quality Checklist

## Purpose

Define the minimum quality bar for `awcms-edge` OpenAPI artifacts so specs remain aligned with runtime behavior and review needs.

## Scope

Applies to:
- `awcms-edge/openapi/public.json`
- `awcms-edge/openapi/admin.json`
- generated internal artifact checks
- Swagger UI surface validation for `/docs` and `/docs/admin`

## Quality Checklist

| ID | Check | Status | Notes |
| --- | --- | --- | --- |
| OAPI-01 | Spec is valid OpenAPI 3.1. |  |  |
| OAPI-02 | Boundary assignment is correct: public, admin, or internal. |  |  |
| OAPI-03 | Public and admin runtime specs exclude internal-only routes. |  |  |
| OAPI-04 | Admin docs remain protected before rendering. |  |  |
| OAPI-05 | Request examples exist for each documented audited endpoint. |  |  |
| OAPI-06 | Success response examples exist for each documented audited endpoint. |  |  |
| OAPI-07 | Error examples exist for `400`, `401`, and other expected failures where applicable. |  |  |
| OAPI-08 | Permission metadata remains accurate for protected operations. |  |  |
| OAPI-09 | Tenant context metadata remains accurate for tenant-scoped operations. |  |  |
| OAPI-10 | Spec updates ship in the same change set as route behavior changes. |  |  |

## Required Commands

```bash
cd awcms-edge
npm run openapi:build
npm run openapi:validate
npm run openapi:diff
npm run test
npm run typecheck
```

## Reviewer Prompts

- Does the documented request shape match runtime validation?
- Are failure responses explicit rather than implied?
- Did the change alter permissions, tenant context, or auth expectations?
- Did the docs surface change in a way that could expose internal routes?
- Is the spec descriptive of reality rather than aspirational?

## Related Docs

- [../architecture/edge-openapi-spec.md](../architecture/edge-openapi-spec.md)
- [../../awcms-edge/README.md](../../awcms-edge/README.md)
- [../audit/awcms-vibe-engineering-audit-checklist.md](../audit/awcms-vibe-engineering-audit-checklist.md)
