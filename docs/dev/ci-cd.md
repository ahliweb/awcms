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
| `lint-build-public` | Build public portal | `awcms-public/primary/` | ci-push, ci-pr |
| `build-mobile` | Flutter build and tests | `awcms-mobile/primary/` | ci-push, ci-pr |
| `db-check` | Supabase migration lint | `awcms/supabase` | ci-pr |
| `deploy-production` | Cloudflare Pages deploy (admin panel artifact) | `awcms/` | ci-push |

### Runtime Notes

- Current GitHub workflows set `NODE_VERSION=20` (legacy pin in `.github/workflows/ci-push.yml` and `.github/workflows/ci-pr.yml`).
- Repository runtime baseline remains Node `>=22.12.0`; align workflow Node versions with package `engines` before enforcing strict engine checks.

### Required Secrets

- `VITE_SUPABASE_URL` (admin build)
- `VITE_SUPABASE_PUBLISHABLE_KEY` (admin build, preferred)
- `VITE_SUPABASE_ANON_KEY` (legacy CI alias still consumed by workflows; mirror publishable key value)
- `PUBLIC_SUPABASE_URL` (public build fallback)
- `PUBLIC_SUPABASE_PUBLISHABLE_KEY` (public build fallback, preferred)
- `PUBLIC_SUPABASE_ANON_KEY` (legacy CI alias still consumed by workflows; mirror publishable key value)
- `PUBLIC_TENANT_ID` (public build tenant scope)
- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ENABLED` (repo variable; must be `true` to deploy)

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
- Public build env mismatch: CI injects `PUBLIC_SUPABASE_*`, while runtime code often prefers `VITE_SUPABASE_*`. Keep values aligned; `createClientFromEnv` accepts both. Legacy `*_ANON_KEY` aliases should match the publishable keys.
- Deploy scope confusion: `deploy-production` currently deploys only `awcms/dist` (admin panel). Public deployment remains a separate Cloudflare Pages pipeline.

## References

- `docs/dev/testing.md`
- `docs/deploy/overview.md`
