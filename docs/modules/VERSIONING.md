> **Documentation Authority**: [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) -> [AGENTS.md](../../AGENTS.md) -> [README.md](../../README.md) -> [DOCS_INDEX.md](../../DOCS_INDEX.md)
>
> **Status:** Maintained
>
> **Last Refreshed:** 2026-04-09

# Versioning System

## Purpose

Describe the current versioning model for AWCMS modules/workspaces and how versioned package/application releases relate to module-level documentation.

This module doc is intentionally concise. The primary strategic detail now lives in [docs/dev/versioning.md](../dev/versioning.md).

## Current Versioning Model

AWCMS is currently a multi-workspace monorepo with independently versioned maintained applications and packages.

Current important rules:

- package manifests are the canonical version source for each workspace
- the root `CHANGELOG.md` remains the canonical project-wide release history
- versioning should remain SemVer-based
- not every doc/module change implies every workspace version must move together

## Current Canonical Version Sources

Representative current sources include:

- `awcms/package.json`
- `awcms-public/*/package.json`
- `awcms-edge/package.json`
- `awcms-mcp/package.json`
- `packages/awcms-shared/package.json`
- mobile/firmware equivalents in their respective workspace metadata files

`awcms/src/lib/version.js` may still matter for admin UI display paths and should not drift from the intended surfaced version where it is still used.

## Current SemVer Guidance

- `MAJOR` for breaking changes
- `MINOR` for backward-compatible features
- `PATCH` for backward-compatible fixes and narrow maintenance changes

Current important note:

- documentation-only changes may justify a patch bump when they ship as a release-relevant artifact, but they do not automatically require every workspace to version-bump together

## Current Module-Level Versioning Implication

For module docs and module-level features:

- treat module changes as part of the owning workspace release unless the module is shipped independently as its own package/runtime surface
- keep release notes/changelog entries aligned with the actual workspace(s) affected

## Current Validation Guidance

| Surface | Validation |
| --- | --- |
| maintained docs | `cd awcms && npm run docs:check` |
| release/versioning workflow detail | use the current guidance in `docs/dev/versioning.md` |

## Related Docs

- [docs/dev/versioning.md](../dev/versioning.md)
- [../../CHANGELOG.md](../../CHANGELOG.md)
