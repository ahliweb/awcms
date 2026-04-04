> **Documentation Authority**: [../../SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) -> [../../AGENTS.md](../../AGENTS.md) -> [../../README.md](../../README.md) -> [../../DOCS_INDEX.md](../../DOCS_INDEX.md)
>
> **Status:** Maintained
>
> **Last Updated:** 2026-04-04

# AWCMS Release Readiness Checklist

## Purpose

Provide a short release gate based on the audit checklist so release reviews are consistent across Admin, Public, Edge, and shared contract changes.

## Release Checklist

| ID | Release Gate | Status | Evidence | Notes |
| --- | --- | --- | --- | --- |
| REL-01 | No Critical audit item remains open without explicit risk acceptance. |  |  |  |
| REL-02 | All High audit items have owners and target dates. |  |  |  |
| REL-03 | Edge validation was verified for newly changed routes. |  |  |  |
| REL-04 | No AI workflow used production DB access for this release scope. |  |  |  |
| REL-05 | OpenAPI examples were updated for changed endpoints. |  |  |  |
| REL-06 | CI validation and browser checks passed for release scope. |  |  |  |
| REL-07 | Review explicitly checked shared auth and refactor opportunities. |  |  |  |

## Minimum Pass Rule

The release is not ready if any `Critical` gate is blank, failed, or accepted informally without a recorded decision.

## Related Docs

- [awcms-vibe-engineering-audit-checklist.md](./awcms-vibe-engineering-audit-checklist.md)
- [awcms-audit-findings-log.md](./awcms-audit-findings-log.md)
