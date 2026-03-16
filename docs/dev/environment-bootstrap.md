# Environment Bootstrap Guide

> Documentation Authority: `SYSTEM_MODEL.md` -> `AGENTS.md` -> `README.md` -> `DOCS_INDEX.md`

## Purpose

Explain how to clone the AWCMS ecosystem, prepare a new development configuration, and align automated deployment inputs for the maintained admin, public, edge, and MCP surfaces.

This guide is intended for a fresh clone/local environment. The setup helper will not remove or mutate existing local tenant data.

## Clone the Ecosystem

```bash
git clone <repository_url>
cd awcms-dev
```

After cloning, install dependencies in the maintained workspaces:

```bash
cd awcms && npm install
cd ../awcms-public/primary && npm install
cd ../smandapbun && npm install
cd ../../awcms-edge && npm install
cd ../awcms-mcp && npm install
cd ../packages/awcms-shared && npm install
```

## Files You Must Configure

| Target | File | Purpose |
| --- | --- | --- |
| Admin app | `awcms/.env.local` | Supabase publishable config, Worker URLs, Cloudflare/R2/deployment secrets |
| Public portal (`primary`) | `awcms-public/primary/.env.local` | Build-time tenant identity and public runtime config |
| Public portal (`smandapbun`) | `awcms-public/smandapbun/.env.local` | Dedicated tenant build-time config |
| Worker | `awcms-edge/.dev.vars` | Cloudflare Worker local runtime, R2, secret, rebuild, and Turnstile config |
| MCP server | `awcms-mcp/.env` | Supabase DB URL and Context7 key |
| Optional mobile app | `awcms-mobile/primary/.env` | Mobile Supabase + default tenant config |

## Required Inputs

These values are required for a usable local/dev + deployment-aligned setup:

### Shared Core

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SECRET_KEY`
- `VITE_EDGE_URL`
- `VITE_REMOTE_EDGE_URL`
- `CONTEXT7_API_KEY`

### Cloudflare / R2

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`
- `R2_ACCOUNT_ID`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_BUCKET_NAME`
- `R2_REGION`
- `R2_CUSTOM_DOMAIN`
- `R2_S3_API_ENDPOINT`

### Worker / Rebuild / Turnstile

- `TURNSTILE_SECRET_KEY`
- `VITE_TURNSTILE_SITE_KEY`
- `GITHUB_REBUILD_TOKEN`
- `GITHUB_REBUILD_OWNER`
- `GITHUB_REBUILD_REPO`
- `GITHUB_REBUILD_EVENT_TYPE`
- `SMANDAPBUN_REBUILD_WEBHOOK_SECRET`

### Tenant Build-Time Inputs

- at least one tenant is required
- `PUBLIC_TENANT_ID` for the first tenant/public app
- `PUBLIC_TENANT_SLUG` for the first tenant/public app
- optional second tenant/public app values can also be provided

## Automated Deployment Inputs

For Cloudflare Pages / Workers and GitHub Actions, keep these aligned:

| Surface | Required Inputs |
| --- | --- |
| Cloudflare Pages (`awcms`) | `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_EDGE_URL`, `VITE_TURNSTILE_SITE_KEY` |
| Cloudflare Pages (`awcms-public/primary`) | `PUBLIC_SUPABASE_URL`, `PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `PUBLIC_TENANT_ID`, `PUBLIC_TENANT_SLUG`, `PUBLIC_TURNSTILE_SITE_KEY` |
| Cloudflare Pages (`awcms-public/smandapbun`) | `PUBLIC_SUPABASE_URL`, `PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `PUBLIC_TENANT_ID`, `PUBLIC_TENANT_SLUG`, `PUBLIC_TURNSTILE_SITE_KEY`, `CLOUDFLARE_ACCOUNT_ID` |
| Cloudflare Worker (`awcms-edge`) | `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, all `R2_*`, rebuild tokens, Turnstile secret |
| GitHub Actions | repository secrets matching the Pages/Worker runtime inputs above |

## Recommended Bootstrap Order

1. Clone the repo.
2. Generate local env files.
3. Start local Supabase.
4. Push local migrations.
5. Bootstrap the default admin/owner account.
6. Run local admin/public/edge services.
7. Run `bash scripts/ci-validate-runtime.sh`.
8. Mirror the same values into Cloudflare Pages, Wrangler secrets, and GitHub Actions secrets.

## Python Setup Helper

Use the interactive bootstrap helper:

```bash
python3 scripts/setup_awcms_environment.py
```

Or run it in non-interactive mode with a JSON file:

```bash
python3 scripts/setup_awcms_environment.py --config-json path/to/setup.json
```

Advanced disposable-environment automation can skip the existing-tenant safety check:

```bash
python3 scripts/setup_awcms_environment.py --config-json path/to/setup.json --force-fresh-check-skip
```

Behavior:

- prompts for all required values before writing anything
- aborts the entire setup if any required field is left blank
- aborts if existing local tenant data is detected in the local cloned AWCMS database
- `--force-fresh-check-skip` bypasses that tenant-data safety check and should only be used in disposable/controlled automation environments
- writes only local developer configuration files
- optionally prepares MCP and mobile env files too
- generates `setup-output/deployment-checklist.md` after a successful run

Example JSON shape:

```json
{
  "VITE_SUPABASE_URL": "https://your-project.supabase.co",
  "VITE_SUPABASE_PUBLISHABLE_KEY": "your-publishable-key",
  "SUPABASE_SECRET_KEY": "your-secret-key",
  "VITE_EDGE_URL": "https://your-worker.workers.dev",
  "VITE_LOCAL_EDGE_URL": "http://127.0.0.1:8787",
  "CONTEXT7_API_KEY": "your-context7-key",
  "VITE_TURNSTILE_SITE_KEY": "your-turnstile-site-key",
  "TURNSTILE_SECRET_KEY": "your-turnstile-secret",
  "CLOUDFLARE_ACCOUNT_ID": "your-account-id",
  "CLOUDFLARE_API_TOKEN": "your-cloudflare-api-token",
  "R2_ACCOUNT_ID": "your-r2-account-id",
  "R2_ACCESS_KEY_ID": "your-r2-access-key-id",
  "R2_SECRET_ACCESS_KEY": "your-r2-secret-access-key",
  "R2_BUCKET_NAME": "your-r2-bucket-name",
  "R2_REGION": "auto",
  "R2_CUSTOM_DOMAIN": "media.example.com",
  "R2_S3_API_ENDPOINT": "https://<account>.r2.cloudflarestorage.com",
  "MAILKETING_API_TOKEN": "your-mailketing-token",
  "MAILKETING_DEFAULT_LIST_ID": "1",
  "GITHUB_REBUILD_TOKEN": "your-github-token",
  "GITHUB_REBUILD_OWNER": "your-org",
  "GITHUB_REBUILD_REPO": "your-repo",
  "GITHUB_REBUILD_EVENT_TYPE": "smandapbun-content-changed",
  "SMANDAPBUN_REBUILD_WEBHOOK_SECRET": "your-rebuild-secret",
  "PRIMARY_TENANT_ID": "tenant-uuid-primary",
  "PRIMARY_TENANT_SLUG": "primary",
  "SMANDAPBUN_TENANT_ID": "tenant-uuid-smandapbun",
  "SMANDAPBUN_TENANT_SLUG": "smandapbun",
  "PUBLIC_TURNSTILE_SITE_KEY": "your-public-turnstile-key",
  "MCP_SUPABASE_DB_URL": "postgresql://postgres:password@db.project.supabase.co:5432/postgres",
  "CONFIGURE_MOBILE": true
}
```

A ready-to-edit template is included at:

- `scripts/setup_awcms_environment.sample.json`

If you only want a minimum one-tenant bootstrap, provide the primary tenant fields and leave the optional secondary tenant fields blank.

## Post-Setup Validation

```bash
npx supabase start
npx supabase db push --local
bash scripts/verify_supabase_migration_consistency.sh
bash scripts/ci-validate-runtime.sh
```

## References

- `docs/dev/setup.md`
- `docs/deploy/cloudflare.md`
- `docs/architecture/runtime-boundaries.md`
- `docs/dev/release-summary-2026-03-extension-runtime-hardening.md`
