> **Documentation Authority**: [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) Section 1 (Tech Stack)

# CI/CD Pipeline

## Purpose

Describe the GitHub Actions workflows used for AWCMS.

## Audience

- Maintainers and release engineers
- Contributors validating CI expectations

## Prerequisites

- [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) - **Primary authority** for CI/CD workflow requirements
- [AGENTS.md](../../AGENTS.md) - Implementation patterns and Context7 references
- GitHub Actions enabled
- Secrets configured (Supabase and Cloudflare)

## Steps

### Workflow Location

- `.github/workflows/ci-push.yml` (pushes to `main`/`develop`, deploys)
- `.github/workflows/ci-pr.yml` (pull requests to `main`)
- `.github/workflows/docs-link-check.yml` (docs link checks on markdown changes)

### Trigger Events

- Push to `main` or `develop` (ci-push)
- Pull requests targeting `main` (ci-pr)

### Jobs

| Job | Purpose | Working Directory | Workflow |
| --- | --- | --- | --- |
| `lint-test-admin` | Lint, test, build admin | `awcms/` | ci-push, ci-pr |
| `paths-filter` | Detect changed push-paths for selected workspaces | repo root | ci-push |
| `lint-build-public` | Run `npm run check`, then build the primary public portal | `awcms-public/primary/` | ci-push, ci-pr |
| `build-mobile` | Flutter build and tests | `awcms-mobile/primary/` | ci-push, ci-pr |
| `typecheck-edge` | Install dependencies and run Worker TypeScript checks | `awcms-edge/` | ci-push, ci-pr |
| `lint-build-mcp` | Install dependencies, lint, and build the MCP server | `awcms-mcp/` | ci-push, ci-pr |
| `build-ext-primary-analytics` | Install dependencies and run the extension SSR smoke build | `awcms-ext/primary-analytics/` | ci-push, ci-pr |
| `typecheck-shared` | Install dependencies and run `@awcms/shared` TypeScript checks | `packages/awcms-shared/` | ci-push, ci-pr |
| `lint-build-smandapbun` | Check and build the SMANDAPBUN public portal | `awcms-public/smandapbun/` | ci-push, ci-pr |
| `db-check` | Supabase migration lint | `awcms/supabase` | ci-pr |
| `deploy-production` | Cloudflare Pages deploy (admin panel artifact) | `awcms/` | ci-push |
| `link-check` | Markdown link validation | repo root | docs-link-check |

Current workflow coverage boundaries:

- `ci-push` path filters now cover `awcms/`, `awcms-public/primary/`, `awcms-mobile/`, `awcms-public/smandapbun/`, `awcms-edge/`, `awcms-mcp/`, `awcms-ext/`, and `packages/awcms-shared/`.
- `ci-pr` now includes dedicated jobs for `awcms-edge/`, `awcms-mcp/`, `awcms-ext/primary-analytics/`, and `packages/awcms-shared/`.
- The current extension coverage is package-specific: only `awcms-ext/primary-analytics/` has a dedicated job. Add new jobs or a matrix when more maintained extension packages appear.

### Runtime Notes

- GitHub workflows pin Node runtime to `22.12.0` to match package `engines` constraints.
- Keep workflow/runtime Node versions aligned with `SYSTEM_MODEL.md` and package `engines` before bumping toolchains.
- `awcms-edge/`, `awcms-mcp/`, `awcms-ext/primary-analytics/`, and `packages/awcms-shared/` are now first-class CI surfaces.
- `build-ext-primary-analytics` uses `vite build --ssr src/index.js` as a package-level smoke build because the extension package does not ship a standalone app shell.

### Required Secrets and Variables (GitHub Actions)

- `VITE_SUPABASE_URL` (used by admin build/test and mapped into public build env)
- `VITE_SUPABASE_PUBLISHABLE_KEY` (used by admin build/test and mapped into public build env)
- `CLOUDFLARE_API_TOKEN` (required by `deploy-production`)
- `CLOUDFLARE_ENABLED` (repo variable; must be `true` for deploy job execution)

Notes:

- `ci-pr` uses mock Supabase values for admin/public jobs and does not require repository Supabase secrets.
- Public portal CI jobs currently map `VITE_*` secrets into `PUBLIC_*` variables in workflow env.
- `PUBLIC_TENANT_ID` is injected in workflow env using either repository secrets or a zero UUID fallback for static-check/build safety.
- `deploy-production` currently deploys only the admin artifact (`awcms/dist`) to Cloudflare Pages.
- Worker deploys for `awcms-edge/` are not part of the current GitHub Actions push/PR workflows.
- `docs-link-check.yml` now delegates to `cd awcms && npm run docs:check`, which keeps workflow scope aligned with the maintained-doc policy in the audit plan/tracker.

## Verification

Run locally before pushing:

```bash
# From repository root

# Admin Panel
cd awcms
npm run lint
npm run test -- --run
npm run build

# Public Portal
cd ../awcms-public/primary
npm run check
npm run build

# Smandapbun portal
cd ../smandapbun
npm run check
npm run lint
npm run build

# Docs link check parity
cd ../../awcms
npm run docs:check

# Edge Worker
cd ../awcms-edge
npm run typecheck

# MCP server
cd ../awcms-mcp
npm run lint
npm run build

# External extension package
cd ../awcms-ext/primary-analytics
npm run build:ci

# Shared package
cd ../../packages/awcms-shared
npm run typecheck

# Mobile
cd ../../awcms-mobile/primary
flutter pub get
flutter analyze
flutter test

# Database lint job parity
cd ../../awcms/supabase
npx supabase db lint
```

## Troubleshooting

- Missing env vars: verify secrets and repo variables.
- Cloudflare deploys: `CLOUDFLARE_API_TOKEN` is required and must be scoped to a single account with access to the Accounts API. The workflow resolves the account ID automatically via the Cloudflare Accounts API.
- Public build env mismatch: CI injects `PUBLIC_SUPABASE_*`, while runtime code often prefers `VITE_SUPABASE_*`. Keep values aligned; `createClientFromEnv` accepts both.
- DB lint warnings: `supabase db lint` may report known advisory warnings (for example `extensions.index_advisor`) while still passing CI. Track these in migration notes before treating as regressions.
- Deploy scope confusion: `deploy-production` currently deploys only `awcms/dist` (admin panel). Public deployment remains a separate Cloudflare Pages pipeline.
- Docs workflow differences: docs link checks run in `docs-link-check.yml` and are independent from `ci-pr.yml` and `ci-push.yml`.
- Docs workflow limitation: `markdown-link-check` can still report some filesystem links as pending `[ / ]`, but the local validator script now enforces the existence of maintained local targets before that step runs.
- Extension coverage scope: only `awcms-ext/primary-analytics/` is covered by a dedicated CI job today; additional maintained extension packages need to be added explicitly.

## References

- `docs/dev/testing.md`
- `docs/deploy/overview.md`
