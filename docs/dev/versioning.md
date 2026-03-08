> **Documentation Authority**: [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) Section 1 (Tech Stack)

# Versioning & Deployment Strategy

## Status Classification (Audit 2026-02-27)

- This document is a strategy guide and may include aspirational workflow patterns.
- Authoritative live behavior for CI/CD and runtime checks is defined in `.github/workflows/**` and package manifests.
- Treat checklist items in this file as release-process guidance, not as proof that every step is automated in all environments.

## 1. Overview

AWCMS is a **monorepo** with multiple independently-versioned apps. Each client application can be updated and deployed independently without requiring a coordinated full-stack release.

## 1.1 Benchmark-Ready Strategy

### Objective

Enable independent releases per client while preserving backward compatibility across shared schemas and APIs.

### Required Inputs

| Field | Source | Required | Notes |
| --- | --- | --- | --- |
| App version | `package.json` / `pubspec.yaml` | Yes | SemVer per client |
| CI path filters | GitHub Actions | Yes | Deploy only changed apps |
| Additive schema rules | DB migration policy | Yes | Prevent breaking clients |
| Root changelog | `CHANGELOG.md` | Yes | Global release history |

### Workflow

1. Make backend changes additive (new columns, new endpoints).
2. Bump only the app versions affected by the change.
3. Deploy in a staged order: database/functions -> admin -> public -> mobile -> IoT.
4. For breaking API changes, create versioned endpoints (for example `device-config-v2`).
5. Record releases in root `CHANGELOG.md` and tag when merging to `main`.

### Reference Implementation

```bash
# Admin only
npm version minor --prefix awcms

# Public portal only
npm version patch --prefix awcms-public/primary
```

```yaml
# .github/workflows/ci-push.yml (excerpt)
jobs:
  paths-filter:
    outputs:
      admin: ${{ steps.filter.outputs.admin }}
      public: ${{ steps.filter.outputs.public }}
    steps:
      - uses: dorny/paths-filter@v3
        id: filter
        with:
          filters: |
            admin:
              - 'awcms/**'
            public:
              - 'awcms-public/**'

  build-admin:
    if: ${{ needs.paths-filter.outputs.admin == 'true' }}
    steps:
      - run: npm run build
        working-directory: awcms/

  build-public:
    if: ${{ needs.paths-filter.outputs.public == 'true' }}
    steps:
      - run: npm run build
        working-directory: awcms-public/primary/
```

Current workflow note:

- PR validation runs on pull requests targeting `main`.
- Push CI runs on both `main` and `develop`.

```yaml
# Historical simplified example (superseded)
jobs:
  deploy-admin:
    if: contains(github.event.commits[0].modified, 'awcms/')
    steps:
      - run: npm run build
        working-directory: awcms/

  deploy-public:
    if: contains(github.event.commits[0].modified, 'awcms-public/')
    steps:
      - run: npm run build
        working-directory: awcms-public/primary/
```

### Validation Checklist

- A single-app change only deploys that app.
- Older clients continue to work after schema changes.
- All releases have a matching `CHANGELOG.md` entry.

### Failure Modes and Guardrails

- Breaking DB changes: use additive migrations and dual-write during transitions.
- Function signature changes: create a new endpoint instead of overwriting.
- Mobile rollback: use OTA plus a force-update wall for critical fixes.

| Application | Versioned In | Deploy Target |
|-------------|-------------|---------------|
| `awcms` (Admin Panel) | `awcms/package.json` | Cloudflare Pages |
| `awcms-public/primary` (Public Portal) | `awcms-public/primary/package.json` | Cloudflare Pages |
| `awcms-mobile/primary` (Flutter App) | `pubspec.yaml` | App Stores / OTA |
| `awcms-esp32/primary` (IoT Firmware) | `platformio.ini` / firmware config headers | OTA via AWCMS API |

---

## 2. Semantic Versioning

All packages follow **Semantic Versioning** (`MAJOR.MINOR.PATCH`):

| Increment | When | Example |
|-----------|------|---------|
| `MAJOR` | Breaking API changes, DB schema incompatibilities | `3.0.0` |
| `MINOR` | New features, backward-compatible | `3.1.0` |
| `PATCH` | Bug fixes, hotfixes | `3.0.1` |

---

## 3. Git Branching Model

```text
main         ← Production. Tagged releases only.
develop      ← Integration branch. All features merge here first.
feature/*    ← One branch per feature/fix (e.g. feature/add-events-module)
release/*    ← Release preparation (e.g. release/3.0.0)
hotfix/*     ← Emergency production patches
```

### Standard Feature Flow

```bash
# 1. Branch from main or the active integration branch used by your team
git checkout main && git pull
git checkout -b feature/my-new-feature

# 2. Work, commit, push
git add . && git commit -m "feat(module): add new feature"
git push origin feature/my-new-feature

# 3. Open PR → main (current automated PR validation target)
# 4. Merge to main when approved
# 5. If your team also uses develop, treat it as an operational workflow layered on top of the current CI setup
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
# → awcms/package.json: "version": "3.1.0"

# Bump only the Public Portal
npm version patch --prefix awcms-public/primary
# → awcms-public/primary/package.json: "version": "3.1.1"
```

### Keeping the Monorepo in Sync

The **root** `CHANGELOG.md` is the single source of truth for the overall project history. Even single-app releases get a CHANGELOG entry:

```markdown
## [Unreleased]

### Changed
- **AWCMS 3.1.0**: Landed the documentation/CI hardening sweep, release-baseline cleanup, and Batch A dependency maintenance updates.

## [3.1.0] - 2026-03-09
Applies to: `awcms@3.1.0`, `awcms-public-root@3.1.0`, `@onwidget/astrowind@3.1.0`, `smanda-pangkalan-bun@3.1.0`, `awcms-mcp@3.1.0`
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

## 8. Dependency Management Across Clients

Since AWCMS clients function independently, managing shared assumptions (like Supabase API schemas or edge API payloads) requires strict coordination to avoid breaking changes.

### Schema Versioning Strategy

- **Additive Database Changes:** Never rename or delete columns used by existing clients. Always add new columns, make them nullable (or provide defaults), and write data to both old and new columns until all clients are updated.
- **API Versioning (Edge Logic):** If a breaking change to a Cloudflare Worker route or a legacy Supabase Edge Function cannot be avoided, create a new endpoint rather than overwriting the existing one.
- **Client Fallbacks:** Mobile and IoT clients must gracefully handle missing new fields or unrecognized enum values from the API without crashing.

### Shared Node Packages

For Node.js clients (`awcms` and `awcms-public/primary`), shared dependencies (e.g., `ajv`, `react-compiler`) are managed at the monorepo root via npm workspaces to ensure identical version resolution and prevent bundle duplication.

---

## 9. Deployment Orchestration & Coordination

Deployments must be sequenced carefully when a feature spans the backend schema, Admin Panel, and end-user clients.

### The Staged Rollout Sequence

When a major feature releases:

1. **Database & Edge Logic (Backend):** Deploy additive migrations first, then deploy `awcms-edge/` (Cloudflare Workers), and deploy legacy Supabase functions only for features that still depend on them.
2. **Admin Panel (`awcms`):** Deploy to Cloudflare Pages. Editors can begin creating data using the new schema.
3. **Public Portal (`awcms-public`):** Deploy to Cloudflare Pages to render the new content for web users.
4. **Mobile App (`awcms-mobile`):** Submit to App Stores. (Approval takes 1-3 days).
5. **IoT Firmware (`awcms-esp32`):** Flag the new firmware version in the Admin config to trigger automatic OTA updates on the next polling cycle.

*Because the backend changes are additive, older mobile and IoT clients continue to function perfectly during the multi-day rollout window.*

---

## 10. Rollback & Recovery Strategies

Production incidents require immediate, client-specific rollback strategies:

### Web Clients (Admin & Public Portal)

- **Cloudflare Pages Instant Rollback:** In the Cloudflare Dashboard, go to Deployments, locate the last known good deployment, and click **Restore**. This reverts the live URLs to the previous build instantly without waiting for CI.
- **Git Reversion:** Locally execute `git revert HEAD`, commit, and push to `main` to align the Git history with the live site.

### Supabase Backend

- **Edge Logic:** Re-deploy the previous Cloudflare Worker or, for legacy flows, re-deploy the affected Supabase function.
- **Database Schema:** Direct rollback of schema migrations is risky. Prefer "roll-forward" fixes by creating a new migration (`npx supabase migration new fix_bug`) that reverts the problematic objects, then push (`npx supabase db push --linked`).

### Mobile App

- **OTA Patch:** Revert the breaking commit, bump the `PATCH` version, rebuild, and push the OTA update manifest.
- **App Store Rejection:** Mobile apps cannot be instantly rolled back on user devices. If an app release ships with a critical bug, immediately release a hotfix to the App Store and use an in-app "Force Update Required" wall (controlled via a Supabase Edge Function) to block broken clients.

### IoT Devices

- **Config Reversion:** Revert the offending `firmware_version` string in the AWCMS Device Config dashboard back to the previous stable version. Devices will downgrade on the next check-in.

---

## 11. Release Checklist

```markdown
- [ ] Ensure all feature branches merged to `develop`
- [ ] Ensure backend migrations (additive only) are applied to staging/prod
- [ ] Run `npm run lint` and `npm run test` for all changed workspaces
- [ ] Bump version in relevant `package.json` / `pubspec.yaml`
- [ ] Update `CHANGELOG.md` with release notes
- [ ] Merge `develop` → `main` via PR
- [ ] Tag release: `git tag v3.1.0 && git push --tags`
- [ ] GitHub Actions deploys web portals automatically
- [ ] Monitor error logs during deployment sequence
```
