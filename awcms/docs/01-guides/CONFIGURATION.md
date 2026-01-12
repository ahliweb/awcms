# Configuration Guide

## Purpose
List required environment variables and configuration files for each package.

## Audience
- Developers configuring local environments
- Operators configuring production deployments

## Prerequisites
- `awcms/docs/00-core/SUPABASE_INTEGRATION.md`

## Steps

### Admin Panel (`awcms/.env.local`)

Copy `awcms/.env.example` to `awcms/.env.local` and configure:

```env
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
VITE_TURNSTILE_SITE_KEY=...
```

Optional admin variables:

```env
VITE_SUPABASE_SERVICE_ROLE_KEY=...   # server-side only
VITE_CORS_ALLOWED_ORIGINS=...
VITE_SUPER_ADMIN_EMAIL=...
VITE_DEV_TENANT_SLUG=primary
MAILKETING_API_TOKEN=...
MAILKETING_DEFAULT_LIST_ID=...
```

### Public Portal (`awcms-public/primary/.env`)

Create `awcms-public/primary/.env` with:

```env
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
VITE_DEV_TENANT_HOST=localhost
```

### Mobile App (`awcms-mobile/primary/.env`)

Copy `awcms-mobile/primary/.env.example` to `.env` and set:

```env
SUPABASE_URL=...
SUPABASE_ANON_KEY=...
```

### ESP32 Firmware (`awcms-esp32/primary/.env`)

Copy `awcms-esp32/primary/.env.example` to `.env` and set WiFi and Supabase credentials.

## Verification

- Ensure each app boots without missing env variable errors.
- Confirm Supabase requests include tenant headers.

## Troubleshooting

- Missing Supabase URL/key: confirm `.env.local` or `.env` files exist.
- Tenant not found: verify `VITE_DEV_TENANT_SLUG` or `VITE_DEV_TENANT_HOST`.

## References

- `../00-core/MULTI_TENANCY.md`
- `../00-core/SUPABASE_INTEGRATION.md`
