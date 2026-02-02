# Cloudflare Pages Deployment

## Purpose

Provide Cloudflare Pages settings for the Admin Panel and Public Portal.

## Audience

- Operators deploying AWCMS to Cloudflare

## Prerequisites

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
| Node version | `20` |

Environment variables:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_TURNSTILE_SITE_KEY`
- `NODE_VERSION=20`

### Public Portal (awcms-public/primary)

| Setting | Value |
| --- | --- |
| Project name | `awcms-public` (example) |
| Framework preset | Astro |
| Root directory | `awcms-public/primary` |
| Build command | `npm run build` |
| Output directory | `dist` |
| Node version | `20` |

Environment variables:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `NODE_VERSION=20`

**Runtime note**: Astro Cloudflare adapter exposes env vars via `runtime.env`; ensure server routes read from it when available.

## Verification

- Public portal returns tenant-resolved pages.
- Admin panel loads and authenticates.

## Troubleshooting

- Build failures: verify root directory and Node version.
- Tenant resolution issues: confirm middleware and tenant domains.

## References

- `docs/deploy/overview.md`
- `docs/tenancy/overview.md`
