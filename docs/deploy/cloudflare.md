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

**Runtime note**: Public portals are built as static sites; environment variables are resolved at build time via `import.meta.env`.

### Public Portal (awcms-public/smandapbun)

| Setting | Value |
| --- | --- |
| Project name | `awcms-public-smandapbun` (example) |
| Framework preset | Astro |
| Root directory | `awcms-public/smandapbun` |
| Build command | `npm run build` |
| Output directory | `dist` |
| Node version | `20` |

Environment variables:

- `PUBLIC_SUPABASE_URL`
- `PUBLIC_SUPABASE_ANON_KEY`
- `PUBLIC_TURNSTILE_SITE_KEY`
- `NODE_VERSION=20`

KV bindings: none (sessions use the in-memory driver).

## Verification

- Public portal returns tenant-resolved pages.
- Admin panel loads and authenticates.

## Troubleshooting

- Build failures: verify root directory and Node version.
- Tenant resolution issues: confirm middleware and tenant domains.

## References

- `docs/deploy/overview.md`
- `docs/tenancy/overview.md`
