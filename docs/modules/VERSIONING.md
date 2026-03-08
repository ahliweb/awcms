> **Documentation Authority**: [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) Section 1 (Tech Stack)

# Versioning System

## Purpose

Define how AWCMS versions are managed across code and documentation.

## Audience

- Release managers
- Maintainers updating versions

## Prerequisites

- [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) - **Primary authority** for versioning standards
- [AGENTS.md](../../AGENTS.md) - Implementation patterns and Context7 references
- `CHANGELOG.md`

## Core Concepts

- AWCMS follows Semantic Versioning.
- Package manifests are the canonical release/version source for each maintained workspace.
- `awcms/src/lib/version.js` is a UI/version-display helper for the admin panel.
- If `version.js` is still used in a release path, update it intentionally after bumping the relevant package manifest.
- Documentation-only releases should use a patch bump.
- `awcms-public/primary/package.json` tracks the public portal template version and may differ from the admin version.
- If `version.js` drifts from `package.json`, the UI will display a stale version.

## How It Works

### Version Format

```text
MAJOR.MINOR.PATCH[-PRERELEASE][+BUILD]
```

### Source Files

| File | Purpose |
| --- | --- |
| `awcms/package.json` | Canonical Admin package version |
| `awcms-public/*/package.json` | Canonical public-portal package versions |
| `awcms-mcp/package.json` / other workspace manifests | Canonical package versions for those workspaces |
| `awcms/src/lib/version.js` | Admin UI display helper (keep aligned when used) |
| `CHANGELOG.md` | Release history |

## Implementation Patterns

```javascript
import { getVersionInfo, getDisplayVersion } from '@/lib/version';
```

## Security and Compliance Notes

- Version bumps are required for documented changes in releases.

## References

- `../../CHANGELOG.md`
