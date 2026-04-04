> **Documentation Authority**: [../../SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) -> [../../AGENTS.md](../../AGENTS.md) -> [../../README.md](../../README.md) -> [../../DOCS_INDEX.md](../../DOCS_INDEX.md)
>
> **Status:** Maintained
>
> **Last Updated:** 2026-04-04

# AWCMS Vibe Engineering Audit Checklist

## Purpose

Convert AWCMS engineering intent into a repeatable audit checklist for architecture review, pull request review, release hardening, and documentation quality checks.

## Scope

In scope:
- AI-assisted engineering workflow in AWCMS
- Planning and issue discipline
- Cloudflare Worker validation and trust boundaries
- Supabase migration and local-only AI database workflow
- Deterministic testing and CI evidence
- OpenAPI 3.1 and Swagger UI quality
- Pre-merge review and refactoring discipline

Out of scope:
- Runtime penetration testing
- Vendor cloud security review
- Full static-analysis replacement
- Financial or legal certification

## Definitions

| Term | Meaning |
| --- | --- |
| Pass | Requirement is implemented, evidenced, and repeatable |
| Partial | Requirement exists but is incomplete or not enforced consistently |
| Fail | Requirement is missing or contradicted by current workflow |

| Severity | Meaning |
| --- | --- |
| Critical | Must be fixed before merge or release |
| High | Must be fixed in the current delivery cycle |
| Medium | Should be scheduled and tracked |
| Low | Improvement opportunity |

## Roles

| Role | Responsibility |
| --- | --- |
| Platform architect | Confirms architecture boundaries and trust separation |
| AI workflow owner | Confirms planning, issue linking, and model handoff discipline |
| Security reviewer | Confirms local-only AI DB workflow and secret boundaries |
| Backend reviewer | Confirms edge validation, migrations, and API contract quality |
| QA reviewer | Confirms deterministic tests and CI evidence |
| Documentation owner | Confirms authority docs and OpenAPI quality |
| PR approver | Confirms review quality and evidence completeness |

## Mandatory Checklist

Record `Status`, `Evidence`, `Owner`, and `Notes` for each item.

### 1. Planning & Workflow Governance

| ID | Control | Severity | Required Evidence |
| --- | --- | --- | --- |
| GOV-01 | Non-trivial implementation work starts from a planning artifact derived from `SYSTEM_MODEL.md`. | High | Linked plan, issue, or tracked task |
| GOV-02 | Planning and implementation roles are intentionally separated when the change is non-trivial. | Medium | Workflow note, issue history, or PR notes |
| GOV-03 | No non-trivial coding work starts without a linked issue or equivalent tracked planning artifact. | High | GitHub issue, PR link, or tracked doc |
| GOV-04 | GitHub issue creation is part of the documented workflow when the work needs durable tracking. | Medium | Issue link and workflow reference |
| GOV-05 | `scripts/start_github_mcp.sh` is documented and usable. | Medium | Script path and setup docs |
| GOV-06 | Context7 usage is explicitly documented for architecture-aware planning and review. | Medium | Docs and workflow references |

Acceptance criteria:
- Non-trivial implementation work is traceable to a planning record.
- Issue-first workflow is available and documented.
- Planning and implementation are not treated as the same uncontrolled step.

### 2. Architecture & Edge Validation

| ID | Control | Severity | Required Evidence |
| --- | --- | --- | --- |
| ARC-01 | UI, edge, and database authority remain separated across Admin/Public, Cloudflare Workers, and Supabase. | High | Architecture docs and code paths |
| ARC-02 | Every Worker route validates request shape before write paths or sensitive reads. | Critical | Route code or shared validator evidence |
| ARC-03 | Edge validation reflects critical database constraints for user-controlled fields. | Critical | Validation logic and schema reference |
| ARC-04 | Routes normalize user-facing errors and do not leak raw database errors directly. | Critical | Error handling code and tests |
| ARC-05 | ABAC/RLS remains the final authority for protected data access. | Critical | Policy review and route behavior |
| ARC-06 | Validation logic is shared where appropriate instead of duplicated across routes. | Medium | Shared middleware or validation utilities |

Acceptance criteria:
- No sensitive Worker path reaches database writes without validation.
- User-facing errors are sanitized and normalized.
- Trust boundaries remain explicit and documented.

### 3. Database & Security Controls

| ID | Control | Severity | Required Evidence |
| --- | --- | --- | --- |
| DB-01 | All schema changes are tracked in `supabase/migrations/`. | Critical | Migration files |
| DB-02 | Migration parity is checked with `scripts/verify_supabase_migration_consistency.sh`. | High | Script output or CI link |
| DB-03 | AI workflows do not use production database access for routine feature work. | Critical | Workflow policy and credential boundaries |
| DB-04 | AI-assisted schema work uses local or explicitly non-production environments only. | Critical | Setup docs or workflow docs |
| DB-05 | Local database update workflow uses `npx supabase db push --local` or an equivalent safe local-only path. | High | Command docs or scripts |
| DB-06 | Sensitive data handling is excluded from normal AI workflows unless explicitly approved. | Critical | Security policy and approval trail |

Acceptance criteria:
- Production database access is not the default AI path.
- Migration history is traceable and consistent.
- Security controls are operational, not aspirational.

### 4. Testing & CI Determinism

| ID | Control | Severity | Required Evidence |
| --- | --- | --- | --- |
| TEST-01 | `scripts/ci-validate-runtime.sh` is runnable and current. | High | Script output or CI link |
| TEST-02 | Platform browser checks exist for review or release validation. | Medium | CI job, screenshots, or run logs |
| TEST-03 | API and Worker tests explicitly seed, reset, or clean state before execution. | High | Test setup and teardown code |
| TEST-04 | Tests do not rely on stale table state or undeclared fixtures. | High | Harness evidence |
| TEST-05 | Worker-facing services have unit or integration coverage. | High | Test files and coverage summary |
| TEST-06 | Validation and authorization failures are tested as first-class cases. | High | Negative test cases |

Acceptance criteria:
- Test runs are reproducible.
- State cleanup is deliberate.
- Validation and auth failures are treated as required behavior.

### 5. Documentation & API Specification Quality

| ID | Control | Severity | Required Evidence |
| --- | --- | --- | --- |
| DOC-01 | `SYSTEM_MODEL.md` remains the primary architectural authority. | High | Current doc review |
| DOC-02 | `AGENTS.md` reflects current AI operating rules. | High | Current doc review |
| DOC-03 | OpenAPI specifications follow OpenAPI 3.1. | High | Spec files |
| DOC-04 | Swagger UI exposes only intended documentation surfaces. | High | Route config and docs-surface tests |
| DOC-05 | Each audited endpoint has request examples. | High | Spec entries |
| DOC-06 | Each audited endpoint has success response examples. | High | Spec entries |
| DOC-07 | Each audited endpoint has explicit error examples, including `400` and `401` where applicable. | High | Spec entries |
| DOC-08 | Function-level comments explain non-obvious logic where needed. | Medium | Source review |
| DOC-09 | Docs are updated in the same change set as relevant implementation changes. | High | PR diff |

Acceptance criteria:
- OpenAPI is decision-grade, not placeholder-grade.
- Error contracts are documented.
- Docs remain aligned with implementation.

### 6. Pre-Merge Review & Refactoring Discipline

| ID | Control | Severity | Required Evidence |
| --- | --- | --- | --- |
| REV-01 | Pull requests receive structured review using a high-capability AI model or an equivalent rigorous review process. | High | Review record |
| REV-02 | Review explicitly checks for duplicated authorization and permission extraction logic. | High | Review notes |
| REV-03 | Shared auth or validation logic is consolidated into reusable middleware or utilities where justified. | High | Refactor diff |
| REV-04 | Review spans Admin Panel, Public Portal, Mobile, and Edge when a shared contract is affected. | Medium | Review checklist |
| REV-05 | Review checks docs drift, validation gaps, and API example drift. | High | Review notes |
| REV-06 | Refactoring does not widen privileges or weaken ABAC/RLS guarantees. | Critical | Security review evidence |

Acceptance criteria:
- Review is structured rather than ad hoc.
- Duplication trends downward over time.
- Refactoring preserves security boundaries.

## Release Gates

| ID | Gate | Severity | Required Evidence |
| --- | --- | --- | --- |
| REL-01 | No Critical item remains open without explicit risk acceptance. | Critical | Audit summary |
| REL-02 | All High items have owners and target dates. | High | Findings register |
| REL-03 | Edge validation has been verified for newly changed routes. | Critical | Test or review evidence |
| REL-04 | No AI workflow used production DB access for the delivered scope. | Critical | Workflow attestation |
| REL-05 | OpenAPI examples were updated for changed endpoints. | High | Spec diff |
| REL-06 | CI validation and browser checks passed for release scope. | High | CI links |
| REL-07 | PR review explicitly checked shared auth and refactor opportunities. | Medium | Review notes |

## Related Docs

- [awcms-audit-findings-log.md](./awcms-audit-findings-log.md)
- [awcms-release-readiness-checklist.md](./awcms-release-readiness-checklist.md)
- [../dev/ai-planning-workflow.md](../dev/ai-planning-workflow.md)
- [../dev/openapi-quality-checklist.md](../dev/openapi-quality-checklist.md)
