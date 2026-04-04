> **Documentation Authority**: [../../SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) -> [../../AGENTS.md](../../AGENTS.md) -> [../../README.md](../../README.md) -> [../../DOCS_INDEX.md](../../DOCS_INDEX.md)
>
> **Status:** Maintained
>
> **Last Updated:** 2026-04-04

# Review Checklist

## Purpose

Provide the human review companion to the PR template and audit checklist so reviewers apply the same checks consistently.

## When To Use It

Use this checklist for:
- pull request review
- release review
- refactor review
- edge contract changes
- schema, permission, or tenancy changes

## Review Checklist

| ID | Check | Status | Notes |
| --- | --- | --- | --- |
| REV-01 | The PR includes a valid planning record or tracked implementation artifact. |  |  |
| REV-02 | The stated affected surfaces match the actual scope of the diff. |  |  |
| REV-03 | Shared contracts were reviewed across Admin, Public, Mobile, Edge, and shared packages where relevant. |  |  |
| REV-04 | Validation happens before sensitive writes or sensitive reads. |  |  |
| REV-05 | Tenant, ABAC, and RLS boundaries remain intact. |  |  |
| REV-06 | Errors returned to users are normalized and do not expose raw database internals. |  |  |
| REV-07 | Auth, permission, or validation duplication was identified and reduced where justified. |  |  |
| REV-08 | Docs changed with behavior when required. |  |  |
| REV-09 | OpenAPI examples changed with edge contract changes when required. |  |  |
| REV-10 | Verification includes negative-path coverage for validation and authorization where relevant. |  |  |

## Reviewer Prompts

- Is the PR body accurate, or is it only complete in format?
- Does the diff introduce a new trust boundary or widen an existing one?
- Are permission checks only in UI, or does the final authority remain in Supabase policies and permission functions?
- If Worker routes changed, are request validation and error responses explicit?
- If migrations changed, is the local-only database workflow preserved?
- If shared contracts changed, did the author verify all affected surfaces?

## Evidence To Capture

- review comment or approval note
- CI run link
- command output
- spec diff
- docs diff
- linked issue or planning doc

## Related Docs

- [ai-planning-workflow.md](./ai-planning-workflow.md)
- [openapi-quality-checklist.md](./openapi-quality-checklist.md)
- [../audit/awcms-vibe-engineering-audit-checklist.md](../audit/awcms-vibe-engineering-audit-checklist.md)
