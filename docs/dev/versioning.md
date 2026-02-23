> **Documentation Authority**: [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) Section 1 (Tech Stack)

# Versioning & Deployment Strategy

## 1. Overview

AWCMS is a **monorepo** with multiple independently-versioned apps. Each client application can be updated and deployed independently without requiring a coordinated full-stack release.

| Application | Versioned In | Deploy Target |
|-------------|-------------|---------------|
| `awcms` (Admin Panel) | `awcms/package.json` | Cloudflare Pages |
| `awcms-public/primary` (Public Portal) | `awcms-public/primary/package.json` | Cloudflare Pages |
| `awcms-mobile/primary` (Flutter App) | `pubspec.yaml` | App Stores / OTA |
| `awcms-esp32/primary` (IoT Firmware) | `CMakeLists.txt` / `build.json` | OTA via AWCMS API |

---

## 2. Semantic Versioning

All packages follow **Semantic Versioning** (`MAJOR.MINOR.PATCH`):

| Increment | When | Example |
|-----------|------|---------|
| `MAJOR` | Breaking API changes, DB schema incompatibilities | `3.0.0` |
| `MINOR` | New features, backward-compatible | `2.33.0` |
| `PATCH` | Bug fixes, hotfixes | `2.32.1` |

---

## 3. Git Branching Model

```text
main         ← Production. Tagged releases only.
develop      ← Integration branch. All features merge here first.
feature/*    ← One branch per feature/fix (e.g. feature/add-events-module)
release/*    ← Release preparation (e.g. release/2.33.0)
hotfix/*     ← Emergency production patches
```

### Standard Feature Flow

```bash
# 1. Branch from develop
git checkout develop && git pull
git checkout -b feature/my-new-feature

# 2. Work, commit, push
git add . && git commit -m "feat(module): add new feature"
git push origin feature/my-new-feature

# 3. Open PR → develop (CI runs lint + tests)
# 4. Merge to develop → staging environment updates automatically
# 5. When ready: open PR from develop → main
```

### Hotfix Flow

```bash
# Branch from main (not develop)
git checkout main && git pull
git checkout -b hotfix/fix-critical-bug

# Fix, bump PATCH version, commit
npm version patch --prefix awcms      # bumps awcms/package.json
git add . && git commit -m "fix: resolve critical auth bug"

# Merge to main AND develop
git checkout main && git merge hotfix/fix-critical-bug
git checkout develop && git merge hotfix/fix-critical-bug
git tag v2.32.1
git push origin main develop --tags
```

---

## 4. Independent Application Deployment

Because each client app has its own `package.json` with an independent `version`, they can be released on separate cadences.

### Bumping a Single App Version

```bash
# Bump only the Admin Panel (e.g., after a UI-only change)
npm version minor --prefix awcms
# → awcms/package.json: "version": "2.33.0"

# Bump only the Public Portal
npm version patch --prefix awcms-public/primary
# → awcms-public/primary/package.json: "version": "2.28.1"
```

### Keeping the Monorepo in Sync

The **root** `CHANGELOG.md` is the single source of truth for the overall project history. Even single-app releases get a CHANGELOG entry:

```markdown
## [Unreleased]

### Changed
- **Admin Panel 2.33.0**: Added Events module with calendar view.

## [2.33.0] "Events Launch" - 2026-03-01
Applies to: `awcms@2.33.0`
```

---

## 5. CI/CD Pipeline per App

GitHub Actions triggers different deploy jobs depending on which paths changed:

```yaml
# .github/workflows/ci-push.yml (excerpt)
jobs:
  deploy-admin:
    if: contains(github.event.commits[0].modified, 'awcms/')
    steps:
      - run: npm run build
        working-directory: awcms/
      - uses: cloudflare/pages-action@v1
        with:
          projectName: awcms-admin

  deploy-public:
    if: contains(github.event.commits[0].modified, 'awcms-public/')
    steps:
      - run: npm run build
        working-directory: awcms-public/primary/
      - uses: cloudflare/pages-action@v1
        with:
          projectName: awcms-public
```

This means merging a Flutter-only change won't trigger a web rebuild, and vice versa.

---

## 6. Mobile App Versioning (Flutter)

The mobile app uses a `MAJOR.MINOR.PATCH+BUILD` version in `pubspec.yaml`:

```yaml
# awcms-mobile/primary/pubspec.yaml
version: 1.5.0+23    # 1.5.0 = human version, 23 = Android versionCode / iOS build number
```

### Releasing a New Build

```bash
# Bump version manually in pubspec.yaml, then build
flutter build apk --release --dart-define-from-file=.env.prod
flutter build ios --release --dart-define-from-file=.env.prod
```

For OTA (Over-The-Air) critical patches, the AWCMS backend serves an update manifest checked by the app on launch.

---

## 7. ESP32 Firmware Versioning

Firmware versions are tracked as `MAJOR.MINOR.PATCH` in the build configuration and compared against the AWCMS-served config on boot:

```cpp
// include/config.h
#define FIRMWARE_VERSION "1.2.0"
```

If the remote config returns a higher `firmware_version`, the device triggers its OTA update sequence automatically.

---

## 8. Release Checklist

```markdown
- [ ] Ensure all feature branches merged to `develop`
- [ ] Run `npm run lint` and `npm run test` for all changed workspaces
- [ ] Bump version in relevant `package.json` / `pubspec.yaml`
- [ ] Update `CHANGELOG.md` with release notes
- [ ] Merge `develop` → `main` via PR
- [ ] Tag release: `git tag v2.33.0 && git push --tags`
- [ ] GitHub Actions deploys to production automatically
- [ ] Verify deployment in Cloudflare Pages dashboard
```
