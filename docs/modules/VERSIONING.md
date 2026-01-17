# Versioning System

## Purpose

Define how AWCMS versions are managed across code and documentation.

## Audience

- Release managers
- Maintainers updating versions

## Prerequisites

- `awcms/CHANGELOG.md`

## Core Concepts

- AWCMS follows Semantic Versioning.
- `awcms/src/lib/version.js` is the single source of truth.
- `awcms/package.json` must match `version.js`.
- Documentation-only releases should use a patch bump.

## How It Works

### Version Format

```text
MAJOR.MINOR.PATCH[-PRERELEASE][+BUILD]
```

### Source Files

| File | Purpose |
| --- | --- |
| `awcms/src/lib/version.js` | Canonical version object |
| `awcms/package.json` | npm version (must match) |
| `awcms/CHANGELOG.md` | Release history |
| `docs/changelog.md` | Documentation changes |

## Implementation Patterns

```javascript
import { getVersionInfo, getDisplayVersion } from '@/lib/version';
```

## Security and Compliance Notes

- Version bumps are required for documented changes in releases.

## References

- `../../CHANGELOG.md`
