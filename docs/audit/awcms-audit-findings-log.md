> **Documentation Authority**: [../../SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) -> [../../AGENTS.md](../../AGENTS.md) -> [../../README.md](../../README.md) -> [../../DOCS_INDEX.md](../../DOCS_INDEX.md)
>
> **Status:** Maintained
>
> **Last Updated:** 2026-04-04

# AWCMS Audit Findings Log

## Purpose

Track findings raised against the AWCMS audit checklist and make ownership, severity, and remediation status visible.

## Usage

- Create one row per finding.
- Link the related control ID from the audit checklist.
- Use a concrete owner and target date.
- Close findings only after evidence is attached.

## Findings Register

| Finding ID | Related Control | Severity | Finding | Recommended Action | Owner | Target Date | Status | Evidence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| F-001 | ARC-02 |  |  |  |  |  | Open |  |
| F-002 | DB-03 |  |  |  |  |  | Open |  |
| F-003 | TEST-03 |  |  |  |  |  | Open |  |
| F-004 | DOC-07 |  |  |  |  |  | Open |  |
| F-005 | REV-03 |  |  |  |  |  | Open |  |

## Notes

- Severity should match the checklist definitions in `docs/audit/awcms-vibe-engineering-audit-checklist.md`.
- Evidence can be a PR link, CI run, script output, screenshot, or commit reference.
