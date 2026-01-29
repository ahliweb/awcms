# Deployment Guide

## Purpose

Describe deployment steps for each AWCMS package in the monorepo.

## Audience

- Operators deploying admin, public, mobile, or IoT packages
- Engineers validating build output

## Prerequisites

- `docs/dev/setup.md`
- Cloudflare Pages account (admin/public)

## Steps

### 1. Public Portal (Cloudflare Pages)

- Root directory: `awcms-public/primary`
- Framework preset: Astro
- Build command: `npm run build`
- Output directory: `dist`
- Required env vars: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`

### 2. Admin Panel (Cloudflare Pages)

- Root directory: `awcms`
- Framework preset: None or Vite
- Build command: `npm run build`
- Output directory: `dist`
- Required env vars: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_TURNSTILE_SITE_KEY`
- Set `NODE_VERSION=20`

### 3. Supabase

- Apply migrations from repo root:

```bash
npx supabase db push
```

- Deploy edge functions as needed:

```bash
npx supabase functions deploy
```

### 3.1 Supabase Auth URLs

- Set Site URL to your admin panel domain.
- Add redirect URLs for admin and public domains (including wildcards if needed).

### 4. Mobile App (Flutter)

```bash
cd awcms-mobile/primary
flutter build appbundle --release
flutter build ipa --release
```

### 5. ESP32 Firmware

```bash
cd awcms-esp32/primary
source .env && pio run -t uploadfs && pio run -t upload
```

## Verification

- Admin panel loads and resolves tenant by domain.
- Public portal resolves tenant via middleware and renders pages.
- Mobile app authenticates via Supabase.
- ESP32 reports telemetry to Supabase.

## Troubleshooting

- Cloudflare build failures: verify root directory and Node version.
- Supabase auth redirects: set Site URL and redirect URLs in Supabase.

## References

- `docs/deploy/cloudflare.md`
- `docs/tenancy/supabase.md`
