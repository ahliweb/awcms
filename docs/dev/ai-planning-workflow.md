> **Documentation Authority**: [../../SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) -> [../../AGENTS.md](../../AGENTS.md) -> [../../README.md](../../README.md) -> [../../DOCS_INDEX.md](../../DOCS_INDEX.md)
>
> **Status:** Maintained
>
> **Last Updated:** 2026-04-04

# AI Planning Workflow

## Purpose

Define the minimum planning discipline for AI-assisted implementation work in AWCMS so coding starts from a traceable plan instead of an untracked prompt.

## When Planning Is Required

Planning is required when work is non-trivial, including:
- schema or migration changes
- Cloudflare Worker route changes
- shared contract changes across Admin, Public, Mobile, or Edge
- permission, tenancy, or RLS changes
- multi-file refactors
- release hardening or audit work

Planning is optional for clearly local, low-risk edits such as typo fixes, one-line docs fixes, or isolated comments.

## Required Inputs

Before implementation begins, confirm:
- the relevant authority docs, starting with `SYSTEM_MODEL.md`
- the affected package or runtime surface
- the security boundary involved, if any
- the verification path
- the tracking artifact

Accepted tracking artifacts:
- GitHub issue
- tracked PR description for tightly scoped follow-up work
- maintained planning document in `docs/dev/` or `docs/audit/`

## Minimum Planning Record

Every non-trivial task should capture:

| Field | Requirement |
| --- | --- |
| Problem | What is changing and why |
| Scope | Which packages, routes, docs, or migrations are affected |
| Constraints | Authority docs, tenancy, RLS, validation, soft delete, release constraints |
| Verification | Tests, builds, CI checks, or manual checks to run |
| Tracking | Linked issue, PR, or maintained planning document |

## Recommended Workflow

1. Read `SYSTEM_MODEL.md` first, then `AGENTS.md`, then the closest package or module docs.
2. Create or link a GitHub issue when the work needs durable tracking.
3. Write a short implementation plan before editing code.
4. Separate planning from implementation for non-trivial work.
5. Execute the change.
6. Update docs in the same change set when behavior, workflow, or contracts changed.
7. Verify the change with the relevant tests and scripts.
8. Use structured review before merge.

## AWCMS-Specific Rules

- Planning must respect the documentation authority chain.
- AI workflows should use local or non-production database paths by default.
- `scripts/start_github_mcp.sh` is the documented GitHub MCP entrypoint when MCP-driven issue work is needed.
- Context7 should be used for architecture-aware library guidance, but repository code and docs remain the source of truth for current implementation.

## Suggested Evidence

- linked GitHub issue
- plan section in PR description
- comment referencing affected docs and verification steps
- CI run or command output

## Related Docs

- [ai-workflows.md](./ai-workflows.md)
- [openapi-quality-checklist.md](./openapi-quality-checklist.md)
- [../audit/awcms-vibe-engineering-audit-checklist.md](../audit/awcms-vibe-engineering-audit-checklist.md)
