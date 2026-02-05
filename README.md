# AWCMS Monorepo

Welcome to the AWCMS monorepo. AWCMS is a multi-tenant CMS platform with admin, public, mobile, and IoT clients backed by Supabase.

## Project Structure

| Directory | Description | Tech Stack |
| --- | --- | --- |
| `awcms/` | Admin Panel | React 19.2.4, Vite 7, Supabase |
| `awcms-public/primary/` | Public Portal | Astro 5.12.9, React 19.2.4 |
| `awcms-mobile/primary/` | Mobile App | Flutter |
| `awcms-esp32/primary/` | IoT Firmware | ESP32, PlatformIO |
| `awcms-ext/` | External Extensions | JavaScript modules |
| `supabase/` | Migrations and Edge Functions | Supabase CLI |

## Current Stack Versions (Core)

- **React**: 19.2.4 (Admin + Public)
- **Vite**: 7.2.7 (Admin)
- **Astro**: 5.12.9 (Public)
- **TailwindCSS**: 4.1.18
- **Supabase JS**: 2.87.1 (Admin), 2.93.3 (Public)
- **React Router DOM**: 7.10.1
- **TipTap**: 3.13.0
- **Puck**: 0.21.0

## Quick Start

See the **[Developer Setup Guide](docs/dev/setup.md)** for detailed instructions.

- **Admin Panel**: [Guide](docs/dev/admin.md)
- **Public Portal**: [Guide](docs/dev/public.md)
- **Mobile App**: [Guide](docs/dev/mobile.md)
- **IoT Firmware**: [Guide](docs/dev/esp32.md)

## Documentation

- **[DOCS_INDEX.md](DOCS_INDEX.md)**: The central navigation for all documentation.
- **[AGENTS.md](AGENTS.md)**: Rules for AI agents.

## Database & Migrations

- Canonical migrations live in `supabase/migrations/` and are mirrored in `awcms/supabase/migrations/` for the Admin runtime.
- Use `npx supabase db push` to apply new migrations and `supabase db pull` to sync remote history.
- If migration history is out of sync, use `supabase migration repair` before pushing.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

See `LICENSE`.
