# AWCMS Documentation Hub

> **Documentation Authority:** `SYSTEM_MODEL.md` -> `AGENTS.md` -> `README.md` -> `DOCS_INDEX.md` -> implementation and module docs
>
> **Status:** Maintained
>
> **Last Updated:** 2026-03-12

## Purpose

This file is the practical entrypoint for the `docs/` tree. It does not redefine architecture rules.
It routes readers to canonical documents and implementation-backed runbooks.

## Start Here

- System constraints and mandatory versions: `SYSTEM_MODEL.md`
- Agent and implementation rules: `AGENTS.md`
- Monorepo operations and baseline commands: `README.md`
- Canonical docs routing: `DOCS_INDEX.md`

## Documentation Domains

| Domain | Focus | Canonical Entry |
| --- | --- | --- |
| Architecture | System model, database, standards, folder structure | `docs/architecture/overview.md` |
| Tenancy | Tenant isolation, hierarchy, Supabase tenancy behavior | `docs/tenancy/overview.md` |
| Security | ABAC, RLS, threat model, security controls | `docs/security/overview.md` |
| Developer Guides | Setup, CI/CD, testing, platform-specific development | `docs/dev/setup.md` |
| Modules | Feature and subsystem documentation | `docs/modules/MODULES_GUIDE.md` |
| Deploy | Deployment runbooks and environments | `docs/deploy/overview.md` |
| Compliance | Regulatory and standards mapping | `docs/compliance/overview.md` |
| Guides | Migration and operational guides | `docs/guides/opencode-models.md` |

## Evidence Sources for Documentation Updates

When updating any document in this repo, verify claims against these implementation sources:

- Package scripts and runtime constraints: `**/package.json`
- CI/CD behavior: `.github/workflows/*.yml`
- Database and RLS behavior: `supabase/migrations/*.sql`, `awcms/supabase/migrations/*.sql`
- Operational scripts: `scripts/*.sh`
- App implementation:
  - `awcms/src/**`
  - `awcms-public/primary/src/**`
  - `awcms-mcp/src/**`

## Context7-First Documentation Workflow

- Audit plan: `docs/dev/documentation-audit-plan.md`
- Audit tracker and drift log: `docs/dev/documentation-audit-tracker.md`
- Benchmark response standard: `docs/dev/context7-benchmark-playbook.md`

The active 2026-03-12 planning refresh re-baselines repository counts, authority-doc drift, resource-map
reconciliation, script accuracy, security wording, dependency/version mismatches, and dead-link remediation planning.

Use Context7 MCP as the primary external source for library guidance and preserve verified IDs from
`AGENTS.md` and `docs/dev/documentation-audit-plan.md`.

## Maintained vs Non-Authoritative Docs

- Maintained: markdown files under root docs and package-level maintained README files.
- Non-authoritative examples/vendor docs (reference-only):
  - `awcms-public/primary/vendor/README.md`
  - `awcms/src/templates/flowbiteadminastro/**/README.md`
  - generated platform asset READMEs (for example iOS asset catalog notes)

## Notes

- For complete topic navigation, use `DOCS_INDEX.md`.
- For version and security mandates, defer to `SYSTEM_MODEL.md`.
- For benchmark-focused documentation quality improvements, follow `docs/dev/context7-benchmark-playbook.md`.
