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
| `deploy-production` | Cloudflare Pages deploy | `awcms/` | ci-push |

### Required Secrets

- `VITE_SUPABASE_URL` (admin build)
- `VITE_SUPABASE_PUBLISHABLE_KEY` (admin build)
- `PUBLIC_SUPABASE_URL` (public build fallback)
- `PUBLIC_SUPABASE_PUBLISHABLE_KEY` (public build fallback)
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
```

## Troubleshooting

- Missing env vars: verify secrets and repo variables.
- Cloudflare deploys: `CLOUDFLARE_API_TOKEN` is required and must be scoped to a single account with access to the Accounts API. The workflow resolves the account ID automatically via the Cloudflare Accounts API.
- Public build env mismatch: CI injects `PUBLIC_SUPABASE_*`, while runtime code prefers `VITE_SUPABASE_*`. Keep values aligned; `createClientFromEnv` accepts both.

## References

- `docs/dev/testing.md`
- `docs/deploy/overview.md`
