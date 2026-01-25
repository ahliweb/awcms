# CI/CD Pipeline

## Purpose

Describe the GitHub Actions workflows used for AWCMS.

## Audience

- Maintainers and release engineers
- Contributors validating CI expectations

## Prerequisites

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

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
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
- Public build env mismatch: ensure CI passes the same `VITE_*` variables that the code expects.

## References

- `docs/dev/testing.md`
- `docs/deploy/overview.md`
