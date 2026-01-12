# Installation Guide

## Purpose
Provide setup steps for each AWCMS package in the monorepo.

## Audience
- Developers setting up local environments
- Operators validating prerequisites

## Prerequisites
- Node.js 20+ (for admin/public)
- npm 10+
- Flutter 3.10+ (for mobile)
- PlatformIO (for ESP32)
- Supabase project (URL and anon key)

## Steps

### 1. Admin Panel (awcms)

```bash
cd awcms
npm install
cp .env.example .env.local
npm run dev
```

### 2. Public Portal (awcms-public/primary)

```bash
cd awcms-public/primary
npm install
# Create .env with required variables
npm run dev
```

Required public env vars:

```env
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
VITE_DEV_TENANT_HOST=localhost
```

### 3. Mobile App (awcms-mobile/primary)

```bash
cd awcms-mobile/primary
flutter pub get
cp .env.example .env
dart run build_runner build
flutter run
```

### 4. ESP32 Firmware (awcms-esp32/primary)

```bash
cd awcms-esp32/primary
cp .env.example .env
source .env && pio run -t uploadfs && pio run -t upload
```

## Verification

- Admin: open `http://localhost:3000`
- Public: open `http://localhost:4321`
- Mobile: confirm device logs in and loads data
- ESP32: confirm device boots and reports data

## Troubleshooting

- See `TROUBLESHOOTING.md` for common issues.

## References

- `../00-core/SUPABASE_INTEGRATION.md`
- `../01-guides/CONFIGURATION.md`
