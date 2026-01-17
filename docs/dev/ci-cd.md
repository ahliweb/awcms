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

- `.github/workflows/ci.yml`

### Trigger Events

- Push to `main` or `develop`
- Pull requests targeting `main`

### Jobs

| Job | Purpose | Working Directory |
| --- | --- | --- |
| `lint-test-admin` | Lint, test, build admin | `awcms/` |
| `lint-build-public` | Build public portal | `awcms-public/primary/` |
| `build-mobile` | Flutter build and tests | `awcms-mobile/primary/` |
| `db-check` | Supabase migration lint | `awcms/supabase` |
| `deploy-production` | Cloudflare Pages deploy | `awcms/` |

### Required Secrets

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_ENABLED` (repo variable; must be `true` to deploy)

## Verification

Run locally before pushing:

```bash
cd awcms
npm run lint
npm run test -- --run
npm run build
```

## Troubleshooting

- Missing env vars: verify secrets and repo variables.
- Public build env mismatch: ensure CI passes the same `VITE_*` variables that the code expects.

## References

- `docs/dev/testing.md`
- `docs/deploy/overview.md`
