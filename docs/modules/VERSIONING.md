# Versioning System

## Purpose

Define how AWCMS versions are managed across code and documentation.

## Audience

- Release managers
- Maintainers updating versions

## Prerequisites

- `CHANGELOG.md`

## Core Concepts

- AWCMS follows Semantic Versioning.
- `awcms/src/lib/version.js` is used for UI/version display.
- `awcms/package.json` provides the build/version metadata for the Admin package.
- Release process should update both files to keep them aligned.
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
| `awcms/package.json` | npm version (keep aligned with `version.js`) |
| `CHANGELOG.md` | Release history |

## Implementation Patterns

```javascript
import { getVersionInfo, getDisplayVersion } from '@/lib/version';
```

## Security and Compliance Notes

- Version bumps are required for documented changes in releases.

## References

- `../../CHANGELOG.md`
