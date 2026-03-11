> **Documentation Authority**: [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) Section 1 (Tech Stack)

# Deployment Guide

## Purpose

Describe deployment steps for the maintained AWCMS deploy surfaces in the monorepo.

## Audience

- Operators deploying admin, public, mobile, or IoT packages
- Engineers validating build output

## Prerequisites

- [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) - **Primary authority** for deployment requirements and tech stack
- [AGENTS.md](../../AGENTS.md) - Implementation patterns and Context7 references
- `docs/dev/setup.md`
- Cloudflare Pages account (admin/public)

## Steps

### 1. Public Portal (Cloudflare Pages)

- Root directory: `awcms-public/primary`
- Framework preset: Astro
- Build command: `npm run build`
- Output directory: `dist`
- Required env vars: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `PUBLIC_TENANT_ID` (supports `PUBLIC_SUPABASE_*` as a build fallback)
- Static build; environment variables resolved via `import.meta.env` at build time.

For `awcms-public/smandapbun`:

- Root directory: `awcms-public/smandapbun`
- Required env vars: `PUBLIC_SUPABASE_URL`, `PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `PUBLIC_TURNSTILE_SITE_KEY`
- No KV bindings are currently required by the maintained repo baseline.
- Middleware currently uses cookie-based identifiers/tracking rather than an in-repo KV-backed or in-memory session driver.

### 2. Admin Panel (Cloudflare Pages)

- Root directory: `awcms`
- Framework preset: None or Vite
- Build command: `npm run build`
- Output directory: `dist`
- Required env vars: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_TURNSTILE_SITE_KEY`
- Set `NODE_VERSION=22` (or any value `>=22.12.0`)

### 3. Edge Worker (Cloudflare Workers)

- Root directory: `awcms-edge`
- Runtime: Cloudflare Workers via Wrangler
- Primary deploy command:

```bash
cd awcms-edge
npm install
npm run typecheck
npm run deploy
```

- `awcms-edge/` is the primary edge HTTP layer for AWCMS.
- Treat `awcms-edge/` as the server-side gateway in front of Supabase for privileged HTTP workflows used by web, mobile, IoT, and other clients.
- Keep Supabase as the authority for Auth, Postgres, RLS, and ABAC; Worker-side validation must complement, not replace, database enforcement.
- Configure bindings and runtime settings in `awcms-edge/wrangler.jsonc`.

### 4. Supabase

- Author migration changes in root `supabase/**` and mirror them to `awcms/supabase/**` before CI.
- Verify root/mirror parity from repo root:

```bash
scripts/verify_supabase_migration_consistency.sh
```

- Apply migrations from repo root:

```bash
npx supabase migration list --linked
npx supabase db push --linked
```

> Use `--local` for local dev stacks and `--linked` for remote projects.
If migration history is out of sync, repair before pushing:

```bash
scripts/repair_supabase_migration_history.sh
scripts/repair_supabase_migration_history.sh --apply --linked
```

### 4.1 Supabase Auth URLs

- Set Site URL to your admin panel domain.
- Add redirect URLs for admin and public domains (including wildcards if needed).

### 5. Mobile App (Flutter)

```bash
cd awcms-mobile/primary
flutter build appbundle --release
flutter build ipa --release
```

### 6. ESP32 Firmware

```bash
cd awcms-esp32/primary
source .env && pio run -t uploadfs && pio run -t upload
```

### 7. GitHub Actions Deploy Scope

- `ci-push.yml` deploys only the admin artifact (`awcms/dist`) through `deploy-production`.
- Public portal deployments are managed as separate Cloudflare Pages projects/pipelines.
- `awcms-edge/` validation runs in CI, but Worker deployment is still handled outside the current GitHub Actions workflows.
- Before promoting a public build, run `cd awcms-public/primary && npm run check && npm run build` locally to match the current package validation baseline.

## Verification

- Admin panel loads and resolves tenant by domain.
- Public portal resolves tenant at build time via `PUBLIC_TENANT_ID` and renders static pages.
- Worker routes deploy successfully via Wrangler and resolve required bindings.
- Mobile app authenticates via Supabase.
- ESP32 reports telemetry to Supabase.

## Troubleshooting

- Cloudflare build failures: verify root directory and Node version.
- Supabase auth redirects: set Site URL and redirect URLs in Supabase.

## References

- `docs/deploy/cloudflare.md`
- `docs/tenancy/supabase.md`
