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
| `lint-build-public` | Build public portal (no lint step in workflow yet) | `awcms-public/primary/` | ci-push, ci-pr |
| `build-mobile` | Flutter build and tests | `awcms-mobile/primary/` | ci-push, ci-pr |
| `db-check` | Supabase migration lint | `awcms/supabase` | ci-pr |
| `deploy-production` | Cloudflare Pages deploy (admin panel artifact) | `awcms/` | ci-push |
| `link-check` | Markdown link validation | repo root | docs-link-check |

### Runtime Notes

- GitHub workflows pin Node runtime to `22.12.0` to match package `engines` constraints.
- Keep workflow/runtime Node versions aligned with `SYSTEM_MODEL.md` and package `engines` before bumping toolchains.

### Required Secrets and Variables (GitHub Actions)

- `VITE_SUPABASE_URL` (used by admin build/test and mapped into public build env)
- `VITE_SUPABASE_PUBLISHABLE_KEY` (used by admin build/test and mapped into public build env)
- `CLOUDFLARE_API_TOKEN` (required by `deploy-production`)
- `CLOUDFLARE_ENABLED` (repo variable; must be `true` for deploy job execution)

Notes:

- `ci-pr` uses mock Supabase values for admin/public jobs and does not require repository Supabase secrets.
- Public portal CI jobs currently map `VITE_*` secrets into `PUBLIC_*` variables in workflow env.
- `PUBLIC_TENANT_ID` is still required for static tenant-scoped production builds, but is not currently injected by the GitHub CI workflows.

## Verification

Run locally before pushing:

```bash
# Admin Panel
cd awcms
npm run lint
npm run test -- --run
npm run build

# Public Portal
cd ../awcms-public/primary
npm run build

# Docs link check parity
cd ../../awcms
npm run docs:check

# Mobile
cd ../../awcms-mobile/primary
flutter pub get
flutter analyze
flutter test

# Database lint job parity
cd ../../awcms/supabase
supabase db lint
```

## Troubleshooting

- Missing env vars: verify secrets and repo variables.
- Cloudflare deploys: `CLOUDFLARE_API_TOKEN` is required and must be scoped to a single account with access to the Accounts API. The workflow resolves the account ID automatically via the Cloudflare Accounts API.
- Public build env mismatch: CI injects `PUBLIC_SUPABASE_*`, while runtime code often prefers `VITE_SUPABASE_*`. Keep values aligned; `createClientFromEnv` accepts both.
- Deploy scope confusion: `deploy-production` currently deploys only `awcms/dist` (admin panel). Public deployment remains a separate Cloudflare Pages pipeline.
- Docs workflow differences: docs link checks run in `docs-link-check.yml` and are independent from `ci-pr.yml` and `ci-push.yml`.

## References

- `docs/dev/testing.md`
- `docs/deploy/overview.md`
