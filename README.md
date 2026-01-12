# AWCMS Monorepo

Welcome to the AWCMS monorepo. AWCMS is a multi-tenant CMS platform with admin, public, mobile, and IoT clients backed by Supabase.

## Project Structure

| Directory | Description | Tech Stack |
| --- | --- | --- |
| `awcms/` | Admin Panel | React 18.3.1, Vite 7, Supabase |
| `awcms-public/primary/` | Public Portal | Astro 5, React 18.3.1 |
| `awcms-mobile/primary/` | Mobile App | Flutter |
| `awcms-esp32/primary/` | IoT Firmware | ESP32, PlatformIO |
| `awcms-ext/` | External Extensions | JavaScript modules |
| `supabase/` | Migrations and Edge Functions | Supabase CLI |

## Quick Start

### Admin Panel

```bash
cd awcms
npm install
cp .env.example .env.local
npm run dev
```

### Public Portal

```bash
cd awcms-public/primary
npm install
# Create .env with Supabase variables
npm run dev
```

### Mobile App

```bash
cd awcms-mobile/primary
flutter pub get
cp .env.example .env
flutter run
```

### ESP32 Firmware

```bash
cd awcms-esp32/primary
cp .env.example .env
source .env && pio run -t uploadfs && pio run -t upload
```

## Documentation

- `DOCS_INDEX.md` (monorepo index)
- `AGENTS.md` (AI agent rules)

## Contributing

See `CONTRIBUTING.md`.

## License

See `LICENSE`.
