> **Documentation Authority**: [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) Section 1 (Tech Stack)

# Cloudflare Pages Deployment

## Purpose

Provide Cloudflare deployment settings for the Admin Panel, Public Portal, Worker gateway, and R2-backed storage model.

## Audience

- Operators deploying AWCMS to Cloudflare

## Prerequisites

- [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) - **Primary authority** for Cloudflare deployment configuration
- [AGENTS.md](../../AGENTS.md) - Implementation patterns and Context7 references
- Cloudflare account
- Supabase project configured

## Steps

### Architecture Note

- Cloudflare Workers (`awcms-edge/`) are the maintained server-side edge gateway for AWCMS clients.
- Cloudflare R2 is the maintained object storage layer for file/media delivery.
- Supabase remains responsible for Auth, PostgreSQL, RLS, and ABAC.

### Admin Panel (awcms)

| Setting | Value |
| --- | --- |
| Project name | `awcms-admin` (example) |
| Framework preset | Vite or None |
| Root directory | `awcms` |
| Build command | `npm run build` |
| Output directory | `dist` |
| Node version | `22` (or `>=22.12.0`) |

Environment variables:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `VITE_TURNSTILE_SITE_KEY`
- `NODE_VERSION=22`

### Public Portal (awcms-public/primary)

| Setting | Value |
| --- | --- |
| Project name | `awcms-public` (example) |
| Framework preset | Astro |
| Root directory | `awcms-public/primary` |
| Build command | `npm run build` |
| Output directory | `dist` |
| Node version | `22` (or `>=22.12.0`) |

Environment variables:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `PUBLIC_SUPABASE_URL` / `PUBLIC_SUPABASE_PUBLISHABLE_KEY` (build/runtime fallback)
- `PUBLIC_TENANT_ID` (fallbacks: `VITE_PUBLIC_TENANT_ID`, `VITE_TENANT_ID`)
- `NODE_VERSION=22`

**Runtime note**: Public portals are built as static sites; environment variables are resolved at build time via `import.meta.env`.

### Public Portal (awcms-public/smandapbun)

| Setting | Value |
| --- | --- |
| Project name | `awcms-smandapangkalanbun-web` |
| Framework preset | Astro |
| Root directory | `awcms-public/smandapbun` |
| Build command | `npm run build` |
| Output directory | `dist` |
| Node version | `22` (or `>=22.12.0`) |

Environment variables:

- `PUBLIC_SUPABASE_URL`
- `PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `PUBLIC_TURNSTILE_SITE_KEY`
- `NODE_VERSION=22`

Custom domains:

- `sman2pangkalanbun.sch.id`
- `www.sman2pangkalanbun.sch.id`

Automated rebuild flow:

- Cloudflare Pages deploy hook -> production rebuild for content-only changes.
- Admin panel save/delete events -> `awcms-edge/api/public/rebuild` -> tenant deploy hook.
- The maintained repository workflows currently include `CI/CD`, `CI (PR)`, and `Documentation Link Check`; SMANDAPBUN repository-based deploys should use the existing Cloudflare Pages project/deploy-hook path unless a dedicated workflow is reintroduced.

KV bindings: none currently required by the maintained repo baseline.

Middleware currently uses cookie-based identifiers/tracking rather than an in-repo KV-backed or
in-memory session driver.

### Optional Secret Sync Helper

Use `scripts/update_cloudflare_secrets.sh` (repo root) to sync project env values into Cloudflare Pages secrets interactively.

### GitHub Actions Secret Mapping

- `ci-push.yml` maps repository `VITE_SUPABASE_*` secrets into `PUBLIC_SUPABASE_*` env names for the public build job.
- `ci-pr.yml` uses mock `PUBLIC_SUPABASE_*` values so fork-safe validation can run without repository secrets.
- Keep both key sets aligned in Cloudflare and GitHub secrets if you use both pipelines.
- Admin production deploy from GitHub Actions currently targets only `awcms-admin`.

## Verification

- Public portal returns tenant-resolved pages.
- Admin panel loads and authenticates.

## Troubleshooting

- Build failures: verify root directory and Node version.
- Tenant resolution issues: confirm `PUBLIC_TENANT_ID` for canonical static builds; only inspect middleware/host settings when working on non-canonical SSR/runtime experiments.

## References

- `docs/deploy/overview.md`
- `docs/tenancy/overview.md`
