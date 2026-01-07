# Versioning System

AWCMS uses [Semantic Versioning](https://semver.org/) to track releases.

---

## Version Format

```text
MAJOR.MINOR.PATCH[-PRERELEASE][+BUILD]

Examples:
  2.0.0           - Stable release
  2.1.0-beta.1    - Beta pre-release
  2.0.0+build.42  - With build metadata
```

### Version Components

| Component | Description | Increment When |
| --------- | ----------- | -------------- |
| **MAJOR** | Breaking changes | Incompatible API changes |
| **MINOR** | New features | Backward-compatible additions |
| **PATCH** | Bug fixes | Backward-compatible fixes |
| **PRERELEASE** | Pre-release tag | alpha, beta, rc.1, etc. |
| **BUILD** | Build number | Every CI build |

---

## Version Source Files

| File | Purpose |
| ---- | ------- |
| `src/lib/version.js` | Single source of truth for app version |
| `package.json` | npm version (should match) |
| `.version` | Build number (auto-incremented by CI) |
| `../CHANGELOG.md` | Release history |

---

## Using Version in Code

### Import Version Info

```javascript
import { getVersionInfo, getDisplayVersion } from '@/lib/version';

// Get full version info object
const info = getVersionInfo();
console.log(info.version);      // "2.0.0"
console.log(info.displayVersion); // 'v2.0.0 "Aurora"'
console.log(info.build);        // 13

// Get display string
const display = getDisplayVersion();
console.log(display); // 'v2.0.0 "Aurora"'
```

### Version Badge Component

```jsx
import VersionBadge from '@/components/ui/VersionBadge';

// Default badge with tooltip
<VersionBadge />

// Compact version (no codename)
<VersionBadge variant="compact" />

// Full version with codename
<VersionBadge variant="full" />

// Without tooltip
<VersionBadge showTooltip={false} />
```

---

## Release Process

### 1. Update Version

Edit `src/lib/version.js`:

```javascript
export const VERSION = {
  major: 2,
  minor: 1,
  patch: 0,
  prerelease: '',
  build: 14,
  date: '2025-01-15',
  codename: 'Blaze',
};
```

### 2. Sync package.json

Update `package.json` version:

```json
{
  "version": "2.1.0"
}
```

### 3. Update Changelog

Add new section to `../CHANGELOG.md`:

```markdown
## [2.1.0] "Blaze" - 2025-01-15

### Added
- New feature description

### Changed
- Change description

### Fixed
- Bug fix description
```

### 4. Commit and Tag

```bash
git add .
git commit -m "release: v2.1.0 Blaze"
git tag v2.1.0
git push origin main --tags
```

---

## Pre-release Versions

For testing before stable release:

```javascript
// Alpha (early testing)
prerelease: 'alpha.1'  // → 2.1.0-alpha.1

// Beta (feature complete, testing)
prerelease: 'beta.1'   // → 2.1.0-beta.1

// Release Candidate (final testing)
prerelease: 'rc.1'     // → 2.1.0-rc.1

// Stable (production ready)
prerelease: ''         // → 2.1.0
```

---

## Related Documentation

- [Changelog](../../CHANGELOG.md)
- [Contributing](../01-guides/CONTRIBUTING.md)
- [Deployment](../01-guides/DEPLOYMENT.md)
