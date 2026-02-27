> **Documentation Authority**: [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) Section 1 (Tech Stack)

# Cloudflare Pages Deployment

## Purpose

Provide Cloudflare Pages settings for the Admin Panel and Public Portal.

## Audience

- Operators deploying AWCMS to Cloudflare

## Prerequisites

- [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) - **Primary authority** for Cloudflare deployment configuration
- [AGENTS.md](../../AGENTS.md) - Implementation patterns and Context7 references
- Cloudflare account
- Supabase project configured

## Steps

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
| Project name | `awcms-public-smandapbun` (example) |
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

KV bindings: none (sessions use the in-memory driver).

### Optional Secret Sync Helper

Use `scripts/update_cloudflare_secrets.sh` (repo root) to sync project env values into Cloudflare Pages secrets interactively.

### GitHub Actions Secret Mapping

- `ci-push.yml` and `ci-pr.yml` currently map repository `VITE_SUPABASE_*` values into `PUBLIC_SUPABASE_*` env names for the public build job.
- Keep both key sets aligned in Cloudflare and GitHub secrets if you use both pipelines.
- Admin production deploy from GitHub Actions currently targets only `awcms-admin`.

## Verification

- Public portal returns tenant-resolved pages.
- Admin panel loads and authenticates.

## Troubleshooting

- Build failures: verify root directory and Node version.
- Tenant resolution issues: confirm `PUBLIC_TENANT_ID` (static) or middleware/host settings (SSR).

## References

- `docs/deploy/overview.md`
- `docs/tenancy/overview.md`
